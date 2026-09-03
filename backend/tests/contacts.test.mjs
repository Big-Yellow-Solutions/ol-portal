/* OL Portal · Pipeline contacts ("Person" records): phone format and edits.

   Same in-memory DynamoDB stand-in as community.test.mjs — everything above
   the client is real: the same handlers, the same validation.

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
const { perms } = await import("../src/identity.mjs");
const { createContact, updateContact } = await import("../src/contacts.mjs");

const rows = new Map();
const rowKey = (pk, sk) => `${pk} ${sk}`;

doc.send = async cmd => {
  const name = cmd.constructor.name;
  const i = cmd.input;
  if (name === "PutCommand") {
    rows.set(rowKey(i.Item.pk, i.Item.sk), structuredClone(i.Item));
    return {};
  }
  if (name === "GetCommand") {
    const hit = rows.get(rowKey(i.Key.pk, i.Key.sk));
    return { Item: hit ? structuredClone(hit) : undefined };
  }
  if (name === "QueryCommand") {
    const pk = i.ExpressionAttributeValues[":p"];
    const items = [...rows.values()].filter(r => r.pk === pk).map(r => structuredClone(r));
    items.sort((a, b) => a.sk.localeCompare(b.sk));
    return { Items: items };
  }
  throw new Error(`unexpected command in test: ${name}`);
};

test.beforeEach(() => rows.clear());

const admin = { can: perms("Admin", [], "teddy") };
const body = res => JSON.parse(res.body);

test("a person record needs at least 10 digits in its phone number", async () => {
  const res = await createContact(admin, { name: "Nora Beck", phone: "555-1234" });
  assert.equal(res.statusCode, 400);
  assert.match(body(res).error, /10 digits/);
});

test("a person record accepts a plain 10-digit US number", async () => {
  const res = await createContact(admin, { name: "Nora Beck", phone: "555-123-4567" });
  assert.equal(res.statusCode, 201);
  assert.equal(body(res).phone, "555-123-4567");
});

test("a person record allows an international number with a country code", async () => {
  const res = await createContact(admin, { name: "Omar Diaz", phone: "+44 20 7946 0958" });
  assert.equal(res.statusCode, 201);
  assert.equal(body(res).phone, "+44 20 7946 0958");
});

test("a person record rejects letters in the phone field", async () => {
  const res = await createContact(admin, { name: "Cass Ito", phone: "555-CALL-NOW" });
  assert.equal(res.statusCode, 400);
  assert.match(body(res).error, /invalid phone/);
});

test("phone stays optional — a person record can be created without one", async () => {
  const res = await createContact(admin, { name: "Teddy Schwarz" });
  assert.equal(res.statusCode, 201);
  assert.equal(body(res).phone, "");
});

test("a person record can be edited, phone included", async () => {
  const created = body(await createContact(admin, { name: "Nora Beck", phone: "555-123-4567" }));

  const badPatch = await updateContact(admin, created.id, { phone: "12345" });
  assert.equal(badPatch.statusCode, 400);

  const saved = body(await updateContact(admin, created.id, {
    name: "Nora Beck-Ito", title: "VP Partnerships", phone: "+1 (555) 987-6543"
  }));
  assert.equal(saved.name, "Nora Beck-Ito");
  assert.equal(saved.title, "VP Partnerships");
  assert.equal(saved.phone, "+1 (555) 987-6543");

  // The edit persisted, not just the response — a second read sees it too.
  const reread = body(await updateContact(admin, created.id, {}));
  assert.equal(reread.name, "Nora Beck-Ito");
  assert.equal(reread.phone, "+1 (555) 987-6543");
});
