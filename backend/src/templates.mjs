/* OL Portal · reusable content and contract templates (Base Contract PRD FR1,
   FR12). Admins own these; Lab Leaders read them and compose from them.

   Three kinds share one record type because they're all "pre-approved text an
   Admin maintains", and the portal already pays a full table scan per pk:

     proposal  a starting set of the six proposal sections, plus optional
               default pricing. Selected when a proposal is created.
     block     one reusable snippet bound to a single section (a scope
               paragraph, a standard timeline, a terms clause). Lab Leaders
               insert these while drafting.
     contract  the standard terms body — ordered clauses with {{placeholders}}
               that merge against the contract at generation time. This is
               where the Legal-approved Client Services Agreement lives.

   `lab` scopes a template to one lab; omitting it makes it OL-wide, which is
   how a lab without its own identity still gets the master OL terms. */

import { resp, today, get, put, del, listType, nextId, fullName } from "./util.mjs";
import { writeAudit } from "./admin.mjs";
import { SECTION_KEYS } from "./proposals.mjs";
import { cleanPricing, pricingTotal, formatMoney } from "./pricing.mjs";

export const TEMPLATE_KINDS = ["proposal", "block", "contract"];
const MAX_CLAUSES = 60;
const MAX_CLAUSE_CHARS = 20_000;
const MAX_SECTION_CHARS = 20_000;

const str = (v, max) => String(v ?? "").trim().slice(0, max);

function cleanClauses(input) {
  if (!Array.isArray(input)) return { error: "clauses must be a list" };
  if (!input.length) return { error: "a contract template needs at least one clause" };
  if (input.length > MAX_CLAUSES) return { error: `a contract template allows at most ${MAX_CLAUSES} clauses` };
  const clauses = [];
  for (const c of input) {
    const heading = str(c?.heading, 200);
    const text = String(c?.text ?? "").slice(0, MAX_CLAUSE_CHARS);
    if (!heading && !text.trim()) return { error: "every clause needs a heading or body text" };
    clauses.push({ heading, text });
  }
  return { clauses };
}

function cleanSections(input) {
  if (input === undefined) return { sections: undefined };
  if (typeof input !== "object" || input === null) return { error: "invalid sections" };
  const out = {};
  for (const k of SECTION_KEYS) out[k] = String(input[k] ?? "").slice(0, MAX_SECTION_CHARS);
  return { sections: out };
}

/* ---------- CRUD ---------- */

/* Readable by anyone with a portal role: Lab Leaders compose from templates,
   so hiding them would defeat the point. Lab-scoped templates are filtered to
   what the caller can actually see, matching the rest of the portal. */
export async function listTemplates(ctx) {
  const items = await listType("TEMPLATE");
  const visible = ctx.role === "Admin"
    ? items
    : items.filter(t => !t.lab || ctx.can.seesLab(t.lab));
  visible.sort((a, b) => (a.kind || "").localeCompare(b.kind) || (a.name || "").localeCompare(b.name || ""));
  return resp(200, visible.map(({ pk, sk, ...rest }) => ({ id: sk, ...rest })));
}

export async function createTemplate(ctx, body) {
  if (ctx.role !== "Admin") return resp(403, { error: "Templates are admin-only" });
  const b = body || {};
  const kind = b.kind;
  if (!TEMPLATE_KINDS.includes(kind)) return resp(400, { error: "kind must be proposal, block, or contract" });
  const name = str(b.name, 200);
  if (!name) return resp(400, { error: "name is required" });
  if (b.lab && !(await get("LAB", b.lab))) return resp(400, { error: "unknown lab" });

  const item = {
    pk: "TEMPLATE", sk: await nextId("TEMPLATE", "T-"),
    kind, name, active: b.active !== false,
    ...(b.lab ? { lab: b.lab } : {}),
    updatedBy: ctx.me.sk, updated: today()
  };

  const applied = await applyKindFields(item, b, kind);
  if (applied.error) return resp(400, { error: applied.error });

  await put(applied.item);
  await writeAudit(ctx.me.sk, "template.created", `${applied.item.sk} · ${kind} · ${name}`);
  const { pk, sk, ...rest } = applied.item;
  return resp(201, { id: sk, ...rest });
}

export async function updateTemplate(ctx, id, body) {
  if (ctx.role !== "Admin") return resp(403, { error: "Templates are admin-only" });
  const t = await get("TEMPLATE", id);
  if (!t) return resp(404, { error: "template not found" });
  const b = body || {};
  let next = { ...t, updatedBy: ctx.me.sk, updated: today() };

  if ("name" in b) {
    const name = str(b.name, 200);
    if (!name) return resp(400, { error: "name is required" });
    next.name = name;
  }
  if ("active" in b) next.active = !!b.active;
  if ("lab" in b) {
    if (b.lab) {
      if (!(await get("LAB", b.lab))) return resp(400, { error: "unknown lab" });
      next.lab = b.lab;
    } else delete next.lab;
  }

  const applied = await applyKindFields(next, b, t.kind);
  if (applied.error) return resp(400, { error: applied.error });
  next = applied.item;

  await put(next);
  await writeAudit(ctx.me.sk, "template.updated", `${id} · ${next.name}`);
  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest });
}

