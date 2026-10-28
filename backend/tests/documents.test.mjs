/* Deal documents · soft delete, protected delete, and waivers.

   The rules the redesigned Documents tab leans on: a requirement is met by a
   live document or an APPROVED waiver (never a pending one), the last version
   of a required document cannot be deleted, and an Admin alone decides a
   waiver. Same in-process table as assignments.test.mjs. Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";

process.env.TABLE_NAME = "ol-portal-test";
process.env.FILES_BUCKET = "test-bucket";
process.env.AWS_REGION ??= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";
process.env.AWS_EC2_METADATA_DISABLED = "true";
process.env.AUTH_PROVIDER = "cognito";

import http from "node:http";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const rows = new Map();
const rowKey = (pk, sk) => `${pk} ${sk}`;
const pack = item => marshall(item, { removeUndefinedValues: true });

const readBody = req => new Promise(resolve => {
  let raw = "";
  req.on("data", c => { raw += c; });
  req.on("end", () => resolve(raw));
});

/* Only the operations this codebase issues, and only the key condition it
   builds — a fake that answered more than the code asks would be a second
   implementation to keep true. */
const table = http.createServer(async (req, res) => {
  const op = String(req.headers["x-amz-target"] || "").split(".").pop();
  const input = JSON.parse((await readBody(req)) || "{}");
  const reply = payload => {
    const text = JSON.stringify(payload ?? {});
    res.writeHead(200, { "content-type": "application/x-amz-json-1.0", "content-length": Buffer.byteLength(text) });
    res.end(text);
  };
  if (op === "GetItem") {
    const key = unmarshall(input.Key);
    const hit = rows.get(rowKey(key.pk, key.sk));
    return reply(hit ? { Item: pack(hit) } : {});
  }
  if (op === "PutItem") {
    const item = unmarshall(input.Item);
    rows.set(rowKey(item.pk, item.sk), item);
    return reply({});
  }
  if (op === "DeleteItem") {
    const key = unmarshall(input.Key);
    rows.delete(rowKey(key.pk, key.sk));
    return reply({});
  }
  if (op === "Query") {
    const pk = unmarshall(input.ExpressionAttributeValues)[":p"];
    const items = [...rows.values()].filter(r => r.pk === pk)
      .sort((a, b) => String(a.sk).localeCompare(String(b.sk)));
    return reply({ Items: items.map(pack), Count: items.length });
  }
  const text = JSON.stringify({ __type: "UnknownOperationException", message: op });
  res.writeHead(400, { "content-type": "application/x-amz-json-1.0", "content-length": Buffer.byteLength(text) });
  res.end(text);
});

await new Promise(resolve => table.listen(0, "127.0.0.1", resolve));
process.env.AWS_ENDPOINT_URL_DYNAMODB = `http://127.0.0.1:${table.address().port}`;
test.after(() => table.close());

/* Imported only now: every module builds its AWS clients at load time and
   reads the endpoint then. */
const { assignmentMath, cleanAssignment, POOL_PCT, SOFT_RESERVE_PCT, mailer } =
  await import("../src/assignments.mjs");
/* liz's record in the fixture is a legacy first-name key carrying her address,
   so the gate is exercised through the email match. */
const APPROVER_KEY = "liz";
const notifsFor = key => [...rows.values()].filter(r => r.pk === `NOTIF#${key}`);

/* The outbox, in memory. Nothing here reaches SES. */
const outbox = [];
mailer.send = async m => { outbox.push(m); };
const { handler } = await import("../src/app.mjs");

const GROUP = { Admin: "Admin", "Lab Leader": "LabLeader", Contributor: "Contributor" };

