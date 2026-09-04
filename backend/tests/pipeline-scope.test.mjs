/* Pipeline · lab scope for the billing entities (Companies and People).

   DEAL, PROPOSAL, CONTRACT and INVOICE have carried a `lab` since the start
   and are filtered on it. COMPANY and CONTACT never have: a client belongs to
   whichever deals name it, not to a lab, so a Lab Leader's slice of them is
   derived (contacts.mjs's labScope) rather than stored. These pin that
   derivation, from both sides — what a leader can read, and what they can
   reach by naming an id the list never gave them.

   Handler-level, through the same router the Lambda runs, with the real table
   stand-in over AWS_ENDPOINT_URL_DYNAMODB — app.mjs builds its own DynamoDB
   client alongside util.mjs's, so patching one module's export leaves the
   other talking to nothing. Same shape as assignments.test.mjs.

   Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";

process.env.TABLE_NAME = "ol-portal-test";
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

const { handler } = await import("../src/app.mjs");

const GROUP = { Admin: "Admin", "Lab Leader": "LabLeader", Contributor: "Contributor" };

async function call(actor, method, path, body) {
  const person = rows.get(rowKey("PERSON", actor));
  const res = await handler({
    version: "2.0",
    rawPath: path,
    rawQueryString: "",
    headers: {},
    queryStringParameters: {},
    requestContext: {
      http: { method, path, sourceIp: "127.0.0.1" },
      authorizer: { jwt: { claims: { "cognito:username": actor, "cognito:groups": [GROUP[person?.role]] } } }
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

const ids = res => res.body.map(r => r.id).sort();

/* Two labs, a leader in each, and a client population arranged so every rule
   in labScope has exactly one record that only it can explain:

     CO-001  on nora's sports deal                    — the seed itself
     CT-003  CO-001's primary contact                 — the primary-contact hop
     CT-001  on nora's sports deal                    — the seed itself
     CO-005  the company CT-001 works at              — the company-of-contact hop
     CO-007  on a philanthropy deal nora *leads*      — PRD 3.3's exception
     CO-006  created by nora, on no deal yet          — the createdBy carve-out
     CO-003  created by liz, on no deal yet           — somebody else's, invisible
     CO-002 / CT-002  on omar's philanthropy deal     — the other lab, invisible
*/
function seed() {
  rows.clear();
  rows.set(rowKey("LAB", "sports"), { pk: "LAB", sk: "sports", name: "Sports Lab" });
  rows.set(rowKey("LAB", "philanthropy"), { pk: "LAB", sk: "philanthropy", name: "Philanthropy Lab" });

  for (const [sk, first, role, labs] of [
    ["liz", "Liz", "Admin", []],
    ["nora", "Nora", "Lab Leader", ["sports"]],
    ["omar", "Omar", "Lab Leader", ["philanthropy"]],
    ["cass", "Cass", "Contributor", ["sports"]]
  ]) rows.set(rowKey("PERSON", sk), { pk: "PERSON", sk, firstName: first, lastName: "T", role, labs, onboarded: true });

  const company = (sk, name, over = {}) =>
    rows.set(rowKey("COMPANY", sk), { pk: "COMPANY", sk, name, contactId: null, ...over });
  const contact = (sk, name, over = {}) =>
    rows.set(rowKey("CONTACT", sk), { pk: "CONTACT", sk, name, companyId: null, ...over });

  company("CO-001", "Independent Center", { contactId: "CT-003" });
  company("CO-002", "Riverbend Trust");
  company("CO-003", "Unattached Holdings", { createdBy: "liz" });
  company("CO-005", "Brandon & Co");
  company("CO-006", "Nora's New Client", { createdBy: "nora" });
  company("CO-007", "Northgate Fund");
  contact("CT-001", "Adam Brandon", { companyId: "CO-005" });
  contact("CT-002", "Pilar Vega");
  contact("CT-003", "Nils Overgaard");

  const deal = (sk, over) => rows.set(rowKey("DEAL", sk), {
    pk: "DEAL", sk, client: sk, stage: "Proposal Sent", amount: 10000,
    close: "2026-12-01", source: "Referral", recurring: false,
    companyId: null, contactId: null, ...over
  });
  deal("D-001", { lab: "sports", owner: "nora", dealOwner: "nora", companyId: "CO-001", contactId: "CT-001" });
  deal("D-002", { lab: "philanthropy", owner: "omar", dealOwner: "omar", companyId: "CO-002", contactId: "CT-002" });
  // PRD 3.3: a Lab Leader also leads projects in other labs. An Admin put nora
  // on this one; it is hers, and so is its client.
  deal("D-004", { lab: "philanthropy", owner: "nora", dealOwner: "nora", companyId: "CO-007" });
}

test.beforeEach(seed);

/* ---------- what a Lab Leader can read ---------- */

test("a Lab Leader's Companies tab is the companies their own deals reach", async () => {
  const res = await call("nora", "GET", "/companies");
  assert.equal(res.status, 200);
  assert.deepEqual(ids(res), ["CO-001", "CO-005", "CO-006", "CO-007"]);
});

test("a Lab Leader's People tab is scoped the same way", async () => {
  const res = await call("nora", "GET", "/contacts");
  assert.equal(res.status, 200);
  assert.deepEqual(ids(res), ["CT-001", "CT-003"]);
});

