/* OL Portal · Lab Leader Assignment (Pipeline v3).

   The artifact finance needs before any payment is released on a won deal:
   who delivers the engagement, what it costs, and how the lab-leader pool
   splits between them. It supersedes the v2 "Assignment Notice", which was a
   blocking modal at close time plus a per-leader signature ceremony. Two
   things changed in v3 and both are deliberate:

   - Closing no longer waits on it. A deal that is won is won; the assignment
     is chased afterwards (the UI nudges, app.mjs no longer blocks). A deal
     that is *lost* never needs one at all.
   - One approver instead of many signatures. The filer can revise freely
     until it is approved; after that only the approver can reopen it. That is
     the whole point of the gate — the numbers stop moving once they are
     agreed, so nobody can change a split behind anybody's back.

   The stored record is the receipt: what was filed, by whom, and whether it
   has been approved. Money is recomputed here on every write rather than
   trusted from the client. */

import { resp, today, get, put, listType, fullName, esc } from "./util.mjs";
import { notify } from "./notifications.mjs";
import { sendSystemEmail } from "./email.mjs";

/* Swappable so a test can watch the outbox without an SES client. */
export const mailer = { send: sendSystemEmail };

/* Config, per the handoff's "tweakable props — surface as config, not UI". */
export const POOL_PCT = 70;
export const SOFT_RESERVE_PCT = 5;
/* Who may approve. A role check would be the natural fit for this codebase,
   but there are two Admins and only one of them is the approver, so this is a
   person. Changing who approves is changing this line.

   It is named by email, and matched against a PERSON's key OR its `email`
   attribute. The WorkOS cutover re-keyed the roster by email, and this used to
   hardcode the old first-name key `liz` — which then matched nobody, so the
   approver got no bell notice and no Approve button. Matching both shapes
   means a legacy first-name record carrying the address still works too. */
export const APPROVER = (process.env.ASSIGNMENT_APPROVER || "liz@optimisticlabs.com").trim().toLowerCase();

const lower = v => String(v || "").trim().toLowerCase();

export const isApprover = person =>
  !!person && (lower(person.sk) === APPROVER || lower(person.email) === APPROVER);

/* The approver's PERSON key, from a roster the caller already has (bootstrap
   reads it anyway) or from the table. Null when nobody matches. */
export async function approverKey(people) {
  const direct = people ? null : await get("PERSON", APPROVER);
  if (direct) return direct.sk;
  const match = (people || (await listType("PERSON"))).find(isApprover);
  return match ? match.sk : null;
}

/* Where someone's mail goes: their `email`, or their key when the key is an
   address (every WorkOS-era account is keyed by email). */
const addressOf = (person, key) =>
  String(person?.email || (String(key || "").includes("@") ? key : "")).trim();

/* The deal's own drawer, opened on the Assignment tab — where the Approve
   button and the receipt both live. */
const dealHref = deal => `/pipeline?deal=${encodeURIComponent(deal.sk)}&tab=assignment`;

export const CADENCES = [
  "On signature", "Monthly", "Quarterly", "Annually", "On milestones",
  "50% up front, 50% on delivery"
];

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const money = v => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/* The pool math, in one place because three surfaces render it: the form's
   live preview, the filed receipt, and whatever finance exports later. Every
   step rounds to whole dollars so the breakdown always adds up on screen. */
export function assignmentMath({ contractValue = 0, hardCosts = 0, subcontractorCosts = 0, leaders = [] }) {
  const gross = Math.max(contractValue, 0);
  const soft = Math.round((gross * SOFT_RESERVE_PCT) / 100);
  const net = Math.max(gross - hardCosts - subcontractorCosts - soft, 0);
  const pool = Math.round((net * POOL_PCT) / 100);
  return {
    softReserve: soft,
    net,
    pool,
    payouts: leaders.map(l => ({ key: l.key, pct: l.pct, payout: Math.round((pool * l.pct) / 100) }))
  };
}

/* Shape + arithmetic only; `leaders` are checked against the directory by the
   caller, which needs an await per person. */
