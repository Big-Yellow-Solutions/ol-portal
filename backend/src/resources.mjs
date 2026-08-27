/* OL Portal · Resource Library (Resources & Courses PRD sections 3.1-3.3).

   A ResourceItem is the single building block behind both halves of the
   feature: it stands alone in the Resource Library, and a Course is just an
   ordered list of them (courses.mjs). Three types share one record because
   they share all of their metadata and every access rule — only the payload
   differs. Two of the three can still be created; see
   CREATABLE_RESOURCE_TYPES:

     file   an uploaded PDF/PPTX/DOCX, stored in the same S3 bucket the Files
            page uses but under a `resources/` prefix so the auto-analyzer
            (which fires on `uploads/`) leaves it alone.
     post   markdown that WAS written in the portal. Legacy only: authoring
            was withdrawn, so no new post can be created and a stored body is
            no longer writable. Existing posts still list, render (including
            their inline @[resource](RS-003) embeds), and delete as before.
     video  either an upload played from S3 or an embed. Embeds are parsed and
            rebuilt server-side into a known-good player URL rather than
            trusting whatever the author pasted.

   Two independent gates decide who sees an item, and both are enforced here
   rather than in the browser:

     permission   lab_leaders | contributors | both — the PRD 6 audience gate.
                  Admins always see everything, including drafts.
     lab          optional. When set, the item is additionally restricted to
                  people in that lab; unset means OL-wide. Same shape as the
                  lab tagging on files.

   `visibility` is a third, different thing: "course-only" items (a short
   course intro video, PRD 8.3) are hidden from the library but still served
   inside a course. */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { resp, get, put, del, listType, nextId, doc, TABLE } from "./util.mjs";
import { writeAudit } from "./admin.mjs";

const s3 = new S3Client({});
const BUCKET = process.env.FILES_BUCKET;

/* Every type that can EXIST on a stored record. "post" stays on this list
   because posts written before native document authoring was withdrawn are
   still real records: they list, preview, download and delete exactly as they
   did. Only their creation is gone. */
export const RESOURCE_TYPES = ["file", "post", "video"];

/* Every type a caller may still bring INTO the library. The Resource Library
   is an upload surface now — a resource arrives as a file from someone's
   device (or a video, uploaded or linked), never as a document composed in
   the portal. Enforced here rather than only in the browser so a direct POST
   can't author one either. */
export const CREATABLE_RESOURCE_TYPES = ["file", "video"];

export const isCreatableType = type => CREATABLE_RESOURCE_TYPES.includes(type);

export const PERMISSIONS = ["lab_leaders", "contributors", "both"];
export const VISIBILITIES = ["library", "course-only"];

/* Documents stay at the Files page's 50 MB ceiling. Video gets more room
   because there is no transcoding step — the browser plays the uploaded file
   as-is, so a 20-minute screen recording has to fit whole. */
const MAX_DOC_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 200_000;
const MAX_THUMBNAIL_CHARS = 120_000;
const MAX_TAGS = 10;

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const now = () => new Date().toISOString();

/* ---------- validation helpers ---------- */

function cleanTags(input) {
  if (input === undefined) return { tags: undefined };
  if (!Array.isArray(input)) return { error: "tags must be a list" };
  const seen = [];
  for (const raw of input) {
    const t = str(raw, 30).toLowerCase();
    if (t && !seen.includes(t)) seen.push(t);
  }
  if (seen.length > MAX_TAGS) return { error: `at most ${MAX_TAGS} tags` };
  return { tags: seen };
}

/* Thumbnails and post cover images are client-resized data URLs, the same
   scheme PERSON.photo uses — small enough to live on the record, which keeps
   a library card render to one request. */
function cleanImage(input) {
  if (input === undefined) return { image: undefined };
  if (input === null || input === "") return { image: null };
  const v = String(input);
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v))
    return { error: "image must be a png, jpeg, or webp data URL" };
  if (v.length > MAX_THUMBNAIL_CHARS) return { error: "image is too large — resize it first" };
  return { image: v };
}

/* Rebuilt from the parsed id rather than passed through, so a pasted URL can
   never smuggle a different origin (or query params) into an iframe src. */
