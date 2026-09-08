/* OL Portal · Messages — the durable store behind the Messages slide-over.

   The panel shipped as React state: a conversation was whatever the session
   appended to it, so a message vanished on refresh and never reached the
   person it was written to. This is the API web/lib/messages.tsx said it was
   waiting for.

   Two record types in the same single table every other feature uses:

     CONVO      pk "CONVO", sk "<conversation id>". The id is a hash of the
                sorted member keys, so two people opening a chat with each
                other from either side land on the same record instead of two.
                A group's id is the same rule over more keys. Hashed rather
                than joined because person keys are email addresses now, and
                an id that has to survive a URL path should not carry "@".
                  members   every PERSON key in it, the writer included.
                  name      an optional group name; absent for a DM.
                  createdBy PERSON key, from the JWT.
                  created / updated  ISO. `updated` moves with every message,
                            so the list can sort newest-activity first.
                  lastText / lastFrom  the row's preview, denormalised so the
                            list does not read every thread to draw itself.
     MSG        pk "MSG#<conversation id>", sk "<ISO created>#<rand4>".
                  from      PERSON key, from the JWT and never from the body.
                  text      the words.
                  created   ISO.

   Who can read a conversation is decided here: you must be a member. There
   is no route that reads someone else's thread, and a member list is
   validated against the PERSON partition so a chat cannot be opened with a
   key that is not a person.

   A message also goes out as an email to each other member, through the same
   SES sender every proposal and contract already leaves by (email.mjs). It is
   from the writer's own address, so replying to the email reaches the writer
   even though the words live in the portal. One email per recipient per
   conversation per EMAIL_COOLDOWN, tracked on the CONVO row (`emailed`), so a
   back-and-forth does not become a flood — the bell carries every message,
   the inbox carries "there is something waiting".

   No GSI on this table, so "my conversations" is a scan of the CONVO
   partition filtered by membership — the same shape every other list here
   takes, and the partition is one row per conversation the whole portal has
   ever had, not one per message. */

import { resp, get, put, listType, fullName, esc, doc, TABLE } from "./util.mjs";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { notify, mentionKeys } from "./notifications.mjs";
import { sendClientEmail } from "./email.mjs";
import { createHash } from "node:crypto";

const MAX_TEXT = 4000;
const MAX_NAME = 80;
const MAX_MEMBERS = 20;
/* Per thread, newest kept. Older rows stay in the table; nothing yet asks
   for them. */
const MAX_MSGS = 200;
/* The quiet period between emails to one person about one conversation. */
const EMAIL_COOLDOWN_MS = 15 * 60_000;

/* Swappable so a test can watch the outbox without an SES client. */
export const mailer = { send: sendClientEmail };

const now = () => new Date().toISOString();
const str = (v, max) => String(v ?? "").trim().slice(0, max);

const log = (message, fields = {}) =>
  console.log(JSON.stringify({ level: "info", message, ...fields }));

function metric(name, value = 1) {
  console.log(JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: "OLPortal/Messages",
        Dimensions: [[]],
        Metrics: [{ Name: name, Unit: "Count" }]
      }]
    },
    [name]: value
  }));
}

export const conversationId = members =>
  "c_" + createHash("sha256")
    .update([...new Set(members)].sort().join("|"))
    .digest("hex")
    .slice(0, 24);
const msgPartition = id => `MSG#${id}`;

const isMember = (convo, key) => Array.isArray(convo?.members) && convo.members.includes(key);

const publicMsg = ({ pk, sk, ...rest }) => ({ id: sk, ...rest });
/* `emailed` is the cooldown ledger — bookkeeping, not conversation. */
const publicConvo = ({ pk, sk, emailed, ...rest }, msgs) => ({ id: sk, ...rest, msgs });

/* The newest MAX_MSGS of a thread, oldest first, as the panel reads them.
   Read newest-first so the cap keeps the recent end, then sorted by key
   rather than trusting the wire order — sk is the ISO time, so this is the
   same order however the page came back. */
