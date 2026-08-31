/* OL Portal API — server-side twin of the prototype's store.js.
   Identity comes from the Cognito JWT (username = person key, group = role);
   the permissions matrix (PRD 3.3) is enforced here, never trusted from the client. */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand
} from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import * as qbo from "./qbo.mjs";
import * as docusign from "./docusign.mjs";
import { webhook as docusignWebhook } from "./docusign-webhook.mjs";
import * as admin from "./admin.mjs";
import * as proposals from "./proposals.mjs";
import * as contacts from "./contacts.mjs";
import * as contracts from "./contracts.mjs";
import * as contractsCreate from "./contracts-create.mjs";
import * as recurring from "./recurring.mjs";
import * as kb from "./kb.mjs";
import * as profile from "./profile.mjs";
import * as templates from "./templates.mjs";
import * as signing from "./signing.mjs";
import * as resources from "./resources.mjs";
import * as courses from "./courses.mjs";
import * as guides from "./guides.mjs";
import * as community from "./community.mjs";
import { fullName } from "./util.mjs";
import { identityFromClaims, buildContext } from "./identity.mjs";

const TABLE = process.env.TABLE_NAME;
const FILES_BUCKET = process.env.FILES_BUCKET;
const s3 = new S3Client({});
const MAX_FILE_BYTES = 50 * 1024 * 1024;
/* Which slot on a deal an uploaded document fills. Proposals, contracts and
   invoices are produced outside the portal now and uploaded here, so the FILE
   record needs to say which of the deal drawer's three upload boxes it belongs
   in — an untagged file is still just a file on the Files page. */
const FILE_KINDS = ["proposal", "contract", "invoice"];
/* Slots that hold one document rather than a pile of them. A second upload
   into one of these is the next version of the same paper, not a second
   document: createFile stamps it `version: n + 1` and the drawer shows the
   highest version, folding the earlier ones away. An invoice box is the other
   shape — a deal can be invoiced many times, and each invoice stands alone —
   so invoices are unversioned and every upload keeps its own row. */
const VERSIONED_KINDS = ["proposal", "contract"];
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const STAGES = ["Lead", "Discovery", "Proposal Sent", "Negotiating", "Closed"];
// "Network" and "Event" added for Pipeline v2 (design handoff) — additive, so
// deals sourced before this change keep reading the same three values.
const SOURCES = ["Referral", "Inbound", "Network", "Event", "Outbound"];
const INVOICE_STATUSES = ["Admin review", "Sent to client", "Paid", "Overdue"];
// Pipeline v2: a deal needs a billing entity (company and/or contact) once it
// reaches this stage. Only enforced on the transition itself — see
// billingGateError below — so it never retroactively blocks a deal that
// reached this stage before companies/contacts existed.
const BILLING_GATE_STAGE = "Proposal Sent";

const resp = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});
const today = () => new Date().toISOString().slice(0, 10);

const get = async (pk, sk) =>
  (await doc.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }))).Item;
