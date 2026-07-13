/* OL Portal API — server-side twin of the prototype's store.js.
   Identity comes from the Cognito JWT (username = person key, group = role);
   the permissions matrix (PRD 3.3) is enforced here, never trusted from the client. */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand
} from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const TABLE = process.env.TABLE_NAME;
const FILES_BUCKET = process.env.FILES_BUCKET;
const s3 = new S3Client({});
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const ROLE_OF_GROUP = { Admin: "Admin", LabLeader: "Lab Leader", Subcontractor: "Subcontractor" };
const STAGES = ["Lead", "Discovery", "Proposal Sent", "Negotiating", "Closed"];
const SOURCES = ["Referral", "Inbound", "Outbound"];
const PROPOSAL_STATUSES = ["Draft", "In Review", "Internally Approved", "Sent",
  "Customer Approved", "Customer Rejected", "Revision Requested"];
const LL_PROPOSAL_STATUSES = ["Draft", "In Review", "Sent"];
const INVOICE_STATUSES = ["Admin review", "Sent to client", "Paid", "Overdue"];

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

/* ---------- identity + permissions (mirrors store.js) ---------- */
function identity(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  const username = (claims["cognito:username"] || claims.username || "").toLowerCase();
  const rawGroups = claims["cognito:groups"] || "";
  const groups = Array.isArray(rawGroups) ? rawGroups
    : String(rawGroups).replace(/[\[\]]/g, "").split(/[,\s]+/).filter(Boolean);
  const role = ROLE_OF_GROUP[groups.find(g => ROLE_OF_GROUP[g])];
  return { username, role };
}

const perms = (role, myLabs) => ({
  inMyLabs: lab => myLabs.includes(lab),
  seesLab: lab => role === "Admin" || (role === "Lab Leader" && myLabs.includes(lab)),
  addDeal: () => role === "Admin" || (role === "Lab Leader" && myLabs.length > 0),
  editDeal: d => role === "Admin" || (role === "Lab Leader" && myLabs.includes(d.lab)),
  deleteDeal: () => role === "Admin",
  changeLab: () => role === "Admin",
  reviewInvoices: () => role === "Admin",
  editProposal: p => role === "Admin" || (role === "Lab Leader" && myLabs.includes(p.lab)),
  approveProposal: () => role === "Admin"
});

/* ---------- route handlers ---------- */
async function bootstrap(ctx) {
  const [labs, people] = await Promise.all([listType("LAB"), listType("PERSON")]);
  return resp(200, {
    me: ctx.me.sk, role: ctx.role,
    labs: Object.fromEntries(labs.map(({ pk, sk, ...l }) => [sk, l])),
    people: Object.fromEntries(people.map(({ pk, sk, ...p }) => [sk, p]))
  });
}

async function listScoped(ctx, pk) {
  if (ctx.role === "Subcontractor") return resp(200, []);
  const items = await listType(pk);
  const visible = items.filter(x => ctx.can.seesLab(x.lab));
  return resp(200, visible.map(({ pk: _, sk, ...rest }) => ({ id: sk, ...rest })));
}

async function createDeal(ctx, body) {
  if (!ctx.can.addDeal()) return resp(403, { error: "Not allowed to add deals" });
  const { client, lab, owner, stage, amount, close, source, recurring } = body || {};
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

  const id = await nextId("DEAL", "D-");
  const deal = {
    pk: "DEAL", sk: id, client: client.trim(), lab, owner: ownerKey,
    stage, amount, close, source, recurring: !!recurring,
    ...(stage === "Closed" && ["Won", "Lost"].includes(body.outcome) ? { outcome: body.outcome } : {})
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
  const editable = ["client", "owner", "stage", "amount", "close", "source", "recurring", "outcome", "lab"];
  for (const k of editable) if (body && k in body) patch[k] = body[k];
  if ("lab" in patch) {
    if (!ctx.can.changeLab()) return resp(403, { error: "Lab reassignment is admin-only" });
    if (!(await get("LAB", patch.lab))) return resp(400, { error: "unknown lab" });
  }
  if ("stage" in patch && !STAGES.includes(patch.stage)) return resp(400, { error: "invalid stage" });
  if ("amount" in patch && (!Number.isFinite(patch.amount) || patch.amount < 0)) return resp(400, { error: "invalid amount" });
  if ("outcome" in patch && !["Won", "Lost"].includes(patch.outcome)) return resp(400, { error: "invalid outcome" });
  if ("owner" in patch && !(await get("PERSON", patch.owner))) return resp(400, { error: "unknown owner" });

  const next = { ...deal, ...patch };
  if (next.stage !== "Closed") delete next.outcome;
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

async function updateProposal(ctx, id, body) {
  const p = await get("PROPOSAL", id);
  if (!p) return resp(404, { error: "proposal not found" });
  if (!ctx.can.editProposal(p)) return resp(403, { error: "Not allowed to edit this proposal" });
  const next = { ...p };
  if ("status" in (body || {})) {
    const allowed = ctx.can.approveProposal() ? PROPOSAL_STATUSES : LL_PROPOSAL_STATUSES;
    if (!allowed.includes(body.status)) return resp(403, { error: "status not allowed for this role" });
    next.status = body.status;
    next.version = (next.version || 0) + 1;
  }
  if ("final" in (body || {})) next.final = !!body.final;
  next.updated = today();
  await put(next);
  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest });
}

