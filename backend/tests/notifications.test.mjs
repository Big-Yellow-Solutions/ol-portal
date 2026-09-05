/* Notifications · who gets told, who does not, and who cannot forge one.

   The bell used to be a span with a permanent dot: it claimed something had
   happened, forever, and there was nowhere to go and find out what. The
   claims worth testing here are the ones that make the new bell believable
   rather than decorative:

     - a mention in a post reaches the person named, and nobody else;
     - a mention you cannot see does not reach you, because the post is scoped
       to a lab you are not in;
     - your own actions never ring your own bell;
     - one person's partition is not another person's, so listing is not a
       filter over everyone's rows;
     - marking read is idempotent and does not resurrect read rows.

   Same in-memory table as community.test.mjs, for the same reason: the store
   IS the feature, and a test that stops above the write cannot tell a
   partition from a variable.

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
const {
  notify, mentionKeys, listNotifications, markRead, personByEmail
} = await import("../src/notifications.mjs");
const { createPost, updatePost } = await import("../src/community.mjs");

/* ---------- the table, in memory ---------- */
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

const PEOPLE = [
  { sk: "teddy", firstName: "Teddy", lastName: "Schwarz", role: "Admin", labs: [], email: "teddy@optimisticlabs.com" },
  { sk: "nora", firstName: "Nora", lastName: "Beck", role: "Lab Leader", labs: ["sports"], email: "nora@optimisticlabs.com" },
  { sk: "cass", firstName: "Cass", lastName: "Ito", role: "Contributor", labs: ["sports"], email: "cass@optimisticlabs.com" },
  { sk: "omar", firstName: "Omar", lastName: "Diaz", role: "Contributor", labs: ["philanthropy"], email: "omar@optimisticlabs.com" },
  // Shares a first name with nobody, but its full name contains another's.
  { sk: "sam", firstName: "Sam", lastName: "Weiss", role: "Contributor", labs: ["sports"], email: "sam@optimisticlabs.com" }
];

const reset = () => {
  rows.clear();
  rows.set(rowKey("LAB", "sports"), { pk: "LAB", sk: "sports", name: "Sports Lab" });
  rows.set(rowKey("LAB", "philanthropy"), { pk: "LAB", sk: "philanthropy", name: "Philanthropy Lab" });
  for (const p of PEOPLE) rows.set(rowKey("PERSON", p.sk), { pk: "PERSON", ...p });
};

const ctxOf = key => {
  const p = PEOPLE.find(x => x.sk === key);
  return { role: p.role, me: { ...p } };
};

const teddy = ctxOf("teddy");
const nora = ctxOf("nora");
const cass = ctxOf("cass");
const omar = ctxOf("omar");

const body = res => JSON.parse(res.body);
const bell = c => listNotifications(c).then(body);

test.beforeEach(reset);

/* ---------- mention resolution ---------- */

test("a full name wins over the first name it contains", () => {
  const keys = mentionKeys("nice one @Sam Weiss", PEOPLE);
  assert.deepEqual(keys, ["sam"]);
});

test("a bare first name still resolves", () => {
  assert.deepEqual(mentionKeys("@Nora can you look?", PEOPLE), ["nora"]);
});

test("a name that is a prefix of a longer word is not a mention", () => {
  // "@Samuel" must not fire "Sam" — the negative lookahead the browser uses.
  assert.deepEqual(mentionKeys("ask @Samuel about it", PEOPLE), []);
});

test("the same person named twice is one mention", () => {
  assert.deepEqual(mentionKeys("@Nora and @Nora again", PEOPLE), ["nora"]);
});

test("text with no at-sign short-circuits", () => {
  assert.deepEqual(mentionKeys("no mentions here", PEOPLE), []);
});

/* ---------- the emitter ---------- */

test("your own action never rings your own bell", async () => {
  await notify({
    to: ["nora", "cass"], kind: "mention", actor: "nora",
    actorName: "Nora Beck", verb: "mentioned you in a post"
  });
  assert.equal((await bell(nora)).items.length, 0);
  assert.equal((await bell(cass)).items.length, 1);
});

test("an unknown kind is refused rather than written with no tab", async () => {
  const out = await notify({ to: ["cass"], kind: "not-a-kind", verb: "did something" });
  assert.equal(out.written, 0);
  assert.equal((await bell(cass)).items.length, 0);
});

test("four people named in one post are four rows, not one collision", async () => {
  await notify({
    to: ["nora", "cass", "omar", "sam"], kind: "mention", actor: "teddy", verb: "mentioned you"
  });
  for (const who of ["nora", "cass", "omar"])
    assert.equal((await bell(ctxOf(who))).items.length, 1, who);
});

