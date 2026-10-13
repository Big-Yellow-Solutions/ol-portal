/* POST /admin/backfill: the Admin page's import. The planning decisions are
   tested in backfill.test.mjs; this is the endpoint around them — who may
   call it, that a check writes nothing, that an import writes exactly the
   plan and nothing when a row is bad, and that it can be run twice.

   Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";

process.env.TABLE_NAME = "ol-portal-test";
process.env.AWS_REGION ??= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";
process.env.AWS_EC2_METADATA_DISABLED = "true";
process.env.AWS_ENDPOINT_URL_DYNAMODB = "http://127.0.0.1:1";

const { doc } = await import("../src/util.mjs");
const { importBackfill } = await import("../src/backfill-api.mjs");

/* The table, in memory: the commands the endpoint issues, and the one
   condition it uses (`attribute_not_exists(pk)` on a put). */
const rows = new Map();
const rowKey = (pk, sk) => `${pk} ${sk}`;
let failPutAfter = Infinity, puts = 0;

doc.send = async cmd => {
  const name = cmd.constructor.name, i = cmd.input;
  if (name === "PutCommand") {
    if (++puts > failPutAfter) throw Object.assign(new Error("boom"), { name: "ConditionalCheckFailedException" });
    const k = rowKey(i.Item.pk, i.Item.sk);
    if (i.ConditionExpression === "attribute_not_exists(pk)" && rows.has(k))
      throw Object.assign(new Error("exists"), { name: "ConditionalCheckFailedException" });
    rows.set(k, structuredClone(i.Item));
    return {};
  }
  if (name === "GetCommand") return { Item: structuredClone(rows.get(rowKey(i.Key.pk, i.Key.sk))) };
  if (name === "QueryCommand") {
    const pk = i.ExpressionAttributeValues[":p"];
    return { Items: [...rows.values()].filter(r => r.pk === pk).map(r => structuredClone(r)) };
  }
  if (name === "UpdateCommand") {
    const k = rowKey(i.Key.pk, i.Key.sk), row = rows.get(k);
    for (const [ph, field] of Object.entries(i.ExpressionAttributeNames)) {
      const v = Object.entries(i.ExpressionAttributeValues)[Object.keys(i.ExpressionAttributeNames).indexOf(ph)][1];
      row[field] = v;
    }
    return {};
  }
  throw new Error(`unexpected command in test: ${name}`);
};

const seed = () => {
  rows.clear(); puts = 0; failPutAfter = Infinity;
  rows.set(rowKey("LAB", "democracy"), { pk: "LAB", sk: "democracy", name: "Democracy Lab" });
  for (const [sk, role] of [["admin@example.com", "Admin"], ["lead@example.com", "Lab Leader"]])
    rows.set(rowKey("PERSON", sk), { pk: "PERSON", sk, email: sk, role });
};
test.beforeEach(seed);

const admin = { role: "Admin", me: { sk: "admin@example.com" } };
const leader = { role: "Lab Leader", me: { sk: "lead@example.com" } };

const FILES = {
  companies: "name,kind,primary_contact_email\nAcme Org,Non-profit,pat@acme.org\nBeta Co,,\n",
  contacts: "name,company,email\nPat Lee,Acme Org,pat@acme.org\n",
  deals: [
    "client,lab,stage,amount,close,source,owner_email,company,contact_email",
    "Acme Retreat,Democracy Lab,Closed Won,\"$35,000.00\",4/22/2026,Referral,lead@example.com,Acme Org,pat@acme.org",
    "Beta Idea,Democracy Lab,Lead,0,,Network,lead@example.com,Beta Co,"
  ].join("\n")
};
const count = pk => [...rows.values()].filter(r => r.pk === pk).length;

test("only an Admin may import", async () => {
  const res = await importBackfill(leader, FILES);
  assert.equal(res.statusCode, 403);
  assert.equal(count("COMPANY"), 0);
});