export function cleanAssignment(body) {
  const b = body || {};
  const agreementRef = str(b.agreementRef, 200);
  if (!agreementRef) return { error: "a client agreement reference is required" };
  const clientName = str(b.clientName, 200);
  if (!clientName) return { error: "a client name is required" };

  const contractValue = money(b.contractValue);
  if (contractValue === null || contractValue <= 0) return { error: "contract value must be greater than zero" };
  const hardCosts = money(b.hardCosts) ?? 0;
  const subcontractorCosts = money(b.subcontractorCosts) ?? 0;
  if (money(b.hardCosts) === null && b.hardCosts !== undefined) return { error: "invalid hard costs" };
  if (money(b.subcontractorCosts) === null && b.subcontractorCosts !== undefined) return { error: "invalid subcontractor costs" };

  const issued = str(b.issued, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issued)) return { error: "invalid issue date" };

  const cadence = str(b.cadence, 60);
  if (!CADENCES.includes(cadence)) return { error: "invalid payment cadence" };

  if (!Array.isArray(b.leaders) || !b.leaders.length)
    return { error: "at least one lab leader is required" };
  const seen = new Set();
  const leaders = [];
  let pctSum = 0;
  for (const l of b.leaders) {
    const key = str(l && l.key, 80);
    if (!key || seen.has(key)) return { error: "each lab leader can only be listed once" };
    seen.add(key);
    const pct = Number(l.pct);
    if (!Number.isFinite(pct) || pct < 0) return { error: "invalid share" };
    pctSum += pct;
    leaders.push({ key, pct });
  }
  if (Math.abs(pctSum - 100) > 0.01) return { error: "shares must add up to 100%" };

  return {
    value: {
      agreementRef, clientName, contractValue, issued, cadence,
      hardCosts, subcontractorCosts, leaders,
      notes: str(b.notes, 2000)
    }
  };
}

/* A leader is anyone who could own a deal — Lab Leaders, and Admins, since the
   approver herself appears in the handoff's own leader list. */
async function isAssignableLeader(key) {
  const p = await get("PERSON", key);
  return !!p && (p.role === "Admin" || p.role === "Lab Leader");
}

/* Pipeline v4: an assignment used to unlock only once a deal was fully Closed
   Won. It now unlocks at Contracted — the paperwork finance needs to plan the
   payout is done as soon as the contract is signed, and Closed itself no
   longer means that; it means paid. Mirrors web/lib/pipeline.ts's
   assignmentState (contractRequiredAt). */
const ASSIGNABLE_STAGES = new Set(["Contracted", "Closed"]);

/* File it, or revise a filing that has not been approved yet. */
export async function fileAssignment(ctx, dealId, body) {
  const deal = await get("DEAL", dealId);
  if (!deal) return resp(404, { error: "deal not found" });
  if (!ctx.can.editDeal(deal)) return resp(403, { error: "Not allowed to edit this deal" });
  if (!ASSIGNABLE_STAGES.has(deal.stage))
    return resp(400, { error: "An assignment is only needed once a deal is Contracted or Closed Won" });
  if (deal.assignment?.approved)
    return resp(409, { error: "This assignment is approved and locked — ask the approver to reopen it before editing" });

  const { value, error } = cleanAssignment(body);
  if (error) return resp(400, { error });
  for (const l of value.leaders)
    if (!(await isAssignableLeader(l.key))) return resp(400, { error: `unknown lab leader: ${l.key}` });

  const stamp = new Date().toISOString();
  const assignment = {
    ...value,
    ...assignmentMath(value),
    poolPct: POOL_PCT,
    filedBy: ctx.me.sk,
    filedAt: deal.assignment?.filedAt || stamp,
    updatedAt: stamp,
    approved: false,
    approvedBy: null,
    approvedAt: null
  };
  const next = { ...deal, assignment, updated: today() };
  await put(next);

  /* Two different facts to two different audiences: the leaders learn their
     share is on the record, the approver learns something is queued. Sending
     both as one notification would mean one of them reads the wrong verb. */
  const approver = await approverKey();
  await notify({
    to: value.leaders.map(l => l.key).filter(k => k !== approver),
    kind: "assignment",
    actor: ctx.me.sk,
    actorName: fullName(ctx.me) || ctx.me.sk,
    verb: `filed an assignment naming you on ${deal.client}`,
    snippet: "Waiting on approval before it is locked.",
    meta: "Pipeline",
    href: dealHref(deal)
  });

  /* The approver hears about it on the bell and by email: the filing screen
     promises an email, and the approver is not necessarily in the portal.
     Neither goes out when the approver filed it herself. */
  let approverEmailed = false;
  if (!approver) {
    console.error(JSON.stringify({
      level: "warn", message: "no PERSON matches the assignment approver", approver: APPROVER, deal: deal.sk
    }));
  } else if (approver !== ctx.me.sk) {
    await notify({
      to: [approver],
      kind: "approval",
      actor: ctx.me.sk,
      actorName: fullName(ctx.me) || ctx.me.sk,
      verb: `filed an assignment on ${deal.client} that needs your approval`,
      meta: "Pipeline",
      href: dealHref(deal)
    });
    approverEmailed = await sendMail({
      deal,
      to: [await get("PERSON", approver)],
      subject: `Assignment filed for ${deal.client} · needs your approval`,
      lead: `${fullName(ctx.me) || ctx.me.sk} filed a lab leader assignment on ${deal.client} that needs your approval.`,
      assignment,
      cta: "Review and approve"
    });
  }

  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest, approverEmailed });
}

