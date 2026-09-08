/* OL Portal · the emailed sign-in code.

   The routes behind /auth/verify: where a fresh WorkOS session stands, send it
   a code, check the code it enters. The gate that keeps an unconfirmed session
   out of everything else lives in authz.mjs, alongside the row this module
   writes — see the note there for why the portal runs this step itself.

   The row, pk MFA / sk <sid>:
     actor      the address the code went to
     codeHash   sha256 of sid + code; the code itself is never stored
     sentAt, expiresAt, attempts
     verified   flips once, then the hash is dropped
   Rows carry the audit TTL so nothing here needs sweeping. */

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { doc, TABLE, resp, esc, writeAudit, AUDIT_TTL_DAYS } from "./util.mjs";
import { MFA_PK, markVerified, isVerifyRoute } from "./authz.mjs";
import { sendSystemEmail } from "./email.mjs";

export { isVerifyRoute };

export const CODE_TTL_MS = 10 * 60_000;
/* The quiet period before another code may be asked for. Short enough that a
   code that never arrived is not a long wait; long enough that a double-fired
   request cannot mail two codes of which only the second works. */
export const RESEND_AFTER_MS = 30_000;
export const MAX_ATTEMPTS = 5;

/* Swappable so a test can watch the outbox without an SES client. */
export const mailer = { send: sendSystemEmail };

const log = (level, message, fields = {}) =>
  console[level === "error" ? "error" : "log"](JSON.stringify({ level, message, ...fields }));

const key = sid => ({ pk: MFA_PK, sk: sid });
const hashOf = (sid, code) => createHash("sha256").update(`${sid}:${code}`).digest("hex");
const rowTtl = () => Math.floor(Date.now() / 1000) + AUDIT_TTL_DAYS * 86400;
const row = async sid =>
  (await doc.send(new GetCommand({ TableName: TABLE, Key: key(sid) }))).Item;

/* Everything the client may know about a challenge. The hash and the attempt
   count stay on the server. */
const view = (email, item) => ({
  email,
  verified: !!item?.verified,
  sentAt: item?.sentAt || null,
  expiresAt: item?.expiresAt || null
});

const sameHash = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function status({ email, sid }) {
  return resp(200, view(email, await row(sid)));
}

function codeEmail(code) {
  const subject = `${code} is your portal sign-in code`;
  const text = [
    `Your Optimistic Labs portal sign-in code is ${code}.`,
    "",
    "It expires in 10 minutes. If you didn't just sign in, you can ignore this email — nobody can get in without the code."
  ].join("\n");
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#1d1a2b;font-size:15px;line-height:1.5">
<p>Your Optimistic Labs portal sign-in code is</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:600;margin:16px 0">${esc(code)}</p>
<p>It expires in 10 minutes. If you didn't just sign in, you can ignore this email &mdash; nobody can get in without the code.</p>
</div>`;
  return { subject, text, html };
}

export async function send({ email, sid }) {
  const existing = await row(sid);
  if (existing?.verified) return resp(200, view(email, existing));

  const now = Date.now();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const item = {
    ...key(sid),
    actor: email,
    codeHash: hashOf(sid, code),
    sentAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CODE_TTL_MS).toISOString(),
    attempts: 0,
    verified: false,
    ttl: rowTtl()
  };

  /* The row is claimed before the mail goes out, and conditionally, so two
     requests arriving together (a double-mounted effect, a double click) can
     only produce one code. The loser gets the same answer a too-quick resend
     does. */
  try {
    await doc.send(new PutCommand({
      TableName: TABLE,
      Item: item,
      ConditionExpression: "attribute_not_exists(pk) OR sentAt < :cutoff",
      ExpressionAttributeValues: { ":cutoff": new Date(now - RESEND_AFTER_MS).toISOString() }
    }));
  } catch (err) {
    if (err.name !== "ConditionalCheckFailedException") throw err;
    return resp(429, {
      error: "A code was sent a moment ago. Give it a minute to arrive before asking for another.",
      ...view(email, existing)
    });
  }

  try {
    await mailer.send({ toEmail: email, ...codeEmail(code) });
  } catch (err) {
    /* The most likely cause is SES refusing the address — and while this
       account is in the SES sandbox that means any address outside the
       verified ones. Drop the claim so a retry is not throttled, and say
       which address failed: it is the one thing the person can act on. */
    log("error", "sign-in code email failed", { detail: err.message });
    await doc.send(new DeleteCommand({ TableName: TABLE, Key: key(sid) }));
    return resp(502, { error: `We couldn't email a code to ${email}. Ask an admin to check the address on your account.` });
  }

  log("info", "sign-in code sent", { sid });
  return resp(200, view(email, item));
}

export async function check({ email, sid, code }) {
  const entered = String(code ?? "").replace(/\D/g, "");
  if (entered.length !== 6) return resp(400, { error: "Enter the 6-digit code from the email." });

  const item = await row(sid);
  if (!item) return resp(400, { error: "No code has been sent for this sign-in yet. Send one first." });
  if (item.verified) return resp(200, { verified: true });
  if (Date.parse(item.expiresAt) < Date.now())
    return resp(410, { error: "That code has expired. Send a new one." });
  if (item.attempts >= MAX_ATTEMPTS)
    return resp(429, { error: "Too many wrong codes. Send a new one." });

  if (!sameHash(hashOf(sid, entered), item.codeHash)) {
    /* Counted with a conditional write so two wrong guesses landing together
       both count. If the condition fails the other guess already counted, and
       the reply is the same either way. */
    const attempts = item.attempts + 1;
    try {
      await doc.send(new PutCommand({
        TableName: TABLE,
        Item: { ...item, attempts },
        ConditionExpression: "attempts = :seen",
        ExpressionAttributeValues: { ":seen": item.attempts }
      }));
    } catch (err) {
      if (err.name !== "ConditionalCheckFailedException") throw err;
    }
    const left = MAX_ATTEMPTS - attempts;
    return resp(400, {
      error: left > 0
        ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`
        : "Too many wrong codes. Send a new one."
    });
  }

  const { codeHash: _dropped, ...rest } = item;
  await doc.send(new PutCommand({
    TableName: TABLE,
    Item: { ...rest, verified: true, verifiedAt: new Date().toISOString() }
  }));
  markVerified(sid);
  await writeAudit(email, "auth.verify", "sign-in confirmed by emailed code");
  return resp(200, { verified: true });
}