/* ---------- partitions ---------- */

test("listing reads your own partition and nobody else's", async () => {
  await notify({ to: ["cass"], kind: "mention", actor: "teddy", verb: "mentioned you" });
  assert.equal((await bell(cass)).items.length, 1);
  assert.equal((await bell(omar)).items.length, 0);
  assert.equal((await bell(teddy)).items.length, 0);
});

test("newest first", async () => {
  await notify({ to: ["cass"], kind: "mention", actor: "teddy", verb: "first" });
  await new Promise(r => setTimeout(r, 2));
  await notify({ to: ["cass"], kind: "mention", actor: "teddy", verb: "second" });
  const { items } = await bell(cass);
  assert.equal(items[0].verb, "second");
  assert.equal(items[1].verb, "first");
});

/* ---------- read receipts ---------- */

test("mark all clears the count, and doing it twice marks nothing more", async () => {
  await notify({ to: ["cass"], kind: "mention", actor: "teddy", verb: "one" });
  await notify({ to: ["cass"], kind: "signature", actor: "teddy", verb: "two" });
  assert.equal((await bell(cass)).unread, 2);

  const first = body(await markRead(cass, { all: true }));
  assert.equal(first.marked, 2);
  assert.equal(first.unread, 0);

  const second = body(await markRead(cass, { all: true }));
  assert.equal(second.marked, 0);
  assert.equal(second.unread, 0);
});

test("marking one leaves the rest unread", async () => {
  await notify({ to: ["cass"], kind: "mention", actor: "teddy", verb: "one" });
  await new Promise(r => setTimeout(r, 2));
  await notify({ to: ["cass"], kind: "signature", actor: "teddy", verb: "two" });

  const { items } = await bell(cass);
  const out = body(await markRead(cass, { ids: [items[0].id] }));
  assert.equal(out.marked, 1);
  assert.equal(out.unread, 1);
});

test("an id from someone else's partition marks nothing", async () => {
  await notify({ to: ["omar"], kind: "mention", actor: "teddy", verb: "for omar" });
  const omarsRow = (await bell(omar)).items[0];

  const out = body(await markRead(cass, { ids: [omarsRow.id] }));
  assert.equal(out.marked, 0);
  // And Omar's is untouched.
  assert.equal((await bell(omar)).unread, 1);
});

test("a read call with neither ids nor all is a 400", async () => {
  const res = await markRead(cass, {});
  assert.equal(res.statusCode, 400);
});

/* ---------- through the real post route ---------- */

test("posting with a mention reaches the person named", async () => {
  await createPost(nora, { text: "@Cass Ito can you take the Thursday call?", lab: "sports" });
  const { items, unread } = await bell(cass);
  assert.equal(unread, 1);
  assert.equal(items[0].kind, "mention");
  assert.equal(items[0].tab, "mentions");
  assert.equal(items[0].actorName, "Nora Beck");
  assert.match(items[0].meta, /Sports Lab/);
  assert.match(items[0].href, /^\/community\?post=PS-\d{3}$/);
});

/* The scoping rule the list route already enforces, applied to the bell: a
   post Omar could not open must not produce a row telling him it exists. */
test("a mention inside a lab you are not in does not reach you", async () => {
  await createPost(nora, { text: "@Omar Diaz thoughts?", lab: "sports" });
  assert.equal((await bell(omar)).items.length, 0);
});

test("a network-wide post reaches anyone it names", async () => {
  await createPost(nora, { text: "@Omar Diaz thoughts?" });
  assert.equal((await bell(omar)).items.length, 1);
});

test("editing a post only tells the names the edit added", async () => {
  const created = body(await createPost(nora, { text: "@Cass Ito first draft", lab: "sports" }));
  assert.equal((await bell(cass)).items.length, 1);

  await updatePost(nora, created.id, { text: "@Cass Ito and @Sam Weiss, second draft" });

  // Cass was already told; Sam is new.
  assert.equal((await bell(cass)).items.length, 1, "Cass should not be told twice");
  assert.equal((await bell(ctxOf("sam"))).items.length, 1, "Sam should be told once");
});

/* ---------- lookups ---------- */

test("a portal person is found by email, case-insensitively", async () => {
  const p = await personByEmail("NORA@optimisticlabs.com");
  assert.equal(p?.sk, "nora");
  assert.equal(await personByEmail("stranger@example.com"), undefined);
  assert.equal(await personByEmail(""), undefined);
});
