/* OL Portal · Deal documents — requirements, waivers, and what may be deleted.

   A deal's proposal, signed contract and invoices are FILE records (see
   app.mjs). This file holds the rules around them that the Documents tab
   depends on:

   - Which document each stage requires. A requirement is met by a live
     (non-deleted) file of that kind, or — for the proposal and the contract —
     by an APPROVED waiver. A pending, declined or withdrawn waiver never
     counts. Invoices cannot be waived.
   - Waivers: a request to proceed without a document, which an Admin
     approves or declines. Anyone who can edit the deal may ask; only an
     Admin decides (and may decide their own request — there is no second
     approver to hand it to). One WAIVER record per requirement.
   - Protected delete: the last live version of a document the deal's current
     stage requires cannot be deleted, unless a waiver covers it.

   Waiver attachments are FILE records tagged `attachment: true`. They are
   proof for the approver, never deal documents: they carry no `kind`, so no
   gate can read them as a proposal or contract, and /files leaves them off the
   Files page. */

import { resp, get, put, listType, nextId, fullName, writeAudit } from "./util.mjs";
import { notify } from "./notifications.mjs";

export const WAIVABLE = ["proposal", "contract"];
const KIND_NAME = { proposal: "proposal", contract: "signed contract", invoice: "invoice" };

/* The stages (stored values) from which each document is required. Mirrors
   BILLING/CONTRACT/INVOICE gates in app.mjs and web/lib/pipeline.ts; "Closed
   Lost" is deliberately absent — a lost deal needs nothing. */
const REQUIRED_FROM = {
  proposal: ["Proposal Sent", "Contracted", "Closed"],
  contract: ["Contracted", "Closed"],
  invoice: ["Closed"]
};
export const requiredAt = (kind, stage) => !!REQUIRED_FROM[kind]?.includes(stage);

const live = f => !f.deletedAt;

export const liveDocs = (files, dealId, kind) =>
  files.filter(f => f.deal === dealId && f.kind === kind && live(f));

export const hasApprovedWaiver = (waivers, dealId, requirement) =>
  waivers.some(w => w.deal === dealId && w.requirement === requirement && w.status === "approved");

const dealHref = deal => `/pipeline?deal=${encodeURIComponent(deal.sk)}&tab=documents`;

const publicWaiver = ({ pk, sk, ...rest }) => ({ id: sk, ...rest });

/* ---------- reads ---------- */

export async function listWaivers(ctx) {
  if (ctx.role === "Contributor") return resp(200, []);
  const [waivers, deals] = await Promise.all([listType("WAIVER"), listType("DEAL")]);
  const visible = new Map(
    deals.filter(d => ctx.can.seesLab(d.lab) || ctx.can.editDeal(d)).map(d => [d.sk, d])
  );
  const out = waivers
    .filter(w => visible.has(w.deal))
    .sort((a, b) => (b.requestedAt || "").localeCompare(a.requestedAt || ""));
  return resp(200, out.map(publicWaiver));
}

/* ---------- requesting ---------- */

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/* Files the requester uploaded as proof. They must be this deal's waiver
   attachments, so a waiver cannot be used to attach (and thereby expose) some
   other file the caller happens to know the id of. */
async function resolveAttachments(ctx, deal, ids) {
  if (!Array.isArray(ids)) return { attachments: [] };
  const attachments = [];
  for (const id of [...new Set(ids)].slice(0, 10)) {
    const f = await get("FILE", id);
    if (!f || f.deletedAt || !f.attachment || f.deal !== deal.sk)
      return { error: "unknown attachment" };
    if (ctx.role !== "Admin" && f.uploader !== ctx.me.sk)
      return { error: "unknown attachment" };
    attachments.push({ id: f.sk, name: f.name, size: f.size, type: f.type, addedBy: ctx.me.sk, addedAt: new Date().toISOString() });
  }
  return { attachments };
}

export async function requestWaivers(ctx, dealId, body) {
  const deal = await get("DEAL", dealId);
  if (!deal) return resp(404, { error: "deal not found" });
  if (!ctx.can.editDeal(deal)) return resp(403, { error: "Not allowed to edit this deal" });

  const wanted = [...new Set(Array.isArray(body?.requirements) ? body.requirements : [])];
  if (!wanted.length || wanted.some(r => !WAIVABLE.includes(r)))
    return resp(400, { error: "choose the proposal and/or the signed contract to waive" });
  const reason = str(body?.reason, 2000);
  if (!reason) return resp(400, { error: "a reason is required" });

  const [files, waivers] = await Promise.all([listType("FILE"), listType("WAIVER")]);
  for (const r of wanted) {
    if (hasApprovedWaiver(waivers, dealId, r))
      return resp(409, { error: `the ${KIND_NAME[r]} is already waived` });
    if (waivers.some(w => w.deal === dealId && w.requirement === r && w.status === "pending"))
      return resp(409, { error: `a waiver for the ${KIND_NAME[r]} is already waiting on approval` });
    if (liveDocs(files, dealId, r).length || (r === "contract" && deal.contractSigned))
      return resp(409, { error: `this deal already has a ${KIND_NAME[r]}` });
  }

  const { attachments, error } = await resolveAttachments(ctx, deal, body?.attachments);
  if (error) return resp(400, { error });

  const stamp = new Date().toISOString();
  const created = [];
  for (const requirement of wanted) {
    const id = await nextId("WAIVER", "W-");
    const record = {
      pk: "WAIVER", sk: id, deal: dealId, requirement, reason, attachments,
      requestedBy: ctx.me.sk, requestedAt: stamp, status: "pending"
    };
    await put(record);
    created.push(record);
  }

  const people = await listType("PERSON");
  await notify({
    to: people.filter(p => p.role === "Admin").map(p => p.sk),
    kind: "approval",
    actor: ctx.me.sk,
    actorName: fullName(ctx.me) || ctx.me.sk,
    verb: `asked to waive the ${wanted.map(r => KIND_NAME[r]).join(" and ")} on ${deal.client}`,
    snippet: reason.slice(0, 140),
    meta: "Pipeline · Documents",
    href: dealHref(deal)
  });
  return resp(201, created.map(publicWaiver));
}

