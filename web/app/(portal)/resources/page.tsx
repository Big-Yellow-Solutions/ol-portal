"use client";

/* Resources — the Claude Design artboard that merges what used to be two
   routes, /library (Resource Library) and /courses (Courses & guides), into
   one surface. Both old routes now redirect here and keep their deep links:
   ?r=<resource> opens a resource, ?c=<course> opens a course.

   Four screens live behind this one route, switched on the query string so
   every one of them is linkable under the static export:
     (none)              the library — continue card, courses, filtered grid
     ?browse=resources   everything, grouped
     ?browse=courses     every course and guide, grouped
     ?r=RS-001           a resource
     ?c=CO-001           a course

   Authoring still runs through the existing ResourceEditor / CourseEditor
   dialogs. The artboard draws three further screens for it (new / builder /
   publish); those dialogs already implement what those screens sketch — file
   upload, embed parsing, markdown bodies, drag-reorder steps — so they are
   reached from the design's admin affordances rather than rebuilt. */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ResourceEditor } from "@/components/resource-editor";
import { CourseEditor } from "@/components/course-editor";
import {
  BackLink,
  EmptyState,
  PageHead,
  PillButton,
  SectionHead,
} from "@/components/resources/chrome";
import { ContinueCard, CourseCard, ResourceCard } from "@/components/resources/cards";
import { FilterAside, FilterChip } from "@/components/resources/panels";
import { CourseScreen } from "@/components/resources/course-screen";
import { ResourceScreen } from "@/components/resources/resource-screen";
import { api, ApiError } from "@/lib/api";
import { usePortalData } from "@/lib/portal-data";
import {
  continueCourse,
  countLabel,
  courseMeta,
  courseProgress,
  groupBy,
  resourceMeta,
} from "@/lib/resources-view";
import { RESOURCE_TYPE_LABELS } from "@/lib/types";
import type {
  Course,
  CourseDetail,
  ProgressMap,
  ResourceItem,
  ResourceType,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE_KEYS: (ResourceType | "all")[] = ["all", "file", "post", "video"];

export default function ResourcesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-mute">Loading…</p>}>
      <Resources />
    </Suspense>
  );
}

