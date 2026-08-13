/* OL Portal · Courses and guides (Resources & Courses PRD sections 3.4, 4.2,
   4.4, 5).

   A course is metadata plus an ordered list of steps, and a step is one
   ResourceItem plus an optional note. The PRD models CourseStep as its own
   record; they're embedded here instead, the way proposals embed their
   sections and deals embed their Assignment Notice — a course has tens of
   steps, not thousands, and embedding means reordering is one write and
   rendering a course is one read.

   Each step carries a stable `id` minted when the step is added and never
   reused. Progress is keyed on that id rather than on the resource id, so
   reordering a course doesn't move a learner's checkmarks and the same
   resource can legitimately appear twice.

   Progress lives at pk `PROGRESS#<username>` so a learner's records across
   every course come back in one query, and nobody's query touches anyone
   else's rows. */

import { resp, get, put, del, listType, nextId } from "./util.mjs";
import { writeAudit } from "./admin.mjs";
import { canSee, PERMISSIONS } from "./resources.mjs";

export const NAVIGATION_MODES = ["free", "linear"];
const MAX_STEPS = 100;
const MAX_NOTE_CHARS = 1000;
const MAX_COVER_CHARS = 120_000;

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const now = () => new Date().toISOString();
const progressPk = username => `PROGRESS#${username}`;

const publicView = ({ pk, sk, ...rest }) => ({ id: sk, ...rest });

/* Same two gates as a resource — audience plus optional lab — so canSee from
   resources.mjs does the work for both record types. */

/* ---------- read ---------- */

export async function listCourses(ctx) {
  const items = await listType("COURSE");
  const visible = items.filter(c => canSee(ctx, c));
  visible.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
  return resp(200, visible.map(publicView));
}

/* Returns the course with every step's resource resolved, because the course
   player needs the post bodies and video embeds inline — a step list plus N
   follow-up requests would show the learner an empty course for a beat. A
   resource that has since been unpublished is dropped from `resources` and
   the step renders as unavailable rather than breaking the course. */
export async function getCourse(ctx, id) {
  const c = await get("COURSE", id);
  if (!c) return resp(404, { error: "course not found" });
  if (!canSee(ctx, c)) return resp(403, { error: "Not allowed to view this course" });

  const steps = c.steps || [];
  const fetched = await Promise.all(steps.map(s => get("RESOURCE", s.resource)));
  const resources = [];
  const seen = new Set();
  for (const r of fetched) {
    if (!r || seen.has(r.sk)) continue;
    // The course's own audience governs its steps (see resources.mjs
    // resourceAccess) — a draft is still withheld from everyone but an Admin.
    if (r.status !== "Published" && ctx.role !== "Admin") continue;
    seen.add(r.sk);
    const { pk, sk, key, ...rest } = r;
    resources.push({ id: sk, ...rest });
  }

  const progress = await get(progressPk(ctx.me.sk), id);
  return resp(200, {
    ...publicView(c),
    resources,
    viewed: progress?.viewed || {}
  });
}

/* Every course this learner has touched, so the Course Library can show
   checkmark state without a request per card. */
export async function listProgress(ctx) {
  const items = await listType(progressPk(ctx.me.sk));
  return resp(200, Object.fromEntries(items.map(p => [p.sk, p.viewed || {}])));
}

/* ---------- authoring ---------- */

export async function createCourse(ctx, body) {
  if (ctx.role !== "Admin") return resp(403, { error: "Publishing courses is admin-only" });
  const b = body || {};
  const title = str(b.title, 200);
  if (!title) return resp(400, { error: "title is required" });

  const base = {
    pk: "COURSE", sk: await nextId("COURSE", "C-"), title,
    status: "Draft", permission: "both", navigation: "free",
    steps: [], nextStep: 1, author: ctx.me.sk, created: now(), updated: now()
  };
  const applied = await applyFields(base, b);
  if (applied.error) return resp(400, { error: applied.error });

  await put(applied.item);
  await writeAudit(ctx.me.sk, "course.created", `${base.sk} · ${title}`);
  return resp(201, publicView(applied.item));
}

export async function updateCourse(ctx, id, body) {
  if (ctx.role !== "Admin") return resp(403, { error: "Editing courses is admin-only" });
  const c = await get("COURSE", id);
  if (!c) return resp(404, { error: "course not found" });
  const applied = await applyFields({ ...c, updated: now() }, body || {});
  if (applied.error) return resp(400, { error: applied.error });

  await put(applied.item);
  await writeAudit(ctx.me.sk, "course.updated", `${id} · ${applied.item.title}`);
  return resp(200, publicView(applied.item));
}