/* ---------- the requester's side ---------- */

async function loadWaiver(ctx, id) {
  const waiver = await get("WAIVER", id);
  if (!waiver) return { out: resp(404, { error: "waiver not found" }) };
  const deal = await get("DEAL", waiver.deal);
  if (!deal) return { out: resp(404, { error: "deal not found" }) };
  if (!ctx.can.editDeal(deal)) return { out: resp(403, { error: "Not allowed to edit this deal" }) };
  return { waiver, deal };
}

/* More proof, in either state. It never touches the deal's own documents. */
export async function addWaiverAttachments(ctx, id, body) {
  const { waiver, deal, out } = await loadWaiver(ctx, id);
  if (out) return out;
  if (!["pending", "approved"].includes(waiver.status))
    return resp(409, { error: "this waiver is closed" });
  const { attachments, error } = await resolveAttachments(ctx, deal, body?.attachments);
  if (error) return resp(400, { error });
  const have = new Set(waiver.attachments.map(a => a.id));
  const next = { ...waiver, attachments: [...waiver.attachments, ...attachments.filter(a => !have.has(a.id))] };
  await put(next);
  return resp(200, publicWaiver(next));
}

export async function withdrawWaiver(ctx, id) {
  const { waiver, out } = await loadWaiver(ctx, id);
  if (out) return out;
  if (waiver.status !== "pending") return resp(409, { error: "only a pending waiver can be withdrawn" });
  const next = { ...waiver, status: "withdrawn", reviewedAt: new Date().toISOString() };
  await put(next);
  return resp(200, publicWaiver(next));
}

/* The requester has read the admin's note on a declined waiver. */
export async function dismissWaiver(ctx, id) {
  const { waiver, out } = await loadWaiver(ctx, id);
  if (out) return out;
  const next = { ...waiver, dismissed: true };
  await put(next);
  return resp(200, publicWaiver(next));
}

/* ---------- the admin's side ---------- */

export async function decideWaiver(ctx, id, decision, body) {
  if (ctx.role !== "Admin") return resp(403, { error: "Only an admin can decide a waiver" });
  const waiver = await get("WAIVER", id);
  if (!waiver) return resp(404, { error: "waiver not found" });
  if (waiver.status !== "pending") return resp(409, { error: "this waiver has already been decided or withdrawn" });
  const note = str(body?.note, 1000);
  if (decision === "declined" && !note) return resp(400, { error: "a note is required to decline a waiver" });
  const deal = await get("DEAL", waiver.deal);

  const next = {
    ...waiver, status: decision, reviewedBy: ctx.me.sk,
    reviewedAt: new Date().toISOString(), adminNote: note
  };
  await put(next);
  await writeAudit(ctx.me.sk, `waiver.${decision}`,
    `${KIND_NAME[waiver.requirement]} waiver on ${deal?.client || waiver.deal}${note ? ` · ${note.slice(0, 120)}` : ""}`);

  if (deal) {
    await notify({
      to: [...new Set([waiver.requestedBy, deal.dealOwner || deal.owner].filter(Boolean))],
      kind: "approval",
      actor: ctx.me.sk,
      actorName: fullName(ctx.me) || ctx.me.sk,
      verb: `${decision} the ${KIND_NAME[waiver.requirement]} waiver on ${deal.client}`,
      snippet: note || undefined,
      meta: "Pipeline · Documents",
      href: dealHref(deal)
    });
  }
  return resp(200, publicWaiver(next));
}

/* ---------- hooks the file routes call ---------- */

/* Uploading the real document closes a pending waiver for it: the requirement
   is met, so there is nothing left to approve. Remembers which file did it so
   an upload that fails, or is undone, can put the request back. */
export async function withdrawPendingFor(dealId, kind, fileId) {
  if (!WAIVABLE.includes(kind)) return;
  for (const w of await listType("WAIVER")) {
    if (w.deal === dealId && w.requirement === kind && w.status === "pending")
      await put({ ...w, status: "withdrawn", reviewedAt: new Date().toISOString(), withdrawnByFile: fileId });
  }
}

export async function restoreWithdrawnBy(fileId) {
  for (const w of await listType("WAIVER")) {
    if (w.withdrawnByFile === fileId && w.status === "withdrawn") {
      const { withdrawnByFile, reviewedAt, ...rest } = w;
      await put({ ...rest, status: "pending" });
    }
  }
}

/* The last live version of a required document cannot be deleted. Returns the
   message to show, or null when the delete may go ahead. */
export function protectedDeleteReason({ file, deal, files, waivers, stageLabel }) {
  if (!WAIVABLE.includes(file.kind)) return null;
  if (!requiredAt(file.kind, deal.stage)) return null;
  if (liveDocs(files, deal.sk, file.kind).some(f => f.sk !== file.sk)) return null;
  if (hasApprovedWaiver(waivers, deal.sk, file.kind)) return null;
  if (file.kind === "contract" && deal.contractSigned) return null;
  return `This is the only ${KIND_NAME[file.kind]}, and a ${stageLabel(deal.stage)} deal needs one. ` +
    "Upload a new version first, or move the deal back a stage.";
}
