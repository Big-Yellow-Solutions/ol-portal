/* OL Portal · contracts (PRD 3.6): created from a customer-approved proposal,
   auto-populated with its data; statuses Draft → Internal Review → Sent →
   Signed. Signed is the trigger (PRD 2.2) that lets the lab's Lab Leader
   invite the Contributor named on the contract. E-signature is deliberately
   absent (PRD 3.7 — blocked until post-raise); Signed is a manual admin step. */

import { resp, today, get, put, listType, nextId } from "./util.mjs";
import { writeAudit } from "./admin.mjs";

export const CONTRACT_STATUSES = ["Draft", "Internal Review", "Sent", "Signed"];

/* Called from the public customer-approval route — no ctx. */
export async function createFromProposal(p) {
  const deal = await get("DEAL", p.deal);
  const id = await nextId("CONTRACT", "C-");
  const c = {
    pk: "CONTRACT", sk: id, proposal: p.sk, deal: p.deal, client: p.client,
    lab: p.lab, owner: deal?.owner || p.author, amount: deal?.amount,
    status: "Draft", created: today(), updated: today(),
    sections: p.sentSections || p.sections
  };
  await put(c);
  await writeAudit("system", "contract.created", `${id} from ${p.sk} (${p.client})`);
  return id;
}

export async function listContracts(ctx) {
  const items = await listType("CONTRACT");
  // Contributors aren't lab-scoped like Lab Leaders — they only ever see the
  // contract(s) naming their own email (their copy, downloadable as a PDF).
  const visible = ctx.role === "Contributor"
    ? items.filter(c => (c.contributorEmail || "").toLowerCase() === (ctx.me.email || "").toLowerCase())
    : items.filter(c => ctx.can.seesLab(c.lab));
  visible.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  return resp(200, visible.map(({ pk, sk, ...rest }) => ({ id: sk, ...rest })));
}

export async function updateContract(ctx, id, body) {
  if (ctx.role !== "Admin") return resp(403, { error: "Contract changes are admin-only" });
  const c = await get("CONTRACT", id);
  if (!c) return resp(404, { error: "contract not found" });
  const next = { ...c };

  if ("status" in (body || {})) {
    if (!CONTRACT_STATUSES.includes(body.status)) return resp(400, { error: "invalid status" });
    next.status = body.status;
    if (body.status === "Signed" && !next.signedAt) {
      next.signedAt = new Date().toISOString();
      await writeAudit(ctx.me.sk, "contract.signed",
        `${id} (${c.client})${c.contributorEmail ? " · unlocks invite for " + c.contributorEmail : ""}`);
    }
  }
  if ("contributorName" in (body || {}))
    next.contributorName = String(body.contributorName || "").slice(0, 120);
  if ("contributorEmail" in (body || {})) {
    const email = String(body.contributorEmail || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return resp(400, { error: "invalid contributor email" });
    next.contributorEmail = email;
  }
  next.updated = today();
  await put(next);
  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest });
}

/* PRD 2.2 gate: a Lab Leader may invite a Contributor only when a Signed
   contract in one of their labs names that email. */
export async function signedContractFor(labs, email) {
  const items = await listType("CONTRACT");
  return items.find(c =>
    c.status === "Signed" && labs.includes(c.lab) &&
    (c.contributorEmail || "").toLowerCase() === (email || "").toLowerCase()) || null;
}
