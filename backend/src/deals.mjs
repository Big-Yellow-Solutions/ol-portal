/* OL Portal · deals: the stage model and the create handler.

   Lived in app.mjs until the Optimist's inbox needed to add a lead too: the
   email intake runs in its own Lambda and has to go through the same
   validation, lab scope and id allocation the browser does, so the rules live
   here once and both import them. Nothing about the rules changed in the move. */

import * as contacts from "./contacts.mjs";
import { resp, get, putNew, today, enterStage } from "./util.mjs";

export const STAGES = ["Lead", "Discovery", "Proposal Sent", "Contracted", "Closed", "Closed Lost"];
/* What people see for each stored stage (mirrors web/lib/types.ts's
   STAGE_LABELS). The stored values stay as they are; only the words change. */
export const STAGE_LABEL = {
  "Proposal Sent": "Proposal & Negotiation",
  "Contracted": "Contracted (Signed)",
  "Closed": "Closed Won (Paid)"
};
export const stageLabel = s => STAGE_LABEL[s] ?? s;
/* Pipeline v3 splits the board's final column in two. The won stage keeps the
   stored value "Closed": every rule and report that already reads it means
   "won", so renaming would have churned thirty-odd call sites to say the same
   thing. The lost stage is new, and skips every gate — a deal can be lost from
   anywhere, and losing one needs no billing entity, no sent proposal, no
   signed contract and no assignment. Outcome is derived from the stage now
   rather than picked separately; the two can no longer disagree.
   Pipeline v4 splits "Closed" again: "Contracted" is a signed contract with
   payment still outstanding, and "Closed" now specifically means paid — see
   CONTRACT_GATE_STAGE/INVOICE_GATE_STAGE below. Outcome is unaffected: it is
   still only "Won" at Closed, not at Contracted. */
export const CLOSED_WON = "Closed";
export const CLOSED_LOST = "Closed Lost";
/* Losing a deal still skips every gate, but it now has to say why: the reason
   is what makes a lost deal worth reporting on. Required on the move into the
   lost stage (and on create); a deal that was lost before this existed keeps
   editing freely without one. */
export const cleanLostReason = v => (typeof v === "string" ? v.trim().slice(0, 1000) : "");
export const outcomeOf = stage => (stage === CLOSED_WON ? "Won" : stage === CLOSED_LOST ? "Lost" : null);
// "Network" and "Event" added for Pipeline v2 (design handoff) — additive, so
// deals sourced before this change keep reading the same three values.
export const SOURCES = ["Referral", "Inbound", "Network", "Event", "Outbound"];
export const INVOICE_STATUSES = ["Admin review", "Sent to client", "Paid", "Overdue"];
// Pipeline v2: a deal needs a billing entity (company and/or contact) once it
// reaches this stage. Only enforced on the transition itself — see
// billingGateError below — so it never retroactively blocks a deal that
// reached this stage before companies/contacts existed.
export const BILLING_GATE_STAGE = "Proposal Sent";
// Pipeline v4: a signed contract is required from here on, and an uploaded
// invoice — the portal's stand-in for "paid" — from Closed on. Both are
// ordinal like the two gates above, so skipping straight to Closed from
// anywhere earlier still asks for everything a deal at Closed needs.
export const CONTRACT_GATE_STAGE = "Contracted";
export const INVOICE_GATE_STAGE = CLOSED_WON;

export async function isValidDealOwner(key) {
  const p = await get("PERSON", key);
  return !!p && (p.role === "Admin" || p.role === "Lab Leader");
}

/* `extra` is for server-side callers only (the email intake stamps where a
   deal came from): it is never read from the request body, and the fields the
   handler computes itself always win over it. */
export async function createDeal(ctx, body, extra = {}) {
  if (!ctx.can.addDeal()) return resp(403, { error: "Not allowed to add deals" });
  const { client, lab, owner, dealOwner, stage, amount, close, source, recurring } = body || {};
  const lostReason = cleanLostReason(body?.lostReason);
  const assignable = ctx.role === "Admin" ? null : ctx.me.labs || [];
  if (typeof client !== "string" || !client.trim()) return resp(400, { error: "client is required" });
  if (!(await get("LAB", lab))) return resp(400, { error: "unknown lab" });
  if (assignable && !assignable.includes(lab)) return resp(403, { error: "lab not assignable" });
  if (!STAGES.includes(stage)) return resp(400, { error: "invalid stage" });
  if (!SOURCES.includes(source)) return resp(400, { error: "invalid source" });
  if (!Number.isFinite(amount) || amount < 0) return resp(400, { error: "invalid amount" });
  if (stage === CLOSED_LOST && !lostReason) return resp(400, { error: "A reason is required to close a deal as lost" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(close || "")) return resp(400, { error: "invalid close date" });
  const ownerKey = ctx.role === "Lab Leader" ? ctx.me.sk : (owner || ctx.me.sk);
  if (!(await get("PERSON", ownerKey))) return resp(400, { error: "unknown owner" });
  const dealOwnerKey = dealOwner || ownerKey;
  if (!(await isValidDealOwner(dealOwnerKey))) return resp(400, { error: "unknown deal owner" });
  // Pipeline v2 billing entity: optional at any stage, but a deal can't be
  // *created* at or past the gate stage without one — a proposal/contract/
  // invoice can't exist yet either (the deal itself doesn't exist until this
  // call returns), so those three gates only apply on later transitions
  // (updateDeal).
  const companyId = body.companyId || null;
  const contactId = body.contactId || null;
  /* A billing entity outside the caller's own pipeline is "unknown" to them.
     Without this a Lab Leader could name any company id on a deal of their
     own and read the record straight back out of the next /companies —
     the tenant boundary undone by a write rather than a read. */
  const scope = companyId || contactId ? await contacts.labScope(ctx) : null;
  if (companyId && (!(await get("COMPANY", companyId)) || !contacts.inScope(scope, "companies", companyId)))
    return resp(400, { error: "unknown company" });
  if (contactId && (!(await get("CONTACT", contactId)) || !contacts.inScope(scope, "contacts", contactId)))
    return resp(400, { error: "unknown contact" });
  if (stage !== CLOSED_LOST && STAGES.indexOf(stage) >= STAGES.indexOf(BILLING_GATE_STAGE) && !companyId && !contactId)
    return resp(400, { error: `A deal at ${stageLabel(stage)} needs a billing entity — link a company or a contact` });

  const stamp = today();
  const deal = await putNew("DEAL", "D-", id => ({
    ...extra,
    pk: "DEAL", sk: id, client: client.trim(), lab, owner: ownerKey, dealOwner: dealOwnerKey,
    stage, amount, close, source, recurring: !!recurring, companyId, contactId,
    created: stamp, updated: stamp, stageDates: enterStage({}, stage, stamp),
    ...(outcomeOf(stage) ? { outcome: outcomeOf(stage) } : {}),
    ...(stage === CLOSED_LOST ? { lostReason } : {})
  }));
  const { pk, sk, ...rest } = deal;
  return resp(201, { id: sk, ...rest });
}