const listType = async pk => {
  const out = [];
  let ExclusiveStartKey;
  do {
    const page = await doc.send(new QueryCommand({
      TableName: TABLE, KeyConditionExpression: "pk = :p",
      ExpressionAttributeValues: { ":p": pk }, ExclusiveStartKey
    }));
    out.push(...page.Items);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
};
const put = item => doc.send(new PutCommand({ TableName: TABLE, Item: item }));

async function nextId(pk, prefix) {
  const items = await listType(pk);
  const max = items.reduce((m, x) => Math.max(m, parseInt(x.sk.replace(/\D/g, ""), 10) || 0), 0);
  return prefix + String(max + 1).padStart(3, "0");
}

/* Identity and the permission matrix moved to identity.mjs when The Optimist
   became a second Lambda: both functions have to resolve the same person to
   the same permissions, and two copies is how that stops being true. */
const identity = event => identityFromClaims(event.requestContext?.authorizer?.jwt?.claims || {});

/* ---------- route handlers ---------- */
async function bootstrap(ctx) {
  const [labs, people] = await Promise.all([listType("LAB"), listType("PERSON")]);
  return resp(200, {
    me: ctx.me.sk, role: ctx.role,
    ...(ctx.actingAs ? { actingAs: { by: ctx.realMe.sk, byName: fullName(ctx.realMe) } } : {}),
    labs: Object.fromEntries(labs.map(({ pk, sk, ...l }) => [sk, l])),
    people: Object.fromEntries(people.map(({ pk, sk, ...p }) =>
      [sk, profile.publicView(p, ctx.me.sk, ctx.role, sk)]))
  });
}

async function listScoped(ctx, pk, extraVisible) {
  if (ctx.role === "Contributor") return resp(200, []);
  const items = await listType(pk);
  const visible = items.filter(x => ctx.can.seesLab(x.lab) || (extraVisible && extraVisible(x)));
  return resp(200, visible.map(({ pk: _, sk, ...rest }) => ({ id: sk, ...rest })));
}

async function isValidDealOwner(key) {
  const p = await get("PERSON", key);
  return !!p && (p.role === "Admin" || p.role === "Lab Leader");
}

function sanitizeAssignmentNotice(n, existingSignatures) {
  if (!n) return null;
  return {
    labLeaders: Array.isArray(n.labLeaders)
      ? n.labLeaders.map(l => ({ key: l && l.key, feeSharePct: l && l.feeSharePct }))
      : [],
    subcontractorCosts: n.subcontractorCosts,
    hardCosts: n.hardCosts,
    signatures: existingSignatures || {}
  };
}

async function isValidAssignmentNotice(n) {
  if (!n || !Array.isArray(n.labLeaders) || !n.labLeaders.length) return false;
  const seen = new Set();
  let pctSum = 0;
  for (const ll of n.labLeaders) {
    if (!ll || typeof ll.key !== "string" || !ll.key || seen.has(ll.key)) return false;
    seen.add(ll.key);
    if (!Number.isFinite(ll.feeSharePct) || ll.feeSharePct < 0) return false;
    pctSum += ll.feeSharePct;
    const p = await get("PERSON", ll.key);
    if (!p || p.role !== "Lab Leader") return false;
  }
  if (Math.abs(pctSum - 100) > 0.01) return false;
  if (!Number.isFinite(n.subcontractorCosts) || n.subcontractorCosts < 0) return false;
  if (!Number.isFinite(n.hardCosts) || n.hardCosts < 0) return false;
  return true;
}

const sameAssignmentTerms = (a, b) =>
  JSON.stringify(a?.labLeaders) === JSON.stringify(b?.labLeaders) &&
  a?.subcontractorCosts === b?.subcontractorCosts && a?.hardCosts === b?.hardCosts;

async function createDeal(ctx, body) {
  if (!ctx.can.addDeal()) return resp(403, { error: "Not allowed to add deals" });
  const { client, lab, owner, dealOwner, stage, amount, close, source, recurring } = body || {};
  const assignable = ctx.role === "Admin" ? null : ctx.me.labs || [];
  if (typeof client !== "string" || !client.trim()) return resp(400, { error: "client is required" });
  if (!(await get("LAB", lab))) return resp(400, { error: "unknown lab" });
  if (assignable && !assignable.includes(lab)) return resp(403, { error: "lab not assignable" });
  if (!STAGES.includes(stage)) return resp(400, { error: "invalid stage" });
  if (!SOURCES.includes(source)) return resp(400, { error: "invalid source" });
  if (!Number.isFinite(amount) || amount < 0) return resp(400, { error: "invalid amount" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(close || "")) return resp(400, { error: "invalid close date" });
  const ownerKey = ctx.role === "Lab Leader" ? ctx.me.sk : (owner || ctx.me.sk);
  if (!(await get("PERSON", ownerKey))) return resp(400, { error: "unknown owner" });
  const dealOwnerKey = dealOwner || ownerKey;
  if (!(await isValidDealOwner(dealOwnerKey))) return resp(400, { error: "unknown deal owner" });
  // Pipeline v2 billing entity: optional at any stage, but a deal can't be
  // *created* at or past the gate stage without one — a proposal/contract
  // can't exist yet either (the deal itself doesn't exist until this call
  // returns), so those two gates only apply on later transitions (updateDeal).
  const companyId = body.companyId || null;
  const contactId = body.contactId || null;
  if (companyId && !(await get("COMPANY", companyId))) return resp(400, { error: "unknown company" });
  if (contactId && !(await get("CONTACT", contactId))) return resp(400, { error: "unknown contact" });
  if (STAGES.indexOf(stage) >= STAGES.indexOf(BILLING_GATE_STAGE) && !companyId && !contactId)
    return resp(400, { error: `A deal at ${stage} needs a billing entity — link a company or a contact` });
  let assignmentNotice = null;
  if (stage === "Closed") {
    assignmentNotice = sanitizeAssignmentNotice(body.assignmentNotice, {});
    if (!(await isValidAssignmentNotice(assignmentNotice)))
      return resp(400, { error: "Assignment Notice is required when closing a deal" });
  }

  const id = await nextId("DEAL", "D-");
  const stamp = today();
  const deal = {
    pk: "DEAL", sk: id, client: client.trim(), lab, owner: ownerKey, dealOwner: dealOwnerKey,
    stage, amount, close, source, recurring: !!recurring, companyId, contactId,
    created: stamp, updated: stamp,
    ...(stage === "Closed" && ["Won", "Lost"].includes(body.outcome) ? { outcome: body.outcome } : {}),
    ...(stage === "Closed" ? { assignmentNotice } : {})
  };
  await put(deal);
  const { pk, sk, ...rest } = deal;
  return resp(201, { id: sk, ...rest });
}

async function updateDeal(ctx, id, body) {
  const deal = await get("DEAL", id);
  if (!deal) return resp(404, { error: "deal not found" });
  if (!ctx.can.editDeal(deal)) return resp(403, { error: "Not allowed to edit this deal" });
  const patch = {};
  const editable = ["client", "owner", "dealOwner", "stage", "amount", "close", "source", "recurring",
    "outcome", "lab", "recurPaused", "autoInvoice", "recurEnd", "assignmentNotice",
    "companyId", "contactId"];
  for (const k of editable) if (body && k in body) patch[k] = body[k];
  if ("recurPaused" in patch) patch.recurPaused = !!patch.recurPaused;
  if ("autoInvoice" in patch) patch.autoInvoice = !!patch.autoInvoice;
  if ("recurEnd" in patch && patch.recurEnd && !/^\d{4}-\d{2}-\d{2}$/.test(patch.recurEnd))
    return resp(400, { error: "invalid recurEnd date" });
  if ("lab" in patch) {
    if (!ctx.can.changeLab()) return resp(403, { error: "Lab reassignment is admin-only" });
    if (!(await get("LAB", patch.lab))) return resp(400, { error: "unknown lab" });
  }
  if ("stage" in patch && !STAGES.includes(patch.stage)) return resp(400, { error: "invalid stage" });
  if ("amount" in patch && (!Number.isFinite(patch.amount) || patch.amount < 0)) return resp(400, { error: "invalid amount" });
  if ("outcome" in patch && !["Won", "Lost"].includes(patch.outcome)) return resp(400, { error: "invalid outcome" });
  if ("owner" in patch && !(await get("PERSON", patch.owner))) return resp(400, { error: "unknown owner" });
  if ("dealOwner" in patch && !(await isValidDealOwner(patch.dealOwner))) return resp(400, { error: "unknown deal owner" });
  if ("companyId" in patch && patch.companyId && !(await get("COMPANY", patch.companyId)))
    return resp(400, { error: "unknown company" });
  if ("contactId" in patch && patch.contactId && !(await get("CONTACT", patch.contactId)))
    return resp(400, { error: "unknown contact" });

  let mergedNotice = deal.assignmentNotice;
  if ("assignmentNotice" in patch) {
    mergedNotice = sanitizeAssignmentNotice(patch.assignmentNotice, deal.assignmentNotice?.signatures);
    const hasSignatures = Object.keys(deal.assignmentNotice?.signatures || {}).length > 0;
    if (hasSignatures && !sameAssignmentTerms(deal.assignmentNotice, mergedNotice))
      return resp(409, { error: "Assignment Notice terms are locked after a signature has been recorded" });
  }
  const noticeValid = await isValidAssignmentNotice(mergedNotice);
  if ("assignmentNotice" in patch) {
    if (!noticeValid) return resp(400, { error: "invalid assignment notice" });
    patch.assignmentNotice = mergedNotice;
  }
  const closingNow = patch.stage === "Closed" && deal.stage !== "Closed";
  if (closingNow && !noticeValid)
    return resp(400, { error: "Assignment Notice is required when closing a deal" });
  // Pipeline v2: a signed client contract on file, in addition to the
  // Assignment Notice above — rollUpDeal (execution.mjs) already closes a deal
  // automatically once both exist, so the only way to hit this is closing one
  // by hand ahead of that. `contractSigned` isn't in `editable`, so it always
  // reflects what rollUpDeal itself set, never a client-supplied value.
  //
  // A contract uploaded onto the deal clears this too, the same way an
  // uploaded proposal clears the Proposal Sent gate below: paper signed
  // outside the portal never reaches rollUpDeal, and a deal whose signed
  // contract is sitting in its own Documents tab should not be unclosable.
  if (closingNow && !deal.contractSigned) {
    const uploaded = (await listType("FILE")).some(f => f.deal === id && f.kind === "contract");
    if (!uploaded) return resp(400, { error: "A signed contract is required to close a deal" });
  }

  // Billing-entity and sent-proposal gates only fire on the transition that
  // actually crosses the gate (or when the billing link itself is being
  // touched) — never a blanket re-check on every save — so a deal that
  // reached a gated stage before this existed can still be edited freely
  // until someone changes its stage or its billing entity.
  if ("stage" in patch || "companyId" in patch || "contactId" in patch) {
    const nextStage = patch.stage ?? deal.stage;
    const nextCompany = "companyId" in patch ? patch.companyId : deal.companyId;
    const nextContact = "contactId" in patch ? patch.contactId : deal.contactId;
    if (STAGES.indexOf(nextStage) >= STAGES.indexOf(BILLING_GATE_STAGE) && !nextCompany && !nextContact)
      return resp(400, { error: `A deal at ${nextStage} needs a billing entity — link a company or a contact` });
  }
  if ("stage" in patch && STAGES.indexOf(patch.stage) >= STAGES.indexOf("Proposal Sent") &&
      STAGES.indexOf(deal.stage) < STAGES.indexOf(patch.stage)) {
    // Proposals are written outside the portal and uploaded onto the deal, so
    // an uploaded proposal file is what clears this gate. The older check —
    // a PROPOSAL record that was marked final and sent from here — still
    // passes, so deals that crossed the gate under the previous workflow can
    // keep moving without re-uploading a document nobody kept.
    const uploaded = (await listType("FILE")).some(f => f.deal === id && f.kind === "proposal");
    const sent = uploaded || (await listType("PROPOSAL")).some(p => p.deal === id && !!p.sentAt);
    if (!sent) return resp(400, { error: `${patch.stage} needs a proposal uploaded to the deal` });
  }

  const next = { ...deal, ...patch, updated: today() };
  if (next.stage !== "Closed") delete next.outcome;
  await put(next);
  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest });
}