async function threadOf(id) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const page = await doc.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :p",
      ExpressionAttributeValues: { ":p": msgPartition(id) },
      ScanIndexForward: false,
      Limit: MAX_MSGS,
      ExclusiveStartKey
    }));
    out.push(...(page.Items || []));
    ExclusiveStartKey = out.length >= MAX_MSGS ? undefined : page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  out.sort((a, b) => String(a.sk).localeCompare(String(b.sk)));
  return out.slice(-MAX_MSGS).map(publicMsg);
}

/* ---------- routes ---------- */

/* Every conversation you are in, with its thread, newest activity first.
   One round trip for the whole panel: the list, the previews and every
   thread the reader might open. */
export async function listConversations(ctx) {
  const mine = (await listType("CONVO")).filter(c => isMember(c, ctx.me.sk));
  mine.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  const items = await Promise.all(mine.map(async c => publicConvo(c, await threadOf(c.sk))));
  log("messages.listed", { actor: ctx.me.sk, conversations: items.length });
  metric("ConversationsListed");
  return resp(200, { items });
}

/* Open a conversation with these people. Idempotent: the id is derived from
   the members, so opening a chat that already exists returns it (name and
   all) rather than starting a second one beside it. */
export async function createConversation(ctx, body) {
  const b = body || {};
  const raw = Array.isArray(b.members) ? b.members : [];
  const others = [...new Set(raw.filter(k => typeof k === "string" && k && k !== ctx.me.sk))];
  if (!others.length) return resp(400, { error: "pick at least one person" });
  if (others.length > MAX_MEMBERS) return resp(400, { error: `at most ${MAX_MEMBERS} people` });

  const people = await listType("PERSON");
  const byKey = Object.fromEntries(people.map(p => [p.sk, p]));
  const unknown = others.find(k => !byKey[k] || byKey[k].active === false);
  if (unknown) return resp(400, { error: `${unknown} is not on the bench` });

  const members = [ctx.me.sk, ...others];
  const id = conversationId(members);
  const existing = await get("CONVO", id);
  if (existing) {
    log("messages.conversation.reused", { actor: ctx.me.sk, conversation: id });
    return resp(200, publicConvo(existing, await threadOf(id)));
  }

  const name = others.length > 1 ? str(b.name, MAX_NAME) : "";
  const item = {
    pk: "CONVO", sk: id,
    members: members.sort(),
    name: name || undefined,
    createdBy: ctx.me.sk,
    created: now(), updated: now()
  };
  await put(item);
  log("messages.conversation.created", {
    actor: ctx.me.sk, conversation: id, members: members.length, named: !!name
  });
  metric("ConversationCreated");
  return resp(201, publicConvo(item, []));
}

/* Append to a thread you are in. The row is written first, then the
   conversation's preview, then the people it is for are told — the last is
   best-effort by construction (see notifications.mjs). */
export async function sendMessage(ctx, id, body) {
  const convo = await get("CONVO", id);
  if (!convo) return resp(404, { error: "conversation not found" });
  if (!isMember(convo, ctx.me.sk)) return resp(403, { error: "You are not in this conversation" });

  const text = str(body?.text, MAX_TEXT);
  if (!text) return resp(400, { error: "text is required" });

  const created = now();
  const msg = {
    pk: msgPartition(id),
    sk: `${created}#${Math.random().toString(36).slice(2, 6)}`,
    from: ctx.me.sk,
    text,
    created
  };
  await put(msg);

  const emailed = { ...(convo.emailed || {}) };
  const due = convo.members.filter(k =>
    k !== ctx.me.sk && Date.parse(emailed[k] || 0) + EMAIL_COOLDOWN_MS <= Date.parse(created));
  for (const k of due) emailed[k] = created;

  await put({
    ...convo, updated: created, lastText: text.slice(0, 200), lastFrom: ctx.me.sk, emailed
  });
  log("messages.sent", { actor: ctx.me.sk, conversation: id, chars: text.length });
  metric("MessageSent");

  await tell(ctx, convo, text, due);
  return resp(201, publicMsg(msg));
}

/* A group's name. A blank name is not a name — it puts the members' own back.
   A DM has no name to set; its title is the other person. */
