/* OL Portal · bringing an agreement into being (Base Contract PRD 5.4 FR10,
   Contributor MSA PRD 5.1 and 5.3).

   Split out of contracts.mjs, which now owns reading and editing one. Creation
   is where the kinds of paper actually differ — what may be attached to what,
   which template supplies the standard terms, where the counterparty comes
   from — while everything after it (edit guards, deviation detection, signing,
   the PDF) is common. Keeping the differences in one module is what stops
   `docKind` checks spreading through the rest of the flow.

   The dependency runs one way: this reads shapes and permission rules from
   contracts.mjs and nothing there reaches back. */

import { resp, today, get, put, listType, nextId, DOC_KINDS, DOC_META, docKind } from "./util.mjs";
import { writeAudit } from "./admin.mjs";
import { approvedSnapshot } from "./proposals.mjs";
import { templateFor, mergeClauses, templateVars } from "./templates.mjs";
import { cleanPricing, pricingTotal, collapseToSelected } from "./pricing.mjs";
import {
  decorate, canEdit, INHERITED_SECTIONS, MAX_SECTION_CHARS, MAX_FIELD, EMAIL_RE, DATE_RE, str
} from "./contracts.mjs";


/* Three ways a document comes into being, all on POST /contracts:

     with proposalId   the PRD 5.4 path — inherits scope and pricing from the
                       version the customer approved, and carries the deviation
                       machinery that keeps the two honest.

     docKind:          a task order under a signed MSA (Contributor MSA PRD
     "task-order"      5.3). Inherits its standard terms from the parent by
                       reference rather than by copy.

     neither           a document written directly: a client contract without a
                       proposal round (renewals, handshake deals, work already
                       agreed by email), or a Contributor MSA, which never has
                       a proposal by definition. There is nothing to inherit,
                       so there is nothing to deviate from — the deviation
                       guard simply doesn't apply (deviationsOf() returns
                       nothing without an `inherited` block).

   Everything downstream is identical: same template merge, same signing flow,
   same audit trail. */
export async function createContract(ctx, body) {
  const kind = body?.docKind;
  if (kind !== undefined && !DOC_KINDS.includes(kind))
    return resp(400, { error: `docKind must be one of: ${DOC_KINDS.join(", ")}` });
  if (kind === "task-order") return createTaskOrder(ctx, body);
  if (body?.proposalId) {
    // A proposal is a customer artefact; only customer paper can inherit one.
    if (kind && kind !== "client")
      return resp(400, { error: `A ${DOC_META[kind].label} can't be generated from a proposal` });
    return generateContract(ctx, body);
  }
  return createStandalone(ctx, body);
}