const EMBED_PATTERNS = [
  { provider: "youtube", re: /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:.*&)?v=([\w-]{6,20})/ },
  { provider: "youtube", re: /^https?:\/\/(?:www\.)?youtube\.com\/(?:embed|shorts|live)\/([\w-]{6,20})/ },
  { provider: "youtube", re: /^https?:\/\/youtu\.be\/([\w-]{6,20})/ },
  { provider: "vimeo", re: /^https?:\/\/(?:www\.)?vimeo\.com\/(?:video\/)?(\d{6,12})/ },
  { provider: "vimeo", re: /^https?:\/\/player\.vimeo\.com\/video\/(\d{6,12})/ },
  { provider: "loom", re: /^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([0-9a-f]{16,64})/ }
];

const EMBED_URL = {
  youtube: id => `https://www.youtube.com/embed/${id}?enablejsapi=1&rel=0`,
  vimeo: id => `https://player.vimeo.com/video/${id}`,
  loom: id => `https://www.loom.com/embed/${id}`
};

export function parseEmbed(url) {
  const clean = String(url || "").trim();
  for (const { provider, re } of EMBED_PATTERNS) {
    const m = clean.match(re);
    if (m) return { provider, embedId: m[1], embedUrl: EMBED_URL[provider](m[1]) };
  }
  return null;
}

const s3Key = (id, name) => `resources/${id}/${str(name, 120).replace(/[^\w.\- ]/g, "_") || "file"}`;

/* Best-effort: a stranded object costs storage, but failing an edit because
   the old file wouldn't delete would be worse. */
const discard = key => (key ? s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {}) : null);

/* ---------- access ---------- */

/* PRD 6. Admins author, so they see drafts and every audience; everyone else
   sees published items aimed at their role and, when the item is lab-tagged,
   only if they're in that lab. */
export function canSee(ctx, r) {
  if (!r) return false;
  if (ctx.role === "Admin") return true;
  if (r.status !== "Published") return false;
  if (r.permission === "lab_leaders" && ctx.role !== "Lab Leader") return false;
  if (r.permission === "contributors" && ctx.role !== "Contributor") return false;
  if (r.lab && !(ctx.me.labs || []).includes(r.lab)) return false;
  return true;
}

/* Inside a course, the *course's* audience governs its steps: an author who
   puts an item into a course they've shared with Contributors means for those
   Contributors to see it, even if the item's own audience is narrower. Without
   this a learner hits a step they can't open, which is worse than the author
   having made a deliberate composition choice. Draft items are still withheld.
   This is also what makes course-only items reachable at all. */
export async function resourceAccess(ctx, r) {
  if (canSee(ctx, r)) return true;
  if (r.status !== "Published") return false;
  const courses = await listType("COURSE");
  return courses.some(c =>
    canSee(ctx, c) && (c.steps || []).some(s => s.resource === r.sk));
}

/* The "this is part of [Course Name]" prompt in PRD 4.3. Only courses the
   caller can actually open are named. */
function courseBacklinks(ctx, courses, resourceId) {
  return courses
    .filter(c => canSee(ctx, c) && (c.steps || []).some(s => s.resource === resourceId))
    .map(c => ({ id: c.sk, title: c.title }));
}

/* S3 keys and transcripts are internal; everything else the browser needs. */
const publicView = ({ pk, sk, key, ...rest }) => ({ id: sk, ...rest });

/* ---------- CRUD ---------- */

export async function listResources(ctx) {
  const [items, courses] = await Promise.all([listType("RESOURCE"), listType("COURSE")]);
  const visible = items.filter(r =>
    canSee(ctx, r) && (r.visibility !== "course-only" || ctx.role === "Admin"));
  visible.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
  return resp(200, visible.map(r => ({
    ...publicView(r),
    courses: courseBacklinks(ctx, courses, r.sk)
  })));
}

export async function getResource(ctx, id) {
  const r = await get("RESOURCE", id);
  if (!r) return resp(404, { error: "resource not found" });
  if (!(await resourceAccess(ctx, r))) return resp(403, { error: "Not allowed to view this resource" });
  const courses = await listType("COURSE");
  return resp(200, { ...publicView(r), courses: courseBacklinks(ctx, courses, r.sk) });
}