/* In-portal e-signature for Assignment Notices: the signer types their name
   while authenticated as themselves, so the "signature" is that typed text
   plus the verified account it came from (who + when, server-stamped). This
   is a lighter-weight scheme than a certified e-signature vendor (no drawn
   signature, no external audit trail) but it's captured directly in the
   portal instead of the manual "assume it's signed outside the system" model
   contracts still use (PRD 3.7). "ol" is the Optimistic Labs line, Admin-only. */
async function signAssignmentNotice(ctx, id, body) {
  const deal = await get("DEAL", id);
  if (!deal) return resp(404, { error: "deal not found" });
  if (!ctx.can.seesLab(deal.lab) && !ctx.can.leadsDeal(deal)) return resp(403, { error: "Not allowed to access this deal" });
  if (deal.stage !== "Closed" || !deal.assignmentNotice)
    return resp(400, { error: "This deal has no Assignment Notice to sign" });
  const signerKey = body?.signerKey;
  const signatureText = typeof body?.signatureText === "string" ? body.signatureText.trim() : "";
  if (!signatureText) return resp(400, { error: "Type your name to sign" });
  if (signatureText.length > 120) return resp(400, { error: "Signature is too long" });
  const isLabLeaderLine = deal.assignmentNotice.labLeaders.some(l => l.key === signerKey);
  if (signerKey !== "ol" && !isLabLeaderLine) return resp(400, { error: "unknown signer" });
  if (signerKey === "ol") {
    if (ctx.role !== "Admin") return resp(403, { error: "Only an Admin can sign for Optimistic Labs" });
  } else if (ctx.me.sk !== signerKey && ctx.role !== "Admin") {
    return resp(403, { error: "You can only sign your own line" });
  }
  const signatures = { ...(deal.assignmentNotice.signatures || {}) };
  if (signatures[signerKey]) return resp(409, { error: "This line is already signed" });
  signatures[signerKey] = {
    by: ctx.me.sk, verifiedName: fullName(ctx.me), name: signatureText, at: new Date().toISOString()
  };
  const next = { ...deal, assignmentNotice: { ...deal.assignmentNotice, signatures } };
  await put(next);
  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest });
}

