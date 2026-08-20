"use client";

import { StarGlyph } from "@/components/shell/top-nav";
import { Badge } from "@/components/ui/badge";
import { RESOURCE_TYPE_LABELS } from "@/lib/types";
import type { Course, ResourceItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Cards for the Resources surface. The design gives resource and course cards
   the same shape — 20px corners, a flush cover, a body that pushes its meta
   row to the bottom, and a violet lift on hover — differing only in cover
   height and the kicker. */

const CARD =
  "group flex cursor-pointer flex-col overflow-hidden rounded-[20px] border border-hair bg-white text-left shadow-card transition-shadow hover:shadow-lift";

/* Records carry a data-URL thumbnail or nothing. Where there is nothing the
   design still wants a filled block, so the placeholder names what the item
   is rather than showing an empty grey rectangle. */
function Cover({
  src,
  label,
  height,
  tone = "pale",
}: {
  src?: string;
  label: string;
  height: number;
  tone?: "pale" | "deep";
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- data URL on the record
      <img
        src={src}
        alt=""
        style={{ height }}
        className="w-full flex-none object-cover"
      />
    );
  }
  return (
    <div
      style={{ height }}
      className={cn(
        "flex w-full flex-none items-center justify-center",
        tone === "deep" ? "bg-violet-deep" : "bg-violet-pale"
      )}
    >
      <span
        className={cn(
          "font-serif text-lg italic",
          tone === "deep" ? "text-white" : "text-violet-deep"
        )}
      >
        {label}
      </span>
    </div>
  );
}

export function ResourceCard({
  resource,
  meta,
  labName,
  onOpen,
}: {
  resource: ResourceItem;
  meta: string;
  labName: string;
  onOpen: () => void;
}) {
  return (
    <article
      onClick={onOpen}
      className={CARD}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open ${resource.title}`}
    >
      <Cover
        src={resource.thumbnail}
        label={RESOURCE_TYPE_LABELS[resource.type]}
        height={132}
      />
      <div className="flex flex-1 flex-col gap-2 p-[18px]">
        <span className="inline-flex items-center gap-[7px] text-[11px] font-semibold tracking-[0.16em] text-violet-deep uppercase">
          {RESOURCE_TYPE_LABELS[resource.type]}
          {resource.status === "Draft" && (
            <Badge variant="destructive" className="tracking-normal normal-case">
              Draft
            </Badge>
          )}
          {resource.visibility === "course-only" && (
            <Badge variant="outline" className="tracking-normal normal-case">
              Course only
            </Badge>
          )}
        </span>
        <div className="text-base leading-[1.35] font-semibold text-pretty">
          {resource.title}
        </div>
        {resource.description && (
          <div className="text-[13px] leading-[1.5] text-pretty text-ink/[0.72]">
            {resource.description}
          </div>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-hair-soft pt-3 text-xs text-warm-gray">
          <span>{labName}</span>
          <span>·</span>
          <span>{meta}</span>
        </div>
      </div>
    </article>
  );
}

export function CourseCard({
  course,
  meta,
  progress,
  onOpen,
}: {
  course: Course;
  meta: string;
  progress: string;
  onOpen: () => void;
}) {
  return (
    <article
      onClick={onOpen}
      className={CARD}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open ${course.title}`}
    >
      <Cover src={course.cover} label="Course" height={150} tone="deep" />
      <div className="flex flex-1 flex-col gap-2.5 p-5">
        <span className="inline-flex items-center gap-[7px] text-[11px] font-semibold tracking-[0.16em] text-violet-deep uppercase">
          <StarGlyph />
          Course
          {course.status === "Draft" && (
            <Badge variant="destructive" className="tracking-normal normal-case">
              Draft
            </Badge>
          )}
        </span>
        <div className="text-lg leading-[1.3] font-bold tracking-[-0.01em] text-pretty">
          {course.title}
        </div>
        {course.description && (
          <div className="text-sm leading-[1.5] text-pretty text-ink/[0.72]">
            {course.description}
          </div>
        )}
        <div className="mt-auto flex items-center gap-2.5 border-t border-hair-soft pt-3 text-xs text-warm-gray">
          <span>{meta}</span>
          <span className="flex-1" />
          <span className="font-semibold text-violet-deep">{progress}</span>
        </div>
      </div>
    </article>
  );
}

/* The violet banner at the top of the library: one course, mid-progress. */
export function ContinueCard({
  course,
  nextStepTitle,
  nextIndex,
  onResume,
}: {
  course: Course;
  nextStepTitle: string;
  nextIndex: number;
  onResume: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-[22px] rounded-[20px] bg-violet-deep p-5 text-white">
      <div className="h-28 w-[196px] flex-none overflow-hidden rounded-[14px] bg-violet/40">
        {course.cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL on the record
          <img src={course.cover} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center font-serif text-lg italic text-white/80">
            Course
          </span>
        )}
      </div>
      <div className="min-w-[200px] flex-1">
        <div className="mb-2 text-[11px] font-semibold tracking-[0.16em] text-white/[0.72] uppercase">
          Continue where you left off
        </div>
        <div className="mb-1.5 text-[22px] font-bold tracking-[-0.01em]">
          {course.title}
        </div>
        <div className="text-sm text-white/[0.78]">
          Next up · Step {nextIndex + 1} of {course.steps.length} — {nextStepTitle}
        </div>
      </div>
      <button
        type="button"
        onClick={onResume}
        className="flex-none cursor-pointer rounded-full bg-white px-[22px] py-[11px] text-sm font-semibold whitespace-nowrap text-violet-deep transition-colors hover:bg-violet-pale"
      >
        Resume course
      </button>
    </div>
  );
}
