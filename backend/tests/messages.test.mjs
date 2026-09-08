/* Messages · a message outlives the tab that wrote it, and reaches the
   person it was written to.

   The panel shipped as React state, so neither of those was true. The claims
   worth testing are the ones that make a DM a DM:

     - a message one person sends is on the other person's list;
     - opening a chat from either side lands on the same conversation;
     - a thread is readable only by its members;
     - a recipient's bell rings, the writer's does not, and an @name in the
       message rings louder than a plain one;
     - a group can be renamed and a DM cannot.

   Same in-memory table as notifications.test.mjs, for the same reason.

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
  listConversations, createConversation, sendMessage, renameConversation, conversationId, mailer
} = await import("../src/messages.mjs");

/* The outbox, in memory. Nothing here reaches SES. */
const outbox = [];
mailer.send = async m => { outbox.push(m); };
const { listNotifications } = await import("../src/notifications.mjs");

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
    if (i.ScanIndexForward === false) items.reverse();
    return { Items: i.Limit ? items.slice(0, i.Limit) : items };
  }
  throw new Error(`unexpected command in test: ${name}`);
};

const PEOPLE = [
  { sk: "teddy@optimisticlabs.com", firstName: "Teddy", lastName: "Schwarz", role: "Admin", labs: [] },
  { sk: "hello@optimisticlabs.com", firstName: "Liz", lastName: "Russell", role: "Admin", labs: [] },
  { sk: "cass", firstName: "Cass", lastName: "Ito", role: "Contributor", labs: ["sports"], email: "cass@example.org" },
  { sk: "quiet", firstName: "Quiet", lastName: "Person", role: "Contributor", labs: [] },
  { sk: "gone", firstName: "Gone", lastName: "Person", role: "Contributor", labs: [], active: false }
];

const reset = () => {
  rows.clear();
  outbox.length = 0;
  for (const p of PEOPLE) rows.set(rowKey("PERSON", p.sk), { pk: "PERSON", ...p });
};

const as = key => {
  const me = PEOPLE.find(p => p.sk === key);
  return { me: { pk: "PERSON", ...me }, role: me.role };
};
const TEDDY = as("teddy@optimisticlabs.com");
const LIZ = as("hello@optimisticlabs.com");
const CASS = as("cass");
const body = r => JSON.parse(r.body);

test("a sent message is on the recipient's list after a fresh read", async () => {
  reset();
  const opened = await createConversation(TEDDY, { members: [LIZ.me.sk] });
  assert.equal(opened.statusCode, 201);
  const id = body(opened).id;

  const sent = await sendMessage(TEDDY, id, { text: "hey Liz" });
  assert.equal(sent.statusCode, 201);
  assert.equal(body(sent).from, TEDDY.me.sk);

  const liz = body(await listConversations(LIZ));
  assert.equal(liz.items.length, 1);
  assert.equal(liz.items[0].id, id);
  assert.deepEqual(liz.items[0].msgs.map(m => m.text), ["hey Liz"]);
  assert.equal(liz.items[0].lastText, "hey Liz");

  /* And it is still there for the writer on a cold read — nothing is held
     in anyone's session. */
  const teddy = body(await listConversations(TEDDY));
  assert.deepEqual(teddy.items[0].msgs.map(m => m.text), ["hey Liz"]);
});

test("opening a chat from either side lands on the same conversation", async () => {
  reset();
  const a = body(await createConversation(TEDDY, { members: [LIZ.me.sk] }));
  const again = await createConversation(LIZ, { members: [TEDDY.me.sk] });
  assert.equal(again.statusCode, 200);
  assert.equal(body(again).id, a.id);
  assert.equal(conversationId([TEDDY.me.sk, LIZ.me.sk]), conversationId([LIZ.me.sk, TEDDY.me.sk]));
  assert.match(a.id, /^c_[0-9a-f]{24}$/);
  assert.equal(body(await listConversations(TEDDY)).items.length, 1);
});

test("a thread is readable and writable only by its members", async () => {
  reset();
  const id = body(await createConversation(TEDDY, { members: [LIZ.me.sk] })).id;
  await sendMessage(TEDDY, id, { text: "private" });

  assert.equal(body(await listConversations(CASS)).items.length, 0);
  assert.equal((await sendMessage(CASS, id, { text: "hi" })).statusCode, 403);
  assert.equal((await renameConversation(CASS, id, { name: "x" })).statusCode, 403);
  assert.equal((await sendMessage(TEDDY, "c_nope", { text: "hi" })).statusCode, 404);
});

test("a chat cannot be opened with yourself, nobody, or someone off the bench", async () => {
  reset();
  assert.equal((await createConversation(TEDDY, { members: [] })).statusCode, 400);
  assert.equal((await createConversation(TEDDY, { members: [TEDDY.me.sk] })).statusCode, 400);
  assert.equal((await createConversation(TEDDY, { members: ["nobody"] })).statusCode, 400);
  assert.equal((await createConversation(TEDDY, { members: ["gone"] })).statusCode, 400);
  assert.equal((await sendMessage(TEDDY, "c_x", { text: "" })).statusCode, 404);
});

