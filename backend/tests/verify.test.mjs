/* The emailed sign-in code · a fresh session gets nothing until its code is in.

   What is worth pinning down:
     - a session that has not entered its code is refused everywhere except the
       verify routes, and admitted everywhere after;
     - the code is emailed, never stored, and only the right one is accepted;
     - wrong guesses run out, codes run out, and a resend is throttled;
     - the whole thing is keyed on the WorkOS session, so two sessions never
       share a code.

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
const { sessionVerified, isVerifyRoute, resetVerifiedCache } = await import("../src/authz.mjs");
const verify = await import("../src/verify.mjs");

/* The outbox, in memory. Nothing here reaches SES. */
const outbox = [];
verify.mailer.send = async m => { outbox.push(m); };

/* ---------- the table, in memory, with the two conditions this module uses ---------- */
const rows = new Map();
const rowKey = (pk, sk) => `${pk} ${sk}`;
const conditionFails = () => Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });

doc.send = async cmd => {
  const name = cmd.constructor.name;
  const i = cmd.input;
  if (name === "PutCommand") {
    const current = rows.get(rowKey(i.Item.pk, i.Item.sk));
    const cond = i.ConditionExpression;
    if (cond === "attribute_not_exists(pk) OR sentAt < :cutoff") {
      if (current && !(current.sentAt < i.ExpressionAttributeValues[":cutoff"])) throw conditionFails();
    } else if (cond === "attempts = :seen") {
      if (!current || current.attempts !== i.ExpressionAttributeValues[":seen"]) throw conditionFails();
    } else if (cond) {
      throw new Error(`unexpected condition in test: ${cond}`);
    }
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
  throw new Error(`unexpected command in test: ${name}`);
};

const body = r => JSON.parse(r.body);
const codeIn = mail => mail.subject.match(/^(\d{6}) /)[1];
const audits = () => [...rows.values()].filter(r => r.pk === "AUDIT");
const stored = sid => rows.get(rowKey("MFA", sid));

const teddy = { email: "teddy@optimisticlabs.com", sid: "session_A" };

test.beforeEach(() => {
  rows.clear();
  outbox.length = 0;
  resetVerifiedCache();
});

test("only the verify routes are open to an unconfirmed session", () => {
  assert.ok(isVerifyRoute("/auth/verify"));
  assert.ok(isVerifyRoute("/auth/verify/send"));
  assert.ok(!isVerifyRoute("/auth/verifyx"));
  assert.ok(!isVerifyRoute("/deals"));
  assert.ok(!isVerifyRoute("/"));
  assert.ok(!isVerifyRoute(""));
});

test("a fresh session is unverified, gets a code by email, and is verified once it is entered", async () => {
  assert.equal(await sessionVerified(teddy.sid), false);
  assert.equal(body(await verify.status(teddy)).verified, false);

  const sent = await verify.send(teddy);
  assert.equal(sent.statusCode, 200);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].toEmail, teddy.email);
  const code = codeIn(outbox[0]);
  assert.match(outbox[0].text, new RegExp(code));
  // The code itself is not on the row, only its hash.
  assert.equal(JSON.stringify(stored(teddy.sid)).includes(code), false);
  assert.equal(body(sent).sentAt, stored(teddy.sid).sentAt);

  assert.equal(await sessionVerified(teddy.sid), false);

  const ok = await verify.check({ ...teddy, code });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(body(ok), { verified: true });
  assert.equal(await sessionVerified(teddy.sid), true);
  assert.equal(stored(teddy.sid).codeHash, undefined);
  assert.equal(audits().filter(a => a.action === "auth.verify" && a.actor === teddy.email).length, 1);

  // Entering it again is harmless, and nothing more is mailed.
  assert.equal((await verify.check({ ...teddy, code })).statusCode, 200);
  assert.equal((await verify.send(teddy)).statusCode, 200);
  assert.equal(outbox.length, 1);
});

test("the code is accepted with spaces and rejected when wrong, and wrong guesses run out", async () => {
  await verify.send(teddy);
  const code = codeIn(outbox[0]);
  const wrong = code === "000000" ? "000001" : "000000";

  let r = await verify.check({ ...teddy, code: "12" });
  assert.equal(r.statusCode, 400);

  r = await verify.check({ ...teddy, code: wrong });
  assert.equal(r.statusCode, 400);
  assert.match(body(r).error, /4 tries left/);
  assert.equal(await sessionVerified(teddy.sid), false);

  for (let i = 0; i < 4; i++) await verify.check({ ...teddy, code: wrong });
  r = await verify.check({ ...teddy, code });
  assert.equal(r.statusCode, 429, "the right code no longer works once guesses are spent");
  assert.equal(await sessionVerified(teddy.sid), false);

  // Spaced out the way people type from an email.
  rows.clear(); outbox.length = 0;
  await verify.send(teddy);
  const fresh = codeIn(outbox[0]);
  r = await verify.check({ ...teddy, code: `${fresh.slice(0, 3)} ${fresh.slice(3)}` });
  assert.equal(r.statusCode, 200);
});

test("a second code is throttled, then replaces the first", async () => {
  await verify.send(teddy);
  const first = codeIn(outbox[0]);
  const again = await verify.send(teddy);
  assert.equal(again.statusCode, 429);
  assert.equal(outbox.length, 1);

  // Age the row past the quiet period.
  const item = stored(teddy.sid);
  item.sentAt = new Date(Date.now() - verify.RESEND_AFTER_MS - 1000).toISOString();
  rows.set(rowKey("MFA", teddy.sid), item);

  assert.equal((await verify.send(teddy)).statusCode, 200);
  assert.equal(outbox.length, 2);
  const second = codeIn(outbox[1]);
  if (first !== second) {
    assert.equal((await verify.check({ ...teddy, code: first })).statusCode, 400);
  }
  assert.equal((await verify.check({ ...teddy, code: second })).statusCode, 200);
});

test("an expired code is refused, and says so", async () => {
  await verify.send(teddy);
  const code = codeIn(outbox[0]);
  const item = stored(teddy.sid);
  item.expiresAt = new Date(Date.now() - 1000).toISOString();
  rows.set(rowKey("MFA", teddy.sid), item);
  const r = await verify.check({ ...teddy, code });
  assert.equal(r.statusCode, 410);
  assert.equal(await sessionVerified(teddy.sid), false);
});

test("a code belongs to one session; another session with the same code stays out", async () => {
  await verify.send(teddy);
  const code = codeIn(outbox[0]);
  const other = { email: teddy.email, sid: "session_B" };
  const r = await verify.check({ ...other, code });
  assert.equal(r.statusCode, 400);
  assert.equal(await sessionVerified(other.sid), false);
  assert.equal((await verify.check({ ...teddy, code })).statusCode, 200);
  assert.equal(await sessionVerified(other.sid), false);
});

test("when the email cannot be sent the claim is dropped so a retry is not throttled", async () => {
  verify.mailer.send = async () => { throw new Error("MessageRejected: address not verified"); };
  const r = await verify.send(teddy);
  assert.equal(r.statusCode, 502);
  assert.match(body(r).error, /teddy@optimisticlabs.com/);
  assert.equal(stored(teddy.sid), undefined);
  verify.mailer.send = async m => { outbox.push(m); };
  assert.equal((await verify.send(teddy)).statusCode, 200);
});
