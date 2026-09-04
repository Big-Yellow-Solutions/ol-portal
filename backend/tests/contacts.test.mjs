/* OL Portal · Pipeline contacts ("Person" records): phone format, edits, and
   the guard that keeps one from being deleted out from under a deal.

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
const {
  createCompany, listCompanies, createContact, listContacts, updateContact, deleteContact
} = await import("../src/contacts.mjs");

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
  if (name === "DeleteCommand") {
    rows.delete(rowKey(i.Key.pk, i.Key.sk));
    return {};
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

/* The real ctx buildContext hands a handler: the resolved PERSON record and
   role alongside the matrix. Both are read now that client records are
   lab-scoped — `me.sk` stamps createdBy, and the matrix answers who sees
   every record. */
const admin = { role: "Admin", me: { sk: "teddy" }, can: perms("Admin", [], "teddy") };
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

/* ---------- deleting a person ----------

   A deal past the billing gate must carry a company or a contact, so deleting
   the person a deal names would leave a deal the API itself would refuse to
   save. These are about other rows, which is why they need the store. */

const seedDeal = (id, client, { companyId = null, contactId = null } = {}) =>
  rows.set(rowKey("DEAL", id), {
    pk: "DEAL", sk: id, client, lab: "sports", owner: "nora", dealOwner: "nora",
    stage: "Proposal Sent", amount: 24000, close: "2026-10-01", source: "Referral",
    recurring: false, companyId, contactId
  });

test("a person on a deal cannot be deleted, and the refusal names the deal", async () => {
  const adam = body(await createContact(admin, { name: "Adam Brandon" }));
  seedDeal("D-001", "Independent Center — Season Sponsorship", { contactId: adam.id });

  const res = await deleteContact(admin, adam.id);
  assert.equal(res.statusCode, 409);
  const out = body(res);
  assert.match(out.error, /Adam Brandon/);
  assert.match(out.error, /1 deal\b/);
  assert.deepEqual(out.deals, [{ id: "D-001", client: "Independent Center — Season Sponsorship" }]);

  // The point of the refusal: the record — and the deal pointing at it — survive.
  assert.equal(body(await listContacts(admin)).length, 1);
  assert.equal(rows.get(rowKey("DEAL", "D-001")).contactId, adam.id);
});

test("the refusal counts every deal, not just the first", async () => {
  const adam = body(await createContact(admin, { name: "Adam Brandon" }));
  seedDeal("D-001", "Season Sponsorship", { contactId: adam.id });
  seedDeal("D-002", "Gala Underwriting", { contactId: adam.id });
  seedDeal("D-003", "Someone else's deal", { contactId: "CT-999" });

  const out = body(await deleteContact(admin, adam.id));
  assert.match(out.error, /2 deals\b/);
  assert.deepEqual(out.deals.map(d => d.id), ["D-001", "D-002"]);
});

test("a person no deal points at is deleted, and stops being a company's primary contact", async () => {
  const co = body(await createCompany(admin, { name: "Independent Center" }));
  const adam = body(await createContact(admin, { name: "Adam Brandon", companyId: co.id }));
  // createContact makes the first person at a company its primary contact.
  assert.equal(body(await listCompanies(admin))[0].contactId, adam.id);
  seedDeal("D-001", "Independent Center — Season Sponsorship", { companyId: co.id });

  assert.equal((await deleteContact(admin, adam.id)).statusCode, 200);
  assert.equal(body(await listContacts(admin)).length, 0);
  assert.equal(body(await listCompanies(admin))[0].contactId, null, "no dangling primary contact");
  assert.equal(rows.get(rowKey("DEAL", "D-001")).companyId, co.id, "the deal is untouched");
});

test("deleting a person is refused for a Contributor and for one who is not there", async () => {
  const contributor = { role: "Contributor", me: { sk: "cass" }, can: perms("Contributor", ["sports"], "cass") };
  const adam = body(await createContact(admin, { name: "Adam Brandon" }));
  assert.equal((await deleteContact(contributor, adam.id)).statusCode, 403);
  assert.equal((await deleteContact(admin, "CT-999")).statusCode, 404);
  assert.equal(body(await listContacts(admin)).length, 1);
});