test("a request with no CSV is refused", async () => {
  const res = await importBackfill(admin, {});
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /at least one CSV/);
});

test("a check answers with the plan and writes nothing", async () => {
  const res = await importBackfill(admin, FILES);
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.ok, true);
  assert.equal(out.imported, false);
  assert.deepEqual(out.summary, { companies: 2, contacts: 1, deals: 2, companiesUpdated: 0 });
  assert.deepEqual(out.preview.deals.map(d => [d.client, d.stage, d.amount, d.close, d.company, d.lab]), [
    ["Acme Retreat", "Closed", 35000, "2026-04-22", "Acme Org", "Democracy Lab"],
    ["Beta Idea", "Lead", 0, "", "Beta Co", "Democracy Lab"]
  ]);
  assert.equal(out.preview.contacts[0].company, "Acme Org");
  assert.equal(count("COMPANY") + count("CONTACT") + count("DEAL"), 0, "a check never writes");
});

test("confirm writes the plan, links it up, and leaves an audit row", async () => {
  const res = await importBackfill(admin, { ...FILES, confirm: true });
  const out = JSON.parse(res.body);
  assert.equal(res.statusCode, 200, out.error);
  assert.equal(out.imported, true);
  assert.equal(out.wrote, 5);
  assert.equal(count("COMPANY"), 2);
  assert.equal(count("CONTACT"), 1);
  assert.equal(count("DEAL"), 2);

  const deal = rows.get(rowKey("DEAL", "D-001"));
  assert.deepEqual([deal.stage, deal.outcome, deal.owner, deal.companyId, deal.contactId, deal.created === deal.updated],
    ["Closed", "Won", "lead@example.com", "CO-001", "CT-001", true]);
  assert.equal(rows.get(rowKey("COMPANY", "CO-001")).contactId, "CT-001");
  assert.equal(rows.get(rowKey("COMPANY", "CO-001")).createdBy, "admin@example.com");

  const audit = [...rows.values()].find(r => r.pk === "AUDIT");
  assert.equal(audit.action, "backfill.import");
  assert.match(audit.detail, /2 companies, 1 contacts, 2 deals/);
});

test("one bad row stops the whole import: nothing is written", async () => {
  const bad = { ...FILES, deals: FILES.deals + "\nGhost,Nowhere Lab,Lead,0,,Network,lead@example.com,,\n" };
  const res = await importBackfill(admin, { ...bad, confirm: true });
  const out = JSON.parse(res.body);
  assert.equal(out.ok, false);
  assert.equal(out.imported, false);
  assert.match(out.errors.join("\n"), /lab "Nowhere Lab" matches no lab/);
  assert.match(out.error, /nothing was imported/);
  assert.equal(count("COMPANY") + count("CONTACT") + count("DEAL"), 0);
});

test("importing the same files twice adds nothing the second time", async () => {
  await importBackfill(admin, { ...FILES, confirm: true });
  const again = JSON.parse((await importBackfill(admin, { ...FILES, confirm: true })).body);
  assert.equal(again.ok, true);
  assert.deepEqual(again.summary, { companies: 0, contacts: 0, deals: 0, companiesUpdated: 0 });
  assert.equal(again.wrote, 0);
  assert.equal(count("COMPANY"), 2);
  assert.equal(count("DEAL"), 2);
});

test("a collision partway through stops with a clear message, and a re-run finishes the job", async () => {
  failPutAfter = 3;
  const res = await importBackfill(admin, { ...FILES, confirm: true });
  const out = JSON.parse(res.body);
  assert.equal(res.statusCode, 409);
  assert.equal(out.wrote, 3);
  assert.match(out.error, /stopped after 3 record\(s\)/);

  failPutAfter = Infinity;
  const done = JSON.parse((await importBackfill(admin, { ...FILES, confirm: true })).body);
  assert.equal(done.imported, true);
  assert.equal(count("COMPANY"), 2);
  assert.equal(count("CONTACT"), 1);
  assert.equal(count("DEAL"), 2);
});
