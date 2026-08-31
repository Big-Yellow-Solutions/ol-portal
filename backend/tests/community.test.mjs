/* Community posts · the store, the routes, and the bug they exist to fix.

   The Community page could always be typed into. What it could not do was
   keep what was typed: `submitPost` pushed the new post into React state and
   nothing else, so it survived exactly as long as that component instance —
   a refresh, or a second person's browser, and it had never happened. The
   first test here is that regression, written against the layer that was
   missing: write a post as one caller, read it back as another.

   These run against an in-memory stand-in for the table rather than
   pre-DynamoDB paths only (which is as far as contracting.test.mjs and
   resources.test.mjs go), because persistence IS the feature — a test that
   stops before the write cannot tell a store from a variable. Everything
   above the client is real: the same handlers the Lambda routes to, the same
   validation, the same scoping.

   Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";

/* Read before any module reads process.env at import time, and point the one
   client the fake does NOT replace (admin.mjs keeps its own, for the audit
   write on a moderated delete) at a socket that refuses immediately, so that
   best-effort write fails fast instead of hunting for credentials. */
process.env.TABLE_NAME = "ol-portal-test";
process.env.AWS_REGION ??= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";
process.env.AWS_EC2_METADATA_DISABLED = "true";
process.env.AWS_ENDPOINT_URL_DYNAMODB = "http://127.0.0.1:1";

const { doc } = await import("../src/util.mjs");
const {
  listPosts, getPost, createPost, updatePost, deletePost, canSee, POST_KINDS
} = await import("../src/community.mjs");

/* ---------- the table, in memory ----------

   Only the four commands util.mjs issues, and only the one key condition it
   builds (`pk = :p`) — a fake that answered more than the code asks would be
   a second implementation to keep true. */
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

const reset = () => {
  rows.clear();
  rows.set(rowKey("LAB", "sports"), { pk: "LAB", sk: "sports", name: "Sports Lab" });
  rows.set(rowKey("LAB", "philanthropy"), { pk: "LAB", sk: "philanthropy", name: "Philanthropy Lab" });
};

const ctx = (sk, role, labs = [], name = {}) => ({
  role,
  me: { sk, labs, firstName: name.first ?? sk, lastName: name.last ?? "Tester" }
});

const teddy = ctx("teddy", "Admin", [], { first: "Teddy", last: "Schwarz" });
const nora = ctx("nora", "Lab Leader", ["sports"], { first: "Nora", last: "Beck" });
const cass = ctx("cass", "Contributor", ["sports"], { first: "Cass", last: "Ito" });
const omar = ctx("omar", "Contributor", ["philanthropy"], { first: "Omar", last: "Diaz" });

const body = res => JSON.parse(res.body);
const post = (c, b) => createPost(c, b).then(body);
const feed = c => listPosts(c).then(body);

test.beforeEach(reset);

/* ---------- the regression ---------- */

/* This is the bug. Before this module existed there was no write at all: the
   composer's text became an object in a React array, and the next load of the
   page — the same person refreshing, or anyone else opening it — saw an empty
   feed. The assertion is deliberately about a SECOND caller reading it back,
   because that is the part local state can never fake. */
test("a post written by one caller is there for the next one", async () => {
  const created = await post(nora, { text: "Two new sponsors said yes this week." });
  assert.equal(created.text, "Two new sponsors said yes this week.");
  assert.match(created.id, /^PS-\d{3}$/);

  const asSomeoneElse = await feed(omar);
  assert.equal(asSomeoneElse.length, 1);
  assert.equal(asSomeoneElse[0].id, created.id);
  assert.equal(asSomeoneElse[0].text, "Two new sponsors said yes this week.");
});

test("the feed a page load reads is the stored one, not the writer's session", async () => {
  await post(nora, { text: "First" });
  await post(omar, { text: "Second" });
  // Nothing carried over from the calls above — a cold read, the way a
  // refreshed browser arrives.
  const onLoad = await feed(cass);
  assert.deepEqual(onLoad.map(p => p.text), ["Second", "First"]);
});

test("a deleted post is gone from the store, not just from a list", async () => {
  const p = await post(nora, { text: "Posted by mistake" });
  assert.equal((await deletePost(nora, p.id)).statusCode, 200);
  assert.equal((await feed(nora)).length, 0);
  assert.equal((await getPost(teddy, p.id)).statusCode, 404);
});

/* ---------- the record ---------- */

test("a new post carries the whole model", async () => {
  const p = await post(nora, { text: "Kickoff moved to Friday", kind: "Update", tags: ["Sponsors", "sponsors"] });
  assert.equal(p.author, "nora");
  assert.equal(p.authorName, "Nora Beck");
  assert.equal(p.kind, "Update");
  assert.deepEqual(p.tags, ["sponsors"]);
  assert.equal(p.likes, 0);
  assert.deepEqual(p.comments, []);
  assert.ok(!Number.isNaN(Date.parse(p.created)));
  assert.equal(p.updated, p.created);
  // Network-wide, which is what no lab means.
  assert.equal(p.lab, undefined);
});

test("the author is the caller, never the body", async () => {
  const p = await post(cass, { text: "Not from Teddy", author: "teddy", authorName: "Teddy Schwarz" });
  assert.equal(p.author, "cass");
  assert.equal(p.authorName, "Cass Ito");
});

test("ids run in sequence, and a refused post does not burn one", async () => {
  assert.equal((await post(nora, { text: "one" })).id, "PS-001");
  assert.equal((await createPost(nora, { text: "   " })).statusCode, 400);
  assert.equal((await post(nora, { text: "two" })).id, "PS-002");
});