function Resources() {
  const router = useRouter();
  const params = useSearchParams();
  const { role, labs } = usePortalData();
  const isAdmin = role === "Admin";

  const resourceId = params.get("r");
  const courseId = params.get("c");
  const browse = params.get("browse");

  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<ResourceType | "all">("all");
  const [tag, setTag] = useState("");
  const [query, setQuery] = useState("");

  const [editingResource, setEditingResource] = useState<ResourceItem | null>(null);
  const [creatingResource, setCreatingResource] = useState<ResourceType | null>(null);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [pendingDelete, setPendingDelete] =
    useState<{ kind: "resource" | "course"; id: string; title: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [r, c, p] = await Promise.all([
          api<ResourceItem[]>("/resources"),
          api<Course[]>("/courses"),
          api<ProgressMap>("/progress"),
        ]);
        setResources(r);
        setCourses(c);
        setProgress(p);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load Resources.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const go = useCallback(
    (q: string) => router.replace(`/resources${q}`, { scroll: false }),
    [router]
  );

  const labName = (id?: string) =>
    id ? (labs.find((l) => l.id === id)?.name ?? id) : "All labs";

  const allTags = useMemo(
    () => [...new Set(resources.flatMap((r) => r.tags ?? []))].sort(),
    [resources]
  );

  const matches = useCallback(
    (r: ResourceItem) => {
      const q = query.trim().toLowerCase();
      if (type !== "all" && r.type !== type) return false;
      if (tag && !(r.tags ?? []).includes(tag)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    },
    [type, tag, query]
  );

  const filtered = useMemo(() => resources.filter(matches), [resources, matches]);
  const typeCounts = useMemo(
    () =>
      TYPE_KEYS.map((k) => ({
        key: k,
        label: k === "all" ? "All" : RESOURCE_TYPE_LABELS[k],
        count: k === "all" ? resources.length : resources.filter((r) => r.type === k).length,
      })),
    [resources]
  );

  const openResourceById = (id: string) => go(`?r=${id}`);
  const openResource = (r: ResourceItem) => openResourceById(r.id);
  const openCourse = (id: string) => go(`?c=${id}`);

  const onResourceSaved = (saved: ResourceItem) =>
    setResources((prev) =>
      prev.some((r) => r.id === saved.id)
        ? prev.map((r) => (r.id === saved.id ? { ...r, ...saved } : r))
        : [saved, ...prev]
    );
  const onCourseSaved = (saved: Course) =>
    setCourses((prev) =>
      prev.some((c) => c.id === saved.id)
        ? prev.map((c) => (c.id === saved.id ? saved : c))
        : [saved, ...prev]
    );

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { kind, id, title } = pendingDelete;
    try {
      await api(`/${kind === "resource" ? "resources" : "courses"}/${id}`, {
        method: "DELETE",
      });
      if (kind === "resource") setResources((p) => p.filter((r) => r.id !== id));
      else setCourses((p) => p.filter((c) => c.id !== id));
      toast.success(`${title} deleted.`);
      setPendingDelete(null);
      go("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete this.");
    }
  };

  if (loading) return <p className="text-sm text-ink-mute">Loading Resources…</p>;
  if (error) return <p className="text-sm text-red">{error}</p>;

  const authorCtas = isAdmin && (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PillButton>New resource</PillButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setCreatingResource("file")}>
            Upload a file
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCreatingResource("post")}>
            Write a post
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCreatingResource("video")}>
            Add a video
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PillButton tone="solid" onClick={() => setCreatingCourse(true)}>
        New course
      </PillButton>
    </>
  );

  const editors = (
    <>
      {(editingResource || creatingResource) && (
        <ResourceEditor
          key={editingResource?.id ?? `new-${creatingResource}`}
          resource={editingResource}
          createType={creatingResource ?? undefined}
          open
          onClose={() => {
            setEditingResource(null);
            setCreatingResource(null);
          }}
          onSaved={onResourceSaved}
        />
      )}
      {(editingCourse || creatingCourse) && (
        <CourseEditor
          key={editingCourse?.id ?? "new"}
          course={editingCourse}
          library={resources}
          open
          onClose={() => {
            setEditingCourse(null);
            setCreatingCourse(false);
          }}
          onSaved={onCourseSaved}
        />
      )}
      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Delete this {pendingDelete?.kind === "course" ? "course" : "resource"}?
            </DialogTitle>
            <DialogDescription>
              &ldquo;{pendingDelete?.title}&rdquo;{" "}
              {pendingDelete?.kind === "course"
                ? "will be deleted. Its resources stay in the library."
                : "and any uploaded file will be permanently deleted."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  /* ---------- resource ---------- */
  if (resourceId) {
    const resource = resources.find((r) => r.id === resourceId);
    if (!resource) {
      return (
        <>
          <PageHead crumb="Resource" titleA="Not " titleB="found" />
          <BackLink onClick={() => go("")} />
          <p className="text-sm text-ink-mute">
            This resource is no longer available, or you do not have access to it.
          </p>
        </>
      );
    }
    return (
      <>
        <PageHead
          crumb={`${RESOURCE_TYPE_LABELS[resource.type]} · ${labName(resource.lab)}`}
          titleA={resource.title}
        />
        <BackLink onClick={() => go("")} />
        <ResourceScreen
          resource={resource}
          related={resources.filter((r) => r.id !== resource.id).slice(0, 3)}
          isAdmin={isAdmin}
          labName={labName(resource.lab)}
          onOpenResource={openResource}
          onOpenCourse={(c) => openCourse(c.id)}
          onEdit={() => setEditingResource(resource)}
          onDelete={() =>
            setPendingDelete({ kind: "resource", id: resource.id, title: resource.title })
          }
          lookup={(id) => resources.find((r) => r.id === id)}
        />
        {editors}
      </>
    );
  }

  /* ---------- course ---------- */
  if (courseId) {
    return (
      <>
        <CourseRoute
          courseId={courseId}
          isAdmin={isAdmin}
          labName={labName}
          onBack={() => go("")}
          onOpenStep={(_stepId, resId) => openResourceById(resId)}
          onEdit={(c) => setEditingCourse(c)}
          onDelete={(c) =>
            setPendingDelete({ kind: "course", id: c.id, title: c.title })
          }
        />
        {editors}
      </>
    );
  }

  /* ---------- browse ---------- */
  if (browse === "resources" || browse === "courses") {
    const isRes = browse === "resources";
    const q = query.trim().toLowerCase();
    const browseCourses = courses.filter(
      (c) => !q || c.title.toLowerCase().includes(q)
    );
    const resourceGroups = groupBy(filtered, (r) => r.tags ?? []);
    const courseGroups = groupBy(browseCourses, (c) => [labName(c.lab)]);
    const total = isRes ? filtered.length : browseCourses.length;

    return (
      <>
        <PageHead
          crumb={isRes ? "All resources" : "All courses"}
          titleA={isRes ? "Everything in the " : "Every course and "}
          titleB={isRes ? "library" : "guide"}
          actions={authorCtas}
        />
        <BackLink onClick={() => go("")} />

        <div className="flex flex-wrap items-center gap-4">
          <span className="flex gap-1 rounded-full border border-hair bg-white p-[3px]">
            <TabPill on={isRes} onClick={() => go("?browse=resources")}>
              Resources
            </TabPill>
            <TabPill on={!isRes} onClick={() => go("?browse=courses")}>
              Courses and guides
            </TabPill>
          </span>
          <span className="flex-1" />
          <span className="text-[13px] text-warm-gray">
            {isRes
              ? countLabel(total, "resource", "resources")
              : countLabel(total, "course and guide", "courses and guides")}
          </span>
        </div>

        <div className="flex flex-col gap-3.5 rounded-[16px] border border-hair bg-white px-[18px] py-4 shadow-card">
          {isRes && (
            <div className="flex flex-wrap items-start gap-2">
              <span className="min-w-11 pt-1.5 text-[11px] font-semibold tracking-[0.16em] text-warm-gray uppercase">
                Type
              </span>
              {typeCounts.map((t) => (
                <FilterChip key={t.key} on={type === t.key} onClick={() => setType(t.key)}>
                  {t.label}
                </FilterChip>
              ))}
            </div>
          )}
          {isRes && allTags.length > 0 && (
            <div className="flex flex-wrap items-start gap-2">
              <span className="min-w-11 pt-1.5 text-[11px] font-semibold tracking-[0.16em] text-warm-gray uppercase">
                Tag
              </span>
              <FilterChip on={!tag} onClick={() => setTag("")}>
                All tags
              </FilterChip>
              {allTags.map((t) => (
                <FilterChip key={t} on={tag === t} onClick={() => setTag(t)}>
                  {t}
                </FilterChip>
              ))}
            </div>
          )}
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title or tag"
            aria-label="Search by title or tag"
            className="max-w-xs"
          />
        </div>

        {total === 0 ? (
          <EmptyState onClear={() => { setType("all"); setTag(""); setQuery(""); }}>
            Nothing matches these filters yet.
          </EmptyState>
        ) : isRes ? (
          resourceGroups.map((g) => (
            <BrowseGroup key={g.title} title={g.title} count={g.items.length}>
              {g.items.map((r) => (
                <ResourceCard
                  key={r.id}
                  resource={r}
                  meta={resourceMeta(r)}
                  labName={labName(r.lab)}
                  onOpen={() => openResource(r)}
                />
              ))}
            </BrowseGroup>
          ))
        ) : (
          courseGroups.map((g) => (
            <BrowseGroup key={g.title} title={g.title} count={g.items.length}>
              {g.items.map((c) => (
                <CourseCard
                  key={c.id}
                  course={c}
                  meta={courseMeta(c)}
                  progress={courseProgress(c, progress)}
                  onOpen={() => openCourse(c.id)}
                />
              ))}
            </BrowseGroup>
          ))
        )}
        {editors}
      </>
    );
  }

  /* ---------- library ---------- */
  const resume = continueCourse(courses, progress);
  const resumeStepTitle = resume
    ? (resources.find((r) => r.id === resume.course.steps[resume.nextIndex]?.resource)?.title ??
      "Next step")
    : "";

  return (
    <>
      <PageHead
        crumb="Resource Library"
        titleA="Resources and "
        titleB="courses"
        actions={authorCtas}
      />

      {resume && (
        <ContinueCard
          course={resume.course}
          nextIndex={resume.nextIndex}
          nextStepTitle={resumeStepTitle}
          onResume={() => openCourse(resume.course.id)}
        />
      )}

      <div className="flex flex-col gap-3.5">
        <SectionHead
          title="Courses and guides"
          count={countLabel(courses.length, "published", "published")}
          onViewAll={() => go("?browse=courses")}
        />
        {courses.length === 0 ? (
          <EmptyState>
            {isAdmin
              ? "No courses yet. Build the first one."
              : "No courses have been shared with you yet."}
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.slice(0, 3).map((c) => (
              <CourseCard
                key={c.id}
                course={c}
                meta={courseMeta(c)}
                progress={courseProgress(c, progress)}
                onOpen={() => openCourse(c.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="grid items-start gap-7 lg:grid-cols-[236px_minmax(0,1fr)]">
        <FilterAside
          types={typeCounts}
          activeType={type}
          onType={(k) => setType(k as ResourceType | "all")}
          tags={allTags}
          activeTag={tag}
          onTag={(t) => setTag(tag === t ? "" : t)}
        />

        <div className="min-w-0">
          <div className="mb-3.5 flex flex-col gap-3">
            <SectionHead
              title="Resources"
              count={`Showing ${Math.min(filtered.length, 6)} of ${filtered.length}`}
              onViewAll={() => go("?browse=resources")}
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title or tag"
              aria-label="Search by title or tag"
              className="max-w-xs"
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState onClear={() => { setType("all"); setTag(""); setQuery(""); }}>
              {resources.length === 0
                ? isAdmin
                  ? "Nothing published yet. Add the first resource."
                  : "Nothing has been shared with you yet."
                : "Nothing matches these filters yet."}
            </EmptyState>
          ) : (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(268px,1fr))]">
              {filtered.slice(0, 6).map((r) => (
                <ResourceCard
                  key={r.id}
                  resource={r}
                  meta={resourceMeta(r)}
                  labName={labName(r.lab)}
                  onOpen={() => openResource(r)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {editors}
    </>
  );
}

function BrowseGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-2">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="m-0 text-xl font-bold tracking-[-0.01em]">{title}</h2>
        <span className="text-[13px] text-warm-gray">
          {countLabel(count, "item", "items")}
        </span>
      </div>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(268px,1fr))]">
        {children}
      </div>
    </section>
  );
}

function TabPill({
  on,
  className,
  ...props
}: React.ComponentProps<"button"> & { on: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn(
        "cursor-pointer rounded-full px-3.5 py-[7px] text-[13px] font-semibold whitespace-nowrap transition-colors",
        on ? "bg-violet-deep text-white" : "text-ink-soft hover:text-violet-deep",
        className
      )}
      {...props}
    />
  );
}

/* The course screen needs its own fetch (/courses/{id} resolves the steps'
   resources and this learner's viewed map), so it is split out to keep that
   effect from re-running on every library filter change. */
function CourseRoute({
  courseId,
  isAdmin,
  labName,
  onBack,
  onOpenStep,
  onEdit,
  onDelete,
}: {
  courseId: string;
  isAdmin: boolean;
  labName: (id?: string) => string;
  onBack: () => void;
  onOpenStep: (stepId: string, resourceId: string) => void;
  onEdit: (c: Course) => void;
  onDelete: (c: Course) => void;
}) {
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CourseDetail>(`/courses/${courseId}`)
      .then(setCourse)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Could not open this course.")
      );
  }, [courseId]);

  const markViewed = async (stepId: string) => {
    if (!course || course.viewed[stepId]) return;
    try {
      const { viewed } = await api<{ viewed: Record<string, string> }>(
        `/courses/${courseId}/progress`,
        { method: "POST", body: JSON.stringify({ stepId }) }
      );
      setCourse((prev) => (prev ? { ...prev, viewed } : prev));
    } catch {
      // A lost checkmark shouldn't interrupt the reading; it re-records on the
      // next visit to the step.
    }
  };

  if (error) return <p className="text-sm text-red">{error}</p>;
  if (!course) return <p className="text-sm text-ink-mute">Loading course…</p>;

  return (
    <>
      <PageHead crumb="Course" titleA={course.title} />
      <BackLink onClick={onBack} />
      <CourseScreen
        course={course}
        isAdmin={isAdmin}
        labName={labName(course.lab)}
        onOpenStep={(stepId, resId) => {
          markViewed(stepId);
          onOpenStep(stepId, resId);
        }}
        onToggleStep={markViewed}
        onEdit={() => onEdit(course)}
        onDelete={() => onDelete(course)}
      />
    </>
  );
}
