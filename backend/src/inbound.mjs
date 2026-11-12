/* OL Portal · the Optimist's inbox.

   A team member forwards an email to theoptimist@optimisticlabs.com. Google
   Workspace routes it to a hidden SES address; SES stores the raw message
   under inbound/ in the files bucket; that S3 event invokes this function.

   Seven steps, any of which can stop with a logged reason:
     1 dedupe  2 authenticate sender  3 build the forwarder's context
     4 parse MIME  5 classify + extract (Claude)  6 match and plan
     7 record, notify, reply

   INBOUND_MODE=dry-run (the Phase 1 default) runs all seven but writes
   nothing to Pipeline: the INBOUND log row is the only write, and the reply
   says what it WOULD have created. "live" is not implemented yet — it is the
   next phase, and refusing to start in it is deliberate rather than letting a
   half-built create path run against production.

   Mail never touches API Gateway or the WorkOS authorizer. The verified
   sender is the credential, and buildContext turns it into the same
   permissions the browser gets. */

import { createHash } from "node:crypto";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { doc, TABLE, listType, put, writeAudit } from "./util.mjs";
import { buildContext } from "./identity.mjs";
import { labScope } from "./contacts.mjs";
import { sendSystemEmail } from "./email.mjs";
import { parseInbound } from "./inbound-parse.mjs";
import { authenticateSender } from "./inbound-auth.mjs";
import { extract } from "./inbound-extract.mjs";
import { planIntake } from "./inbound-plan.mjs";
import { buildReply } from "./inbound-reply.mjs";

const s3 = new S3Client({});

export const TTL_DAYS = 90;
export const PER_SENDER_PER_HOUR = 30;
export const PER_INBOX_PER_DAY = 200;
const mode = () => (process.env.INBOUND_MODE || "dry-run");

const log = (message, detail) => console.log(JSON.stringify({ level: "info", message, ...detail }));
const masked = a => { const [l = "", d = ""] = String(a).split("@"); return `${l.slice(0, 1)}***@${d}`; };
const ttl = now => Math.floor(now.getTime() / 1000) + TTL_DAYS * 86400;

/* INBOUND rows sort by arrival time, so "how many in the last hour" is a
   range query on the sort key rather than a scan. */