async function deleteDeal(ctx, id) {
  if (!ctx.can.deleteDeal()) return resp(403, { error: "Deleting deals is admin-only" });
  const deal = await get("DEAL", id);
  if (!deal) return resp(404, { error: "deal not found" });
  await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: "DEAL", sk: id } }));
  return resp(200, { deleted: id });
}

async function createInvoice(ctx, body) {
  const { dealId, recurring } = body || {};
  const deal = await get("DEAL", dealId);
  if (!deal) return resp(404, { error: "deal not found" });
  if (!ctx.can.editDeal(deal)) return resp(403, { error: "Not allowed to invoice this deal" });
  const id = await nextId("INVOICE", "INV-R-");
  const inv = {
    pk: "INVOICE", sk: id, deal: deal.sk, client: deal.client, lab: deal.lab,
    amount: recurring ? Math.round(deal.amount / 12) : deal.amount,
    requestedBy: ctx.role === "Lab Leader" ? ctx.me.sk : deal.owner,
    date: today(), recurring: !!recurring, status: "Admin review"
  };
  await put(inv);
  const { pk, sk, ...rest } = inv;
  return resp(201, { id: sk, ...rest });
}

async function updateInvoice(ctx, id, body) {
  if (!ctx.can.reviewInvoices()) return resp(403, { error: "Invoice review is admin-only" });
  const inv = await get("INVOICE", id);
  if (!inv) return resp(404, { error: "invoice not found" });
  if (!INVOICE_STATUSES.includes(body?.status)) return resp(400, { error: "invalid status" });
  await put({ ...inv, status: body.status });
  return resp(200, { id, status: body.status });
}

/* ---------- files ---------- */
const canSeeFile = (ctx, f) =>
  ctx.role === "Admin" || !f.lab || (ctx.role === "Lab Leader" && ctx.can.inMyLabs(f.lab)) || f.uploader === ctx.me.sk ||
  // Contract PDFs are tagged with the named Contributor's email (pdf/index.mjs)
  // so they can find their own copy without full lab-scoped file access.
  (ctx.role === "Contributor" && f.contributorEmail && f.contributorEmail.toLowerCase() === (ctx.me.email || "").toLowerCase());

