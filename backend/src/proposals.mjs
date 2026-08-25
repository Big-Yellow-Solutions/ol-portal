/* OL Portal · proposals (PRD 3.4-3.5, Base Contract PRD 5.1-5.3): structured
   OL template sections, structured pricing, version snapshots with author/date,
   admin review statuses, sending the Final version to the customer via a
   tokenized link, open tracking, and the customer Approve / Request Changes
   loop.

   Contract creation is NOT here any more. It used to fire automatically the
   instant a customer approved; per Base Contract PRD 5.4 the Lab Leader now
   presses Generate Contract, so approval only marks the proposal approved and
   contracts.mjs owns the conversion. */

import { randomBytes } from "node:crypto";
import { resp, today, get, put, listType, nextId, fullName } from "./util.mjs";
import { writeAudit } from "./admin.mjs";
import { sendClientEmail } from "./email.mjs";
import { cleanPricing, pricingText, pricingTotal, samePricing } from "./pricing.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SECTION_KEYS = ["summary", "scope", "deliverables", "timeline", "pricing", "terms"];
const PROPOSAL_STATUSES = ["Draft", "In Review", "Internally Approved", "Sent",
  "Customer Approved", "Customer Rejected", "Revision Requested"];
const LL_PROPOSAL_STATUSES = ["Draft", "In Review", "Sent"];
const MAX_SECTION_CHARS = 20_000;
const MAX_VERSION_SNAPSHOTS = 20;
const MAX_VIEWS = 50;
/* Two opens of the same link from the same device inside this window count as
   one visit — email clients prefetch, and customers refresh. */
const VIEW_DEDUPE_MS = 60_000;

const emptySections = () => Object.fromEntries(SECTION_KEYS.map(k => [k, ""]));

/* Versioning model (rewritten July 28, 2026; pricing added August 2026)
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
     portal, and editing after marking no longer silently clears the flag.
   - A snapshot carries `pricing` alongside `sections`, so the contract inherits
     the numbers the customer actually approved rather than the current draft. */