export async function deleteTemplate(ctx, id) {
  if (ctx.role !== "Admin") return resp(403, { error: "Templates are admin-only" });
  const t = await get("TEMPLATE", id);
  if (!t) return resp(404, { error: "template not found" });
  await del("TEMPLATE", id);
  await writeAudit(ctx.me.sk, "template.deleted", `${id} · ${t.name}`);
  return resp(200, { deleted: id });
}

/* Kind-specific field handling, shared by create and update so a PATCH can't
   put a contract template into a shape create would have rejected. */
async function applyKindFields(item, b, kind) {
  const next = { ...item };
  if (kind === "contract") {
    if ("clauses" in b || next.clauses === undefined) {
      const { clauses, error } = cleanClauses(b.clauses ?? next.clauses);
      if (error) return { error };
      next.clauses = clauses;
    }
    return { item: next };
  }
  if (kind === "block") {
    const section = str(b.section ?? next.section, 40);
    if (!SECTION_KEYS.includes(section))
      return { error: `section must be one of: ${SECTION_KEYS.join(", ")}` };
    next.section = section;
    if ("text" in b || next.text === undefined) {
      const text = String(b.text ?? next.text ?? "").slice(0, MAX_SECTION_CHARS);
      if (!text.trim()) return { error: "a content block needs text" };
      next.text = text;
    }
    return { item: next };
  }
  // proposal
  if ("sections" in b || next.sections === undefined) {
    const { sections, error } = cleanSections(b.sections ?? next.sections ?? {});
    if (error) return { error };
    next.sections = sections;
  }
  if ("pricing" in b) {
    const { value, error } = cleanPricing(b.pricing);
    if (error) return { error };
    if (value) next.pricing = value; else delete next.pricing;
  }
  return { item: next };
}

/* ---------- contract template resolution + merge ---------- */

/* The lab's own contract template wins; an OL-wide one is the fallback so a lab
   without its own terms still contracts on the master agreement. */
export async function contractTemplateFor(lab) {
  const items = await listType("TEMPLATE");
  const usable = items.filter(t => t.kind === "contract" && t.active !== false && Array.isArray(t.clauses));
  return usable.find(t => t.lab === lab) || usable.find(t => !t.lab) || null;
}

export async function proposalTemplate(id) {
  const t = await get("TEMPLATE", id);
  return t && t.kind === "proposal" ? t : null;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/* Substitutes {{placeholders}} and reports any it couldn't fill. Unresolved
   placeholders are left visible in the text rather than blanked, because a
   contract that silently drops "{{paymentSchedule}}" is worse than one that
   shows an obvious gap the Lab Leader has to close before sending. */
export function mergeClauses(clauses, vars) {
  const unresolved = new Set();
  const merged = (clauses || []).map(c => ({
    heading: fill(c.heading || "", vars, unresolved),
    text: fill(c.text || "", vars, unresolved)
  }));
  return { clauses: merged, unresolved: [...unresolved] };
}

function fill(text, vars, unresolved) {
  return String(text).replace(PLACEHOLDER, (whole, key) => {
    const v = vars[key];
    if (v === undefined || v === null || v === "") { unresolved.add(key); return whole; }
    return String(v);
  });
}

/* The variable bag every contract template can draw on. Kept in one place so
   the admin UI can list exactly what's available to template authors. */
export function templateVars({ contract, deal, lab, owner, signatory }) {
  const total = pricingTotal(contract?.pricing);
  return {
    client: contract?.client || "",
    clientSigner: contract?.clientSignerName || "",
    clientSignerTitle: contract?.clientSignerTitle || "",
    lab: lab?.name || contract?.lab || "",
    labLeader: fullName(owner) || "",
    olSignatory: fullName(signatory) || contract?.olSignatoryName || "",
    contractId: contract?.sk || contract?.id || "",
    total: total === null ? "" : formatMoney(total),
    paymentSchedule: contract?.paymentSchedule || "",
    startDate: contract?.startDate || "",
    endDate: contract?.endDate || "",
    dealId: deal?.sk || contract?.deal || "",
    today: today()
  };
}

export const TEMPLATE_VAR_KEYS = [
  "client", "clientSigner", "clientSignerTitle", "lab", "labLeader", "olSignatory",
  "contractId", "total", "paymentSchedule", "startDate", "endDate", "dealId", "today"
];
