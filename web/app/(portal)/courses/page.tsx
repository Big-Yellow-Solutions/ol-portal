"use client";

/* Courses (Resources & Courses PRD 4.2 and 4.4).

   Two views behind one route, switched on ?c=<id> so a course can be linked
   to directly under the static export: the Course Library grid, and the
   player a learner works through.

   Progress is a checkbox per step and nothing more — PRD 5 keeps percent
   complete, progress bars, and admin-facing completion stats in v2, so the
   player shows checkmarks and stops there. A step ticks itself off when it's
   been viewed: opening it for a post or file, 95% watched for a video. */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api";
import { usePortalData } from "@/lib/portal-data";
import { CourseEditor } from "@/components/course-editor";
import { ResourceViewer } from "@/components/resource-viewer";
import { RESOURCE_TYPE_LABELS } from "@/lib/types";
import type { Course, CourseDetail, ProgressMap, ResourceItem } from "@/lib/types";

export default function CoursesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-mute">Loading…</p>}>
      <Courses />
    </Suspense>
  );
}

function Courses() {
  const params = useSearchParams();
  const openId = params.get("c");
  return openId ? <CoursePlayer courseId={openId} /> : <CourseLibrary />;
}

/* ---------- library ---------- */

function CourseLibrary() {
  const router = useRouter();
  const { role, labs } = usePortalData();
  const isAdmin = role === "Admin";

  const [courses, setCourses] = useState<Course[]>([]);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [library, setLibrary] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Course | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Course | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [c, p] = await Promise.all([
          api<Course[]>("/courses"),
          api<ProgressMap>("/progress"),
        ]);
        setCourses(c);
        setProgress(p);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load courses.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Only Admins build courses, so the resource list they pick steps from is
  // fetched only for them.
  useEffect(() => {
    if (!isAdmin) return;
    api<ResourceItem[]>("/resources").then(setLibrary).catch(() => {});
  }, [isAdmin]);

  const labName = (id?: string) => (id ? labs.find((l) => l.id === id)?.name ?? id : "All labs");

  const allDone = (c: Course) => {
    const viewed = progress[c.id] ?? {};
    return c.steps.length > 0 && c.steps.every((s) => viewed[s.id]);
  };

  const onSaved = (saved: Course) =>
    setCourses((prev) =>
      prev.some((c) => c.id === saved.id)
        ? prev.map((c) => (c.id === saved.id ? saved : c))
        : [saved, ...prev]
    );

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await api(`/courses/${pendingDelete.id}`, { method: "DELETE" });
      setCourses((prev) => prev.filter((c) => c.id !== pendingDelete.id));
      toast.success(`${pendingDelete.title} deleted.`);
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete this course.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl italic text-ink">Courses &amp; guides</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-mute">
            Sequenced sets of resources — onboarding, training, and walkthroughs. Your place is
            saved as you go.
          </p>
        </div>
        {isAdmin && <Button onClick={() => setCreating(true)}>+ New course</Button>}
      </div>

      {loading ? (
        <p className="text-sm text-ink-mute">Loading courses…</p>
      ) : error ? (
        <p className="text-sm text-red">{error}</p>
      ) : courses.length === 0 ? (
        <p className="text-sm text-ink-mute">
          {isAdmin ? "No courses yet. Build the first one." : "No courses have been shared with you yet."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <Card key={c.id} className="overflow-hidden py-0">
              <button
                type="button"
                onClick={() => router.push(`/courses?c=${c.id}`)}
                className="block w-full text-left"
                aria-label={`Open ${c.title}`}
              >
                {c.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element -- data URL on the record
                  <img src={c.cover} alt="" className="h-32 w-full object-cover" />
                ) : (
                  <div className="flex h-32 w-full items-center justify-center bg-violet-deep">
                    <span className="font-serif text-lg italic text-white">Course</span>
                  </div>
                )}
              </button>
              <CardContent className="flex flex-col gap-2 pb-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">
                    {c.steps.length} step{c.steps.length === 1 ? "" : "s"}
                  </Badge>
                  {c.status === "Draft" && <Badge variant="destructive">Draft</Badge>}
                  {allDone(c) && <Badge variant="success">Complete</Badge>}
                  {c.estimatedMinutes ? (
                    <span className="text-xs text-ink-mute">about {c.estimatedMinutes} min</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => router.push(`/courses?c=${c.id}`)}
                  className="text-left font-medium text-ink hover:text-violet-deep"
                >
                  {c.title}
                </button>
                {c.description && <p className="line-clamp-2 text-xs text-ink-mute">{c.description}</p>}
                <p className="text-xs text-ink-mute">{labName(c.lab)}</p>
                {isAdmin && (
                  <div className="mt-1 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(c)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => setPendingDelete(c)}>Delete</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(editing || creating) && (
        <CourseEditor
          key={editing?.id ?? "new"}
          course={editing}
          library={library}
          open
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={onSaved}
        />
      )}

      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this course?</DialogTitle>
            <DialogDescription>
              &ldquo;{pendingDelete?.title}&rdquo; will be deleted. Its resources stay in the
              Resource Library.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- player ---------- */

function CoursePlayer({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    api<CourseDetail>(`/courses/${courseId}`)
      .then((c) => {
        setCourse(c);
        // Drop the learner where they left off rather than back at step one.
        const next = c.steps.findIndex((s) => !c.viewed[s.id]);
        setActive(next === -1 ? 0 : next);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Could not open this course.")
      );
  }, [courseId]);

  const markViewed = useCallback(
    async (stepId: string) => {
      if (!stepId || course?.viewed[stepId]) return;
      try {
        const { viewed } = await api<{ viewed: Record<string, string> }>(
          `/courses/${courseId}/progress`,
          { method: "POST", body: JSON.stringify({ stepId }) }
        );
        setCourse((prev) => (prev ? { ...prev, viewed } : prev));
      } catch {
        // A lost checkmark shouldn't interrupt the reading; it re-records on
        // the next visit to the step.
      }
    },
    [courseId, course?.viewed]
  );

  const byId = useMemo(
    () => new Map((course?.resources ?? []).map((r) => [r.id, r])),
    [course?.resources]
  );

  if (error) return <p className="text-sm text-red">{error}</p>;
  if (!course) return <p className="text-sm text-ink-mute">Loading course…</p>;

  const steps = course.steps;
  const step = steps[active];
  const resource = step ? byId.get(step.resource) : undefined;

  /* Linear courses unlock one step past the last completed one. This is a
     sequencing affordance, not a security boundary — the server serves the
     whole course either way (courses.mjs markStepViewed). */
  const unlocked = (i: number) =>
    course.navigation === "free" || i === 0 || !!course.viewed[steps[i - 1]?.id];

  const done = steps.length > 0 && steps.every((s) => course.viewed[s.id]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => router.push("/courses")}>
          ← All courses
        </Button>
        <h1 className="mt-1 font-serif text-2xl italic text-ink">{course.title}</h1>
        {course.description && (
          <p className="mt-1 max-w-2xl text-sm text-ink-mute">{course.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{steps.length} step{steps.length === 1 ? "" : "s"}</Badge>
          {course.estimatedMinutes ? (
            <span className="text-xs text-ink-mute">about {course.estimatedMinutes} min</span>
          ) : null}
          {course.navigation === "linear" && (
            <span className="text-xs text-ink-mute">Steps unlock in order</span>
          )}
          {done && <Badge variant="success">All steps complete</Badge>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <ol className="flex flex-col gap-1">
          {steps.map((s, i) => {
            const r = byId.get(s.resource);
            const open = unlocked(i);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={!open}
                  onClick={() => setActive(i)}
                  aria-current={i === active ? "step" : undefined}
                  className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                    i === active
                      ? "border-violet-light bg-violet-pale"
                      : "border-transparent hover:bg-violet-pale/50"
                  } ${open ? "" : "cursor-not-allowed opacity-50"}`}
                >
                  <span
                    aria-hidden
                    className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                      course.viewed[s.id]
                        ? "border-green bg-green text-white"
                        : "border-warm-gray text-transparent"
                    }`}
                  >
                    ✓
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">
                      {r?.title ?? "Unavailable"}
                    </span>
                    <span className="block text-[11px] text-ink-mute">
                      {r ? RESOURCE_TYPE_LABELS[r.type] : "Removed"}
                      {course.viewed[s.id] ? " · viewed" : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-col gap-4">
          {!step ? (
            <p className="text-sm text-ink-mute">This course has no steps yet.</p>
          ) : !resource ? (
            <p className="text-sm text-ink-mute">
              This step&apos;s resource is no longer available. An Admin needs to update the course.
            </p>
          ) : (
            <>
              <div>
                <h2 className="font-serif text-lg italic text-ink">{resource.title}</h2>
                {resource.description && (
                  <p className="mt-1 text-sm text-ink-mute">{resource.description}</p>
                )}
              </div>
              {step.note && (
                <p className="rounded-lg border border-hair bg-violet-pale/50 px-3 py-2 text-sm text-ink-soft">
                  {step.note}
                </p>
              )}
              <ResourceViewer
                key={step.id}
                resource={resource}
                onViewed={() => markViewed(step.id)}
                lookup={(id) => byId.get(id)}
              />
            </>
          )}

          <div className="flex justify-between gap-2 border-t border-hair pt-4">
            <Button variant="outline" disabled={active === 0} onClick={() => setActive(active - 1)}>
              ← Previous
            </Button>
            <Button
              disabled={active >= steps.length - 1 || !unlocked(active + 1)}
              onClick={() => setActive(active + 1)}
            >
              Next →
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