async function call(actor, method, fullPath, body) {
  const [path, qs = ""] = fullPath.split("?");
  const person = rows.get(rowKey("PERSON", actor));
  const res = await handler({
    version: "2.0",
    rawPath: path,
    rawQueryString: qs,
    headers: {},
    queryStringParameters: Object.fromEntries(new URLSearchParams(qs)),
    requestContext: {
      http: { method, path, sourceIp: "127.0.0.1" },
      authorizer: { jwt: { claims: { "cognito:username": actor, "cognito:groups": [GROUP[person?.role]] } } }
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

/* liz is the approver and an Admin; seth is the *other* Admin, which is the
   whole reason the gate is a person and not a role. */
const seed = () => {
  rows.clear();
  outbox.length = 0;
  rows.set(rowKey("LAB", "sports"), { pk: "LAB", sk: "sports", name: "Sports Lab" });
  for (const [sk, first, role] of [
    ["liz", "Liz", "Admin"], ["seth", "Seth", "Admin"],
    ["marcus", "Marcus", "Lab Leader"], ["aliza", "Aliza", "Lab Leader"],
    ["dana", "Dana", "Contributor"]
  ]) rows.set(rowKey("PERSON", sk), { pk: "PERSON", sk, email: `${sk}@optimisticlabs.com`, firstName: first, lastName: "T", role, labs: ["sports"], onboarded: true });
  rows.set(rowKey("COMPANY", "CO-001"), { pk: "COMPANY", sk: "CO-001", name: "Independent Center" });
};

const deal = (id, over = {}) => {
  const d = {
    pk: "DEAL", sk: id, client: "Independent Center — Season Sponsorship", lab: "sports",
    owner: "marcus", dealOwner: "marcus", stage: "Closed", outcome: "Won", amount: 60000,
    close: "2026-08-31", source: "Referral", recurring: false,
    companyId: "CO-001", contactId: null, contractSigned: true,
    ...over
  };
  rows.set(rowKey("DEAL", id), d);
  return d;
};


const { planVersionFixes } = await import("../src/documents.mjs");

test.beforeEach(seed);

/* A file the way createFile leaves it, minus the S3 round trip. */
let n = 0;
const file = (dealId, kind, over = {}) => {
  const id = `F-${++n}`;
  const f = {
    pk: "FILE", sk: id, name: `${kind}-${id}.pdf`, key: `uploads/${id}/x.pdf`, size: 10, type: "application/pdf",
    lab: "sports", deal: dealId, kind, uploader: "marcus", date: new Date().toISOString(), status: "Ready",
    ...(kind !== "invoice" ? { version: 1 } : {}), ...over
  };
  rows.set(rowKey("FILE", id), f);
  return f;
};
const waiver = (dealId, requirement, status = "pending", over = {}) => {
  const id = `W-${++n}`;
  const w = { pk: "WAIVER", sk: id, deal: dealId, requirement, reason: "Agreement is in email", attachments: [],
    requestedBy: "marcus", requestedAt: new Date().toISOString(), status, ...over };
  rows.set(rowKey("WAIVER", id), w);
  return w;
};
const move = (actor, id, stage) => call(actor, "PATCH", `/deals/${id}`, { stage });

/* ---------- soft delete ---------- */

test("deleting a deal document keeps the record and drops it from every list", async () => {
  deal("D-1", { stage: "Discovery", outcome: undefined });
  const f = file("D-1", "proposal");
  const res = await call("marcus", "DELETE", `/files/${f.sk}`);
  assert.equal(res.status, 200);
  assert.ok(rows.get(rowKey("FILE", f.sk)).deletedAt, "the row is kept, marked deleted");
  const list = await call("marcus", "GET", "/files");
  assert.deepEqual(list.body.map(x => x.id), []);
});

test("a Files-page upload with no deal is still removed outright", async () => {
  const f = { pk: "FILE", sk: "F-X", name: "a.pdf", key: "k", size: 1, type: "x", uploader: "marcus", date: new Date().toISOString() };
  rows.set(rowKey("FILE", "F-X"), f);
  assert.equal((await call("marcus", "DELETE", "/files/F-X")).status, 200);
  assert.equal(rows.has(rowKey("FILE", "F-X")), false);
});

/* ---------- protected delete ---------- */

test("any version can go while another remains; the last one of a required document cannot", async () => {
  deal("D-2", { stage: "Contracted", contractSigned: false, outcome: undefined });
  file("D-2", "proposal");
  const v1 = file("D-2", "contract", { version: 1 });
  const v2 = file("D-2", "contract", { version: 2 });
  assert.equal((await call("marcus", "DELETE", `/files/${v1.sk}`)).status, 200);
  const last = await call("marcus", "DELETE", `/files/${v2.sk}`);
  assert.equal(last.status, 409);
  assert.match(last.body.error, /only signed contract.*Contracted \(Signed\)/);
  assert.equal(rows.get(rowKey("FILE", v2.sk)).deletedAt, undefined);
});

test("a proposal is protected from Proposal & Negotiation on, and not before", async () => {
  deal("D-3", { stage: "Proposal Sent", outcome: undefined });
  const p = file("D-3", "proposal");
  assert.equal((await call("marcus", "DELETE", `/files/${p.sk}`)).status, 409);
  deal("D-4", { stage: "Discovery", outcome: undefined });
  const q = file("D-4", "proposal");
  assert.equal((await call("marcus", "DELETE", `/files/${q.sk}`)).status, 200);
});

test("an approved waiver lifts the protection; a pending one does not; invoices are never protected", async () => {
  deal("D-5", { stage: "Contracted", contractSigned: false, outcome: undefined });
  const c = file("D-5", "contract");
  waiver("D-5", "contract", "pending");
  assert.equal((await call("marcus", "DELETE", `/files/${c.sk}`)).status, 409);
  waiver("D-5", "contract", "approved");
  assert.equal((await call("marcus", "DELETE", `/files/${c.sk}`)).status, 200);

  deal("D-6", { stage: "Closed" });
  const inv = file("D-6", "invoice");
  assert.equal((await call("marcus", "DELETE", `/files/${inv.sk}`)).status, 200);
});

test("undo takes a fresh upload back even when it is the only one; abort removes it outright", async () => {
  deal("D-7", { stage: "Contracted", contractSigned: false, outcome: undefined });
  const c = file("D-7", "contract");
  assert.equal((await call("marcus", "DELETE", `/files/${c.sk}?undo=1`)).status, 200);
  assert.ok(rows.get(rowKey("FILE", c.sk)).deletedAt);
  const d = file("D-7", "contract");
  assert.equal((await call("marcus", "DELETE", `/files/${d.sk}?abort=1`)).status, 200);
  assert.equal(rows.has(rowKey("FILE", d.sk)), false);
  const old = file("D-7", "contract", { date: new Date(Date.now() - 3600e3).toISOString() });
  assert.equal((await call("marcus", "DELETE", `/files/${old.sk}?undo=1`)).status, 409, "only within the window");
  assert.equal((await call("aliza", "DELETE", `/files/${old.sk}?undo=1`)).status, 403, "and only by the uploader");
});

/* ---------- gates ---------- */

test("a deleted document no longer clears a stage gate, and an approved waiver does", async () => {
  deal("D-8", { stage: "Discovery", outcome: undefined, contractSigned: false });
  const p = file("D-8", "proposal");
  await call("marcus", "DELETE", `/files/${p.sk}`);
  const blocked = await move("marcus", "D-8", "Proposal Sent");
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /needs a proposal/);

  waiver("D-8", "proposal", "pending");
  assert.equal((await move("marcus", "D-8", "Proposal Sent")).status, 400, "pending never counts");
  waiver("D-8", "proposal", "approved");
  assert.equal((await move("marcus", "D-8", "Proposal Sent")).status, 200);

  const toContracted = await move("marcus", "D-8", "Contracted");
  assert.match(toContracted.body.error, /signed contract/);
  waiver("D-8", "contract", "approved");
  assert.equal((await move("marcus", "D-8", "Contracted")).status, 200);
});

test("invoices cannot be waived", async () => {
  deal("D-9", { stage: "Contracted", outcome: undefined, contractSigned: true });
  file("D-9", "proposal");
  const res = await call("marcus", "POST", "/deals/D-9/waivers", { requirements: ["invoice"], reason: "x" });
  assert.equal(res.status, 400);
});

/* ---------- the waiver flow ---------- */

test("requesting a waiver files one pending record per requirement and rings every admin", async () => {
  deal("D-10", { stage: "Contracted", outcome: undefined, contractSigned: false });
  const res = await call("marcus", "POST", "/deals/D-10/waivers", { requirements: ["contract", "proposal"], reason: "  Signed by email " });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.map(w => w.requirement).sort(), ["contract", "proposal"]);
  assert.ok(res.body.every(w => w.status === "pending" && w.reason === "Signed by email" && w.requestedBy === "marcus"));
  for (const admin of ["liz", "seth"]) assert.equal(notifsFor(admin).length, 1);
});

test("a reason is required, a duplicate request is refused, and so is one for a document already on file", async () => {
  deal("D-11", { stage: "Contracted", outcome: undefined, contractSigned: false });
  assert.equal((await call("marcus", "POST", "/deals/D-11/waivers", { requirements: ["contract"], reason: "  " })).status, 400);
  assert.equal((await call("marcus", "POST", "/deals/D-11/waivers", { requirements: [], reason: "x" })).status, 400);
  assert.equal((await call("marcus", "POST", "/deals/D-11/waivers", { requirements: ["contract"], reason: "x" })).status, 201);
  assert.equal((await call("marcus", "POST", "/deals/D-11/waivers", { requirements: ["contract"], reason: "x" })).status, 409);
  file("D-11", "proposal");
  assert.equal((await call("marcus", "POST", "/deals/D-11/waivers", { requirements: ["proposal"], reason: "x" })).status, 409);
});

test("only someone who can edit the deal may ask", async () => {
  deal("D-12", { stage: "Contracted", outcome: undefined, contractSigned: false });
  assert.equal((await call("dana", "POST", "/deals/D-12/waivers", { requirements: ["contract"], reason: "x" })).status, 403);
});

test("only an admin decides; declining needs a note; the requester and deal owner hear back", async () => {
  deal("D-13", { stage: "Contracted", outcome: undefined, contractSigned: false });
  const [w] = (await call("aliza", "POST", "/deals/D-13/waivers", { requirements: ["contract"], reason: "x" })).body;
  assert.equal((await call("marcus", "POST", `/waivers/${w.id}/approve`, {})).status, 403);
  assert.equal((await call("seth", "POST", `/waivers/${w.id}/decline`, { note: " " })).status, 400);

  const declined = await call("seth", "POST", `/waivers/${w.id}/decline`, { note: "Get the paper" });
  assert.equal(declined.body.status, "declined");
  assert.equal(declined.body.adminNote, "Get the paper");
  assert.equal(notifsFor("aliza").length, 1, "the requester");
  assert.equal(notifsFor("marcus").length, 1, "the deal owner");
  assert.equal((await call("seth", "POST", `/waivers/${w.id}/approve`, {})).status, 409, "decided once");
});

test("an admin can approve their own request, and approval clears the gate", async () => {
  deal("D-14", { stage: "Proposal Sent", outcome: undefined, contractSigned: false });
  file("D-14", "proposal");
  const [w] = (await call("liz", "POST", "/deals/D-14/waivers", { requirements: ["contract"], reason: "x" })).body;
  const ok = await call("liz", "POST", `/waivers/${w.id}/approve`, {});
  assert.equal(ok.status, 200);
  assert.equal(ok.body.reviewedBy, "liz");
  assert.equal((await move("liz", "D-14", "Contracted")).status, 200);
});

test("uploading the real document withdraws a pending waiver; failing or undoing it puts the request back", async () => {
  deal("D-15", { stage: "Contracted", outcome: undefined, contractSigned: false });
  const [w] = (await call("marcus", "POST", "/deals/D-15/waivers", { requirements: ["contract"], reason: "x" })).body;
  const up = await call("marcus", "POST", "/files", { name: "signed.pdf", size: 10, type: "application/pdf", deal: "D-15", kind: "contract", lab: "sports" });
  assert.equal(up.status, 201);
  assert.equal(rows.get(rowKey("WAIVER", w.id)).status, "withdrawn");
  await call("marcus", "DELETE", `/files/${up.body.id}?abort=1`);
  assert.equal(rows.get(rowKey("WAIVER", w.id)).status, "pending");

  const again = await call("marcus", "POST", "/files", { name: "signed.pdf", size: 10, type: "application/pdf", deal: "D-15", kind: "contract", lab: "sports" });
  assert.equal(rows.get(rowKey("WAIVER", w.id)).status, "withdrawn");
  await call("marcus", "DELETE", `/files/${again.body.id}?undo=1`);
  assert.equal(rows.get(rowKey("WAIVER", w.id)).status, "pending");
});

test("an approved waiver survives the real document arriving, and the requester can withdraw a pending one", async () => {
  deal("D-16", { stage: "Contracted", outcome: undefined, contractSigned: false });
  const [a, b] = (await call("marcus", "POST", "/deals/D-16/waivers", { requirements: ["contract", "proposal"], reason: "x" })).body;
  await call("liz", "POST", `/waivers/${a.id}/approve`, {});
  const w = await call("marcus", "POST", `/waivers/${b.id}/withdraw`, {});
  assert.equal(w.body.status, "withdrawn");
  assert.equal((await call("marcus", "POST", `/waivers/${a.id}/withdraw`, {})).status, 409, "approved cannot be withdrawn");
  await call("marcus", "POST", "/files", { name: "signed.pdf", size: 10, type: "application/pdf", deal: "D-16", kind: "contract", lab: "sports" });
  assert.equal(rows.get(rowKey("WAIVER", a.id)).status, "approved");
});

test("waiver proof is an attachment: it never counts as a document and stays off the Files page", async () => {
  deal("D-17", { stage: "Contracted", outcome: undefined, contractSigned: false });
  const up = await call("marcus", "POST", "/files", { name: "email.pdf", size: 10, type: "application/pdf", deal: "D-17", attachment: true, lab: "sports" });
  assert.equal(up.status, 201);
  assert.equal((await call("marcus", "POST", "/files", { name: "x.pdf", size: 10, type: "a/b", deal: "D-17", kind: "contract", attachment: true })).status, 400);
  assert.deepEqual((await call("marcus", "GET", "/files")).body, []);

  const res = await call("marcus", "POST", "/deals/D-17/waivers", { requirements: ["contract"], reason: "x", attachments: [up.body.id] });
  assert.equal(res.body[0].attachments[0].name, "email.pdf");
  assert.equal((await call("marcus", "POST", "/deals/D-17/waivers", { requirements: ["proposal"], reason: "x", attachments: ["F-nope"] })).status, 400);

  const more = await call("marcus", "POST", "/files", { name: "approval.pdf", size: 10, type: "application/pdf", deal: "D-17", attachment: true, lab: "sports" });
  const added = await call("marcus", "POST", `/waivers/${res.body[0].id}/attachments`, { attachments: [more.body.id] });
  assert.deepEqual(added.body.attachments.map(a => a.name), ["email.pdf", "approval.pdf"]);
  assert.equal((await move("marcus", "D-17", "Closed")).status, 400, "no proposal, contract or invoice from attachments");
});

test("waivers are listed only for deals the caller can see", async () => {
  deal("D-18", { stage: "Contracted", outcome: undefined, contractSigned: false });
  await call("marcus", "POST", "/deals/D-18/waivers", { requirements: ["contract"], reason: "x" });
  assert.equal((await call("liz", "GET", "/waivers")).body.length, 1);
  assert.equal((await call("dana", "GET", "/waivers")).body.length, 0);
});

test("a deleted version's number is not reused, and /files says what the next one is", async () => {
  deal("D-19", { stage: "Discovery", outcome: undefined });
  file("D-19", "proposal", { version: 1 });
  const v2 = file("D-19", "proposal", { version: 2 });
  await call("marcus", "DELETE", `/files/${v2.sk}`);
  const list = await call("marcus", "GET", "/files");
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].maxVersion, 2, "the deleted v2 still holds its number");
  const up = await call("marcus", "POST", "/files", { name: "p.pdf", size: 10, type: "application/pdf", deal: "D-19", kind: "proposal", lab: "sports" });
  assert.equal(rows.get(rowKey("FILE", up.body.id)).version, 3);
});