export async function createResource(ctx, body) {
  if (ctx.role !== "Admin") return resp(403, { error: "Publishing resources is admin-only" });
  const b = body || {};
  if (b.type === "post")
    return resp(400, { error: "Posts can no longer be created — upload a file instead" });
  if (!isCreatableType(b.type))
    return resp(400, { error: "type must be file or video" });
  const title = str(b.title, 200);
  if (!title) return resp(400, { error: "title is required" });

  const id = await nextId("RESOURCE", "RS-");
  const base = {
    pk: "RESOURCE", sk: id, type: b.type, title,
    status: "Draft", visibility: "library", permission: "both",
    tags: [], author: ctx.me.sk, created: now(), updated: now()
  };
  const applied = await applyFields(ctx, base, b, true);
  if (applied.error) return resp(400, { error: applied.error });

  await put(applied.item);
  await writeAudit(ctx.me.sk, "resource.created", `${id} · ${b.type} · ${title}`);
  return resp(201, { ...publicView(applied.item), ...(applied.uploadUrl ? { uploadUrl: applied.uploadUrl } : {}) });
}

export async function updateResource(ctx, id, body) {
  if (ctx.role !== "Admin") return resp(403, { error: "Editing resources is admin-only" });
  const r = await get("RESOURCE", id);
  if (!r) return resp(404, { error: "resource not found" });
  const applied = await applyFields(ctx, { ...r, updated: now() }, body || {}, false);
  if (applied.error) return resp(400, { error: applied.error });

  await put(applied.item);
  await writeAudit(ctx.me.sk, "resource.updated", `${id} · ${applied.item.title}`);
  return resp(200, { ...publicView(applied.item), ...(applied.uploadUrl ? { uploadUrl: applied.uploadUrl } : {}) });
}

/* Deleting an item that a course still steps through would leave a hole in
   that course, so the course has to let go of it first. */
export async function deleteResource(ctx, id) {
  if (ctx.role !== "Admin") return resp(403, { error: "Deleting resources is admin-only" });
  const r = await get("RESOURCE", id);
  if (!r) return resp(404, { error: "resource not found" });
  const courses = await listType("COURSE");
  const used = courses.filter(c => (c.steps || []).some(s => s.resource === id));
  if (used.length)
    return resp(409, { error: `Still used by ${used.map(c => c.title).join(", ")}. Remove it from those courses first.` });

  await discard(r.key);
  await del("RESOURCE", id);
  await writeAudit(ctx.me.sk, "resource.deleted", `${id} · ${r.title}`);
  return resp(200, { deleted: id });
}

/* Shared by create and update so a PATCH can't produce a record that create
   would have rejected — the same guarantee templates.mjs makes. Returns an
   `uploadUrl` whenever the caller attached new file metadata, which is how
   both first upload and file replacement work. */
async function applyFields(ctx, item, b, isCreate) {
  const next = { ...item };

  if ("title" in b) {
    const title = str(b.title, 200);
    if (!title) return { error: "title is required" };
    next.title = title;
  }
  if ("description" in b) next.description = str(b.description, 2000);
  if ("permission" in b) {
    if (!PERMISSIONS.includes(b.permission)) return { error: "invalid permission" };
    next.permission = b.permission;
  }
  if ("visibility" in b) {
    if (!VISIBILITIES.includes(b.visibility)) return { error: "invalid visibility" };
    next.visibility = b.visibility;
  }
  if ("lab" in b) {
    if (b.lab) {
      if (!(await get("LAB", b.lab))) return { error: "unknown lab" };
      next.lab = b.lab;
    } else delete next.lab;
  }
  if ("tags" in b) {
    const { tags, error } = cleanTags(b.tags);
    if (error) return { error };
    next.tags = tags;
  }
  if ("thumbnail" in b) {
    const { image, error } = cleanImage(b.thumbnail);
    if (error) return { error };
    if (image) next.thumbnail = image; else delete next.thumbnail;
  }
  if ("status" in b) {
    if (!["Draft", "Published"].includes(b.status)) return { error: "invalid status" };
    next.status = b.status;
    if (b.status === "Published" && !next.publishedAt) next.publishedAt = now();
  }

  const typed = await applyTypeFields(next, b, isCreate);
  if (typed.error) return typed;
  return typed;
}

