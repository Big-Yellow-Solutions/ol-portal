/* OL Portal · inbound mail: turn a plan into records.

   Phase 2 of the Optimist's inbox. planIntake (inbound-plan.mjs) decides; this
   only does. Every write goes through the same handlers the browser uses —
   createCompany, createContact, createDeal — called with the forwarder's own
   context, so lab scope, validation and id allocation cannot drift from what
   the UI enforces. Nothing here trusts the email: the model's output has
   already been clamped to a schema, and what lab, owner and stage a deal gets
   comes from the forwarder's context and fixed rules, never from the text.

   Order matters: company, then contact (createContact makes the new person the
   company's primary contact when it has none), then the deal that links both.

   If a step fails, whatever was already created stays (there is no
   transaction), and the error carries `created` so the INBOUND row records
   exactly what to clean up. */

import { createCompany, createContact, updateContact } from "./contacts.mjs";
import { createDeal } from "./deals.mjs";
import { notify } from "./notifications.mjs";
import { get } from "./util.mjs";

const body = r => { try { return JSON.parse(r.body); } catch { return {}; } };
const ok = r => r.statusCode >= 200 && r.statusCode < 300;

/* A deal needs a close date. An inbound lead has none, so it gets the same
   thirty days a person adding a lead by hand would be left to overwrite. */
const closeDate = (from = new Date()) => new Date(from.getTime() + 30 * 86400_000).toISOString().slice(0, 10);

/* Extracted phone numbers and websites come out of signatures, and the
   handlers refuse a malformed one with a 400. The record is worth more than
   that one field, so retry once without the optional extras. */
async function createWithFallback(create, full, bare) {
  let r = await create(full);
  if (!ok(r) && r.statusCode === 400 && bare) r = await create(bare);
  return r;
}

export class CreateError extends Error {
  constructor(message, created) { super(message); this.created = created; }
}

/** `plan` is a "ready" plan from planIntake. Returns { created, deal } where
 *  `created` lists only what this call made (matched records are not in it). */
export async function executePlan({ ctx, plan, inboundId, receivedAt = new Date(), subject = "" }) {
  const created = {};
  const origin = { via: "email", inboundId };
  const fail = (what, r) => new CreateError(`${what}: ${body(r).error || r.statusCode}`, { ...created });

  // Company
  let companyId = null;
  if (plan.company?.matched) companyId = plan.company.matched;
  else if (plan.company) {
    const c = plan.company;
    const r = await createWithFallback(
      b => createCompany(ctx, b, { origin }),
      { name: c.name, website: c.website || "" }, { name: c.name });
    if (!ok(r)) throw fail("create company", r);
    companyId = body(r).id;
    created.companyId = companyId;
  }

  // Person
  const p = plan.person;
  let contactId = p.matched || null;
  if (contactId) {
    // Reuse it; fill blanks only, never overwrite what someone already typed.
    const have = (await get("CONTACT", contactId)) || {};
    const patch = {};
    if (!have.title && p.title) patch.title = p.title;
    if (!have.phone && p.phone) patch.phone = p.phone;
    if (Object.keys(patch).length) {
      let r = await updateContact(ctx, contactId, patch);
      if (!ok(r) && patch.phone && patch.title) r = await updateContact(ctx, contactId, { title: patch.title });
      // A refused fill-in is not worth failing the lead over.
    }
  } else {
    const r = await createWithFallback(
      b => createContact(ctx, b, { origin }),
      { name: p.name, email: p.email, phone: p.phone || "", title: p.title || "", companyId },
      { name: p.name, email: p.email, companyId });
    if (!ok(r)) throw fail("create contact", r);
    contactId = body(r).id;
    created.contactId = contactId;
  }

  // Deal. The forwarder owns it: it lands in their lab, in their pipeline.
  const d = plan.deal;
  const others = plan.others?.length
    ? ` Also in the thread: ${plan.others.map(a => a.name || a.address).join(", ")}.` : "";
  const summary = `${d.summary || ""}${others}`.trim().slice(0, 1200);
  const r = await createDeal(ctx, {
    client: plan.company?.name || p.name, lab: plan.lab, stage: d.stage, amount: d.amount,
    close: closeDate(receivedAt), source: d.source,
    owner: ctx.me.sk, dealOwner: ctx.me.sk, companyId, contactId
  }, {
    origin: { ...origin, forwardedBy: ctx.me.sk, receivedAt: receivedAt.toISOString(), subject: (d.subject || subject).slice(0, 200), summary },
    flags: plan.flags.map(f => f.code)
  });
  if (!ok(r)) throw fail("create deal", r);
  const deal = body(r);
  created.dealId = deal.id;

  // Flagged deals tell the forwarder, in the bell as well as the reply.
  if (plan.flags.length) {
    await notify({
      to: [ctx.me.sk], kind: "intake",
      verb: `${deal.client} was added from your email and needs a look`,
      snippet: plan.flags.map(f => f.text).join(" "),
      meta: `${plan.labName} · Pipeline`, href: `/pipeline?deal=${deal.id}`
    });
  }
  return { created, deal };
}