/* ---------- files ---------- */
const canSeeFile = (ctx, f) =>
  ctx.role === "Admin" || !f.lab || (ctx.role === "Lab Leader" && ctx.can.inMyLabs(f.lab)) || f.uploader === ctx.me.sk;

async function listFiles(ctx) {
  const items = await listType("FILE");
  const visible = items.filter(f => canSeeFile(ctx, f));
  visible.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return resp(200, visible.map(({ pk, sk, key, ...rest }) => ({ id: sk, ...rest })));
}

async function createFile(ctx, body) {
  const { name, size, type, lab, deal } = body || {};
  if (typeof name !== "string" || !name.trim()) return resp(400, { error: "name is required" });
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES)
    return resp(400, { error: "size must be 1 byte to 50 MB" });
  if (typeof type !== "string" || !type) return resp(400, { error: "type is required" });
  if (lab && !(await get("LAB", lab))) return resp(400, { error: "unknown lab" });
  if (lab && !ctx.can.seesLab(lab)) return resp(403, { error: "lab not visible to you" });

  const id = await nextId("FILE", "F-");
  const key = `uploads/${id}/${name.trim().replace(/[^\w.\- ]/g, "_")}`;
  const record = {
    pk: "FILE", sk: id, name: name.trim(), key, size, type,
    ...(lab ? { lab } : {}), ...(deal ? { deal } : {}),
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
  const url = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: FILES_BUCKET, Key: f.key,
    ResponseContentDisposition: `attachment; filename="${f.name.replace(/"/g, "")}"`
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

/* ---------- router ---------- */
export const handler = async event => {
  try {
    const { username, role } = identity(event);
    if (!username || !role) return resp(403, { error: "No portal role on this account" });
    const me = await get("PERSON", username);
    if (!me) return resp(403, { error: "No portal profile for this user" });
    const ctx = { me, role, can: perms(role, me.labs || []) };

    const method = event.requestContext.http.method;
    const path = event.rawPath.replace(/\/+$/, "");
    const seg = path.split("/").filter(Boolean);
    let body = null;
    if (event.body) {
      try { body = JSON.parse(event.body); } catch { return resp(400, { error: "invalid JSON body" }); }
    }

    if (method === "GET" && path === "/bootstrap") return await bootstrap(ctx);
    if (method === "GET" && path === "/deals") return await listScoped(ctx, "DEAL");
    if (method === "GET" && path === "/proposals") return await listScoped(ctx, "PROPOSAL");
    if (method === "GET" && path === "/invoices") return await listScoped(ctx, "INVOICE");
    if (method === "POST" && path === "/deals") return await createDeal(ctx, body);
    if (method === "PATCH" && seg[0] === "deals" && seg[1]) return await updateDeal(ctx, seg[1], body);
    if (method === "DELETE" && seg[0] === "deals" && seg[1]) return await deleteDeal(ctx, seg[1]);
    if (method === "GET" && path === "/files") return await listFiles(ctx);
    if (method === "POST" && path === "/files") return await createFile(ctx, body);
    if (method === "GET" && seg[0] === "files" && seg[1] && seg[2] === "download") return await downloadFile(ctx, seg[1]);
    if (method === "DELETE" && seg[0] === "files" && seg[1]) return await deleteFile(ctx, seg[1]);
    if (method === "POST" && path === "/invoices") return await createInvoice(ctx, body);
    if (method === "PATCH" && seg[0] === "invoices" && seg[1]) return await updateInvoice(ctx, seg[1], body);
    if (method === "PATCH" && seg[0] === "proposals" && seg[1]) return await updateProposal(ctx, seg[1], body);

    return resp(404, { error: "no such route" });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: err.message, stack: err.stack }));
    return resp(500, { error: "internal error" });
  }
};