async function countSince(isoSince, from) {
  let n = 0, ExclusiveStartKey;
  do {
    const page = await doc.send(new QueryCommand({
      TableName: TABLE, KeyConditionExpression: "pk = :p AND sk >= :s",
      ExpressionAttributeValues: { ":p": "INBOUND", ":s": isoSince }, ExclusiveStartKey
    }));
    n += from ? page.Items.filter(i => i.from === from).length : page.Items.length;
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return n;
}

/* SES can deliver the same message twice and Gmail retries. A conditional put
   on a marker row keyed by Message-ID claims the message exactly once; the
   INBOUND row itself is keyed by arrival time, so it can't do that job. */
async function claim(hash, now) {
  try {
    await doc.send(new PutCommand({
      TableName: TABLE, Item: { pk: "INBOUND_MSG", sk: hash, ttl: ttl(now) },
      ConditionExpression: "attribute_not_exists(sk)"
    }));
    return true;
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

async function record(now, hash, fields) {
  await put({
    pk: "INBOUND", sk: `${now.toISOString()}#${hash.slice(0, 12)}`,
    ...fields, ttl: ttl(now)
  });
}

/** Everything after the raw message is in hand. `deps` exist so tests can run
 *  the real flow without S3, SES or the Anthropic API. */
export async function processMessage(raw, { s3Key = "", now = new Date(), deps = {} } = {}) {
  const send = deps.send || sendSystemEmail;
  const run = deps.extract || extract;

  const parsed = await parseInbound(raw);
  const hash = createHash("sha256").update(parsed.messageId || raw).digest("hex");
  const base = { from: parsed.from, subject: parsed.subject.slice(0, 200), s3Key, dryRun: mode() === "dry-run" };

  // 1. Dedupe
  if (!(await claim(hash, now))) { log("inbound.duplicate", { hash: hash.slice(0, 12) }); return { status: "duplicate" }; }

  // Inbox-wide cap first: it is the only limit that applies before we know who
  // sent the message, and past it nothing more is written for that traffic.
  if ((await countSince(new Date(now - 86400_000).toISOString())) >= PER_INBOX_PER_DAY) {
    log("inbound.inbox-cap", {}); return { status: "ignored", reason: "inbox-cap" };
  }

  // 2. Authenticate sender — fail and the message is dropped, no reply.
  const auth = authenticateSender(parsed);
  log("inbound.auth", { from: masked(parsed.from || ""), ok: auth.ok, reason: auth.reason, checks: auth.checks });
  if (!auth.ok) {
    await record(now, hash, { ...base, status: "rejected", reason: auth.reason });
    return { status: "rejected", reason: auth.reason };
  }

  // 3. The forwarder's context: exactly what they would have in the browser.
  const { ctx, error } = await buildContext({ username: parsed.from, role: undefined });
  if (error) {
    await record(now, hash, { ...base, status: "rejected", reason: "no-active-person" });
    return { status: "rejected", reason: "no-active-person" };
  }
  const base2 = { ...base, personKey: ctx.me.sk };
  const replyTo = ctx.me.email || parsed.from;
  const reply = async r => {
    try { await send({ toEmail: replyTo, ...r }); return null; }
    catch (err) { log("inbound.reply-failed", { message: err.message }); return err.message; }
  };

  if ((await countSince(new Date(now - 3600_000).toISOString(), parsed.from)) >= PER_SENDER_PER_HOUR) {
    await record(now, hash, { ...base2, status: "ignored", reason: "sender-rate-limit" });
    return { status: "ignored", reason: "sender-rate-limit" };
  }

  if (ctx.role === "Contributor") {
    const replyError = await reply(buildReply({ kind: "contributor", mode: mode(), subject: parsed.subject }));
    await record(now, hash, { ...base2, status: "ignored", reason: "contributor", replyError });
    return { status: "ignored", reason: "contributor" };
  }

  try {
    // 5. Classify and extract. (4, the MIME parse, already ran above: the
    // Message-ID it yields is what dedupe needed.)
    const labs = (await listType("LAB")).map(l => ({ id: l.sk, name: l.name || l.sk }));
    const visibleLabs = ctx.role === "Admin" ? labs : labs.filter(l => (ctx.me.labs || []).includes(l.id));
    const extraction = await run(parsed, visibleLabs);

    // 6. Match and plan.
    const [contacts, companies, deals, scope] = await Promise.all([
      listType("CONTACT"), listType("COMPANY"), listType("DEAL"), labScope(ctx)
    ]);
    const plan = planIntake({ ctx, parsed, extraction, data: { labs, contacts, companies, deals }, scope });

    // 7. Record, reply.
    const kind = plan.outcome === "needs-contact" ? "needs-contact" : plan.outcome === "unknown-intent" ? "unknown-intent" : "plan";
    const replyError = await reply(buildReply({ kind, plan, mode: mode(), subject: parsed.subject }));
    await record(now, hash, {
      ...base2, intent: extraction.intent, status: plan.outcome === "ready" || plan.outcome === "held" ? "done" : "ignored",
      reason: plan.outcome, plan: kind === "plan" ? slimPlan(plan) : undefined, replyError
    });
    await writeAudit(ctx.me.sk, "pipeline.email-intake", { dryRun: mode() === "dry-run", outcome: plan.outcome, lab: plan.lab || null });
    log("inbound.done", { personKey: ctx.me.sk, outcome: plan.outcome, flags: plan.flags.map(f => f.code) });
    return { status: "done", plan, kind };
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: err.message, stack: err.stack }));
    const replyError = await reply(buildReply({ kind: "failed", mode: mode(), subject: parsed.subject }));
    await record(now, hash, { ...base2, status: "failed", reason: String(err.message).slice(0, 300), replyError });
    return { status: "failed" };
  }
}

/* The INBOUND row keeps the decision, not the thread: the summary stays (it
   will live on the deal), the body never does — raw MIME stays in S3. */
const slimPlan = p => ({
  outcome: p.outcome, lab: p.lab || null, labHow: p.labHow,
  person: { email: p.person.email, matched: p.person.matched },
  company: p.company ? { name: p.company.name, matched: p.company.matched, via: p.company.via } : null,
  deal: { name: p.deal.name, amount: p.deal.amount, source: p.deal.source },
  flags: p.flags.map(f => f.code)
});

export const handler = async event => {
  if (mode() !== "dry-run")
    throw new Error(`INBOUND_MODE=${mode()} is not implemented yet; only dry-run is supported`);
  for (const rec of event.Records || []) {
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));
    if (!key.startsWith("inbound/")) continue;
    const obj = await s3.send(new GetObjectCommand({ Bucket: rec.s3.bucket.name, Key: key }));
    const raw = Buffer.from(await obj.Body.transformToByteArray());
    const out = await processMessage(raw, { s3Key: key });
    log("inbound.processed", { key, status: out.status });
  }
};