async function listFiles(ctx) {
  const items = await listType("FILE");
  const visible = items.filter(f => canSeeFile(ctx, f));
  visible.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return resp(200, visible.map(({ pk, sk, key, ...rest }) => ({ id: sk, ...rest })));
}

async function createFile(ctx, body) {
  const { name, size, type, lab, deal, kind } = body || {};
  if (typeof name !== "string" || !name.trim()) return resp(400, { error: "name is required" });
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES)
    return resp(400, { error: "size must be 1 byte to 50 MB" });
  if (typeof type !== "string" || !type) return resp(400, { error: "type is required" });
  if (lab && !(await get("LAB", lab))) return resp(400, { error: "unknown lab" });
  if (lab && !ctx.can.seesLab(lab)) return resp(403, { error: "lab not visible to you" });
  if (kind && !FILE_KINDS.includes(kind)) return resp(400, { error: "invalid kind" });

  /* A second upload into a single-document slot is the next version of that
     document, not a rival to it, so number it above every version already on
     the deal. Files stored before versioning existed carry no `version` and
     read as v1. A gap left by a deleted version is not reused — the v4 after a
     removed v3 is still the fourth proposal, which is what the record should
     say. */
  let version;
  if (deal && VERSIONED_KINDS.includes(kind)) {
    const siblings = (await listType("FILE")).filter(f => f.deal === deal && f.kind === kind);
    version = siblings.reduce((max, f) => Math.max(max, f.version || 1), 0) + 1;
  }

  const id = await nextId("FILE", "F-");
  const key = `uploads/${id}/${name.trim().replace(/[^\w.\- ]/g, "_")}`;
  const record = {
    pk: "FILE", sk: id, name: name.trim(), key, size, type,
    ...(lab ? { lab } : {}), ...(deal ? { deal } : {}), ...(kind ? { kind } : {}),
    ...(version ? { version } : {}),
    uploader: ctx.me.sk, date: new Date().toISOString(), status: "Uploading"
  };
  await put(record);
  const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: FILES_BUCKET, Key: key, ContentType: type, ContentLength: size
  }), { expiresIn: 900 });
  return resp(201, { id, uploadUrl });
}

async function downloadFile(ctx, id) {
  const f = await get("FILE", id);
  if (!f) return resp(404, { error: "file not found" });
  if (!canSeeFile(ctx, f)) return resp(403, { error: "Not allowed to access this file" });
  // `?disposition=inline` backs the deal drawer's View action: the same
  // presigned URL, but opened in a tab rather than pushed to the downloads
  // folder. Anything the browser can't render inline still downloads.
  const disposition = ctx.query?.disposition === "inline" ? "inline" : "attachment";
  const url = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: FILES_BUCKET, Key: f.key,
    ResponseContentDisposition: `${disposition}; filename="${f.name.replace(/"/g, "")}"`
  }), { expiresIn: 300 });
  return resp(200, { url });
}

async function deleteFile(ctx, id) {
  const f = await get("FILE", id);
  if (!f) return resp(404, { error: "file not found" });
  if (ctx.role !== "Admin" && f.uploader !== ctx.me.sk)
    return resp(403, { error: "Only the uploader or an admin can delete a file" });
  await s3.send(new DeleteObjectCommand({ Bucket: FILES_BUCKET, Key: f.key })).catch(() => {});
  await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: "FILE", sk: id } }));
  return resp(200, { deleted: id });
}

/* ---------- QuickBooks (ported from Bookspark; connection is admin-only) ---------- */
async function qboConnect(ctx) {
  if (!ctx.can.reviewInvoices()) return resp(403, { error: "QuickBooks connection is admin-only" });
  if (!(await qbo.isConfigured()))
    return resp(409, { error: "QuickBooks credentials are not configured yet" });
  return resp(200, { url: await qbo.buildAuthorizeUrl() });
}

async function qboStatus(ctx) {
  if (!ctx.can.reviewInvoices()) return resp(403, { error: "QuickBooks status is admin-only" });
  return resp(200, await qbo.status());
}

async function qboDisconnect(ctx) {
  if (!ctx.can.reviewInvoices()) return resp(403, { error: "QuickBooks disconnect is admin-only" });
  await qbo.disconnect();
  return resp(200, { disconnected: true });
}

async function qboInvoices(ctx) {
  if (!ctx.can.reviewInvoices()) return resp(403, { error: "QuickBooks invoices are admin-only" });
  if (!(await qbo.isConnected())) return resp(409, { error: "QuickBooks is not connected" });
  return resp(200, await qbo.listInvoices());
}

/* Intuit redirects the admin's browser here after consent; there is no JWT on
   this request, so the route is public (Authorizer NONE in template.yaml). The
   OAuth state check in exchangeCode is the CSRF protection. */