/* Best-effort like notify(): a bounce must not turn a filing or an approval
   into a 500, so a failure is logged and the send reports false. `to` is a
   list of PERSON records; one without an address is skipped and logged.
   Resolves true only when every recipient's mail went out. */
async function sendMail({ deal, to, subject, lead, assignment, cta }) {
  const url = `${process.env.FRONTEND_URL || ""}${dealHref(deal)}`;
  const usd = n => `$${Number(n || 0).toLocaleString("en-US")}`;
  const lines = [
    `Contract value: ${usd(assignment.contractValue)}`,
    ...(await Promise.all((assignment.leaders || []).map(async l =>
      `${fullName(await get("PERSON", l.key)) || l.key}: ${l.pct}%`)))
  ];
  const plain = `${lead}\n\n${lines.join("\n")}${assignment.notes ? `\n\nNotes: ${assignment.notes}` : ""}\n\n${cta}: ${url}`;
  const html =
    `<p>${esc(lead)}</p>` +
    `<p>${lines.map(esc).join("<br>")}</p>` +
    (assignment.notes ? `<p><strong>Notes:</strong> ${esc(assignment.notes).replace(/\n/g, "<br>")}</p>` : "") +
    `<p><a href="${esc(url)}">${esc(cta)}</a></p>`;

  let ok = true;
  for (const person of to) {
    const address = addressOf(person, person?.sk);
    if (!address) {
      ok = false;
      console.error(JSON.stringify({
        level: "warn", message: "assignment email skipped: no address", person: person?.sk, deal: deal.sk
      }));
      continue;
    }
    try {
      await mailer.send({ toEmail: address, subject, text: plain, html });
      console.log(JSON.stringify({ level: "info", message: "assignments.emailed", deal: deal.sk, to: address, subject }));
    } catch (err) {
      ok = false;
      console.error(JSON.stringify({
        level: "warn", message: "assignment email failed", deal: deal.sk, to: address, detail: err.message
      }));
    }
  }
  return ok;
}

/* Approval is the gate the whole flow exists for, so it is the one action
   nobody else can take — not another Admin, not the person who filed it.
   (The approver filing it herself is allowed to approve: with a single
   approver, separation of duties would otherwise deadlock the deal.) */
export async function approveAssignment(ctx, dealId) {
  const deal = await get("DEAL", dealId);
  if (!deal) return resp(404, { error: "deal not found" });
  if (!isApprover(ctx.me))
    return resp(403, { error: "Only the assignment approver can approve an assignment" });
  if (!deal.assignment) return resp(400, { error: "no assignment has been filed on this deal" });
  if (deal.assignment.approved) return resp(409, { error: "this assignment is already approved" });

  const next = {
    ...deal,
    assignment: {
      ...deal.assignment,
      approved: true,
      approvedBy: ctx.me.sk,
      approvedAt: new Date().toISOString()
    },
    updated: today()
  };
  await put(next);

  /* Everyone with a stake in the split: the deal owner, every leader named on
     it, and whoever filed it. One notice each, and none to the approver. */
  const keys = [...new Set([
    deal.dealOwner || deal.owner,
    ...(deal.assignment.leaders || []).map(l => l.key),
    deal.assignment.filedBy
  ].filter(Boolean))].filter(k => k !== ctx.me.sk);

  await notify({
    to: keys,
    kind: "approval",
    actor: ctx.me.sk,
    actorName: fullName(ctx.me) || ctx.me.sk,
    verb: `approved the assignment on ${deal.client}`,
    snippet: "It is locked now — reopening it takes the approver.",
    meta: "Pipeline",
    href: dealHref(deal)
  });
  const people = (await Promise.all(keys.map(k => get("PERSON", k)))).filter(Boolean);
  const emailed = await sendMail({
    deal,
    to: people,
    subject: `Assignment approved for ${deal.client}`,
    lead: `${fullName(ctx.me) || ctx.me.sk} approved the lab leader assignment on ${deal.client}. The figures are now locked.`,
    assignment: next.assignment,
    cta: "View the assignment"
  });

  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest, notified: people.length, emailed });
}

/* Reopening drops the approval and hands the record back to the filer as a
   draft. The figures are kept rather than deleted — "reopen and edit" means
   correcting what was agreed, not retyping it. */
export async function reopenAssignment(ctx, dealId) {
  const deal = await get("DEAL", dealId);
  if (!deal) return resp(404, { error: "deal not found" });
  if (!isApprover(ctx.me))
    return resp(403, { error: "Only the assignment approver can reopen an approved assignment" });
  if (!deal.assignment) return resp(400, { error: "no assignment has been filed on this deal" });

  const next = {
    ...deal,
    assignment: { ...deal.assignment, approved: false, approvedBy: null, approvedAt: null, reopenedAt: new Date().toISOString() },
    updated: today()
  };
  await put(next);
  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest });
}