export async function applyTypeFields(next, b, isCreate) {
  /* A post's body is no longer writable from anywhere: the editor is gone and
     an incoming `body` is ignored rather than rejected, so an older client
     PATCHing a whole record still saves its metadata instead of erroring. The
     stored body rides through untouched, which is what keeps existing posts
     readable. Creation is already blocked upstream, so isCreate never lands
     here for a post. */
  if (next.type === "post") return { item: next };

  if (next.type === "file") {
    if (!b.file) {
      if (isCreate) return { error: "a file resource needs a file" };
      return { item: next };
    }
    const f = await attachUpload(next, b.file, MAX_DOC_BYTES);
    return f.error ? f : { item: next, uploadUrl: f.uploadUrl };
  }

  // video
  const source = b.source ?? next.source ?? (b.embedUrl ? "embed" : undefined);
  if (!["upload", "embed"].includes(source))
    return { error: "a video resource needs source 'upload' or 'embed'" };
  next.source = source;
  if ("duration" in b) {
    if (b.duration === null || b.duration === "") delete next.duration;
    else if (!Number.isFinite(b.duration) || b.duration < 0) return { error: "invalid duration" };
    else next.duration = Math.round(b.duration);
  }
  if ("transcript" in b) {
    const t = String(b.transcript ?? "").slice(0, MAX_TRANSCRIPT_CHARS);
    if (t.trim()) next.transcript = t; else delete next.transcript;
  }

  if (source === "embed") {
    if ("embedUrl" in b || isCreate) {
      const parsed = parseEmbed(b.embedUrl);
      if (!parsed) return { error: "paste a YouTube, Vimeo, or Loom link" };
      Object.assign(next, parsed);
    }
    // Switching an uploaded video to an embed drops the file reference, so
    // drop the object with it rather than leaving it paying rent in S3.
    await discard(next.key);
    for (const k of ["key", "fileName", "size", "mime"]) delete next[k];
    return { item: next };
  }

  for (const k of ["provider", "embedId", "embedUrl"]) delete next[k];
  if (!b.file) {
    if (isCreate) return { error: "an uploaded video needs a file" };
    return { item: next };
  }
  const f = await attachUpload(next, b.file, MAX_VIDEO_BYTES);
  return f.error ? f : { item: next, uploadUrl: f.uploadUrl };
}

/* Mints the S3 key and a 15-minute presigned PUT. ContentLength is pinned so
   the browser can't upload something larger than what we validated. */
async function attachUpload(next, file, maxBytes) {
  const name = str(file?.name, 200);
  const size = file?.size;
  const mime = str(file?.type, 120) || "application/octet-stream";
  if (!name) return { error: "file name is required" };
  if (!Number.isFinite(size) || size <= 0 || size > maxBytes)
    return { error: `file must be 1 byte to ${Math.round(maxBytes / 1048576)} MB` };

  const key = s3Key(next.sk, name);
  // Replacing a file with a differently-named one writes to a new key; the old
  // object would otherwise stay behind, unreferenced and unreachable.
  if (next.key && next.key !== key) await discard(next.key);
  next.key = key;
  next.fileName = name;
  next.size = size;
  next.mime = mime;
  const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: BUCKET, Key: next.key, ContentType: mime, ContentLength: size
  }), { expiresIn: 900 });
  return { uploadUrl };
}

/* ---------- download / playback ---------- */

/* One route serves three jobs: the download button (attachment), the inline
   PDF preview, and the <video> source — they differ only in disposition and
   how long the link needs to stay good. Video URLs get an hour because a
   learner may pause partway through a long recording. */
export async function downloadResource(ctx, id, query) {
  const r = await get("RESOURCE", id);
  if (!r) return resp(404, { error: "resource not found" });
  if (!(await resourceAccess(ctx, r))) return resp(403, { error: "Not allowed to view this resource" });
  if (!r.key) return resp(400, { error: "this resource has no file" });

  const inline = query?.disposition === "inline";
  const url = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: BUCKET, Key: r.key,
    ResponseContentDisposition: inline
      ? "inline"
      : `attachment; filename="${(r.fileName || r.title).replace(/"/g, "")}"`
  }), { expiresIn: inline ? 3600 : 300 });

  // PRD 3.1 asks for a download count; previews and video streaming aren't
  // downloads, so only the attachment path counts.
  if (!inline) {
    await doc.send(new UpdateCommand({
      TableName: TABLE, Key: { pk: "RESOURCE", sk: id },
      UpdateExpression: "ADD downloads :one",
      ExpressionAttributeValues: { ":one": 1 }
    })).catch(() => {});
  }
  return resp(200, { url });
}
