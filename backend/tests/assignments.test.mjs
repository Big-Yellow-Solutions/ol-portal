/* Lab Leader Assignment (Pipeline v3) · the pool math, the filing rules, and
   the approval gate.

   Two of these are regressions in the strict sense — they pin behaviour that
   v3 deliberately *removed*: closing a won deal no longer waits on an
   assignment, and a lost deal is not gated on anything at all. Both used to
   be hard 400s, so a test that only covered the new endpoints would let the
   old blocks creep back unnoticed.

   Handler-level, through the same router the Lambda runs. The table is a real
   in-process stand-in reached over AWS_ENDPOINT_URL_DYNAMODB rather than the
   patched `doc.send` community.test.mjs uses: app.mjs builds its own client
   alongside util.mjs's, so patching one module's export leaves the other
   talking to nothing. Same trick as scripts/dev-api.mjs, and it means the
   approval gate is exercised through the identity the router resolves.

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
const { assignmentMath, cleanAssignment, POOL_PCT, SOFT_RESERVE_PCT, APPROVER_KEY } =
  await import("../src/assignments.mjs");
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

/* liz is the approver and an Admin; seth is the *other* Admin, which is the
   whole reason the gate is a person and not a role. */
const seed = () => {
  rows.clear();
  rows.set(rowKey("LAB", "sports"), { pk: "LAB", sk: "sports", name: "Sports Lab" });
  for (const [sk, first, role] of [
    ["liz", "Liz", "Admin"], ["seth", "Seth", "Admin"],
    ["marcus", "Marcus", "Lab Leader"], ["aliza", "Aliza", "Lab Leader"],
    ["dana", "Dana", "Contributor"]
  ]) rows.set(rowKey("PERSON", sk), { pk: "PERSON", sk, firstName: first, lastName: "T", role, labs: ["sports"], onboarded: true });
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

const FORM = {
  agreementRef: "Independent Center — signed agreement",
  clientName: "Independent Center",
  contractValue: 60000,
  issued: "2026-09-02",
  cadence: "Quarterly",
  hardCosts: 4000,
  subcontractorCosts: 6000,
  leaders: [{ key: "marcus", pct: 60 }, { key: "aliza", pct: 40 }],
  notes: ""
};

test.beforeEach(seed);

/* ---------- the money ---------- */

test("the pool is 70% of what is left after costs and the 5% reserve", () => {
  const m = assignmentMath({ contractValue: 60000, hardCosts: 4000, subcontractorCosts: 6000, leaders: [] });
  assert.equal(SOFT_RESERVE_PCT, 5);
  assert.equal(POOL_PCT, 70);
  assert.equal(m.softReserve, 3000);          // 5% of 60,000
  assert.equal(m.net, 47000);                 // 60,000 − 4,000 − 6,000 − 3,000
  assert.equal(m.pool, 32900);                // 70% of 47,000
});

test("each leader's payout is their share of the pool, and the shares add up to it", () => {
  const m = assignmentMath({ ...FORM });
  assert.deepEqual(m.payouts.map(p => p.payout), [19740, 13160]);
  assert.equal(m.payouts.reduce((s, p) => s + p.payout, 0), m.pool);
});

test("costs bigger than the contract floor the pool at zero rather than going negative", () => {
  const m = assignmentMath({ contractValue: 10000, hardCosts: 9000, subcontractorCosts: 9000, leaders: [] });
  assert.equal(m.net, 0);
  assert.equal(m.pool, 0);
});

/* ---------- the form ---------- */

test("shares have to total 100 across at least one leader", () => {
  assert.match(cleanAssignment({ ...FORM, leaders: [{ key: "marcus", pct: 60 }] }).error, /100%/);
  assert.match(cleanAssignment({ ...FORM, leaders: [] }).error, /at least one lab leader/);
  assert.equal(cleanAssignment(FORM).error, undefined);
});

test("the same leader cannot be listed twice", () => {
  const twice = { ...FORM, leaders: [{ key: "marcus", pct: 50 }, { key: "marcus", pct: 50 }] };
  assert.match(cleanAssignment(twice).error, /only be listed once/);
});

test("the fields finance cannot work without are required", () => {
  assert.match(cleanAssignment({ ...FORM, agreementRef: "" }).error, /agreement reference/);
  assert.match(cleanAssignment({ ...FORM, clientName: "" }).error, /client name/);
  assert.match(cleanAssignment({ ...FORM, contractValue: 0 }).error, /greater than zero/);
  assert.match(cleanAssignment({ ...FORM, cadence: "Whenever" }).error, /cadence/);
  assert.match(cleanAssignment({ ...FORM, issued: "soon" }).error, /issue date/);
});

/* ---------- filing ---------- */

test("an assignment can only be filed once the deal is Closed Won", async () => {
  deal("D-1", { stage: "Negotiating", outcome: undefined });
  const open = await call("marcus", "POST", "/deals/D-1/assignment", FORM);
  assert.equal(open.status, 400);
  assert.match(open.body.error, /Closed Won/);

  deal("D-2", { stage: "Closed Lost", outcome: "Lost" });
  const lost = await call("marcus", "POST", "/deals/D-2/assignment", FORM);
  assert.equal(lost.status, 400, "a lost deal never needs one");

  deal("D-3");
  const won = await call("marcus", "POST", "/deals/D-3/assignment", FORM);
  assert.equal(won.status, 200);
  assert.equal(won.body.assignment.pool, 32900);
  assert.equal(won.body.assignment.filedBy, "marcus");
  assert.equal(won.body.assignment.approved, false);
});

test("a leader has to be someone who could run the engagement", async () => {
  deal("D-1");
  const res = await call("marcus", "POST", "/deals/D-1/assignment",
    { ...FORM, leaders: [{ key: "dana", pct: 100 }] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /unknown lab leader/);

  // The approver is an Admin and still a legitimate leader — she is on the
  // handoff's own leader list.
  const liz = await call("marcus", "POST", "/deals/D-1/assignment",
    { ...FORM, leaders: [{ key: "liz", pct: 100 }] });
  assert.equal(liz.status, 200);
});

/* ---------- the approval gate ---------- */

test("only the approver can approve — not the filer, not the other Admin", async () => {
  deal("D-1");
  await call("marcus", "POST", "/deals/D-1/assignment", FORM);

  assert.equal((await call("marcus", "POST", "/deals/D-1/assignment/approve", {})).status, 403);
  assert.equal((await call("seth", "POST", "/deals/D-1/assignment/approve", {})).status, 403,
    "a second Admin is still not the approver");

  const ok = await call(APPROVER_KEY, "POST", "/deals/D-1/assignment/approve", {});
  assert.equal(ok.status, 200);
  assert.equal(ok.body.assignment.approved, true);
  assert.equal(ok.body.assignment.approvedBy, APPROVER_KEY);
  assert.ok(ok.body.assignment.approvedAt);
});

test("the filer can revise until it is approved, and not after", async () => {
  deal("D-1");
  await call("marcus", "POST", "/deals/D-1/assignment", FORM);

  const revised = await call("marcus", "POST", "/deals/D-1/assignment", { ...FORM, hardCosts: 8000 });
  assert.equal(revised.status, 200);
  assert.equal(revised.body.assignment.hardCosts, 8000);

  await call(APPROVER_KEY, "POST", "/deals/D-1/assignment/approve", {});
  const locked = await call("marcus", "POST", "/deals/D-1/assignment", { ...FORM, hardCosts: 1 });
  assert.equal(locked.status, 409);
  assert.match(locked.body.error, /reopen/);
  assert.equal(rows.get(rowKey("DEAL", "D-1")).assignment.hardCosts, 8000, "the agreed figures did not move");
});

test("reopening is the approver's alone, and hands the figures back as a draft", async () => {
  deal("D-1");
  await call("marcus", "POST", "/deals/D-1/assignment", FORM);
  await call(APPROVER_KEY, "POST", "/deals/D-1/assignment/approve", {});

  assert.equal((await call("marcus", "POST", "/deals/D-1/assignment/reopen", {})).status, 403);

  const reopened = await call(APPROVER_KEY, "POST", "/deals/D-1/assignment/reopen", {});
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.assignment.approved, false);
  assert.equal(reopened.body.assignment.hardCosts, 4000, "kept, not wiped");
  assert.equal((await call("marcus", "POST", "/deals/D-1/assignment", { ...FORM, hardCosts: 12000 })).status, 200);
});

/* ---------- what v3 removed ---------- */

test("closing a won deal no longer waits on an assignment", async () => {
  deal("D-1", { stage: "Negotiating", outcome: undefined, contractSigned: true });
  rows.set(rowKey("PROPOSAL", "P-1"), { pk: "PROPOSAL", sk: "P-1", deal: "D-1", sentAt: "2026-08-01" });

  const res = await call("liz", "PATCH", "/deals/D-1", { stage: "Closed" });
  assert.equal(res.status, 200, res.body?.error);
  assert.equal(res.body.stage, "Closed");
  assert.equal(res.body.outcome, "Won", "outcome comes from the stage now");
  assert.equal(res.body.assignment, undefined, "and nothing was filed to get there");
});

test("a lost deal is gated on nothing — no billing entity, no proposal, no contract", async () => {
  deal("D-1", { stage: "Lead", outcome: undefined, companyId: null, contactId: null, contractSigned: false });

  const res = await call("liz", "PATCH", "/deals/D-1", { stage: "Closed Lost" });
  assert.equal(res.status, 200, res.body?.error);
  assert.equal(res.body.stage, "Closed Lost");
  assert.equal(res.body.outcome, "Lost");
});

test("moving a deal back out of a closed stage drops the outcome with it", async () => {
  deal("D-1", { stage: "Closed Lost", outcome: "Lost", companyId: "CO-001" });
  const res = await call("liz", "PATCH", "/deals/D-1", { stage: "Negotiating" });
  assert.equal(res.status, 200, res.body?.error);
  assert.equal(res.body.outcome, undefined);
});
