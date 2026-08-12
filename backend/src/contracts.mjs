/* OL Portal · contracts (PRD 3.6, Base Contract PRD 5.4).

   What changed in the Base Contract PRD build:
   - Generation is explicit. Customer approval used to create a contract as a
     side effect of the public decision route; now the Lab Leader presses
     Generate Contract (FR10) and this module owns the conversion.
   - Scope, pricing and timeline are inherited from the version the customer
     actually approved and kept frozen in `inherited`. The live copy sits
     alongside it, so any later edit to an inherited field can be detected and
     surfaced as a declared deviation (FR11) instead of silently rewriting what
     was agreed.
   - Lab Leaders can edit their own contracts' contract-specific fields
     (payment schedule, signatories, dates) while the contract is still a
     draft. Everything after it goes out for signature is locked.
   - Standard terms come from an Admin-maintained, lab-specific contract
     template merged at generation time (FR12).

   Signing lives in signing.mjs. Signed remains reachable manually by an Admin,
   which is the paper fallback for a client who insists on wet ink. */

import { resp, today, get, put, listType, nextId } from "./util.mjs";
import { writeAudit } from "./admin.mjs";
import { approvedSnapshot } from "./proposals.mjs";
import { contractTemplateFor, mergeClauses, templateVars } from "./templates.mjs";
import {
  cleanPricing, samePricing, pricingTotal, pricingDiffSummary, collapseToSelected
} from "./pricing.mjs";

/* Human labels for deviation messages. The raw section keys leak into a
   customer-visible PDF otherwise. */
const SECTION_LABEL = {
  summary: "Client and problem summary", scope: "Scope", deliverables: "Deliverables",
  timeline: "Timeline", pricing: "Pricing", terms: "Terms"
};

/* "Sent" is retained only so contracts written before this build still validate
   on read; nothing sets it any more. */
export const CONTRACT_STATUSES = ["Draft", "Internal Review", "Out for Signature", "Signed", "Sent"];
const LL_CONTRACT_STATUSES = ["Draft", "Internal Review"];
/* Once a contract is out for signature its content is frozen — the customer is
   looking at a hashed document and changing it underneath them would break the
   audit trail signing.mjs depends on. */
