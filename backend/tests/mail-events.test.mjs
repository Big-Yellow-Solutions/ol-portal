/* OL Portal · bounce and complaint handling.

   SES event shapes in, suppression rows out, and email.mjs refusing to send to
   what was suppressed. The SES client is never reached: a suppressed address
   throws before the send, which is the point.

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
const { recipientsOf, handleEvent, handler } = await import("../src/mail-events.mjs");
const { suppress, suppressionFor, SuppressedRecipientError } = await import("../src/suppression.mjs");
const { sendSystemEmail, sendClientEmail } = await import("../src/email.mjs");

const rows = new Map();
let failReads = false;
doc.send = async cmd => {
  const n = cmd.constructor.name, i = cmd.input;
  if (n === "PutCommand") { rows.set(`${i.Item.pk} ${i.Item.sk}`, structuredClone(i.Item)); return {}; }
  if (n === "GetCommand") {
    if (failReads) throw new Error("dynamo down");
    const h = rows.get(`${i.Key.pk} ${i.Key.sk}`); return { Item: h && structuredClone(h) };
  }
  throw new Error(`unexpected command in test: ${n}`);
};
const ofType = pk => [...rows.values()].filter(r => r.pk === pk);
test.beforeEach(() => { rows.clear(); failReads = false; });

const bounce = (type, ...addrs) => ({
  eventType: "Bounce", mail: { messageId: "m1", commonHeaders: { subject: "Your proposal" } },
  bounce: { bounceType: type, bounceSubType: "General", bouncedRecipients: addrs.map(a => ({ emailAddress: a, diagnosticCode: "550 5.1.1 user unknown" })) }
});
const complaint = (...addrs) => ({
  eventType: "Complaint", mail: { messageId: "m2" },
  complaint: { complaintFeedbackType: "abuse", complainedRecipients: addrs.map(a => ({ emailAddress: a })) }
});

test("only a permanent bounce or a complaint suppresses", () => {
  assert.equal(recipientsOf(bounce("Permanent", "a@x.org"))[0].suppress, true);
  assert.equal(recipientsOf(bounce("Transient", "a@x.org"))[0].suppress, false);
  assert.equal(recipientsOf(bounce("Undetermined", "a@x.org"))[0].suppress, false);
  assert.equal(recipientsOf(complaint("a@x.org"))[0].suppress, true);
  assert.equal(recipientsOf({ eventType: "Reject", mail: { destination: ["a@x.org"] }, reject: { reason: "Bad content" } })[0].suppress, false);
  assert.equal(recipientsOf({ eventType: "DeliveryDelay", deliveryDelay: { delayedRecipients: [{ emailAddress: "a@x.org" }] } })[0].suppress, false);
  assert.deepEqual(recipientsOf({ eventType: "Send" }), []);
});

test("a permanent bounce is recorded and the address suppressed, lower-cased", async () => {
  await handleEvent(bounce("Permanent", "Dana@RiverChurch.org"));
  const [sup] = ofType("SUPPRESSION");
  assert.equal(sup.sk, "dana@riverchurch.org");
  assert.equal(sup.reason, "hard bounce");
  assert.match(sup.detail, /user unknown/);
  const [ev] = ofType("MAILEVENT");
  assert.equal(ev.suppressed, true);
  assert.equal(ev.subject, "Your proposal");
  assert.ok(ev.ttl > 0);
});

test("a transient bounce is recorded but never suppresses", async () => {
  await handleEvent(bounce("Transient", "full@x.org"));
  assert.equal(ofType("MAILEVENT").length, 1);
  assert.equal(ofType("SUPPRESSION").length, 0);
});

test("a complaint suppresses every complaining recipient", async () => {
  await handleEvent(complaint("a@x.org", "b@x.org"));
  assert.deepEqual(ofType("SUPPRESSION").map(r => r.sk).sort(), ["a@x.org", "b@x.org"]);
  assert.equal(ofType("SUPPRESSION")[0].reason, "complaint");
});

test("the first cause is kept when an address is suppressed twice", async () => {
  await handleEvent(bounce("Permanent", "a@x.org"));
  await handleEvent(complaint("a@x.org"));
  assert.equal(ofType("SUPPRESSION")[0].reason, "hard bounce");
});

test("the SNS handler unwraps the message and survives garbage", async () => {
  await handler({ Records: [{ Sns: { Message: "not json" } }, { Sns: { Message: JSON.stringify(bounce("Permanent", "z@x.org")) } }] });
  assert.equal(ofType("SUPPRESSION").length, 1);
});

test("mail to a suppressed address is refused before SES is called, for system and client mail", async () => {
  await suppress({ address: "gone@x.org", reason: "hard bounce" });
  await assert.rejects(sendSystemEmail({ toEmail: "Gone@X.org", subject: "s", text: "t", html: "h" }),
    e => e instanceof SuppressedRecipientError && e.code === "SuppressedRecipient");
  await assert.rejects(sendClientEmail({ sender: { email: "liz@optimisticlabs.com", name: "Liz" }, toEmail: "gone@x.org", subject: "s", text: "t", html: "h" }),
    /suppressed/);
});

test("a failed lookup fails open: the mail is not blocked by our own outage", async () => {
  failReads = true;
  assert.equal(await suppressionFor("a@x.org"), null);
});