async function qboCallback(event) {
  const back = ok => ({
    statusCode: 302,
    headers: { location: `${process.env.FRONTEND_URL}/invoices.html?qbo=${ok ? "connected" : "error"}` }
  });
  const { code, realmId, state } = event.queryStringParameters || {};
  if (!code || !realmId || !state) return back(false);
  try {
    await qbo.exchangeCode(code, realmId, state);
    return back(true);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: "QBO callback failed", detail: err.message }));
    return back(false);
  }
}

/* First-party event log for the Deal View (tab switches, key actions) — see
   web/lib/analytics.ts. Deliberately its own pk, not admin.mjs's AUDIT
   record: that table backs the /admin security audit trail (invites,
   2FA resets, act-as), and routine navigation events would drown it out
   within hours of real usage. A shorter TTL reflects that this is
   low-value telemetry, not a compliance record. */
const EVENT_TTL_DAYS = 30;

async function createEvent(ctx, body) {
  const name = typeof body?.name === "string" ? body.name.slice(0, 100) : "";
  if (!name) return resp(400, { error: "name is required" });
  const props = body?.props && typeof body.props === "object" ? body.props : {};
  const now = new Date();
  await put({
    pk: "EVENT", sk: now.toISOString() + "#" + Math.random().toString(36).slice(2, 6),
    actor: ctx.me.sk, name, detail: JSON.stringify(props).slice(0, 500),
    ttl: Math.floor(now.getTime() / 1000) + EVENT_TTL_DAYS * 86400
  });
  return resp(202, { recorded: true });
}