const EDITABLE_STATUSES = ["Draft", "Internal Review"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SECTION_CHARS = 20_000;
const MAX_FIELD = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const INHERITED_SECTIONS = ["summary", "scope", "deliverables", "timeline", "pricing", "terms"];
const str = (v, max) => String(v ?? "").trim().slice(0, max);

/* ---------- generation (FR10) ---------- */

export async function generateContract(ctx, body) {
  const proposalId = body?.proposalId;
  const p = await get("PROPOSAL", proposalId);
  if (!p) return resp(404, { error: "proposal not found" });
  if (!ctx.can.editProposal(p)) return resp(403, { error: "Not allowed to generate a contract for this proposal" });

  const snapshot = approvedSnapshot(p);
  if (!snapshot)
    return resp(409, { error: "Only a customer-approved proposal can become a contract" });

  // One contract per proposal (PRD 7). Pressing the button twice returns the
  // contract that already exists rather than forking the audit trail.
  const existing = (await listType("CONTRACT")).find(c => c.proposal === p.sk);
  if (existing) {
    const { pk, sk, ...rest } = existing;
    return resp(200, { id: sk, ...rest, alreadyExisted: true });
  }

  const [deal, lab, owner, template] = await Promise.all([
    get("DEAL", p.deal), get("LAB", p.lab), get("PERSON", p.owner), contractTemplateFor(p.lab)
  ]);

  /* Collapse a chosen package to a single priced line. The proposal offered a
     menu; the contract is for the one thing they bought, and an agreement that
     also quotes the declined options invites an argument later. Both the frozen
     `inherited` copy and the live one use the collapsed form so deviation
     detection still compares like with like. */
  const pricing = collapseToSelected(snapshot.pricing);

  const id = await nextId("CONTRACT", "C-");
  const base = {
    pk: "CONTRACT", sk: id, proposal: p.sk, deal: p.deal, client: p.client,
    lab: p.lab, owner: deal?.owner || p.author,
    status: "Draft", created: today(), updated: today(),
    // Frozen record of what the customer approved. Never edited afterwards.
    inherited: {
      version: snapshot.version,
      approvedAt: snapshot.approvedAt,
      sections: snapshot.sections,
      pricing
    },
    // The live, editable copy. Starts identical to `inherited`.
    sections: snapshot.sections,
    pricing,
    amount: pricingTotal(pricing) ?? deal?.amount,
    deviationLog: [],
    ...(template ? { templateId: template.sk, templateName: template.name } : {})
  };

  // Standard terms merged from the lab's template (FR12). Placeholders that
  // depend on fields the Lab Leader hasn't filled in yet stay visible and come
  // back in `unresolved` so the UI can block sending until they're closed.
  if (template) {
    const vars = templateVars({ contract: base, deal, lab, owner, signatory: null });
    const { clauses, unresolved } = mergeClauses(template.clauses, vars);
    base.clauses = clauses;
    base.unresolvedVars = unresolved;
  }

  await put(base);
  await writeAudit(ctx.me.sk, "contract.generated",
    `${id} from ${p.sk} v${snapshot.version} (${p.client})${template ? " · template " + template.name : " · NO TEMPLATE"}`);

  const { pk, sk, ...rest } = base;
  return resp(201, { id: sk, ...rest });
}

/* ---------- read ---------- */

export async function listContracts(ctx) {
  const items = await listType("CONTRACT");
  // Contributors aren't lab-scoped like Lab Leaders — they only ever see the
  // contract(s) naming their own email (their copy, downloadable as a PDF).
  // A Lab Leader also sees a contract outside their own lab(s) when they're
  // the Lab Leader named on its deal (PRD 3.3 "leading a project" exception,
  // same as Pipeline/Proposals).
  const visible = ctx.role === "Contributor"
    ? items.filter(c => (c.contributorEmail || "").toLowerCase() === (ctx.me.email || "").toLowerCase())
    : items.filter(c => ctx.can.seesLab(c.lab) || (ctx.role === "Lab Leader" && c.owner === ctx.me.sk));
  visible.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  return resp(200, visible.map(decorate));
}

/* Deviations are computed on read rather than stored as the source of truth, so
   reverting an edit clears the flag instead of leaving a stale warning. The
   append-only `deviationLog` is what preserves the audit trail. */
export function deviationsOf(c) {
  const out = [];
  if (!c?.inherited) return out;
  for (const k of INHERITED_SECTIONS) {
    const before = (c.inherited.sections?.[k] || "").trim();
    const after = (c.sections?.[k] || "").trim();
    if (before !== after)
      out.push({ field: k, summary: `${SECTION_LABEL[k] ?? k} differs from the approved proposal` });
  }
  if (!samePricing(c.inherited.pricing || null, c.pricing || null))
    out.push({ field: "pricing", summary: pricingDiffSummary(c.inherited.pricing, c.pricing) });
  return out;
}

function decorate({ pk, sk, ...rest }) {
  const withId = { id: sk, ...rest };
  const deviations = deviationsOf({ ...rest, sk });
  return { ...withId, deviations, hasDeviations: deviations.length > 0 };
}

/* ---------- edit ---------- */

function canEdit(ctx, c) {
  if (ctx.role === "Admin") return true;
  if (ctx.role !== "Lab Leader") return false;
  return ctx.can.seesLab(c.lab) || c.owner === ctx.me.sk;
}

export async function updateContract(ctx, id, body) {
  const c = await get("CONTRACT", id);
  if (!c) return resp(404, { error: "contract not found" });
  if (!canEdit(ctx, c)) return resp(403, { error: "Not allowed to edit this contract" });

  const b = body || {};
  const next = { ...c };
  const isAdmin = ctx.role === "Admin";

  // Content edits stop the moment the document is in front of a signer.
  const contentKeys = ["sections", "pricing", "clauses", "paymentSchedule",
    "startDate", "endDate", "clientSignerName", "clientSignerTitle", "clientSignerEmail", "olSignatory"];
  const touchesContent = contentKeys.some(k => k in b);
  if (touchesContent && !EDITABLE_STATUSES.includes(c.status))
    return resp(409, { error: `This contract is ${c.status.toLowerCase()} and can no longer be edited` });

  /* --- inherited fields: editable, but the deviation has to be declared --- */
  if ("sections" in b) {
    if (typeof b.sections !== "object" || b.sections === null) return resp(400, { error: "invalid sections" });
    const sections = { ...(c.sections || {}) };
    for (const k of INHERITED_SECTIONS) {
      if (!(k in b.sections)) continue;
      if (typeof b.sections[k] !== "string") return resp(400, { error: "invalid sections" });
      sections[k] = b.sections[k].slice(0, MAX_SECTION_CHARS);
    }
    next.sections = sections;
  }
  if ("pricing" in b) {
    const { value, error } = cleanPricing(b.pricing);
    if (error) return resp(400, { error });
    next.pricing = value;
    next.amount = pricingTotal(value) ?? next.amount;
  }

  // FR11: a change to inherited scope or pricing must be acknowledged, so the
  // record always says whether the contract matches the approved proposal or
  // knowingly departs from it. Reverting back to the approved text needs no
  // acknowledgement, which is why this compares outcomes rather than intent.
  const before = deviationsOf(c);
  const after = deviationsOf(next);
  const added = after.filter(d => !before.some(x => x.field === d.field));
  if (added.length && b.acknowledgeDeviation !== true) {
    return resp(409, {
      error: "This differs from the approved proposal. Confirm the deviation to save it.",
      needsDeviationAck: true,
      deviations: added
    });
  }
  if (added.length) {
    const note = str(b.deviationNote, 500);
    next.deviationLog = [...(c.deviationLog || []), ...added.map(d => ({
      field: d.field, summary: d.summary, note,
      by: ctx.me.sk, at: new Date().toISOString()
    }))];
    for (const d of added)
      await writeAudit(ctx.me.sk, "contract.deviation", `${id} · ${d.summary}${note ? " · " + note : ""}`);
  }

  /* --- contract-only fields (PRD 5.4.3) --- */
  if ("paymentSchedule" in b) next.paymentSchedule = str(b.paymentSchedule, 4000);
  if ("clientSignerName" in b) next.clientSignerName = str(b.clientSignerName, MAX_FIELD);
  if ("clientSignerTitle" in b) next.clientSignerTitle = str(b.clientSignerTitle, MAX_FIELD);
  if ("clientSignerEmail" in b) {
    const email = str(b.clientSignerEmail, MAX_FIELD);
    if (email && !EMAIL_RE.test(email)) return resp(400, { error: "invalid client signer email" });
    next.clientSignerEmail = email;
  }
  for (const k of ["startDate", "endDate"]) {
    if (!(k in b)) continue;
    const v = str(b[k], 10);
    if (v && !DATE_RE.test(v)) return resp(400, { error: `invalid ${k}` });
    next[k] = v;
  }
  if ("olSignatory" in b) {
    const key = str(b.olSignatory, 80);
    if (key) {
      const person = await get("PERSON", key);
      // FR13: the OL side is countersigned by an Admin, never the Lab Leader.
      if (!person || person.role !== "Admin")
        return resp(400, { error: "The OL signatory must be an Admin" });
    }
    next.olSignatory = key;
  }
  if ("clauses" in b) {
    if (!isAdmin) return resp(403, { error: "Editing contract terms is admin-only" });
    if (!Array.isArray(b.clauses)) return resp(400, { error: "clauses must be a list" });
    next.clauses = b.clauses.slice(0, 60).map(x => ({
      heading: str(x?.heading, MAX_FIELD),
      text: String(x?.text ?? "").slice(0, MAX_SECTION_CHARS)
    }));
  }

  /* Re-merge the standard terms against the current field values.
     mergeClauses() is idempotent — a placeholder that has already been filled
     is no longer in the text — so re-running it on every save is what lets
     {{paymentSchedule}} resolve the moment the Lab Leader types one in.
     Without this the unresolved list stays frozen at whatever was missing at
     generation time and blocks sending for the life of the contract. */
  if ((next.clauses || []).length) {
    const [deal, lab, owner, signatory] = await Promise.all([
      next.deal ? get("DEAL", next.deal) : null,
      get("LAB", next.lab),
      next.owner ? get("PERSON", next.owner) : null,
      next.olSignatory ? get("PERSON", next.olSignatory) : null
    ]);
    const merged = mergeClauses(next.clauses, templateVars({ contract: next, deal, lab, owner, signatory }));
    next.clauses = merged.clauses;
    next.unresolvedVars = merged.unresolved;
  }

  /* --- status --- */
  if ("status" in b) {
    if (!CONTRACT_STATUSES.includes(b.status)) return resp(400, { error: "invalid status" });
    if (!isAdmin && !LL_CONTRACT_STATUSES.includes(b.status))
      return resp(403, { error: "status not allowed for this role" });
    // Out for Signature is reached by sending it, not by picking it from a menu.
    if (b.status === "Out for Signature" && c.status !== "Out for Signature")
      return resp(409, { error: "Use Send for Signature to move a contract out for signature" });
    next.status = b.status;
    if (b.status === "Signed" && !next.signedAt) {
      next.signedAt = new Date().toISOString();
      next.signedManually = true;
      await writeAudit(ctx.me.sk, "contract.signed",
        `${id} (${c.client}) · recorded manually${c.contributorEmail ? " · unlocks invite for " + c.contributorEmail : ""}`);
    }
  }

  /* --- Contributor naming: unchanged, still what unlocks LL invites (PRD 2.2) --- */
  if ("contributorName" in b) {
    if (!isAdmin) return resp(403, { error: "Naming a Contributor is admin-only" });
    next.contributorName = str(b.contributorName, 120);
  }
  if ("contributorEmail" in b) {
    if (!isAdmin) return resp(403, { error: "Naming a Contributor is admin-only" });
    const email = str(b.contributorEmail, MAX_FIELD);
    if (email && !EMAIL_RE.test(email)) return resp(400, { error: "invalid contributor email" });
    next.contributorEmail = email;
  }

  next.updated = today();
  await put(next);
  return resp(200, decorate(next));
}

/* The PRD 2.2 gate (a Lab Leader may invite a Contributor only when a Signed
   contract in one of their labs names that email) lives in admin.mjs's
   signedContractUnlocks(). A duplicate of it used to sit here, unreferenced;
   it's gone rather than left to drift out of step with the real check. That
   gate keys off `status === "Signed"`, which is still exactly what full
   execution sets in signing.mjs — the e-signature flow feeds it unchanged. */
