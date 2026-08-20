/* Presentation helpers shared by the Resources surface.
 *
 * The design shows a single "meta" string on every card ("PDF · 4 pages",
 * "11 min read", "10 min"). The records carry mime/size/duration instead, so
 * that string is derived here rather than in three components.
 */

import { fmtBytes, fmtDuration } from "@/components/resource-viewer";
import type { Course, ProgressMap, ResourceItem } from "@/lib/types";

/** "PDF" / "DOCX" — the square badge on a file's detail screen. */
export function fileExt(r: ResourceItem): string {
  const name = r.fileName ?? "";
  const dot = name.lastIndexOf(".");
  if (dot > -1 && dot < name.length - 1) return name.slice(dot + 1).toUpperCase();
  return (r.mime?.split("/")[1] ?? "FILE").slice(0, 4).toUpperCase();
}

export function resourceMeta(r: ResourceItem): string {
  if (r.type === "video") return r.duration ? fmtDuration(r.duration) : "Video";
  if (r.type === "post") return "Post";
  return [fileExt(r), r.size ? fmtBytes(r.size) : null].filter(Boolean).join(" · ");
}

export function courseMeta(c: Course): string {
  const steps = `${c.steps.length} step${c.steps.length === 1 ? "" : "s"}`;
  return c.estimatedMinutes ? `${steps} · ${c.estimatedMinutes} min` : steps;
}

/** Viewed-count wording for a course card, matching the design's three states. */
export function courseProgress(c: Course, progress: ProgressMap): string {
  const viewed = progress[c.id] ?? {};
  const done = c.steps.filter((s) => viewed[s.id]).length;
  if (c.steps.length === 0) return "No steps yet";
  if (done === 0) return "Not started";
  if (done >= c.steps.length) return "All steps viewed";
  return `${done} of ${c.steps.length} viewed`;
}

/** The course the "Continue where you left off" card offers: the one furthest
 *  along without being finished. Nothing started means no card. */
export function continueCourse(
  courses: Course[],
  progress: ProgressMap
): { course: Course; nextIndex: number } | null {
  let best: { course: Course; nextIndex: number; done: number } | null = null;
  for (const c of courses) {
    if (c.status !== "Published" || c.steps.length === 0) continue;
    const viewed = progress[c.id] ?? {};
    const done = c.steps.filter((s) => viewed[s.id]).length;
    if (done === 0 || done >= c.steps.length) continue;
    const nextIndex = c.steps.findIndex((s) => !viewed[s.id]);
    if (!best || done > best.done) best = { course: c, nextIndex, done };
  }
  return best ? { course: best.course, nextIndex: best.nextIndex } : null;
}

/* The design groups "browse all" under six editorial topics. Topics are not a
   field any record carries, and inventing one would mean an unbacked taxonomy
   nobody can edit. Resources group by `tags` instead — Admins already maintain
   those, and they serve the same "find things like this" purpose. Courses have
   no tags, so they group by lab. Anything unkeyed collects under one heading
   rather than vanishing. */
export const UNGROUPED = "Everything else";

export function groupBy<T>(
  items: T[],
  keysOf: (item: T) => string[]
): { title: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const found = keysOf(item).filter(Boolean);
    const keys = found.length ? found : [UNGROUPED];
    for (const key of keys) {
      const bucket = groups.get(key);
      if (bucket) bucket.push(item);
      else groups.set(key, [item]);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b)
    )
    .map(([title, group]) => ({ title, items: group }));
}

export function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