test("the other lab's leader sees the other lab's clients, and only those", async () => {
  // CO-007 is on D-004: nora leads it, but it sits in omar's lab, so the
  // client is his to see as well. Scope is the lab, not the owner.
  assert.deepEqual(ids(await call("omar", "GET", "/companies")), ["CO-002", "CO-007"]);
  assert.deepEqual(ids(await call("omar", "GET", "/contacts")), ["CT-002"]);
  assert.deepEqual(ids(await call("omar", "GET", "/deals")), ["D-002", "D-004"]);
});

test("an Admin's pipeline is unchanged — every client record, both labs", async () => {
  assert.deepEqual(ids(await call("liz", "GET", "/companies")),
    ["CO-001", "CO-002", "CO-003", "CO-005", "CO-006", "CO-007"]);
  assert.deepEqual(ids(await call("liz", "GET", "/contacts")), ["CT-001", "CT-002", "CT-003"]);
  assert.deepEqual(ids(await call("liz", "GET", "/deals")), ["D-001", "D-002", "D-004"]);
});

test("a Contributor has no pipeline and no client records", async () => {
  assert.deepEqual((await call("cass", "GET", "/companies")).body, []);
  assert.deepEqual((await call("cass", "GET", "/contacts")).body, []);
  assert.deepEqual((await call("cass", "GET", "/deals")).body, []);
});

test("the board is the same scope the tabs are — plus the deal nora leads elsewhere", async () => {
  assert.deepEqual(ids(await call("nora", "GET", "/deals")), ["D-001", "D-004"]);
});

/* ---------- what a Lab Leader cannot reach by naming an id ---------- */

test("another lab's company answers a Lab Leader exactly as a missing one does", async () => {
  const real = await call("nora", "PATCH", "/companies/CO-002", { name: "Renamed" });
  const fake = await call("nora", "PATCH", "/companies/CO-999", { name: "Renamed" });
  assert.equal(real.status, 404);
  assert.deepEqual(real.body, fake.body, "the refusal must not confirm CO-002 exists");
  assert.equal(rows.get(rowKey("COMPANY", "CO-002")).name, "Riverbend Trust", "and nothing was written");
});

test("another lab's person cannot be edited or deleted by a Lab Leader", async () => {
  assert.equal((await call("nora", "PATCH", "/contacts/CT-002", { name: "Renamed" })).status, 404);
  assert.equal((await call("nora", "DELETE", "/contacts/CT-002")).status, 404);
  assert.equal(rows.get(rowKey("CONTACT", "CT-002")).name, "Pilar Vega");
});

test("an unattached record belongs to whoever made it, not to everyone", async () => {
  // CO-006 is nora's; CO-003 is liz's. Neither is on any deal.
  assert.ok(ids(await call("nora", "GET", "/companies")).includes("CO-006"));
  assert.ok(!ids(await call("nora", "GET", "/companies")).includes("CO-003"));
  assert.ok(!ids(await call("omar", "GET", "/companies")).includes("CO-006"));
});

test("a company created by a Lab Leader is theirs at once, before any deal points at it", async () => {
  const made = await call("nora", "POST", "/companies", { name: "Fresh Client" });
  assert.equal(made.status, 201);
  assert.ok(ids(await call("nora", "GET", "/companies")).includes(made.body.id));
  assert.ok(!ids(await call("omar", "GET", "/companies")).includes(made.body.id));
});

/* The write path is the same boundary by a slower route: attach another lab's
   company to a deal of your own and it is yours to read on the next list. */

test("a Lab Leader cannot attach another lab's company to a new deal", async () => {
  const refused = await call("nora", "POST", "/deals", {
    client: "New Sports Client", lab: "sports", stage: "Lead", source: "Referral",
    amount: 5000, close: "2027-01-15", companyId: "CO-002"
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /unknown company/);

  const allowed = await call("nora", "POST", "/deals", {
    client: "New Sports Client", lab: "sports", stage: "Lead", source: "Referral",
    amount: 5000, close: "2027-01-15", companyId: "CO-001"
  });
  assert.equal(allowed.status, 201, allowed.body?.error);
});

test("a Lab Leader cannot attach another lab's person to a deal they already own", async () => {
  const res = await call("nora", "PATCH", "/deals/D-001", { contactId: "CT-002" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /unknown contact/);
  assert.equal(rows.get(rowKey("DEAL", "D-001")).contactId, "CT-001");
});

test("an Admin may still link any client to any deal in either lab", async () => {
  const res = await call("liz", "PATCH", "/deals/D-001", { companyId: "CO-002" });
  assert.equal(res.status, 200, res.body?.error);
  assert.equal(res.body.companyId, "CO-002");
});

/* ---------- the refusal that names other people's deals ---------- */

test("a delete refusal counts every blocking deal but only names the caller's", async () => {
  // Adam Brandon (CT-001) is on nora's D-001 and, after this, on omar's D-002.
  rows.get(rowKey("DEAL", "D-002")).contactId = "CT-001";
  const res = await call("nora", "DELETE", "/contacts/CT-001");
  assert.equal(res.status, 409);
  assert.match(res.body.error, /2 deals\b/, "the count is the truth about the data");
  assert.deepEqual(res.body.deals.map(d => d.id), ["D-001"], "the list is only what nora may see");
});