function commit(p) {
  const first = !(p.versions || []).length && !(p.version || 0);
  const v = first ? 1 : (p.version || 0) + 1;
  const versions = [...(p.versions || []), {
    v, author: p.author, date: today(), status: p.status,
    sections: p.sections || emptySections(),
    pricing: p.pricing || null
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
function snapshotAt(p, v) {
  const snap = (p.versions || []).find(x => x.v === v);
  return {
    sections: snap?.sections || p.sections,
    // `pricing` is undefined on snapshots taken before structured pricing
    // existed; fall back to the live value rather than nulling those out.
    pricing: snap ? (snap.pricing ?? p.pricing ?? null) : (p.pricing || null)
  };
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
  const { dealId, title, templateId } = body || {};
  const deal = await get("DEAL", dealId);
  if (!deal) return resp(404, { error: "deal not found" });
  if (!ctx.can.editDeal(deal)) return resp(403, { error: "Not allowed to create proposals for this deal" });
  if (typeof title !== "string" || !title.trim()) return resp(400, { error: "title is required" });

  // PRD 5.1.2: start from a lab template or blank. A template only seeds the
  // opening draft; nothing about it is retained on the proposal afterwards
  // beyond a note of where it came from.
  let sections = emptySections();
  let pricing = null;
  if (templateId) {
    const t = await get("TEMPLATE", templateId);
    if (!t || t.kind !== "proposal") return resp(400, { error: "unknown proposal template" });
    if (t.lab && !ctx.can.seesLab(t.lab)) return resp(403, { error: "That template belongs to another lab" });
    sections = { ...sections, ...cleanSections(t.sections || {}) };
    pricing = t.pricing || null;
  }

  const id = await nextId("PROPOSAL", "P-");
  const p = {
    pk: "PROPOSAL", sk: id, title: title.trim(), deal: deal.sk, client: deal.client,
    // `owner` mirrors the deal's Lab Leader (PRD 3.3 "leading a project in
    // another lab" exception) — same pattern contracts.mjs uses.
    lab: deal.lab, owner: deal.owner, author: ctx.me.sk, status: "Draft", version: 0, final: false,
    dirty: false, updated: today(), sections, pricing, versions: [],
    ...(templateId ? { fromTemplate: templateId } : {})
  };
  await put(p);
  const { pk, sk, ...rest } = p;
  return resp(201, { id: sk, ...rest });
}

/* Contributors have no lab scope, so a proposal is only visible to one when a
   Lab Leader/Admin names their email on it (PRD 3.3 "shared with them") —
   same share-by-email pattern contracts.mjs already uses. */
export async function listProposals(ctx) {
  const items = await listType("PROPOSAL");
  const visible = ctx.role === "Contributor"
    ? items.filter(p => (p.contributorEmail || "").toLowerCase() === (ctx.me.email || "").toLowerCase())
    : items.filter(p => ctx.can.seesLab(p.lab) || (ctx.role === "Lab Leader" && p.owner === ctx.me.sk));
  visible.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
  return resp(200, visible.map(({ pk, sk, ...rest }) => ({ id: sk, ...rest })));
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
  if ("pricing" in b) {
    const { value, error } = cleanPricing(b.pricing);
    if (error) return resp(400, { error });
    if (!samePricing(next.pricing || null, value)) next.dirty = true;
    next.pricing = value;
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
  const touchedContent = ("sections" in b || "pricing" in b);
  const wantsCommit = b.commit === true || (touchedContent && !draftOnly) || ("status" in b && next.dirty);
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
  // Naming a Contributor here is what makes the proposal visible to them
  // (PRD 3.3 "shared with them") — mirrors contracts.mjs's contributorEmail.
  if ("contributorName" in b) next.contributorName = String(b.contributorName || "").slice(0, 120);
  if ("contributorEmail" in b) {
    const email = String(b.contributorEmail || "").trim();
    if (email && !EMAIL_RE.test(email)) return resp(400, { error: "invalid contributor email" });
    next.contributorEmail = email;
  }
  next.updated = today();
  await put(next);
  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest });
}

/* ---------- send to customer (PRD 3.5) ----------
   "Sending" always freezes the Final version behind a link — that part never
   changes. Delivery is a separate choice the sender makes each time:
   `sendEmail: true` has the portal email the client directly via SES;
   otherwise the response's subject/text let the frontend offer a "copy email
   text" fallback instead. A failed SES send doesn't undo the freeze — the
   link is still valid either way, matching the pre-email behavior.

   Re-sending after a revision is the normal path (PRD 5.3), not an edge case:
   it re-freezes at the new Final version, which is also what re-opens the
   customer's ability to record a decision. */
export async function sendProposal(ctx, id, body) {
  const p = await get("PROPOSAL", id);
  if (!p) return resp(404, { error: "proposal not found" });
  if (!ctx.can.editProposal(p)) return resp(403, { error: "Not allowed to send this proposal" });
  if (!p.final) return resp(409, { error: "Mark a version Final before sending — the Final version is what the client sees" });

  const clientEmail = typeof body?.clientEmail === "string" ? body.clientEmail.trim() : "";
  if (clientEmail && !EMAIL_RE.test(clientEmail)) return resp(400, { error: "invalid client email" });
  if (body?.sendEmail && !clientEmail) return resp(400, { error: "client email is required to send" });

  // Send the version that was marked Final, not whatever the draft has drifted
  // to since. `draftAhead` lets the UI say so rather than surprising the sender.
  const sentVersion = p.finalVersion || p.version;
  const draftAhead = !!(p.dirty || (p.finalVersion && p.finalVersion !== p.version));
  const frozen = snapshotAt(p, sentVersion);
  const resend = !!p.sentAt && p.sentVersion !== sentVersion;
  const next = {
    ...p,
    shareToken: p.shareToken || randomBytes(16).toString("hex"),
    status: "Sent",
    sentVersion,
    sentSections: frozen.sections,
    sentPricing: frozen.pricing,
    sentAt: new Date().toISOString(),
    sendCount: (p.sendCount || 0) + 1,
    updated: today(),
    ...(clientEmail ? { clientEmail } : {})
  };
  await put(next);
  await writeAudit(ctx.me.sk, resend ? "proposal.resent" : "proposal.sent",
    `${id} v${sentVersion} → customer link`);
  await advanceDeal(p.deal, "Proposal Sent");

  const url = `${process.env.FRONTEND_URL}/proposal-view.html?token=${next.shareToken}`;
  const subject = resend
    ? `Updated proposal from Optimistic Labs: ${p.title}`
    : `Your proposal from Optimistic Labs: ${p.title}`;
  const senderName = fullName(ctx.me);
  const lead = resend
    ? `${senderName} at Optimistic Labs has sent you a revised proposal: "${p.title}".`
    : `${senderName} at Optimistic Labs has sent you a proposal: "${p.title}".`;
  const text = `Hi,\n\n${lead}\n\n` +
    `View it and let us know what you think: ${url}\n\n` +
    `Just reply to this email with any questions.\n\n— Optimistic Labs`;
  const html = `<p>Hi,</p><p>${lead.replace(`"${p.title}"`, `<b>${p.title}</b>`)}</p>` +
    `<p><a href="${url}">View it and let us know what you think</a>.</p>` +
    `<p>Just reply to this email with any questions.</p><p>— Optimistic Labs</p>`;

  let emailSent = false, emailError;
  if (body?.sendEmail) {
    try {
      await sendClientEmail({ sender: { ...ctx.me, name: senderName }, toEmail: clientEmail, subject, text, html });
      emailSent = true;
      await writeAudit(ctx.me.sk, "proposal.emailed", `${id} → ${clientEmail}`);
    } catch (err) {
      emailError = err.message;
    }
  }

  const { pk, sk, ...rest } = next;
  return resp(200, {
    ...rest, id: sk,
    sentVersion, draftAhead, resend, url, clientEmail, subject, text, emailSent, emailError
  });
}

/* ---------- public customer routes (Authorizer NONE) ----------
   The 32-hex token is the only credential; it's minted per proposal at send
   time and only ever shared with the client. `meta` carries the request's
   source IP and user-agent, which the handler pulls off the event — the
   modules never see the raw event. */
async function byToken(token) {
  if (!/^[0-9a-f]{32}$/.test(token || "")) return null;
  return (await listType("PROPOSAL")).find(p => p.shareToken === token) || null;
}

/* The customer may record one decision per version they were sent. That is the
   whole revision loop (PRD 5.3): request changes on v2, the Lab Leader revises
   and re-sends as v3, and the customer can decide again. The previous code kept
   a single terminal `decision` field and 409'd forever after the first click,
   which made "Changes Requested → revise → approve" impossible to complete. */
export function decisionForCurrentVersion(p) {
  return (p.decisions || []).find(d => d.version === p.sentVersion) || null;
}

export async function shareView(token, meta = {}) {
  const p = await byToken(token);
  if (!p || !p.sentAt) return resp(404, { error: "This proposal link is not valid" });

  await recordView(p, meta);

  const [lab, owner] = await Promise.all([get("LAB", p.lab), get("PERSON", p.owner)]);
  return resp(200, {
    title: p.title, client: p.client, version: p.sentVersion,
    sentAt: p.sentAt, status: p.status,
    sections: p.sentSections || p.sections,
    pricing: p.sentPricing ?? p.pricing ?? null,
    // Per-lab branding on customer-facing pages (Base Contract PRD 8). Falls
    // back to the OL master brand when a lab carries no identity of its own —
    // `color` is the per-lab accent already on every LAB record.
    brand: { lab: lab?.name || null, accent: lab?.color || null, org: "Optimistic Labs" },
    preparedBy: fullName(owner) || null,
    decision: decisionForCurrentVersion(p),
    // Prior rounds, so a returning customer sees that their earlier comments
    // were received rather than an unexplained new version.
    history: (p.decisions || []).map(d => ({ action: d.action, comment: d.comment, at: d.at, version: d.version }))
  });
}

/* Open tracking (FR7). Written on the read path, which is a write per view;
   the dedupe window keeps email-client prefetches and refreshes from turning
   one read into a dozen rows. Failures here must never break the customer's
   view of the proposal, so this swallows its own errors. */
async function recordView(p, meta) {
  try {
    const at = new Date().toISOString();
    const ip = String(meta.ip || "").slice(0, 60);
    const ua = String(meta.ua || "").slice(0, 300);
    const views = p.views || [];
    const last = views[views.length - 1];
    if (last && last.ip === ip && last.ua === ua &&
      Date.now() - Date.parse(last.at) < VIEW_DEDUPE_MS) return;

    const first = !views.length;
    const next = {
      ...p,
      views: [...views, { at, ip, ua, version: p.sentVersion }].slice(-MAX_VIEWS),
      viewCount: (p.viewCount || 0) + 1,
      lastViewedAt: at,
      ...(first ? { firstViewedAt: at } : {})
    };
    await put(next);
    // FR9: tell the Lab Leader the moment it's been opened, once per proposal.
    if (first) {
      await notifyOwner(p, `${p.client} opened your proposal`,
        `${p.client} just opened "${p.title}" (v${p.sentVersion}) for the first time.`);
    }
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", message: "view tracking failed", detail: err.message }));
  }
}

/* FR18: the deal's stage tracks proposal progress without anyone dragging a
   card. Only ever moves forward, and never touches a Closed deal — closing is
   gated on an Assignment Notice the pipeline collects separately, and quietly
   reopening a closed deal would be worse than leaving the stage alone. */
const STAGE_ORDER = ["Lead", "Discovery", "Proposal Sent", "Negotiating", "Closed"];

async function advanceDeal(dealId, stage) {
  try {
    if (!dealId) return;
    const deal = await get("DEAL", dealId);
    if (!deal || deal.stage === "Closed") return;
    if (STAGE_ORDER.indexOf(deal.stage) >= STAGE_ORDER.indexOf(stage)) return;
    await put({ ...deal, stage });
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", message: "deal stage roll-up failed", detail: err.message }));
  }
}

/* FR9 notifications to the Lab Leader. Best-effort: a failed notification must
   never roll back the customer action that triggered it. */
async function notifyOwner(p, subject, line) {
  try {
    const owner = await get("PERSON", p.owner);
    if (!owner?.email) return;
    const url = `${process.env.FRONTEND_URL}/proposals.html`;
    await sendClientEmail({
      sender: { name: "Optimistic Labs", email: null },
      toEmail: owner.email,
      subject: `[OL Portal] ${subject}`,
      text: `${line}\n\nOpen the portal: ${url}\n\n— Optimistic Labs Portal`,
      html: `<p>${line}</p><p><a href="${url}">Open the portal</a></p><p>— Optimistic Labs Portal</p>`
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", message: "owner notification failed", detail: err.message }));
  }
}

export async function shareDecision(token, body, meta = {}) {
  const p = await byToken(token);
  if (!p || !p.sentAt) return resp(404, { error: "This proposal link is not valid" });
  if (decisionForCurrentVersion(p))
    return resp(409, { error: "You've already responded to this version. We'll be in touch with any update." });

  const STATUS_OF = {
    approve: "Customer Approved",
    reject: "Customer Rejected",
    revision: "Revision Requested"
  };
  const action = body?.action;
  if (!STATUS_OF[action]) return resp(400, { error: "action must be approve, reject, or revision" });
  // PRD 5.2: requesting changes without saying what to change strands the Lab
  // Leader, so the comment is required on that path only.
  const comment = typeof body?.comment === "string" ? body.comment.slice(0, 2000).trim() : "";
  if (action === "revision" && !comment)
    return resp(400, { error: "Tell us what you'd like changed so we can revise it" });
  const name = typeof body?.name === "string" ? body.name.slice(0, 120).trim() : "";

  /* Tiered pricing has no total until the customer picks a package, so the
     approval is where that choice gets made and frozen. Without it a tiered
     proposal would hand the contract a null total (FR3/FR11). */
  const sentPricing = p.sentPricing ?? p.pricing ?? null;
  let chosenPricing = sentPricing;
  if (sentPricing?.kind === "tiered") {
    const tierId = typeof body?.selectedTier === "string" ? body.selectedTier : "";
    if (action === "approve") {
      if (!tierId) return resp(400, { error: "Choose a package before approving" });
      if (!sentPricing.tiers.some(t => t.id === tierId))
        return resp(400, { error: "That package isn't on this proposal" });
      chosenPricing = { ...sentPricing, selected: tierId };
    } else if (tierId && sentPricing.tiers.some(t => t.id === tierId)) {
      // A tier picked alongside a change request is worth keeping — it tells
      // the Lab Leader which package the conversation is actually about.
      chosenPricing = { ...sentPricing, selected: tierId };
    }
  }

  const decision = {
    action, comment, name,
    at: new Date().toISOString(),
    version: p.sentVersion,
    ip: String(meta.ip || "").slice(0, 60),
    ...(chosenPricing?.kind === "tiered" && chosenPricing.selected
      ? { selectedTier: chosenPricing.selected }
      : {})
  };
  await put({
    ...p,
    status: STATUS_OF[action],
    decision,                                   // latest, kept flat for existing readers
    decisions: [...(p.decisions || []), decision],
    // The frozen copy carries the selection so the contract inherits the
    // package the customer actually chose, not an unpriced set of options.
    ...(chosenPricing !== sentPricing ? { sentPricing: chosenPricing, pricing: chosenPricing } : {}),
    // Approval is what unlocks Generate Contract (PRD 5.4.1). Recording which
    // version was approved is what later lets the contract prove that its
    // inherited scope and pricing match what the customer actually said yes to.
    ...(action === "approve"
      ? { approvedVersion: p.sentVersion, approvedAt: decision.at }
      : {}),
    updated: today()
  });
  await writeAudit(name || "customer", "proposal." + action,
    `${p.sk} v${p.sentVersion} (${p.client})${comment ? " · " + comment.slice(0, 120) : ""}`);
  // An approved proposal is a deal in negotiation, not a closed one — closing
  // waits on the signed contract and its Assignment Notice.
  if (action === "approve") await advanceDeal(p.deal, "Negotiating");

  const headline = {
    approve: `${p.client} approved your proposal`,
    reject: `${p.client} declined your proposal`,
    revision: `${p.client} requested changes`
  }[action];
  await notifyOwner(p, headline,
    `${headline} — "${p.title}" (v${p.sentVersion}).${comment ? ` They wrote: "${comment}"` : ""}`);

  return resp(200, { recorded: action });
}

/* Read helper for contracts.mjs: the exact content the customer approved. */
export function approvedSnapshot(p) {
  if (!p?.approvedVersion) return null;
  const snap = snapshotAt(p, p.approvedVersion);
  return {
    version: p.approvedVersion,
    approvedAt: p.approvedAt,
    // `sentSections` is the authoritative record of what was on screen; the
    // version snapshot is the fallback for proposals approved before sending
    // froze pricing.
    sections: p.sentVersion === p.approvedVersion ? (p.sentSections || snap.sections) : snap.sections,
    pricing: p.sentVersion === p.approvedVersion ? (p.sentPricing ?? snap.pricing) : snap.pricing
  };
}

export { pricingText, pricingTotal };
