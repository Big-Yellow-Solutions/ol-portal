/* OL Portal · what SES tells us happened to the mail we sent.

   Every send carries the ol-portal-mail configuration set (email.mjs), which
   publishes bounce, complaint, reject and delivery-delay events to an SNS
   topic. This function is subscribed to it.

   For each recipient it does two things:
     - writes a MAILEVENT row (90 days, same as AUDIT) so "did Dana's proposal
       bounce?" has an answer without opening CloudWatch;
     - for a PERMANENT bounce or a complaint, adds the address to the
       suppression list (suppression.mjs), which email.mjs checks before
       sending.

   Transient and undetermined bounces, rejects and delays are recorded but do
   not suppress. The reputation-rate alarms live in template.yaml. */

import { put } from "./util.mjs";
import { suppress, normalizeAddress } from "./suppression.mjs";

const TTL_DAYS = 90;
const masked = a => { const [l = "", d = ""] = String(a).split("@"); return `${l.slice(0, 1)}***@${d}`; };

/** One SES event → [{ address, type, suppress, reason, detail }], one per
 *  recipient. Pure, so the decision table is testable. */
export function recipientsOf(event) {
  const type = String(event.eventType || event.notificationType || "").toLowerCase();
  if (type === "bounce") {
    const b = event.bounce || {};
    const permanent = b.bounceType === "Permanent";
    return (b.bouncedRecipients || []).map(r => ({
      address: r.emailAddress, type: `bounce:${(b.bounceType || "unknown").toLowerCase()}`,
      suppress: permanent, reason: "hard bounce",
      detail: r.diagnosticCode || b.bounceSubType || ""
    }));
  }
  if (type === "complaint") {
    const c = event.complaint || {};
    return (c.complainedRecipients || []).map(r => ({
      address: r.emailAddress, type: "complaint", suppress: true, reason: "complaint",
      detail: c.complaintFeedbackType || ""
    }));
  }
  if (type === "reject") {
    return (event.mail?.destination || []).map(a => ({
      address: a, type: "reject", suppress: false, reason: "rejected", detail: event.reject?.reason || ""
    }));
  }
  if (type === "deliverydelay") {
    return (event.deliveryDelay?.delayedRecipients || []).map(r => ({
      address: r.emailAddress, type: "delay", suppress: false, reason: "delayed", detail: r.diagnosticCode || event.deliveryDelay?.delayType || ""
    }));
  }
  return [];
}

export async function handleEvent(event, now = new Date()) {
  const messageId = event.mail?.messageId || "";
  const out = [];
  for (const r of recipientsOf(event)) {
    const address = normalizeAddress(r.address);
    if (!address) continue;
    await put({
      pk: "MAILEVENT", sk: `${now.toISOString()}#${messageId}#${address}`,
      address, type: r.type, detail: r.detail.slice(0, 500), messageId,
      subject: String(event.mail?.commonHeaders?.subject || "").slice(0, 200),
      suppressed: r.suppress, ttl: Math.floor(now.getTime() / 1000) + TTL_DAYS * 86400
    });
    if (r.suppress) await suppress({ address, reason: r.reason, detail: r.detail, messageId, at: now });
    console.log(JSON.stringify({ level: r.suppress ? "warn" : "info", message: "mail.event", type: r.type, to: masked(address), suppressed: r.suppress, messageId }));
    out.push({ address, type: r.type, suppressed: r.suppress });
  }
  return out;
}

export const handler = async event => {
  for (const rec of event.Records || []) {
    let body;
    try { body = JSON.parse(rec.Sns.Message); }
    catch { console.log(JSON.stringify({ level: "error", message: "mail.event unparseable" })); continue; }
    await handleEvent(body);
  }
};