async function createStandalone(ctx, body) {
  const b = body || {};
  if (ctx.role === "Contributor") return resp(403, { error: "Not allowed to create contracts" });

  const kind = DOC_KINDS.includes(b.docKind) ? b.docKind : "client";
  const meta = DOC_META[kind];

  /* FR1: an MSA is a relationship with a Contributor, not work for a customer.
     Attaching a deal would put it in the customer pipeline and close that deal
     on execution (signing.mjs rollUpDeal), so it's refused rather than quietly
     dropped. */
  if (kind === "msa" && b.dealId)
    return resp(400, { error: "An MSA isn't tied to a deal" });

  // A deal is optional but preferred: attaching one is what lets the contract
  // roll the pipeline forward and feed invoicing on execution.
  let deal = null;
  if (b.dealId) {
    deal = await get("DEAL", b.dealId);
    if (!deal) return resp(404, { error: "deal not found" });
    if (!ctx.can.editDeal(deal)) return resp(403, { error: "Not allowed to contract on this deal" });
  }

  /* Every document is lab-scoped, including an MSA. The relationship is really
     OL-to-Contributor rather than lab-to-Contributor, but `lab` is what every
     visibility check in the portal runs on (ctx.can.seesLab), so an MSA
     without one would be invisible to its own author. It carries the lab of
     the Lab Leader who engaged the Contributor. */
  const lab = str(b.lab, 80) || deal?.lab || (ctx.role === "Lab Leader" ? (ctx.me.labs || [])[0] : "");
  if (!lab) return resp(400, { error: "lab is required" });
  if (!(await get("LAB", lab))) return resp(400, { error: "unknown lab" });
  if (ctx.role !== "Admin" && !ctx.can.seesLab(lab) && deal?.owner !== ctx.me.sk)
    return resp(403, { error: "Not allowed to create contracts for that lab" });

  // One stored field holds the counterparty for both kinds; only the label
  // differs. See templateVars() for the matching {{client}}/{{contributor}} pair.
  const client = str(b.client, 200) || deal?.client;
  if (!client) return resp(400, { error: `${meta.counterparty} name is required` });

  const signer = readSignerFields(b);
  if (signer.error) return resp(400, { error: signer.error });

  /* FR6 expects one MSA per Contributor in practice but the model shouldn't
     hard-block a second (PRD 7). A soft block: refuse by default, and let the
     caller say it meant it. */
  if (kind === "msa" && signer.fields.clientSignerEmail && b.allowSecondMsa !== true) {
    const existing = (await listType("CONTRACT")).find(c =>
      docKind(c) === "msa" &&
      ["Signed", "Out for Signature"].includes(c.status) &&
      (c.clientSignerEmail || "").toLowerCase() === signer.fields.clientSignerEmail.toLowerCase());
    if (existing)
      return resp(409, {
        error: `${signer.fields.clientSignerEmail} already has an MSA (${existing.sk}, ${existing.status.toLowerCase()}).`,
        existingMsa: existing.sk,
        needsSecondMsaAck: true
      });
  }

  const { value: pricing, error: pricingError } = cleanPricing(b.pricing);
  if (pricingError) return resp(400, { error: pricingError });

  // An explicit template wins; otherwise fall back to the lab's own, then the
  // OL-wide one — same resolution the proposal path uses. Resolution is scoped
  // to this document's kind so contributor paper can never resolve to the
  // client agreement.
  let template = null;
  if (b.templateId) {
    template = await get("TEMPLATE", b.templateId);
    if (!template || template.kind !== meta.templateKind)
      return resp(400, { error: `unknown ${meta.label} template` });
    if (template.lab && !ctx.can.seesLab(template.lab))
      return resp(403, { error: "That template belongs to another lab" });
  } else {
    template = await templateFor(lab, meta.templateKind);
  }

  const ownerKey = deal?.owner || ctx.me.sk;
  const owner = await get("PERSON", ownerKey);

  const id = await nextId("CONTRACT", meta.prefix, c => docKind(c) === kind);
  const base = {
    pk: "CONTRACT", sk: id, client, lab, owner: ownerKey,
    ...(kind === "client" ? {} : { docKind: kind }),
    ...(deal ? { deal: deal.sk } : {}),
    status: "Draft", created: today(), updated: today(),
    sections: Object.fromEntries(INHERITED_SECTIONS.map(k => [k, str(b.sections?.[k], MAX_SECTION_CHARS)])),
    pricing,
    amount: pricingTotal(pricing) ?? deal?.amount,
    deviationLog: [],
    ...signer.fields,
    /* An MSA's counterparty is the Contributor, so the invite gate's field
       (admin.mjs signedContractUnlocks) is known at creation instead of being
       set separately by an Admin later. */
    ...(kind === "msa" ? { contributorName: client, contributorEmail: signer.fields.clientSignerEmail || "" } : {}),
    ...(template ? { templateId: template.sk, templateName: template.name } : {})
  };

  if (template) {
    const vars = templateVars({ contract: base, deal, lab: await get("LAB", lab), owner, signatory: null });
    const { clauses, unresolved } = mergeClauses(template.clauses, vars);
    base.clauses = clauses;
    base.unresolvedVars = unresolved;
  }

  await put(base);
  await writeAudit(ctx.me.sk, `${kind === "msa" ? "msa" : "contract"}.created`,
    `${id} direct (${client})${deal ? " · deal " + deal.sk : " · no deal"}${template ? " · template " + template.name : " · NO TEMPLATE"}`);

  return resp(201, decorate(base));
}

/* Signer fields are accepted at creation as well as on PATCH. The MSA dialog
   collects the Contributor's name and email up front — they're the whole point
   of the record — and requiring a follow-up PATCH just to store them would
   leave a window where the document exists with no counterparty. */
function readSignerFields(b) {
  const fields = {};
  for (const k of ["clientSignerName", "clientSignerTitle"])
    if (k in b) fields[k] = str(b[k], MAX_FIELD);
  if ("clientSignerEmail" in b) {
    const email = str(b.clientSignerEmail, MAX_FIELD);
    if (email && !EMAIL_RE.test(email)) return { error: "invalid signer email" };
    fields.clientSignerEmail = email;
  }
  return { fields };
}

/* ---------- task orders (Contributor MSA PRD 5.3) ---------- */

/* A task order is the unit of authorised work under a signed MSA. It carries
   its own scope, timeline, compensation and signatures, and there can be many
   against one MSA without the MSA being re-signed (FR6). */
