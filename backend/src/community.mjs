/* OL Portal · Community posts — the Feed tab's durable store.

   The Community page shipped with its content in a frontend module
   (web/lib/community.ts), which said in its own comment that the loaders
   would become fetches "when the API lands". This is that API. Until it, a
   post written in the composer lived in React state and was gone on the next
   render pass — the feed could be typed into but never actually posted to.

   A POST is one record in the same single-table store every other record type
   uses, so it inherits the table, its backups and its billing mode with no
   infrastructure change:

     pk         "POST"
     sk         "PS-001" — the post id, the sequence every other record type
                here uses (C-001, RS-001), so a post is linkable by a readable
                id: /community?post=PS-001 already deep-links the feed.
     author     PERSON key, taken from the JWT and never from the body.
     authorName display-name snapshot at write time, so a post still reads
                correctly if the person is later renamed or removed. Callers
                that hold a live roster (the portal does) should prefer it —
                see publicView's note.
     text       the body.
     kind       which chip the card wears (POST_KINDS).
     lab        LAB key, or absent for a post to the whole network. This is
                the scope: absent is visible to everyone, set is visible to
                that lab (and to Admins).
     tags       free tags, same shape and ceiling as a resource's.
     likes      reserved on the record so the shape is stable; there is no
                like route yet and the feed still counts likes in the browser.
     comments   same standing as likes — the thread is client-side until a
                comment route exists, and this keeps the stored shape honest
                about where it will go.
     created    ISO write time.
     updated    ISO of the last edit; equal to `created` until one happens.

   Who sees what is decided here rather than in the browser, the same way
   resources.mjs decides it: a lab-scoped post is for that lab, and asking for
   one by id from outside it is a 403, not a filtered-out card. */

import { resp, get, put, del, listType, nextId, fullName } from "./util.mjs";
import { writeAudit } from "./admin.mjs";
import { notify, mentionKeys } from "./notifications.mjs";

/* The chips the design draws on a card. "Update" is what an ordinary post is,
   and is what the composer sends when it says nothing else. */
export const POST_KINDS = ["Update", "Ask", "Win", "Link", "Introduction"];

const MAX_TEXT = 5000;
const MAX_TAGS = 10;
const MAX_TAG_CHARS = 30;

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const now = () => new Date().toISOString();

/* ---------- observability ----------

   Structured lines, matching the shape every other module logs in, so a post
   that never arrives can be traced from the browser's request id to the write.
   `message` is the event name; CloudWatch Logs Insights filters on it. */
const log = (message, fields = {}) =>
  console.log(JSON.stringify({ level: "info", message, ...fields }));

/* CloudWatch Embedded Metric Format: a log line the metric filter turns into a
   real metric with no SDK call and no added latency. Namespaced away from AWS
   defaults so the Community counters are readable on their own. */
function metric(name, value = 1) {
  console.log(JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: "OLPortal/Community",
        Dimensions: [[]],
        Metrics: [{ Name: name, Unit: "Count" }]
      }]
    },
    [name]: value
  }));
}

/* ---------- access ---------- */

/* A post with no lab is network-wide. A lab-scoped one is for that lab —
   Admins see every lab, and an author always sees their own post even if they
   later leave the lab they filed it under. */
export function canSee(ctx, p) {
  if (!p) return false;
  if (ctx.role === "Admin") return true;
  if (p.author === ctx.me.sk) return true;
  if (!p.lab) return true;
  return (ctx.me.labs || []).includes(p.lab);
}

/* Editing and deleting are the author's, plus an Admin for moderation. A Lab
   Leader does not own other people's posts in their lab: the feed is a
   conversation between peers, and silently rewritable posts would make it a
   worse record than no record. */
const canEdit = (ctx, p) => ctx.role === "Admin" || p.author === ctx.me.sk;

/* Which labs this caller may file a post under. Admins can post to any lab;
   everyone else can post to the network or to a lab they are actually in. */
const canPostToLab = (ctx, lab) =>
  !lab || ctx.role === "Admin" || (ctx.me.labs || []).includes(lab);