/* ---------- router ---------- */
async function route(ctx, method, path, seg, body) {
  if (method === "GET" && path === "/bootstrap") return await bootstrap(ctx);
  if (method === "GET" && path === "/guides") return await guides.listGuides(ctx);
  if (method === "POST" && path === "/help/assist") return await guides.helpAssist(ctx, body);
  if (method === "GET" && path === "/deals") return await listScoped(ctx, "DEAL", ctx.can.leadsDeal);
  if (method === "POST" && path === "/events") return await createEvent(ctx, body);
  if (method === "GET" && path === "/proposals") return await proposals.listProposals(ctx);
  if (method === "GET" && path === "/companies") return await contacts.listCompanies(ctx);
  if (method === "POST" && path === "/companies") return await contacts.createCompany(ctx, body);
  if (method === "PATCH" && seg[0] === "companies" && seg[1]) return await contacts.updateCompany(ctx, seg[1], body);
  if (method === "GET" && path === "/contacts") return await contacts.listContacts(ctx);
  if (method === "POST" && path === "/contacts") return await contacts.createContact(ctx, body);
  if (method === "PATCH" && seg[0] === "contacts" && seg[1]) return await contacts.updateContact(ctx, seg[1], body);
  if (method === "GET" && path === "/invoices")
    return await listScoped(ctx, "INVOICE", i => ctx.role === "Lab Leader" && i.requestedBy === ctx.me.sk);
  if (method === "POST" && path === "/deals") return await createDeal(ctx, body);
  if (method === "PATCH" && seg[0] === "deals" && seg[1]) return await updateDeal(ctx, seg[1], body);
  if (method === "DELETE" && seg[0] === "deals" && seg[1]) return await deleteDeal(ctx, seg[1]);
  if (method === "POST" && seg[0] === "deals" && seg[1] && seg[2] === "assignment-notice" && seg[3] === "sign")
    return await signAssignmentNotice(ctx, seg[1], body);
  if (method === "GET" && path === "/files") return await listFiles(ctx);
  if (method === "POST" && path === "/files") return await createFile(ctx, body);
  if (method === "GET" && seg[0] === "files" && seg[1] && seg[2] === "download") return await downloadFile(ctx, seg[1]);
  if (method === "DELETE" && seg[0] === "files" && seg[1]) return await deleteFile(ctx, seg[1]);
  if (method === "POST" && path === "/invoices") return await createInvoice(ctx, body);
  if (method === "PATCH" && seg[0] === "invoices" && seg[1]) return await updateInvoice(ctx, seg[1], body);
  if (method === "POST" && path === "/proposals") return await proposals.createProposal(ctx, body);
  if (method === "POST" && seg[0] === "proposals" && seg[2] === "send") return await proposals.sendProposal(ctx, seg[1], body);
  if (method === "PATCH" && seg[0] === "proposals" && seg[1]) return await proposals.updateProposal(ctx, seg[1], body);
  if (method === "GET" && path === "/contracts") return await contracts.listContracts(ctx);
  /* Base Contract PRD 5.4: generation is an explicit action on an approved
     proposal, not a side effect of the customer's approval. The same route also
     creates a contract directly with no proposal behind it, and — with
     `docKind` in the body — a Contributor MSA or a task order under one. One
     route because they're one record type; see DOC_KINDS in util.mjs. */
  if (method === "POST" && path === "/contracts") return await contractsCreate.createContract(ctx, body);
  if (method === "POST" && seg[0] === "contracts" && seg[1] && seg[2] === "send-for-signature")
    return await signing.sendForSignature(ctx, seg[1], body);
  if (method === "POST" && seg[0] === "contracts" && seg[1] && seg[2] === "countersign")
    return await signing.countersign(ctx, seg[1], body, ctx.meta);
  if (method === "POST" && seg[0] === "contracts" && seg[1] && seg[2] === "docusign" && seg[3] === "resend")
    return await docusign.resendContractEnvelope(ctx, seg[1]);
  if (method === "POST" && seg[0] === "contracts" && seg[1] && seg[2] === "docusign" && seg[3] === "void")
    return await docusign.voidContractEnvelope(ctx, seg[1], body);
  if (method === "PATCH" && seg[0] === "contracts" && seg[1]) return await contracts.updateContract(ctx, seg[1], body);
  if (method === "GET" && path === "/templates") return await templates.listTemplates(ctx);
  if (method === "POST" && path === "/templates") return await templates.createTemplate(ctx, body);
  if (method === "PATCH" && seg[0] === "templates" && seg[1]) return await templates.updateTemplate(ctx, seg[1], body);
  if (method === "DELETE" && seg[0] === "templates" && seg[1]) return await templates.deleteTemplate(ctx, seg[1]);
  /* Resource Library and Courses. The `/download` and `/progress` sub-routes
     are matched before the bare `{id}` forms, which the sequential router
     would otherwise swallow. */
  if (method === "GET" && path === "/resources") return await resources.listResources(ctx);
  if (method === "POST" && path === "/resources") return await resources.createResource(ctx, body);
  if (method === "GET" && seg[0] === "resources" && seg[1] && seg[2] === "download")
    return await resources.downloadResource(ctx, seg[1], ctx.query);
  if (method === "GET" && seg[0] === "resources" && seg[1]) return await resources.getResource(ctx, seg[1]);
  if (method === "PATCH" && seg[0] === "resources" && seg[1]) return await resources.updateResource(ctx, seg[1], body);
  if (method === "DELETE" && seg[0] === "resources" && seg[1]) return await resources.deleteResource(ctx, seg[1]);
  if (method === "GET" && path === "/courses") return await courses.listCourses(ctx);
  if (method === "POST" && path === "/courses") return await courses.createCourse(ctx, body);
  if (method === "GET" && path === "/progress") return await courses.listProgress(ctx);
  if (method === "POST" && seg[0] === "courses" && seg[1] && seg[2] === "progress")
    return await courses.markStepViewed(ctx, seg[1], body);
  if (method === "GET" && seg[0] === "courses" && seg[1]) return await courses.getCourse(ctx, seg[1]);
  if (method === "PATCH" && seg[0] === "courses" && seg[1]) return await courses.updateCourse(ctx, seg[1], body);
  if (method === "DELETE" && seg[0] === "courses" && seg[1]) return await courses.deleteCourse(ctx, seg[1]);
  /* Community feed. The `{id}` forms sit after the bare `/posts` ones, which
     the sequential router would otherwise never reach. */
  if (method === "GET" && path === "/posts") return await community.listPosts(ctx);
  if (method === "POST" && path === "/posts") return await community.createPost(ctx, body);
  if (method === "GET" && seg[0] === "posts" && seg[1]) return await community.getPost(ctx, seg[1]);
  if (method === "PATCH" && seg[0] === "posts" && seg[1]) return await community.updatePost(ctx, seg[1], body);
  if (method === "DELETE" && seg[0] === "posts" && seg[1]) return await community.deletePost(ctx, seg[1]);
  if (method === "GET" && path === "/recurrences") return await recurring.listRecurrences(ctx);
  if (method === "POST" && path === "/recurrences/run") return await recurring.runNow(ctx);
  if (method === "GET" && path === "/kb") return await kb.listKb(ctx);
  if (method === "POST" && path === "/kb") return await kb.createKb(ctx, body);
  if (method === "PATCH" && seg[0] === "kb" && seg[1]) return await kb.updateKb(ctx, seg[1], body);
  if (method === "DELETE" && seg[0] === "kb" && seg[1]) return await kb.deleteKb(ctx, seg[1]);
  if (method === "PATCH" && path === "/profile") return await profile.updateProfile(ctx, null, body);
  if (method === "PATCH" && seg[0] === "profile" && seg[1]) return await profile.updateProfile(ctx, seg[1], body);
  if (method === "GET" && path === "/admin/users") return await admin.listPortalUsers(ctx);
  if (method === "POST" && path === "/admin/invites") return await admin.createInvite(ctx, body);
  if (method === "POST" && seg[0] === "admin" && seg[1] === "invites" && seg[3] === "resend")
    return await admin.resendInvite(ctx, seg[2]);
  if (method === "DELETE" && seg[0] === "admin" && seg[1] === "invites" && seg[2])
    return await admin.revokeInvite(ctx, seg[2]);
  if (method === "PATCH" && seg[0] === "admin" && seg[1] === "users" && seg[2])
    return await admin.updateUserEmail(ctx, seg[2], body);
  if (method === "POST" && seg[0] === "admin" && seg[1] === "users" && seg[3] === "reset-mfa")
    return await admin.resetUserMfa(ctx, seg[2]);
  if (method === "GET" && path === "/admin/audit") return await admin.listAudit(ctx);
  if (method === "POST" && path === "/admin/act-as") return await admin.startActingAs(ctx, body);
  if (method === "POST" && path === "/admin/act-as/stop") return await admin.stopActingAs(ctx);
  if (method === "GET" && path === "/qbo/status") return await qboStatus(ctx);
  if (method === "GET" && path === "/qbo/connect") return await qboConnect(ctx);
  if (method === "POST" && path === "/qbo/disconnect") return await qboDisconnect(ctx);
  if (method === "GET" && path === "/qbo/invoices") return await qboInvoices(ctx);
  if (method === "GET" && path === "/docusign/status") return await docusign.status(ctx);
  if (method === "GET" && path === "/docusign/connect") return await docusign.connect(ctx);
  if (method === "POST" && path === "/docusign/disconnect") return await docusign.disconnectConnection(ctx);
  if (method === "GET" && path === "/docusign/templates") return await docusign.listDocuSignTemplates(ctx);

  return resp(404, { error: "no such route" });
}

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const ACT_AS_ROUTES = new Set(["/admin/act-as", "/admin/act-as/stop"]);