export async function createTaskOrder(ctx, body) {
  const b = body || {};
  if (ctx.role === "Contributor") return resp(403, { error: "Not allowed to create task orders" });

  const parent = await get("CONTRACT", str(b.parentId, 40));
  if (!parent || docKind(parent) !== "msa")
    return resp(404, { error: "No such MSA to write a task order against" });
  // Work is authorised underneath an executed relationship, never alongside
  // one still being negotiated (PRD 5.3.1: "From a Signed MSA").
  if (parent.status !== "Signed")
    return resp(409, { error: "That MSA isn't signed yet, so work can't be authorised under it" });
  if (!canEdit(ctx, parent))
    return resp(403, { error: "Not allowed to write task orders against this MSA" });

  const { value: pricing, error: pricingError } = cleanPricing(b.pricing);
  if (pricingError) return resp(400, { error: pricingError });

  const [lab, owner, template] = await Promise.all([
    get("LAB", parent.lab),
    get("PERSON", ctx.role === "Lab Leader" ? ctx.me.sk : parent.owner),
    templateFor(parent.lab, "task-order")
  ]);

  const id = await nextId("CONTRACT", "TO-", c => docKind(c) === "task-order");
  const base = {
    pk: "CONTRACT", sk: id,
    docKind: "task-order",
    parentId: parent.sk,
    // Carried down from the MSA: same Contributor, same relationship, same lab.
    client: parent.client,
    lab: parent.lab,
    owner: ctx.role === "Lab Leader" ? ctx.me.sk : parent.owner,
    status: "Draft", created: today(), updated: today(),
    sections: Object.fromEntries(INHERITED_SECTIONS.map(k => [k, str(b.sections?.[k], MAX_SECTION_CHARS)])),
    pricing,
    amount: pricingTotal(pricing),
    deviationLog: [],
    clientSignerName: parent.clientSignerName || "",
    clientSignerTitle: parent.clientSignerTitle || "",
    clientSignerEmail: parent.clientSignerEmail || "",
    contributorName: parent.contributorName || parent.client,
    contributorEmail: parent.contributorEmail || parent.clientSignerEmail || "",
    // Same countersigner as the MSA, so the relationship stays with one Admin.
    ...(parent.olSignatory ? { olSignatory: parent.olSignatory } : {}),
    ...(template ? { templateId: template.sk, templateName: template.name } : {})
  };
  for (const k of ["startDate", "endDate"]) {
    const v = str(b[k], 10);
    if (v && !DATE_RE.test(v)) return resp(400, { error: `invalid ${k}` });
    if (v) base[k] = v;
  }

  /* FR7: the MSA's standard terms govern, and are brought in by reference
     rather than copied. Copying would let an amended MSA silently diverge from
     every task order that had already duplicated its text; a reference always
     points at the executed original. What the task order carries in its own
     right is whatever the (short, optional) task-order template adds. */
  const vars = templateVars({ contract: base, deal: null, lab, owner, signatory: null, parent });
  const merged = mergeClauses([GOVERNING_CLAUSE, ...(template?.clauses || [])], vars);
  base.clauses = merged.clauses;
  base.unresolvedVars = merged.unresolved;

  await put(base);
  await writeAudit(ctx.me.sk, "task-order.created",
    `${id} under ${parent.sk} (${parent.client})${template ? " · template " + template.name : ""}`);

  return resp(201, decorate(base));
}

const GOVERNING_CLAUSE = {
  heading: "Governing Agreement",
  text: "This Task Order is issued under and governed by the Master Services Agreement " +
    "{{msaId}} between Optimistic Labs and {{contributor}}, executed {{msaDate}}. The terms " +
    "of that agreement apply in full to the work described here and are not restated. Where " +
    "this Task Order conflicts with the Master Services Agreement, the Master Services " +
    "Agreement controls."
};

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
  if (existing) return resp(200, { ...decorate(existing), alreadyExisted: true });

  const [deal, lab, owner, template] = await Promise.all([
    get("DEAL", p.deal), get("LAB", p.lab), get("PERSON", p.owner), templateFor(p.lab, "contract")
  ]);

  /* Collapse a chosen package to a single priced line. The proposal offered a
     menu; the contract is for the one thing they bought, and an agreement that
     also quotes the declined options invites an argument later. Both the frozen
     `inherited` copy and the live one use the collapsed form so deviation
     detection still compares like with like. */
  const pricing = collapseToSelected(snapshot.pricing);

  const id = await nextId("CONTRACT", "C-", c => docKind(c) === "client");
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

  return resp(201, decorate(base));
}