/* ---------- validation ---------- */

test("a post needs something to say", async () => {
  for (const text of [undefined, "", "   ", null]) {
    const res = await createPost(nora, { text });
    assert.equal(res.statusCode, 400);
    assert.match(body(res).error, /needs something to say/);
  }
});

test("a very long post is cut to the ceiling rather than stored whole", async () => {
  const p = await post(nora, { text: "x".repeat(9000) });
  assert.equal(p.text.length, 5000);
});

test("kind has to be one the feed can draw", async () => {
  const res = await createPost(nora, { text: "hi", kind: "Rant" });
  assert.equal(res.statusCode, 400);
  assert.equal(body(res).error, "invalid kind");
  for (const kind of POST_KINDS) {
    assert.equal((await post(nora, { text: "hi", kind })).kind, kind);
  }
});

test("tags are a list, deduped, lowercased and capped", async () => {
  assert.equal(body(await createPost(nora, { text: "hi", tags: "sponsors" })).error, "tags must be a list");
  const tooMany = await createPost(nora, { text: "hi", tags: Array.from({ length: 11 }, (_, i) => `t${i}`) });
  assert.equal(tooMany.statusCode, 400);
  assert.match(body(tooMany).error, /at most 10 tags/);
});

test("a post cannot be filed under a lab that does not exist", async () => {
  const res = await createPost(teddy, { text: "hi", lab: "quantum" });
  assert.equal(res.statusCode, 400);
  assert.equal(body(res).error, "unknown lab");
});

test("a post cannot be filed under a lab the author is not in", async () => {
  const res = await createPost(omar, { text: "hi", lab: "sports" });
  assert.equal(res.statusCode, 400);
  assert.match(body(res).error, /not in that lab/);
  // An Admin files anywhere — they are in every lab by role.
  assert.equal((await post(teddy, { text: "hi", lab: "sports" })).lab, "sports");
});

/* ---------- scope ---------- */

test("a lab post reaches that lab, and stops there", async () => {
  const p = await post(nora, { text: "Sports Lab only", lab: "sports" });
  await post(nora, { text: "Everyone" });

  assert.deepEqual((await feed(cass)).map(x => x.text), ["Everyone", "Sports Lab only"]);
  assert.deepEqual((await feed(omar)).map(x => x.text), ["Everyone"]);
  assert.deepEqual((await feed(teddy)).map(x => x.text), ["Everyone", "Sports Lab only"]);

  // Filtered out of a list is not the same as unreadable: ask for it directly.
  assert.equal((await getPost(cass, p.id)).statusCode, 200);
  assert.equal((await getPost(omar, p.id)).statusCode, 403);
  assert.equal((await getPost(teddy, p.id)).statusCode, 200);
});

test("an author keeps their own post after leaving the lab", () => {
  const stored = { author: "nora", lab: "sports" };
  assert.equal(canSee(ctx("nora", "Contributor", []), stored), true);
  assert.equal(canSee(ctx("someone", "Contributor", []), stored), false);
});

test("getting a post that isn't there is a 404", async () => {
  assert.equal((await getPost(teddy, "PS-404")).statusCode, 404);
});

/* ---------- editing ---------- */

test("an author can edit their own post, and the timestamps say so", async () => {
  const p = await post(nora, { text: "Kickoff Thursday" });
  const edited = body(await updatePost(nora, p.id, { text: "Kickoff Friday" }));
  assert.equal(edited.text, "Kickoff Friday");
  assert.equal(edited.created, p.created);
  assert.ok(edited.updated >= p.created);
  assert.equal((await feed(nora))[0].text, "Kickoff Friday");
});

test("nobody else can rewrite someone's post — a Lab Leader included", async () => {
  const p = await post(cass, { text: "Cass wrote this", lab: "sports" });
  const res = await updatePost(nora, p.id, { text: "Nora rewrote this" });
  assert.equal(res.statusCode, 403);
  assert.match(body(res).error, /Only the author/);
  assert.equal(body(await getPost(cass, p.id)).text, "Cass wrote this");
});

test("an edit cannot empty a post, and cannot smuggle in a bad kind", async () => {
  const p = await post(nora, { text: "Something" });
  assert.equal((await updatePost(nora, p.id, { text: "  " })).statusCode, 400);
  assert.equal((await updatePost(nora, p.id, { kind: "Rant" })).statusCode, 400);
  assert.equal(body(await getPost(nora, p.id)).text, "Something");
});

test("an edit can move a post between scopes, under the same lab rules", async () => {
  const p = await post(nora, { text: "Now lab-only" });
  assert.equal(body(await updatePost(nora, p.id, { lab: "sports" })).lab, "sports");
  assert.equal((await feed(omar)).length, 0);
  assert.equal(body(await updatePost(nora, p.id, { lab: null })).lab, undefined);
  assert.equal((await feed(omar)).length, 1);
  assert.equal((await updatePost(nora, p.id, { lab: "philanthropy" })).statusCode, 400);
});

/* ---------- deleting ---------- */

test("only the author or an Admin can delete", async () => {
  const p = await post(cass, { text: "Cass wrote this" });
  assert.equal((await deletePost(nora, p.id)).statusCode, 403);
  assert.equal((await deletePost(omar, p.id)).statusCode, 403);
  assert.equal((await deletePost(teddy, p.id)).statusCode, 200);
  assert.equal((await feed(teddy)).length, 0);
});

test("deleting a post that isn't there is a 404, not a silent success", async () => {
  assert.equal((await deletePost(teddy, "PS-404")).statusCode, 404);
});
