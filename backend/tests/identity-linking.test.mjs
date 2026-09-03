/* buildContext · linking an authenticated caller to their PERSON record.

   The WorkOS cutover changed what the PERSON sort key means: Cognito's pool
   Username (`liz`) became the lowercased email. Records written before the
   cutover kept the old key and carry no email, so a single get() on the email
   missed them and their owners were told they had no portal profile after a
   successful sign-in. These pin the fallback that links the two, and the
   cases where it must refuse to.

   The table is in memory; everything above it is the real buildContext.

   Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_PROVIDER = "workos";
process.env.TABLE_NAME = "ol-portal-test";
process.env.AWS_REGION ??= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";
process.env.AWS_EC2_METADATA_DISABLED = "true";
process.env.AWS_ENDPOINT_URL_DYNAMODB = "http://127.0.0.1:1";

const { doc } = await import("../src/util.mjs");
const { buildContext } = await import("../src/identity.mjs");

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
    return { Items: [...rows.values()].filter(r => r.pk === pk).map(r => structuredClone(r)) };
  }
  throw new Error(`unexpected command ${name}`);
};

const person = item => rows.set(rowKey("PERSON", item.sk), { pk: "PERSON", ...item });

function seed() {
  rows.clear();
  // Pre-cutover: keyed by first name, no email attribute at all.
  person({ sk: "liz", firstName: "Liz", lastName: "Russell", role: "Admin", labs: [] });
  person({ sk: "marcus", firstName: "Marcus", lastName: "Vale", role: "Lab Leader", labs: ["faith"] });
  // Post-cutover: the email is the key and the attribute.
  person({
    sk: "teddy@optimisticlabs.com", firstName: "Teddy", lastName: "Schwarz",
    role: "Admin", labs: [], email: "teddy@optimisticlabs.com"
  });
}

test("a record keyed by the email resolves directly", async () => {
  seed();
  const { ctx, error } = await buildContext({ username: "teddy@optimisticlabs.com" });
  assert.equal(error, undefined);
  assert.equal(ctx.me.sk, "teddy@optimisticlabs.com");
  assert.equal(ctx.role, "Admin");
});

test("a pre-cutover record is found by its email attribute, keeping its own key", async () => {
  seed();
  // What the backfill writes: the address, on the record that kept `liz`.
  person({
    sk: "liz", firstName: "Liz", lastName: "Russell", role: "Admin", labs: [],
    email: "liz@optimisticlabs.com"
  });

  const { ctx, error } = await buildContext({ username: "liz@optimisticlabs.com" });
  assert.equal(error, undefined);
  // The key must NOT become the email: every deal, proposal and invoice that
  // names this person still points at `liz`.
  assert.equal(ctx.me.sk, "liz");
  assert.equal(ctx.role, "Admin");
});

test("the email match is case-normalised on both sides", async () => {
  seed();
  person({
    sk: "marcus", firstName: "Marcus", lastName: "Vale", role: "Lab Leader",
    labs: ["faith"], email: "Marcus@OptimisticLabs.com"
  });

  const { ctx, error } = await buildContext({ username: "marcus@optimisticlabs.com" });
  assert.equal(error, undefined);
  assert.equal(ctx.me.sk, "marcus");
  assert.deepEqual(ctx.me.labs, ["faith"]);
});

test("a record with no email is never reachable by email", async () => {
  seed();
  const { ctx, error } = await buildContext({ username: "liz@optimisticlabs.com" });
  assert.equal(ctx, undefined);
  assert.equal(error.status, 403);
  assert.match(error.message, /No portal profile/);
});

test("two records claiming one address fail closed rather than guess", async () => {
  seed();
  person({ sk: "liz", firstName: "Liz", role: "Admin", labs: [], email: "shared@optimisticlabs.com" });
  person({ sk: "marcus", firstName: "Marcus", role: "Lab Leader", labs: ["faith"], email: "shared@optimisticlabs.com" });

  const { ctx, error } = await buildContext({ username: "shared@optimisticlabs.com" });
  assert.equal(ctx, undefined);
  assert.equal(error.status, 403);
  assert.match(error.message, /More than one portal profile/);
});

test("an unknown address is still refused", async () => {
  seed();
  const { error } = await buildContext({ username: "stranger@example.com" });
  assert.equal(error.status, 403);
});

test("an empty claim is refused before any lookup runs", async () => {
  seed();
  const { error } = await buildContext({ username: "" });
  assert.equal(error.status, 403);
});

test("linking does not widen what the caller may see", async () => {
  seed();
  person({
    sk: "marcus", firstName: "Marcus", role: "Lab Leader", labs: ["faith"],
    email: "marcus@optimisticlabs.com"
  });

  const { ctx } = await buildContext({ username: "marcus@optimisticlabs.com" });
  // The linked record's own role and labs govern, exactly as a directly-keyed
  // record's would: his lab, and no other.
  assert.equal(ctx.can.seesLab("faith"), true);
  assert.equal(ctx.can.seesLab("health"), false);
  assert.equal(ctx.actingAs, false);
});

test("acting as someone still resolves the target by its own key", async () => {
  seed();
  person({ sk: "liz", firstName: "Liz", role: "Admin", labs: [], email: "liz@optimisticlabs.com" });

  const { ctx, error } = await buildContext({
    username: "liz@optimisticlabs.com",
    actAsTarget: "marcus"
  });
  assert.equal(error, undefined);
  assert.equal(ctx.me.sk, "marcus");
  assert.equal(ctx.realMe.sk, "liz");
  assert.equal(ctx.actingAs, true);
});
