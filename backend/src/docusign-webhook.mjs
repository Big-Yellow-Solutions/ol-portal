/* OL Portal · DocuSign Connect webhook receiver (Authorizer NONE).

   Split out of docusign.mjs because that file makes outbound DocuSign API
   calls and this one only processes inbound events — the same boundary
   execution.mjs draws against signing.mjs.

   Two things this MUST get right, because a webhook endpoint is public and
   DocuSign retries failed deliveries for up to 15 days:

     authenticity   HMAC-SHA256 over the RAW body, verified before anything
                    else touches the payload. API Gateway may hand the body
                    base64-encoded; that has to be decoded first, since the
                    signature covers DocuSign's original bytes.
     idempotency    DocuSign's docs don't name a canonical per-message id, so
                    one is derived from envelope + event + DocuSign's own
                    timestamp. A conditional put makes a replay a no-op
                    instead of re-sending the "please countersign" email a
                    second (or fifth) time. */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { resp, today, get, put, doc, TABLE, esc, docMeta } from "./util.mjs";
import { credsForWebhook, getEnvelopeRecord, saveEnvelopeRecord, appendHistory } from "./docusign.mjs";
import { writeAudit } from "./admin.mjs";
import { sendClientEmail } from "./email.mjs";

export function verifyWebhookSignature(rawBody, headers, hmacKey) {
  if (!hmacKey) return false;
  const mac = createHmac("sha256", hmacKey).update(rawBody).digest("base64");
  for (const [name, value] of Object.entries(headers || {})) {
    if (!/^x-docusign-signature-\d+$/i.test(name)) continue;
    const a = Buffer.from(mac), b = Buffer.from(String(value));
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function webhookDedupeKey(envelopeId, event, generatedAt) {
  return createHash("sha256").update(`${envelopeId}:${event}:${generatedAt}`).digest("hex");
}

async function claimOnce(dedupeKey) {
  try {
    await doc.send(new PutCommand({
      TableName: TABLE,
      Item: { pk: "WEBHOOK_EVENT", sk: dedupeKey, ttl: Math.floor(Date.now() / 1000) + 20 * 86400 },
      ConditionExpression: "attribute_not_exists(pk)"
    }));
    return true;
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

/* Maps a DocuSign envelope completion onto the exact field
   signing.mjs::signSubmit() already writes for a native signature, so
   execution.mjs and the countersign dialog need no changes to keep working.
   OL's own countersignature and full execution stay entirely in signing.mjs. */
async function applyToContract(contractId, envelopeStatus, recipient) {
  const c = await get("CONTRACT", contractId);
  if (!c) return;
  if (envelopeStatus === "completed" && !(c.signatures || {}).client) {
    const record = {
      name: recipient?.name || c.clientSignerName, email: c.clientSignerEmail,
      signatureType: "docusign", consent: true,
      at: new Date().toISOString(), documentHash: c.documentHash
    };
    await put({ ...c, signatures: { ...(c.signatures || {}), client: record }, updated: today() });
    await writeAudit("docusign", "docusign.envelope-completed", `${contractId} · external signer completed`);
    await notifyCountersigner(c);
  }
}

async function notifyCountersigner(c) {
  try {
    const signatory = c.olSignatory ? await get("PERSON", c.olSignatory) : null;
    if (!signatory?.email) return;
    const url = `${process.env.FRONTEND_URL}/contracts.html`;
    const line = `${c.clientSignerName} signed the ${docMeta(c).title} for ${c.client} (${c.sk}) via DocuSign. It needs your countersignature.`;
    await sendClientEmail({
      sender: { name: "Optimistic Labs", email: null },
      subject: `[OL Portal] Countersignature needed: ${docMeta(c).label} · ${c.client}`,
      toEmail: signatory.email,
      text: `${line}\n\nCountersign it here: ${url}\n\n— Optimistic Labs Portal`,
      html: `<p>${esc(line)}</p><p><a href="${url}">Countersign it here</a></p><p>— Optimistic Labs Portal</p>`
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", message: "countersign notification failed", detail: err.message }));
  }
}

const STATUS_MAP = {
  "envelope-sent": "sent", "envelope-delivered": "delivered", "envelope-completed": "completed",
  "envelope-declined": "declined", "envelope-voided": "voided"
};

export async function webhook(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  const c = await credsForWebhook();
  if (!verifyWebhookSignature(raw, event.headers || {}, c.hmacKey)) return resp(401, { error: "invalid signature" });

  let payload;
  try { payload = JSON.parse(raw); } catch { return resp(400, { error: "invalid JSON" }); }
  const envelopeId = payload.data?.envelopeId || payload.envelopeId;
  const eventName = payload.event || "unknown";
  const generatedAt = payload.generatedDateTime || "";
  if (!envelopeId) return resp(200, { ok: true }); // nothing we can act on

  const dedupeKey = webhookDedupeKey(envelopeId, eventName, generatedAt);
  if (!(await claimOnce(dedupeKey))) return resp(200, { ok: true, duplicate: true });

  const newStatus = STATUS_MAP[eventName];
  const rec = await getEnvelopeRecord(envelopeId);
  if (rec && newStatus) {
    await saveEnvelopeRecord(appendHistory({ ...rec, status: newStatus, lastStatusAt: new Date().toISOString() }, eventName));
    if (rec.source === "contract" && rec.contractId)
      await applyToContract(rec.contractId, newStatus, payload.data?.recipient);
  }
  await writeAudit("docusign", "docusign.webhook-received", `${eventName} · envelope ${envelopeId}`);
  return resp(200, { ok: true });
}