/* ---------- migrating uploads that predate versions ---------- */

test("a lone unversioned upload, or a clean versioned chain, needs no migration", () => {
  const f = (id, kind, version, date) => ({ sk: id, deal: "D-1", kind, version, date });
  assert.deepEqual(planVersionFixes([f("a", "proposal", undefined, "2026-01-01")]), []);
  assert.deepEqual(planVersionFixes([f("a", "proposal", undefined, "2026-01-01"), f("b", "proposal", 2, "2026-02-01")]), []);
  assert.deepEqual(planVersionFixes([f("a", "contract", 1, "2026-01-01"), f("b", "contract", 2, "2026-02-01")]), []);
});

test("several unversioned uploads are numbered by date, and later versions shift up behind them", () => {
  const f = (id, version, date, over = {}) => ({ sk: id, deal: "D-1", kind: "proposal", version, date, ...over });
  const fixes = planVersionFixes([
    f("late", undefined, "2026-03-01"), f("early", undefined, "2026-01-01"), f("mid", undefined, "2026-02-01"),
    f("v2", 2, "2026-04-01"), f("v4", 4, "2026-06-01"),            // v3 was deleted earlier
    f("gone", undefined, "2026-01-15", { deletedAt: "2026-02-01" }), // a deleted file is left alone
    f("other", undefined, "2026-01-01", { deal: "D-2" }),            // a different deal is its own group
  ]);
  const to = Object.fromEntries(fixes.map(x => [x.id, x.to]));
  assert.deepEqual(to, { early: 1, mid: 2, late: 3, v2: 4, v4: 6 }, "order kept, the v3 gap kept");
  assert.equal(planVersionFixes([]).length, 0);
});

test("invoices are never renumbered, and re-running the plan after applying it changes nothing", () => {
  const inv = [{ sk: "i1", deal: "D-1", kind: "invoice", date: "2026-01-01" }, { sk: "i2", deal: "D-1", kind: "invoice", date: "2026-02-01" }];
  assert.deepEqual(planVersionFixes(inv), []);
  const files = [{ sk: "a", deal: "D-1", kind: "contract", date: "2026-01-01" }, { sk: "b", deal: "D-1", kind: "contract", date: "2026-02-01" }];
  const applied = files.map(f => ({ ...f, version: planVersionFixes(files).find(x => x.id === f.sk)?.to }));
  assert.deepEqual(planVersionFixes(applied), []);
});
