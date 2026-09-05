/* OL Portal · Notifications — what is waiting on you, and nothing else.

   The bell in the top nav was a span with a permanent dot and no handler:
   it said "something happened" forever, and there was nowhere to click to
   find out what. This is the store behind it.

   A notification is written by the server, at the moment the thing happens,
   to the person it happened TO. It is never written by the browser: there is
   no create route, and the emitters below are the only way a record appears.
   That is deliberate — a notification the client can mint is a notification
   anyone can forge, and the whole point of the bell is that you can believe
   what it says.

     pk       "NOTIF#<person key>" — one partition per recipient, so reading
              your own list is a single Query and nobody else's rows are ever
              on the wire. This is the first pk here that is not a bare type
              name; the alternative (pk "NOTIF", filter by recipient) reads
              the whole table's notifications to answer one person's bell.
     sk       "<ISO created>#<rand4>" — sortable, so DynamoDB returns them in
              time order and "newest first" is a reverse, not a sort. The
              suffix keeps two notifications written in the same millisecond
              (one post mentioning four people) from colliding on the key.
     kind     what happened. TAB maps it to the page's filter.
     actor    PERSON key of whoever did it, or absent for something the system
              did. Never the recipient: notify() drops self-notifications, so
              signing your own contract does not ping you about it.
     actorName display-name snapshot, so the row still reads correctly after
              a rename or an offboarding. The portal prefers its live roster
              and falls back to this, the way a post's authorName works.
     verb     the sentence after the name: "mentioned you in a post".
     snippet  the words themselves, when there are words. Optional.
     meta     the quiet line: "Applied AI Lab · Community".
     href     where clicking it goes, as a portal path.
     read     false until the reader says otherwise.
     created  ISO write time.
     ttl      90 days, matching the audit log. A notification is a nudge with
              a short shelf life — the thing it points AT is the durable
              record, and that one lives in its own partition untouched.

   What is NOT here, and why: messages, comments, likes, events and lab joins
   have no server behind them yet (messages are React state seeded from an
   empty COMMUNITY_THREADS; comments and likes are client-side by
   community.mjs's own admission). Their tabs render empty rather than
   inventing rows. When those APIs land they emit through notify() and the
   page needs no change. */

import { resp, get, put, listType, fullName, doc, TABLE } from "./util.mjs";
import { PutCommand } from "@aws-sdk/lib-dynamodb";

/* How long a nudge is worth keeping. The same 90 days the audit log uses,
   and for the same reason: long enough that coming back from leave still
   shows you what you missed, short enough that the partition stays small. */
export const NOTIF_TTL_DAYS = 90;

/* The one place the taxonomy lives. The page's tabs read this mapping off the
   record rather than re-deriving it, so adding a kind is a one-line change
   here and not a second switch statement in the browser. */
const TAB = {
  mention: "mentions",
  comment: "community",
  post: "community",
  event: "community",
  join: "community",
  message: "messages",
  signature: "work",
  executed: "work",
  assignment: "work",
  approval: "work",
  proposal: "work",
  invoice: "work"
};

export const NOTIF_KINDS = Object.keys(TAB);
export const NOTIF_TABS = ["mentions", "messages", "community", "work"];

/* A bell that can be flooded is a bell nobody reads, so the read path caps
   what it will return. Older rows stay in the table until the TTL takes them
   — they are simply below the fold, and "Load older" is a page the design
   sketches but nothing yet asks for. */
const MAX_LIST = 200;

const now = () => new Date().toISOString();
const str = (v, max) => String(v ?? "").trim().slice(0, max);

const log = (message, fields = {}) =>
  console.log(JSON.stringify({ level: "info", message, ...fields }));

function metric(name, value = 1) {
  console.log(JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: "OLPortal/Notifications",
        Dimensions: [[]],
        Metrics: [{ Name: name, Unit: "Count" }]
      }]
    },
    [name]: value
  }));
}

const partition = key => `NOTIF#${key}`;

/* pk is internal and so is the recipient — you only ever read your own. */
const publicView = ({ pk, sk, ...rest }) => ({ id: sk, ...rest });

/* ---------- writing ----------

   notify() is the only writer. Every caller is a route handler that has
   already done its own work and persisted its own record, so this is
   best-effort by construction: a failure here must never turn a filed
   assignment or a sent contract into a 500. It logs and returns instead.

   `to` is a list of PERSON keys. Duplicates and the actor are dropped, so a
   post mentioning the same person twice is one row and mentioning yourself is
   none. */