test("the recipient's bell rings, the writer's does not, and a mention is louder", async () => {
  reset();
  const id = body(await createConversation(TEDDY, { members: [LIZ.me.sk, CASS.me.sk] })).id;
  await sendMessage(TEDDY, id, { text: "@Cass can you take this one?" });

  const teddy = body(await listNotifications(TEDDY));
  assert.equal(teddy.items.length, 0);

  const liz = body(await listNotifications(LIZ));
  assert.equal(liz.items.length, 1);
  assert.equal(liz.items[0].kind, "message");
  assert.equal(liz.items[0].tab, "messages");
  assert.equal(liz.items[0].href, `/community#messages/${id}`);

  const cass = body(await listNotifications(CASS));
  assert.equal(cass.items.length, 1);
  assert.equal(cass.items[0].kind, "mention");
});

test("a group can be renamed and a DM cannot; a blank name reverts", async () => {
  reset();
  const dm = body(await createConversation(TEDDY, { members: [LIZ.me.sk] })).id;
  assert.equal((await renameConversation(TEDDY, dm, { name: "Us" })).statusCode, 400);

  const group = body(await createConversation(TEDDY, { members: [LIZ.me.sk, CASS.me.sk], name: "Launch" }));
  assert.equal(group.name, "Launch");
  const renamed = body(await renameConversation(LIZ, group.id, { name: "  Launch week " }));
  assert.equal(renamed.name, "Launch week");
  const blank = body(await renameConversation(LIZ, group.id, { name: "   " }));
  assert.equal(blank.name, undefined);
});

test("messages come back oldest first and the list is newest-activity first", async () => {
  reset();
  const a = body(await createConversation(TEDDY, { members: [LIZ.me.sk] })).id;
  const b = body(await createConversation(TEDDY, { members: [CASS.me.sk] })).id;
  await sendMessage(TEDDY, a, { text: "one" });
  await new Promise(r => setTimeout(r, 2));
  await sendMessage(TEDDY, a, { text: "two" });
  await new Promise(r => setTimeout(r, 2));
  await sendMessage(TEDDY, b, { text: "later" });

  const list = body(await listConversations(TEDDY)).items;
  assert.deepEqual(list.map(c => c.id), [b, a]);
  assert.deepEqual(list[1].msgs.map(m => m.text), ["one", "two"]);
});

test("the recipient gets an email from the writer's own address, and the writer does not", async () => {
  reset();
  process.env.FRONTEND_URL = "https://portal.test";
  const id = body(await createConversation(TEDDY, { members: [LIZ.me.sk] })).id;
  await sendMessage(TEDDY, id, { text: "lunch?" });

  assert.equal(outbox.length, 1);
  const m = outbox[0];
  assert.equal(m.toEmail, "hello@optimisticlabs.com");
  assert.equal(m.sender.email, "teddy@optimisticlabs.com");
  assert.equal(m.sender.name, "Teddy Schwarz");
  assert.equal(m.subject, "Teddy Schwarz sent you a message");
  assert.match(m.text, /"lunch\?"/);
  assert.match(m.text, new RegExp(`https://portal.test/community#messages/${id}`));
  assert.match(m.html, /Open the conversation/);
});

test("a mention says so in the subject, and a group names itself", async () => {
  reset();
  const id = body(await createConversation(TEDDY, { members: [LIZ.me.sk, CASS.me.sk], name: "Launch" })).id;
  await sendMessage(TEDDY, id, { text: "@Cass can you own this?" });

  const to = Object.fromEntries(outbox.map(m => [m.toEmail, m.subject]));
  assert.equal(to["cass@example.org"], "Teddy Schwarz mentioned you in Launch");
  assert.equal(to["hello@optimisticlabs.com"], "New message in Launch from Teddy Schwarz");
});

test("one email per person per conversation per cooldown; the bell still rings every time", async () => {
  reset();
  const id = body(await createConversation(TEDDY, { members: [LIZ.me.sk] })).id;
  await sendMessage(TEDDY, id, { text: "one" });
  await sendMessage(TEDDY, id, { text: "two" });
  await sendMessage(TEDDY, id, { text: "three" });
  assert.equal(outbox.length, 1);
  assert.equal(body(await listNotifications(LIZ)).items.length, 3);

  /* Liz answering restarts nothing for her, but Teddy has not been emailed
     yet, so her first reply reaches his inbox. */
  await sendMessage(LIZ, id, { text: "yes" });
  assert.equal(outbox.length, 2);
  assert.equal(outbox[1].toEmail, "teddy@optimisticlabs.com");

  /* Once the quiet period has passed, the next message emails again. */
  const convo = rows.get(rowKey("CONVO", id));
  convo.emailed[LIZ.me.sk] = new Date(Date.now() - 16 * 60_000).toISOString();
  await sendMessage(TEDDY, id, { text: "still there?" });
  assert.equal(outbox.length, 3);
  assert.equal(outbox[2].toEmail, "hello@optimisticlabs.com");
});

test("a person with no address gets the bell and no email; a failed send is not a failed message", async () => {
  reset();
  const id = body(await createConversation(TEDDY, { members: ["quiet"] })).id;
  const r = await sendMessage(TEDDY, id, { text: "hi" });
  assert.equal(r.statusCode, 201);
  assert.equal(outbox.length, 0);
  assert.equal(body(await listNotifications(as("quiet"))).items.length, 1);

  const id2 = body(await createConversation(TEDDY, { members: [LIZ.me.sk] })).id;
  const real = mailer.send;
  mailer.send = async () => { throw new Error("SES down"); };
  try {
    const r2 = await sendMessage(TEDDY, id2, { text: "hi" });
    assert.equal(r2.statusCode, 201);
  } finally {
    mailer.send = real;
  }
});