export async function deleteCourse(ctx, id) {
  if (ctx.role !== "Admin") return resp(403, { error: "Deleting courses is admin-only" });
  const c = await get("COURSE", id);
  if (!c) return resp(404, { error: "course not found" });
  await del("COURSE", id);
  await writeAudit(ctx.me.sk, "course.deleted", `${id} · ${c.title}`);
  return resp(200, { deleted: id });
}

async function applyFields(item, b) {
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
  if ("navigation" in b) {
    if (!NAVIGATION_MODES.includes(b.navigation)) return { error: "invalid navigation mode" };
    next.navigation = b.navigation;
  }
  if ("lab" in b) {
    if (b.lab) {
      if (!(await get("LAB", b.lab))) return { error: "unknown lab" };
      next.lab = b.lab;
    } else delete next.lab;
  }
  if ("estimatedMinutes" in b) {
    if (b.estimatedMinutes === null || b.estimatedMinutes === "") delete next.estimatedMinutes;
    else if (!Number.isFinite(b.estimatedMinutes) || b.estimatedMinutes < 0)
      return { error: "invalid estimated time" };
    else next.estimatedMinutes = Math.round(b.estimatedMinutes);
  }
  if ("cover" in b) {
    if (!b.cover) delete next.cover;
    else {
      const v = String(b.cover);
      if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v))
        return { error: "cover must be a png, jpeg, or webp data URL" };
      if (v.length > MAX_COVER_CHARS) return { error: "cover image is too large — resize it first" };
      next.cover = v;
    }
  }
  if ("status" in b) {
    if (!["Draft", "Published"].includes(b.status)) return { error: "invalid status" };
    if (b.status === "Published" && !(b.steps ?? next.steps ?? []).length)
      return { error: "a course needs at least one step before it can be published" };
    next.status = b.status;
    if (b.status === "Published" && !next.publishedAt) next.publishedAt = now();
  }
  if ("steps" in b) {
    const built = await buildSteps(next, b.steps);
    if (built.error) return built;
    next.steps = built.steps;
    next.nextStep = built.nextStep;
    if (next.status === "Published" && !built.steps.length)
      return { error: "a published course needs at least one step" };
  }
  return { item: next };
}

/* Rebuilds the step list from what the editor sent. A step keeps its id — and
   therefore everyone's progress — as long as it still points at the same
   resource; repointing a step at a different resource mints a new id, because
   "viewed" no longer means the same thing. */
async function buildSteps(course, input) {
  if (!Array.isArray(input)) return { error: "steps must be a list" };
  if (input.length > MAX_STEPS) return { error: `a course allows at most ${MAX_STEPS} steps` };

  const existing = new Map((course.steps || []).map(s => [s.id, s]));
  let nextStep = course.nextStep || 1;
  const steps = [];
  const usedIds = new Set();

  for (const raw of input) {
    const resource = str(raw?.resource, 40);
    if (!resource) return { error: "every step needs a resource" };
    const r = await get("RESOURCE", resource);
    if (!r) return { error: `unknown resource ${resource}` };

    const prior = existing.get(raw?.id);
    const id = prior && prior.resource === resource && !usedIds.has(prior.id)
      ? prior.id
      : `s${nextStep++}`;
    usedIds.add(id);
    steps.push({ id, resource, note: str(raw?.note, MAX_NOTE_CHARS) });
  }
  return { steps, nextStep };
}

/* ---------- progress ---------- */

/* PRD 5 + 8.2: one checkbox per step, set once the learner has viewed it —
   opening it for a post or file, 95% watched for a video. Which of those
   applies is a player-side question, so the client decides *when* to call
   this; the server's job is to make it stick, exactly once, for steps that
   really exist in a course this person can open.

   `navigation: "linear"` is a UI affordance, not a security boundary — it
   sequences the step list rather than withholding content, so it isn't
   re-checked here. */
export async function markStepViewed(ctx, id, body) {
  const c = await get("COURSE", id);
  if (!c) return resp(404, { error: "course not found" });
  if (!canSee(ctx, c)) return resp(403, { error: "Not allowed to view this course" });

  const stepId = str(body?.stepId, 40);
  if (!(c.steps || []).some(s => s.id === stepId))
    return resp(400, { error: "unknown step" });

  const pk = progressPk(ctx.me.sk);
  const record = (await get(pk, id)) || { pk, sk: id, viewed: {} };
  if (record.viewed[stepId]) return resp(200, { viewed: record.viewed });

  record.viewed = { ...record.viewed, [stepId]: now() };
  record.updated = now();
  await put(record);
  return resp(200, { viewed: record.viewed });
}