export const handler = async event => {
  try {
    const rawMethod = event.requestContext.http.method;
    const rawPath = event.rawPath.replace(/\/+$/, "");
    if (rawMethod === "GET" && rawPath === "/qbo/callback") return await qboCallback(event);
    if (rawMethod === "GET" && rawPath === "/docusign/callback") return await docusign.callback(event);
    if (rawMethod === "POST" && rawPath === "/docusign/webhook") return await docusignWebhook(event);

    /* Public customer routes (Authorizer NONE) — the token is the credential.
       `meta` carries the caller's source IP and user-agent, which the customer
       flows need for open tracking and, on the signing side, for the ESIGN/UETA
       attribution record. Reading it here keeps the raw event out of the
       modules. */
    const meta = {
      ip: event.requestContext?.http?.sourceIp || "",
      ua: event.headers?.["user-agent"] || ""
    };
    let publicBody = null;
    if (event.body) { try { publicBody = JSON.parse(event.body); } catch { return resp(400, { error: "invalid JSON body" }); } }

    const shareMatch = rawPath.match(/^\/share\/([0-9a-f]+)(\/decision)?$/);
    if (shareMatch) {
      if (rawMethod === "GET" && !shareMatch[2]) return await proposals.shareView(shareMatch[1], meta);
      if (rawMethod === "POST" && shareMatch[2]) return await proposals.shareDecision(shareMatch[1], publicBody, meta);
      return resp(404, { error: "no such route" });
    }

    // Contract signing: view the frozen document, sign it, download the
    // countersigned copy afterwards.
    const signMatch = rawPath.match(/^\/sign\/([0-9a-f]+)(\/pdf|\/docusign-view)?$/);
    if (signMatch) {
      if (rawMethod === "GET" && signMatch[2] === "/pdf") return await signing.signPdf(signMatch[1]);
      if (rawMethod === "GET" && signMatch[2] === "/docusign-view") return await docusign.contractEmbeddedView(signMatch[1]);
      if (rawMethod === "GET" && !signMatch[2]) return await signing.signView(signMatch[1]);
      if (rawMethod === "POST" && !signMatch[2]) return await signing.signSubmit(signMatch[1], publicBody, meta);
      return resp(404, { error: "no such route" });
    }

    const { username, role } = identity(event);
    const { ctx, error: ctxError } = await buildContext({
      username, role,
      actAsTarget: event.headers?.["x-act-as"],
      meta,
      query: event.queryStringParameters || {}
    });
    if (ctxError) return resp(ctxError.status, { error: ctxError.message });

    const method = event.requestContext.http.method;
    const path = event.rawPath.replace(/\/+$/, "");
    const seg = path.split("/").filter(Boolean);
    // Already parsed above, alongside the public routes.
    const body = publicBody;

    const result = await route(ctx, method, path, seg, body);
    if (ctx.actingAs && MUTATING_METHODS.has(method) && !ACT_AS_ROUTES.has(path) && result.statusCode < 300) {
      await admin.writeAudit(ctx.realMe.sk, "admin.act-as-mutation", `${method} ${path} (as ${ctx.me.sk})`);
    }
    return result;
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: err.message, stack: err.stack }));
    return resp(500, { error: "internal error" });
  }
};
