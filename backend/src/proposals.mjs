/* OL Portal · proposals (PRD 3.4-3.5): structured OL template sections,
   version snapshots with author/date, admin review statuses, sending the
   Final version to the customer via a tokenized link, and in-system
   customer Approve / Reject / Revision capture. Customer approval
   auto-creates a contract (PRD 3.6). */

import { randomBytes } from "node:crypto";
import { resp, today, get, put, listType, nextId } from "./util.mjs";
import { createFromProposal } from "./contracts.mjs";
import { writeAudit } from "./admin.mjs";

export const SECTION_KEYS = ["summary", "scope", "deliverables", "timeline", "pricing", "terms"];
const PROPOSAL_STATUSES = ["Draft", "In Review", "Internally Approved", "Sent",
  "Customer Approved", "Customer Rejected", "Revision Requested"];
const LL_PROPOSAL_STATUSES = ["Draft", "In Review", "Sent"];
const MAX_SECTION_CHARS = 20_000;
const MAX_VERSION_SNAPSHOTS = 20;

const emptySections = () => Object.fromEntries(SECTION_KEYS.map(k => [k, ""]));

function cleanSections(input) {
  if (typeof input !== "object" || input === null) return null;
  const out = {};
  for (const k of SECTION_KEYS) {
    const v = input[k];
    if (v !== undefined && typeof v !== "string") return null;
    out[k] = (v || "").slice(0, MAX_SECTION_CHARS);
  }
  return out;
}

function snapshot(p) {
  const versions = [...(p.versions || []), {
    v: p.version || 1, author: p.author, date: p.updated || today(),
    status: p.status, sections: p.sections || emptySections()
  }];
  return versions.slice(-MAX_VERSION_SNAPSHOTS);
}

export async function createProposal(ctx, body) {
  const { dealId, title } = body || {};
  const deal = await get("DEAL", dealId);
  if (!deal) return resp(404, { error: "deal not found" });
  if (!ctx.can.editDeal(deal)) return resp(403, { error: "Not allowed to create proposals for this deal" });
  if (typeof title !== "string" || !title.trim()) return resp(400, { error: "title is required" });

  const id = await nextId("PROPOSAL", "P-");
  const p = {
    pk: "PROPOSAL", sk: id, title: title.trim(), deal: deal.sk, client: deal.client,
    lab: deal.lab, author: ctx.me.sk, status: "Draft", version: 1, final: false,
    updated: today(), sections: emptySections(), versions: []
  };
  await put(p);
  const { pk, sk, ...rest } = p;
  return resp(201, { id: sk, ...rest });
}

export async function updateProposal(ctx, id, body) {
  const p = await get("PROPOSAL", id);
  if (!p) return resp(404, { error: "proposal not found" });
  if (!ctx.can.editProposal(p)) return resp(403, { error: "Not allowed to edit this proposal" });
  const next = { ...p };
  let bump = false;

  if ("sections" in (body || {})) {
    // PRD 3.5: the exact version sent to the customer is locked; edits after
    // send always land in a new version.
    const sections = cleanSections(body.sections);
    if (!sections) return resp(400, { error: "invalid sections" });
    next.sections = sections;
    next.final = false;
    bump = true;
  }
  if ("status" in (body || {})) {
    const allowed = ctx.can.approveProposal() ? PROPOSAL_STATUSES : LL_PROPOSAL_STATUSES;
    if (!allowed.includes(body.status)) return resp(403, { error: "status not allowed for this role" });
    next.status = body.status;
    bump = true;
  }
  if ("final" in (body || {})) {
    // Only one Final at a time (PRD 3.4): marking this one unmarks the rest.
    next.final = !!body.final;
    if (next.final) {
      const others = (await listType("PROPOSAL")).filter(x => x.sk !== id && x.final);
      for (const o of others) await put({ ...o, final: false });
    }
  }
  if (bump) {
    next.versions = snapshot(p);
    next.version = (p.version || 1) + 1;
  }
  next.updated = today();
  await put(next);
  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest });
}

/* ---------- send to customer (PRD 3.5) ---------- */
export async function sendProposal(ctx, id) {
  const p = await get("PROPOSAL", id);
  if (!p) return resp(404, { error: "proposal not found" });
  if (!ctx.can.editProposal(p)) return resp(403, { error: "Not allowed to send this proposal" });
  if (!p.final) return resp(409, { error: "Mark a version Final before sending — the Final version is what the client sees" });

  const next = {
    ...p,
    shareToken: p.shareToken || randomBytes(16).toString("hex"),
    status: "Sent",
    sentVersion: p.version,
    sentSections: p.sections,
    sentAt: new Date().toISOString(),
    updated: today()
  };
  await put(next);
  await writeAudit(ctx.me.sk, "proposal.sent", `${id} v${next.sentVersion} → customer link`);
  return resp(200, {
    id, sentVersion: next.sentVersion,
    url: `${process.env.FRONTEND_URL}/proposal-view.html?token=${next.shareToken}`
  });
}

/* ---------- public customer routes (Authorizer NONE) ----------
   The 32-hex token is the only credential; it's minted per proposal at send
   time and only ever shared with the client. */
async function byToken(token) {
  if (!/^[0-9a-f]{32}$/.test(token || "")) return null;
  return (await listType("PROPOSAL")).find(p => p.shareToken === token) || null;
}

export async function shareView(token) {
  const p = await byToken(token);
  if (!p || !p.sentAt) return resp(404, { error: "This proposal link is not valid" });
  return resp(200, {
    title: p.title, client: p.client, version: p.sentVersion,
    sentAt: p.sentAt, status: p.status,
    sections: p.sentSections || p.sections,
    decision: p.decision || null
  });
}

export async function shareDecision(token, body) {
  const p = await byToken(token);
  if (!p || !p.sentAt) return resp(404, { error: "This proposal link is not valid" });
  if (p.decision) return resp(409, { error: "A decision was already recorded for this proposal" });

  const STATUS_OF = {
    approve: "Customer Approved",
    reject: "Customer Rejected",
    revision: "Revision Requested"
  };
  const action = body?.action;
  if (!STATUS_OF[action]) return resp(400, { error: "action must be approve, reject, or revision" });
  const comment = typeof body?.comment === "string" ? body.comment.slice(0, 2000) : "";
  const name = typeof body?.name === "string" ? body.name.slice(0, 120) : "";

  const decision = { action, comment, name, at: new Date().toISOString(), version: p.sentVersion };
  await put({ ...p, status: STATUS_OF[action], decision, updated: today() });
  await writeAudit(name || "customer", "proposal." + action,
    `${p.sk} v${p.sentVersion} (${p.client})${comment ? " · " + comment.slice(0, 120) : ""}`);

  // PRD 3.6: customer approval is the trigger for contract creation.
  let contract = null;
  if (action === "approve") contract = await createFromProposal(p);
  return resp(200, { recorded: action, ...(contract ? { contract } : {}) });
}