/* The record as the browser reads it. `pk` is internal; the id moves to `id`
   the way every other list route here returns it.

   `authorName` ships alongside `author` deliberately: the portal resolves the
   live name from its own roster (a renamed person should read as renamed),
   and falls back to this snapshot for an author who has since left. */
const publicView = ({ pk, sk, ...rest }) => ({ id: sk, ...rest });

/* ---------- validation ---------- */

function cleanTags(input) {
  if (input === undefined) return { tags: undefined };
  if (!Array.isArray(input)) return { error: "tags must be a list" };
  const seen = [];
  for (const raw of input) {
    const t = str(raw, MAX_TAG_CHARS).toLowerCase();
    if (t && !seen.includes(t)) seen.push(t);
  }
  if (seen.length > MAX_TAGS) return { error: `at most ${MAX_TAGS} tags` };
  return { tags: seen };
}

/* Shared by create and update so a PATCH cannot produce a record that a POST
   would have been refused — the guarantee resources.mjs makes for the same
   reason. `isCreate` is what makes `text` required once and only once. */
async function applyFields(ctx, item, b, isCreate) {
  const next = { ...item };

  if (isCreate || "text" in b) {
    const text = str(b.text, MAX_TEXT);
    if (!text) return { error: "a post needs something to say" };
    next.text = text;
  }
  if ("kind" in b) {
    if (!POST_KINDS.includes(b.kind)) return { error: "invalid kind" };
    next.kind = b.kind;
  }
  if ("tags" in b) {
    const { tags, error } = cleanTags(b.tags);
    if (error) return { error };
    next.tags = tags;
  }
  /* `lab` absent on a create means the whole network, which is what the
     composer's "All labs" option is. On an update, only an explicit `lab` key
     moves a post between scopes. */
  if ("lab" in b) {
    if (b.lab) {
      if (!(await get("LAB", b.lab))) return { error: "unknown lab" };
      if (!canPostToLab(ctx, b.lab)) return { error: "You are not in that lab" };
      next.lab = b.lab;
    } else delete next.lab;
  }
  return { item: next };
}

/* ---------- mentions ----------

   "@Teddy" in a post is the one thing in Community that is addressed at a
   person rather than at a room, so it is the one thing that rings a bell.
   Resolution is notifications.mjs's, which mirrors the browser's rule in
   web/lib/messages.tsx — the composer's autocomplete and this have to agree
   on what counts as a name or people get told about mentions they cannot see
   and miss ones they can.

   Scoped, and quietly: a lab-scoped post can only notify people who could
   have read it anyway, so @-ing someone into a lab they are not in tells them
   nothing. Best-effort throughout — a post that saved is a post that saved,
   whatever the bell did. */
async function tellMentioned(ctx, post, text, previousText) {
  try {
    const people = await listType("PERSON");
    const named = mentionKeys(text, people);
    if (!named.length) return;

    const already = previousText ? mentionKeys(previousText, people) : [];
    const fresh = named.filter(k => !already.includes(k));
    if (!fresh.length) return;

    /* canSee() reads ctx.role and ctx.me.{sk,labs}, which is exactly the shape
       a PERSON record already has — so the recipient is checked against the
       same rule the list route enforces, rather than a second copy of it. */
    const byKey = Object.fromEntries(people.map(p => [p.sk, p]));
    const allowed = fresh.filter(k =>
      byKey[k] && canSee({ role: byKey[k].role, me: byKey[k] }, post));

    const lab = post.lab ? await get("LAB", post.lab) : null;
    await notify({
      to: allowed,
      kind: "mention",
      actor: ctx.me.sk,
      actorName: fullName(ctx.me) || ctx.me.sk,
      verb: "mentioned you in a post",
      snippet: post.text,
      meta: [lab?.name || "All labs", "Community"].join(" · "),
      href: `/community?post=${post.sk}`
    });
  } catch (err) {
    console.error(JSON.stringify({
      level: "warn", message: "mention notify failed", post: post.sk, detail: err.message
    }));
  }
}

