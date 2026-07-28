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

/* Versioning model (rewritten July 28, 2026)
   - `sections` is the live working draft. The Optimist writes into it on every
     message with `draft: true`, which does NOT create a version. Before this,
     each assistant message bumped the number, so a 15-message conversation
     landed at v15 and the count tracked keystrokes rather than decisions.
   - `versions[]` holds committed snapshots; `version` is the latest committed
     number (0 = nothing saved yet). A version is created only on an explicit
     save, on a status change that carries unsaved work, or on marking Final.
   - `dirty` means the working draft is ahead of the latest committed version.
   - `finalVersion` records WHICH committed version is Final. Final is scoped to
     this proposal: marking one no longer unmarks every other proposal in the
     portal, and editing after marking no longer silently clears the flag. */

function commit(p) {
  const first = !(p.versions || []).length && !(p.version || 0);
  const v = first ? 1 : (p.version || 0) + 1;
  const versions = [...(p.versions || []), {
    v, author: p.author, date: today(), status: p.status,
    sections: p.sections || emptySections()
  }];
  return { ...p, version: v, versions: trimVersions(versions, p.finalVersion), dirty: false };
}

/* Keep the last N snapshots, but never drop the one marked Final — the send
   path reads its sections back out. */
function trimVersions(versions, keepV) {
  if (versions.length <= MAX_VERSION_SNAPSHOTS) return versions;
  const keep = versions.filter(v => v.v === keepV);
  const rest = versions.filter(v => v.v !== keepV).slice(-(MAX_VERSION_SNAPSHOTS - keep.length));
  return [...keep, ...rest].sort((a, b) => a.v - b.v);
}

/* Falls back to the working draft when the version isn't in versions[] — true
   for records written under the old scheme, where the array held only the
   versions BEFORE the current one. */
function sectionsAt(p, v) {
  return (p.versions || []).find(x => x.v === v)?.sections || p.sections;
}

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

export async function createProposal(ctx, body) {
  const { dealId, title } = body || {};
  const deal = await get("DEAL", dealId);
  if (!deal) return resp(404, { error: "deal not found" });
  if (!ctx.can.editDeal(deal)) return resp(403, { error: "Not allowed to create proposals for this deal" });
  if (typeof title !== "string" || !title.trim()) return resp(400, { error: "title is required" });

  const id = await nextId("PROPOSAL", "P-");
  const p = {
    pk: "PROPOSAL", sk: id, title: title.trim(), deal: deal.sk, client: deal.client,
    lab: deal.lab, author: ctx.me.sk, status: "Draft", version: 0, final: false,
    dirty: false, updated: today(), sections: emptySections(), versions: []
  };
  await put(p);
  const { pk, sk, ...rest } = p;
  return resp(201, { id: sk, ...rest });
}

export async function updateProposal(ctx, id, body) {
  const p = await get("PROPOSAL", id);
  if (!p) return resp(404, { error: "proposal not found" });
  if (!ctx.can.editProposal(p)) return resp(403, { error: "Not allowed to edit this proposal" });
  const b = body || {};
  let next = { ...p };

  if ("sections" in b) {
    const sections = cleanSections(b.sections);
    if (!sections) return resp(400, { error: "invalid sections" });
    next.sections = sections;
    next.dirty = true;
  }
  // `draft: true` saves the working draft and stops there — this is what The
  // Optimist sends on every message. Anything else commits a version.
  const draftOnly = b.draft === true;

  if ("status" in b) {
    const allowed = ctx.can.approveProposal() ? PROPOSAL_STATUSES : LL_PROPOSAL_STATUSES;
    if (!allowed.includes(b.status)) return resp(403, { error: "status not allowed for this role" });
    next.status = b.status;
  }
  // A status change is a milestone, so it carries any unsaved work into a
  // version rather than leaving it stranded on the draft.
  const wantsCommit = b.commit === true || ("sections" in b && !draftOnly) || ("status" in b && next.dirty);
  if (wantsCommit && next.dirty) next = commit(next);

  if ("final" in b) {
    if (b.final) {
      // Final always names a committed version, so commit first if the draft
      // has moved on or nothing has ever been saved.
      if (next.dirty || !next.version) next = commit(next);
      next.final = true;
      next.finalVersion = next.version;
    } else {
      next.final = false;
      delete next.finalVersion;
    }
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

  // Send the version that was marked Final, not whatever the draft has drifted
  // to since. `draftAhead` lets the UI say so rather than surprising the sender.
  const sentVersion = p.finalVersion || p.version;
  const draftAhead = !!(p.dirty || (p.finalVersion && p.finalVersion !== p.version));
  const next = {
    ...p,
    shareToken: p.shareToken || randomBytes(16).toString("hex"),
    status: "Sent",
    sentVersion,
    sentSections: sectionsAt(p, sentVersion),
    sentAt: new Date().toISOString(),
    updated: today()
  };
  await put(next);
  await writeAudit(ctx.me.sk, "proposal.sent", `${id} v${sentVersion} → customer link`);
  return resp(200, {
    id, sentVersion, draftAhead,
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