export async function renameConversation(ctx, id, body) {
  const convo = await get("CONVO", id);
  if (!convo) return resp(404, { error: "conversation not found" });
  if (!isMember(convo, ctx.me.sk)) return resp(403, { error: "You are not in this conversation" });
  if (convo.members.length < 3) return resp(400, { error: "Only a group can be renamed" });

  const name = str(body?.name, MAX_NAME);
  const next = { ...convo, name: name || undefined };
  await put(next);
  log("messages.conversation.renamed", { actor: ctx.me.sk, conversation: id, named: !!name });
  return resp(200, publicConvo(next, await threadOf(id)));
}

/* Everyone else in the thread hears about a message; someone @named in it
   hears that they were named, which is the louder of the two and what the
   bubble's "was notified" line promises. A name that is not in the
   conversation is not told — they could not open what it points at. */
async function tell(ctx, convo, text, emailTo = []) {
  try {
    const others = convo.members.filter(k => k !== ctx.me.sk);
    if (!others.length) return;
    const people = (await listType("PERSON")).filter(p => others.includes(p.sk));
    const named = mentionKeys(text, people);
    const plain = others.filter(k => !named.includes(k));

    const actorName = fullName(ctx.me) || ctx.me.sk;
    const group = convo.members.length > 2;
    const where = group ? (convo.name || "a group chat") : "Direct message";
    const href = `/community#messages/${convo.sk}`;

    await Promise.all(emailTo.map(k => email({
      ctx, convo, text, actorName, group, href,
      to: people.find(p => p.sk === k),
      mentioned: named.includes(k)
    })));

    await Promise.all([
      notify({
        to: named, kind: "mention", actor: ctx.me.sk, actorName,
        verb: group ? "mentioned you in a group chat" : "mentioned you in a message",
        snippet: text, meta: [where, "Messages"].join(" · "), href
      }),
      notify({
        to: plain, kind: "message", actor: ctx.me.sk, actorName,
        verb: group ? "sent a message to the group" : "sent you a message",
        snippet: text, meta: [where, "Messages"].join(" · "), href
      })
    ]);
  } catch (err) {
    console.error(JSON.stringify({
      level: "warn", message: "message notify failed", conversation: convo.sk, detail: err.message
    }));
  }
}

/* The email half of a message. Best-effort like the bell: a bounced address
   must not turn a sent message into a 500, so this logs and returns.

   The address is the person's own `email`, or their key when the key is an
   address (every WorkOS-era account is keyed by email). A record with
   neither has no inbox to reach. */
async function email({ ctx, convo, text, actorName, group, href, to, mentioned }) {
  const address = String(to?.email || (String(to?.sk || "").includes("@") ? to.sk : "")).trim();
  if (!address) return;

  const senderEmail = String(ctx.me.email || (String(ctx.me.sk).includes("@") ? ctx.me.sk : "")).trim();
  const url = `${process.env.FRONTEND_URL}${href}`;
  const title = group ? (convo.name || "your group chat") : null;
  const subject = mentioned
    ? (group ? `${actorName} mentioned you in ${title}` : `${actorName} mentioned you in a message`)
    : (group ? `New message in ${title} from ${actorName}` : `${actorName} sent you a message`);
  const lead = mentioned
    ? `${actorName} mentioned you in ${group ? title : "a message"} on the Optimistic Labs Portal:`
    : `${actorName} sent you a message ${group ? `in ${title} ` : ""}on the Optimistic Labs Portal:`;
  const footer = senderEmail
    ? `Reply in the portal, or reply to this email to reach ${actorName} directly.`
    : "Reply in the portal.";

  const plain = `${lead}\n\n"${text}"\n\nOpen the conversation: ${url}\n\n${footer}`;
  const html =
    `<p>${esc(lead)}</p>` +
    `<blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #7c6df5;background:#f6f4ff;color:#111">${esc(text).replace(/\n/g, "<br>")}</blockquote>` +
    `<p><a href="${esc(url)}">Open the conversation</a></p>` +
    `<p style="color:#666;font-size:13px">${esc(footer)}</p>`;

  try {
    await mailer.send({
      sender: { name: actorName, email: senderEmail || undefined },
      toEmail: address, subject, text: plain, html
    });
    log("messages.emailed", { actor: ctx.me.sk, conversation: convo.sk, to: to.sk, mentioned });
    metric("MessageEmailed");
  } catch (err) {
    console.error(JSON.stringify({
      level: "warn", message: "message email failed", conversation: convo.sk, to: to.sk, detail: err.message
    }));
  }
}
