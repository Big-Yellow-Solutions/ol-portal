/* Insights · access and money.

   The page is Admin-only, and the only control that counts is the server's:
   every route is exercised as every role, including an Admin acting as a Lab
   Leader (who must be refused, since acting as someone is being them).
   Handler-level through the same router the Lambda runs, same table stand-in
   as assignments.test.mjs.

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
const { mailer } = await import("../src/assignments.mjs");
const { dealFinance } = await import("../src/insights.mjs");
mailer.send = async () => {};
const { handler } = await import("../src/app.mjs");

const GROUP = { Admin: "Admin", "Lab Leader": "LabLeader", Contributor: "Contributor" };

async function call(actor, method, path, body, headers = {}) {
  const person = rows.get(rowKey("PERSON", actor));
  const res = await handler({
    version: "2.0",
    rawPath: path,
    rawQueryString: "",
    headers,
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


const seed = () => {
  rows.clear();
  rows.set(rowKey("LAB", "sports"), { pk: "LAB", sk: "sports", name: "Sports Lab" });
  for (const [sk, first, role] of [
    ["liz", "Liz", "Admin"], ["seth", "Seth", "Admin"],
    ["marcus", "Marcus", "Lab Leader"], ["dana", "Dana", "Contributor"]
  ]) rows.set(rowKey("PERSON", sk), { pk: "PERSON", sk, email: `${sk}@optimisticlabs.com`, firstName: first, lastName: "T", role, labs: ["sports"], onboarded: true });
  rows.set(rowKey("COMPANY", "CO-1"), { pk: "COMPANY", sk: "CO-1", name: "Independent Center" });
  rows.set(rowKey("DEAL", "D-1"), {
    pk: "DEAL", sk: "D-1", client: "Independent Center", lab: "sports", owner: "marcus", dealOwner: "marcus",
    stage: "Contracted", companyId: "CO-1", contractSigned: true, amount: 50000, close: "2026-08-31", created: "2026-05-01", updated: "2026-08-31",
    assignment: {
      contractValue: 50000, hardCosts: 3000, subcontractorCosts: 7000,
      leaders: [{ key: "marcus", pct: 100 }], approved: true,
      payouts: [{ key: "marcus", pct: 100, payout: 26250 }]
    }
  });
};
test.beforeEach(seed);

const ROUTES = [
  ["GET", "/insights"],
  ["PATCH", "/insights/weights", { weights: { "Proposal Sent": 30 } }],
  ["POST", "/insights/exports", { kind: "deals", rows: 3, scope: "All labs", range: "YTD" }]
];

test("an Admin can read Insights, with every lab's payouts", async () => {
  const r = await call("liz", "GET", "/insights");
  assert.equal(r.status, 200);
  assert.equal(r.body.deals.length, 1);
  assert.equal(r.body.deals[0].leaderName, "Marcus T");
  assert.equal(r.body.weights["Proposal Sent"], 25);
});

test("Lab Leaders and Contributors are refused on every Insights route", async () => {
  for (const who of ["marcus", "dana"])
    for (const [method, path, body] of ROUTES) {
      const r = await call(who, method, path, body);
      assert.equal(r.status, 403, `${who} ${method} ${path}`);
      assert.equal(JSON.stringify(r.body).includes("Independent"), false);
    }
  assert.equal(rows.has(rowKey("SETTING", "insights-weights")), false, "a refused write must not land");
});

test("an Admin acting as a Lab Leader is refused too", async () => {
  for (const [method, path, body] of ROUTES) {
    const r = await call("liz", method, path, body, { "x-act-as": "marcus" });
    assert.equal(r.status, 403, `${method} ${path}`);
  }
});

test("any Admin can set the weighting, and it persists org-wide", async () => {
  const w = await call("seth", "PATCH", "/insights/weights", { weights: { "Proposal Sent": 40 } });
  assert.equal(w.status, 200);
  const r = await call("liz", "GET", "/insights");
  assert.equal(r.body.weights["Proposal Sent"], 40);
  assert.equal(r.body.updatedBy, "seth");
});

test("the weighting rejects values outside 0-100", async () => {
  for (const v of [-1, 101, "abc", null]) {
    const r = await call("liz", "PATCH", "/insights/weights", { weights: { "Proposal Sent": v } });
    assert.equal(r.status, 400, String(v));
  }
});

test("exports are logged to the audit trail with who, what and how many", async () => {
  const r = await call("liz", "POST", "/insights/exports", { kind: "deals", rows: 3, scope: "All labs", range: "YTD" });
  assert.equal(r.status, 200);
  const audit = [...rows.values()].filter(x => x.pk === "AUDIT" && x.action === "insights.export");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor, "liz");
  assert.match(audit[0].detail, /deals · 3 rows/);
  const bad = await call("liz", "POST", "/insights/exports", { kind: "everything" });
  assert.equal(bad.status, 400);
});

test("finance: the worked example from the Lab Leader agreement", () => {
  const f = dealFinance(rows.get(rowKey("DEAL", "D-1")));
  assert.equal(f.soft, 2500);
  assert.equal(f.payout, 26250);
  assert.equal(f.ol, 11250);
  assert.equal(f.unallocated, 0);
  assert.equal(f.reconciles, true);
  assert.equal(f.source, "approved");
});

test("finance: a recorded payout that is short of the pool does not reconcile", () => {
  const d = structuredClone(rows.get(rowKey("DEAL", "D-1")));
  d.assignment.payouts = [{ key: "marcus", pct: 100, payout: 25000 }];
  const f = dealFinance(d);
  assert.equal(f.unallocated, 1250);
  assert.equal(f.reconciles, false);
});

test("finance: a deal with no assignment is projected, never presented as filed", () => {
  const f = dealFinance({ amount: 100000 });
  assert.equal(f.source, "projected");
  assert.equal(f.soft, 5000);
  assert.equal(f.payout, 66500);
  assert.equal(f.ol, 28500);
});

test("moving a deal records the date it entered the new stage", async () => {
  const r = await call("liz", "PATCH", "/deals/D-1", { stage: "Closed" });
  assert.equal(r.status, 400, "Closed still needs its paperwork");
  for (const kind of ["proposal", "invoice"])
    rows.set(rowKey("FILE", `F-${kind}`), { pk: "FILE", sk: `F-${kind}`, deal: "D-1", kind });
  const ok = await call("liz", "PATCH", "/deals/D-1", { stage: "Closed" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.stageDates.Closed);
});