export async function notify({ to, kind, actor, actorName, verb, snippet, meta, href }) {
  const tab = TAB[kind];
  if (!tab) {
    console.error(JSON.stringify({
      level: "warn", message: "notify called with unknown kind", kind
    }));
    return { written: 0 };
  }

  const recipients = [...new Set((to || []).filter(Boolean))].filter(k => k !== actor);
  if (!recipients.length) return { written: 0 };

  const created = now();
  const ttl = Math.floor(Date.now() / 1000) + NOTIF_TTL_DAYS * 86400;

  const rows = recipients.map(key => ({
    pk: partition(key),
    /* Distinct per row even inside one call: four people mentioned in one
       post are four writes in the same millisecond. */
    sk: `${created}#${Math.random().toString(36).slice(2, 6)}`,
    kind, tab,
    actor: actor || undefined,
    actorName: str(actorName, 120) || undefined,
    verb: str(verb, 200),
    snippet: str(snippet, 400) || undefined,
    meta: str(meta, 160) || undefined,
    href: str(href, 300) || undefined,
    read: false,
    created,
    ttl
  }));

  try {
    /* Sequential-ish via Promise.all rather than BatchWrite: the fan-out here
       is a handful of rows (the people named in one post, the leaders on one
       assignment), and BatchWrite would add unprocessed-item retry logic for
       a case that does not arise. */
    await Promise.all(rows.map(r => doc.send(new PutCommand({ TableName: TABLE, Item: r }))));
    log("notifications.emitted", { kind, tab, actor: actor || null, count: rows.length });
    metric("NotificationsEmitted", rows.length);
    return { written: rows.length };
  } catch (err) {
    console.error(JSON.stringify({
      level: "warn", message: "notification write failed", kind, detail: err.message
    }));
    return { written: 0, error: err.message };
  }
}

/* ---------- mentions ----------

   The browser resolves "@Marcus Kelley" against the live roster in
   web/lib/messages.tsx; this is the same rule on the server, because the
   server is what decides who gets told. Kept in step deliberately: longest
   name first so "@Marcus Kelley" wins over "@Marcus", and a negative
   lookahead so "@Sam" does not fire inside "@Samuel".

   `people` is the PERSON list. Both the full name and the first name are
   candidates, which is what the composer's own autocomplete offers. */
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function mentionKeys(text, people) {
  const body = String(text || "");
  if (!body.includes("@")) return [];

  const candidates = [];
  for (const p of people) {
    const full = fullName(p);
    if (full) candidates.push({ name: full, key: p.sk });
    if (p.firstName) candidates.push({ name: p.firstName, key: p.sk });
  }
  if (!candidates.length) return [];

  candidates.sort((a, b) => b.name.length - a.name.length);
  const re = new RegExp(
    `@(${candidates.map(c => escapeRe(c.name)).join("|")})(?![A-Za-z])`,
    "g"
  );

  const hits = [];
  for (const m of body.matchAll(re)) {
    const hit = candidates.find(c => c.name.toLowerCase() === m[1].toLowerCase());
    if (hit && !hits.includes(hit.key)) hits.push(hit.key);
  }
  return hits;
}

/* Resolve a portal person from an email address — how a contract names its
   contributor counterparty. Returns undefined for an external client signer,
   who has no portal account and is reached by the sign link instead. */
export async function personByEmail(email) {
  const wanted = String(email || "").trim().toLowerCase();
  if (!wanted) return undefined;
  const people = await listType("PERSON");
  return people.find(p => String(p.email || "").toLowerCase() === wanted);
}

/* ---------- routes ---------- */

/* Your own list, newest first. There is no route that reads anyone else's:
   the partition is derived from the JWT-resolved identity, never from a
   parameter, so there is no id to tamper with.

   Acting as someone else reads THEIR bell, which is the point of acting as
   them — an Admin debugging "I never got told" needs to see what that person
   sees. Marking read while acting as them is likewise their state; the audit
   log already records who was acting. */
export async function listNotifications(ctx) {
  const items = await listType(partition(ctx.me.sk));
  items.reverse(); // sk is time-ordered ascending; a bell reads newest first.
  const unread = items.filter(n => !n.read).length;
  log("notifications.listed", { actor: ctx.me.sk, stored: items.length, unread });
  metric("NotificationsListed");
  return resp(200, {
    items: items.slice(0, MAX_LIST).map(publicView),
    unread,
    total: items.length
  });
}

/* Mark one, or mark the lot. Both spellings write the same field, so the
   header's "Mark all as read" and a row click share one route.

   Only unread rows are rewritten: re-reading an already-read list would put
   two hundred identical items back for nothing. */
export async function markRead(ctx, body) {
  const b = body || {};
  const all = b.all === true;
  const ids = Array.isArray(b.ids) ? b.ids.filter(x => typeof x === "string") : [];
  if (!all && !ids.length)
    return resp(400, { error: "pass an id list, or all: true" });

  const pk = partition(ctx.me.sk);
  let targets;
  if (all) {
    targets = (await listType(pk)).filter(n => !n.read);
  } else {
    const found = await Promise.all(ids.slice(0, MAX_LIST).map(sk => get(pk, sk)));
    targets = found.filter(n => n && !n.read);
  }

  await Promise.all(targets.map(n => put({ ...n, read: true })));
  log("notifications.read", { actor: ctx.me.sk, marked: targets.length, all });
  metric("NotificationsRead", targets.length || 0);

  const remaining = (await listType(pk)).filter(n => !n.read).length;
  return resp(200, { marked: targets.length, unread: remaining });
}
