/* Bootstrap · the roster every screen is built from.

   /bootstrap hands the browser the whole PERSON partition, and the Directory
   and Community's Members tab decide who is on the roster from what arrives
   (web/lib/data.ts, isMember: every account not offboarded, any role). That
   only works if the field that decision reads reaches every viewer, and
   only stays safe if the fields it must not read do not. Both halves are
   pinned here, from a Contributor's side and an Admin's.

   Handler-level, through the same router the Lambda runs, with the real
   table stand-in over AWS_ENDPOINT_URL_DYNAMODB — app.mjs builds its own
   DynamoDB client alongside util.mjs's, so patching one module's export
   leaves the other talking to nothing. Same shape as pipeline-scope.test.mjs.

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

async function bootstrapAs(actor) {
  const person = rows.get(rowKey("PERSON", actor));
  const res = await handler({
    version: "2.0",
    rawPath: "/bootstrap",
    rawQueryString: "",
    headers: {},
    queryStringParameters: {},
    requestContext: {
      http: { method: "GET", path: "/bootstrap", sourceIp: "127.0.0.1" },
      authorizer: { jwt: { claims: { "cognito:username": actor, "cognito:groups": [GROUP[person?.role]] } } }
    },
    isBase64Encoded: false
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

/* One person in each state the roster has to tell apart, and two rows that
   are not people at all:

     liz     Admin, onboarded                       — on the roster
     nora    Lab Leader in two labs, onboarded      — on it once, not twice
     cass    Contributor, onboarded                 — on it; the viewer below
     pat     Contributor, never finished /welcome   — on the roster all the
                                                      same; an account is enough
     dana    Lab Leader, offboarded                 — sent, so a deal she owned
                                                      still names her, not a member
     CT-001  a client contact                       — not a portal user at all
*/
function seed() {
  rows.clear();
  rows.set(rowKey("LAB", "sports"), { pk: "LAB", sk: "sports", name: "Sports Lab" });
  rows.set(rowKey("LAB", "philanthropy"), { pk: "LAB", sk: "philanthropy", name: "Philanthropy Lab" });

  const person = (sk, over) => rows.set(rowKey("PERSON", sk), {
    pk: "PERSON", sk, firstName: sk[0].toUpperCase() + sk.slice(1), lastName: "T",
    email: `${sk}@optimisticlabs.com`, labs: [], ...over
  });
  person("liz", { role: "Admin", onboarded: true });
  person("nora", {
    role: "Lab Leader", labs: ["sports", "philanthropy"], onboarded: true,
    bench: { blurb: "Sports and giving", specialties: ["Ops"], email: "nora@ol.test", phone: "555-0100", showPhone: false }
  });
  person("cass", { role: "Contributor", labs: ["sports"], onboarded: true });
  person("pat", { role: "Contributor" });
  person("dana", {
    role: "Lab Leader", labs: ["sports"], onboarded: true,
    active: false, offboardedAt: "2026-09-01T00:00:00.000Z", offboardedBy: "liz"
  });

  rows.set(rowKey("CONTACT", "CT-001"), { pk: "CONTACT", sk: "CT-001", name: "Adam Brandon", companyId: null });
  rows.set(rowKey("COMPANY", "CO-001"), { pk: "COMPANY", sk: "CO-001", name: "Independent Center", contactId: "CT-001" });
}

test.beforeEach(seed);

/* ---------- what reaches a Contributor ---------- */

test("a Contributor is sent every person, Admins included, each exactly once", async () => {
  const res = await bootstrapAs("cass");
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body.people).sort(), ["cass", "dana", "liz", "nora", "pat"]);
  assert.equal(res.body.people.liz.role, "Admin");
  // Two labs is one record with two ids — never a row per lab.
  assert.deepEqual(res.body.people.nora.labs, ["sports", "philanthropy"]);
});

test("the one field the roster rule reads reaches a Contributor for everyone", async () => {
  const { people } = (await bootstrapAs("cass")).body;
  assert.equal(people.dana.active, false, "dana was offboarded");
  for (const who of ["liz", "nora", "pat"])
    assert.notEqual(people[who].active, false, `${who} is active`);
  // pat has an account and no welcome-screen flag; nothing else is needed.
  assert.equal(people.pat.role, "Contributor");
});

test("what a Contributor is never sent: root email, others' welcome flag, the offboarding audit, hidden contact details", async () => {
  const { people } = (await bootstrapAs("cass")).body;
  for (const who of ["liz", "nora", "pat", "dana"]) {
    assert.equal(people[who].email, undefined, `${who}'s sign-in address leaked`);
    assert.equal(people[who].onboarded, undefined, `${who}'s welcome flag leaked`);
  }
  assert.equal(people.dana.offboardedAt, undefined);
  assert.equal(people.dana.offboardedBy, undefined);
  // Bench email shows unless hidden; phone stays hidden until opted in; the
  // toggles themselves are the owner's business.
  assert.equal(people.nora.bench.email, "nora@ol.test");
  assert.equal(people.nora.bench.phone, undefined);
  assert.equal(people.nora.bench.showPhone, undefined);
  assert.equal(people.nora.bench.showEmail, undefined);
  // Your own record is whole: the welcome gate reads your own `onboarded`.
  assert.equal(people.cass.email, "cass@optimisticlabs.com");
  assert.equal(people.cass.onboarded, true);
});

/* ---------- what reaches an Admin ---------- */

test("an Admin is sent the full record", async () => {
  const { people, role } = (await bootstrapAs("liz")).body;
  assert.equal(role, "Admin");
  assert.equal(people.nora.email, "nora@optimisticlabs.com");
  assert.equal(people.nora.bench.phone, "555-0100");
  assert.equal(people.dana.offboardedBy, "liz");
  assert.equal(people.liz.onboarded, true);
  assert.equal(people.pat.onboarded, undefined);
});

/* ---------- the boundary of the roster ---------- */

test("only PERSON rows are people: a client contact or company never appears", async () => {
  const { people, labs } = (await bootstrapAs("cass")).body;
  assert.ok(!("CT-001" in people));
  assert.ok(!("CO-001" in people));
  assert.ok(!Object.values(people).some(p => p.name === "Adam Brandon"));
  assert.deepEqual(Object.keys(labs).sort(), ["philanthropy", "sports"]);
});

test("a sign-in with no portal profile is refused rather than handed the roster", async () => {
  const res = await bootstrapAs("stranger");
  assert.equal(res.status, 403);
  assert.equal(res.body.people, undefined);
});

test("an offboarded person's still-valid token is refused too", async () => {
  const res = await bootstrapAs("dana");
  assert.equal(res.status, 403);
  assert.match(res.body.error, /deactivated/);
});