/* ---------- routes ---------- */

/* Newest first, which is the only order a feed has. Scoping happens here, so
   a lab's posts never leave the API for a browser that isn't entitled to
   them. */
export async function listPosts(ctx) {
  const items = await listType("POST");
  const visible = items.filter(p => canSee(ctx, p));
  /* Newest first, and by id within a millisecond: two posts written in the
     same tick would otherwise come back in whatever order the partition
     happened to hold them, which reads as a feed that reshuffles itself. */
  visible.sort((a, b) =>
    (b.created || "").localeCompare(a.created || "") || b.sk.localeCompare(a.sk));
  log("community.posts.listed", {
    actor: ctx.me.sk, role: ctx.role, stored: items.length, visible: visible.length
  });
  metric("PostsListed");
  return resp(200, visible.map(publicView));
}

export async function getPost(ctx, id) {
  const p = await get("POST", id);
  if (!p) return resp(404, { error: "post not found" });
  if (!canSee(ctx, p)) return resp(403, { error: "Not allowed to view this post" });
  return resp(200, publicView(p));
}

/* Anyone with a portal account can post. Community is the one surface where
   role decides nothing: a Contributor's win belongs in the feed on the same
   terms as an Admin's. */
export async function createPost(ctx, body) {
  const b = body || {};
  const base = {
    pk: "POST", sk: null,
    author: ctx.me.sk, authorName: fullName(ctx.me) || ctx.me.sk,
    kind: "Update", tags: [], likes: 0, comments: [],
    created: now(), updated: now()
  };
  const applied = await applyFields(ctx, base, b, true);
  if (applied.error) {
    log("community.post.rejected", { actor: ctx.me.sk, reason: applied.error });
    metric("PostRejected");
    return resp(400, { error: applied.error });
  }

  /* The id is minted after validation so a refused post never burns a number
     in the sequence. */
  applied.item.sk = await nextId("POST", "PS-");
  await put(applied.item);
  log("community.post.created", {
    actor: ctx.me.sk, post: applied.item.sk,
    lab: applied.item.lab || "all", chars: applied.item.text.length
  });
  metric("PostCreated");
  await tellMentioned(ctx, applied.item, applied.item.text);
  return resp(201, publicView(applied.item));
}

export async function updatePost(ctx, id, body) {
  const p = await get("POST", id);
  if (!p) return resp(404, { error: "post not found" });
  if (!canEdit(ctx, p)) return resp(403, { error: "Only the author can edit this post" });

  const applied = await applyFields(ctx, { ...p, updated: now() }, body || {}, false);
  if (applied.error) return resp(400, { error: applied.error });

  await put(applied.item);
  log("community.post.updated", { actor: ctx.me.sk, post: id });
  metric("PostUpdated");
  /* Only names the edit ADDED. Re-notifying everyone on every typo fix is how
     a mention becomes noise, and the people already told have already read
     the row that pointed here. */
  await tellMentioned(ctx, applied.item, applied.item.text, p.text);
  return resp(200, publicView(applied.item));
}

export async function deletePost(ctx, id) {
  const p = await get("POST", id);
  if (!p) return resp(404, { error: "post not found" });
  if (!canEdit(ctx, p)) return resp(403, { error: "Only the author can delete this post" });

  await del("POST", id);
  log("community.post.deleted", { actor: ctx.me.sk, post: id, author: p.author });
  metric("PostDeleted");
  /* An Admin removing somebody else's post is moderation, and moderation is
     the kind of thing the audit log exists for. An author deleting their own
     post is not — logging every one of those would drown the log the way
     every-post-created would. */
  if (p.author !== ctx.me.sk)
    await writeAudit(ctx.me.sk, "community.post.removed", `${id} · by ${p.author}`)
      .catch(err => console.error(JSON.stringify({
        level: "warn", message: "audit write failed", detail: err.message
      })));
  return resp(200, { deleted: id });
}
