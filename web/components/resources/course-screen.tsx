"use client";

import { PillButton } from "@/components/resources/chrome";
import { AdminPanel, DetailPanel } from "@/components/resources/panels";
import { PERMISSION_LABELS, RESOURCE_TYPE_LABELS } from "@/lib/types";
import type { CourseDetail, ResourceItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const CTA: Record<ResourceItem["type"], string> = {
  video: "Watch",
  post: "Read",
  file: "Open",
};

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12.5 9.5 18 20 6.5" />
    </svg>
  );
}

export function CourseScreen({
  course,
  isAdmin,
  labName,
  onOpenStep,
  onToggleStep,
  onEdit,
  onDelete,
}: {
  course: CourseDetail;
  isAdmin: boolean;
  labName: string;
  onOpenStep: (stepId: string, resourceId: string) => void;
  onToggleStep: (stepId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const byId = new Map(course.resources.map((r) => [r.id, r]));
  const viewedCount = course.steps.filter((s) => course.viewed[s.id]).length;

  /* Linear courses unlock one step past the last completed one. A sequencing
     affordance, not a security boundary — the server serves the whole course
     either way. The design draws only the free-navigation case, so the locked
     state reuses the disabled treatment rather than inventing a lock glyph. */
  const unlocked = (i: number) =>
    course.navigation === "free" ||
    i === 0 ||
    !!course.viewed[course.steps[i - 1]?.id];

  const nextIndex = course.steps.findIndex((s) => !course.viewed[s.id]);
  const resumeAt = nextIndex === -1 ? 0 : nextIndex;
  const resumeStep = course.steps[resumeAt];

  return (
    <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
      <main className="min-w-0">
        <div className="mb-[22px] h-[260px] overflow-hidden rounded-[20px] bg-violet-pale">
          {course.cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL on the record
            <img src={course.cover} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center font-serif text-2xl text-violet-deep italic">
              {course.title}
            </span>
          )}
        </div>

        {course.description && (
          <p className="mt-0 mb-[22px] text-xl leading-[1.55] text-pretty text-ink/[0.82]">
            {course.description}
          </p>
        )}

        <div className="rounded-[20px] border border-hair bg-white px-5 pt-2 pb-3 shadow-card">
          <div className="flex items-center justify-between gap-3 border-b border-hair-soft py-3.5">
            <h2 className="m-0 text-base font-bold tracking-[-0.01em]">Steps</h2>
            <span className="text-xs text-warm-gray">
              {viewedCount} of {course.steps.length} viewed
            </span>
          </div>

          {course.steps.length === 0 && (
            <p className="py-5 text-sm text-warm-gray">This course has no steps yet.</p>
          )}

          {course.steps.map((step, i) => {
            const r = byId.get(step.resource);
            const done = !!course.viewed[step.id];
            const open = unlocked(i);
            return (
              <div
                key={step.id}
                className="flex items-start gap-3.5 border-b border-[rgba(124,109,245,0.12)] py-4"
              >
                <button
                  type="button"
                  onClick={() => onToggleStep(step.id)}
                  disabled={!open}
                  aria-pressed={done}
                  aria-label={done ? "Mark not viewed" : "Mark viewed"}
                  className={cn(
                    "mt-0.5 flex size-[22px] flex-none items-center justify-center rounded-[7px] border-[1.5px] transition-colors",
                    done
                      ? "border-violet-deep bg-violet-deep text-white"
                      : "border-[rgba(124,109,245,0.45)] bg-white text-transparent",
                    open ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                  )}
                >
                  {done && <CheckIcon />}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2.5">
                    <span className="font-serif text-[15px] text-violet-light italic">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-base font-semibold tracking-[-0.01em]">
                      {r?.title ?? "Unavailable"}
                    </span>
                    <span className="text-[11px] font-semibold tracking-[0.14em] text-violet-deep uppercase">
                      {r ? RESOURCE_TYPE_LABELS[r.type] : "Removed"}
                    </span>
                  </div>
                  {step.note && (
                    <div className="text-sm leading-[1.55] text-pretty text-ink/[0.72]">
                      {step.note}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  disabled={!r || !open}
                  onClick={() => r && onOpenStep(step.id, r.id)}
                  className={cn(
                    "flex-none rounded-full border border-hair-strong bg-white px-4 py-2 text-[13px] font-medium whitespace-nowrap text-violet-deep transition-colors",
                    r && open
                      ? "cursor-pointer hover:bg-violet-pale"
                      : "cursor-not-allowed opacity-50"
                  )}
                >
                  {r ? CTA[r.type] : "Unavailable"}
                </button>
              </div>
            );
          })}

          <div className="px-0 pt-3.5 pb-1.5 text-[13px] text-warm-gray">
            {course.navigation === "free"
              ? "Free navigation: open any step in any order."
              : "Linear: each step unlocks the next."}
          </div>
        </div>
      </main>

      <aside className="flex flex-col gap-4">
        <DetailPanel
          title="About this course"
          rows={[
            ...(course.estimatedMinutes
              ? [{ label: "Estimated time", value: `${course.estimatedMinutes} min` }]
              : []),
            { label: "Steps", value: String(course.steps.length) },
            { label: "Lab", value: labName },
            {
              label: "Navigation",
              value: course.navigation === "free" ? "Free" : "Linear",
            },
            { label: "Access", value: PERMISSION_LABELS[course.permission] },
          ]}
          footer={
            resumeStep && (
              <PillButton
                tone="solid"
                onClick={() => onOpenStep(resumeStep.id, resumeStep.resource)}
              >
                {viewedCount === 0
                  ? "Start course"
                  : `Resume at step ${resumeAt + 1}`}
              </PillButton>
            )
          }
        />

        {isAdmin && (
          <AdminPanel
            title="You published this"
            body="Edit the step order, notes, or who can see it."
          >
            <PillButton tone="solid" onClick={onEdit}>
              Edit steps
            </PillButton>
            <PillButton onClick={onDelete}>Delete</PillButton>
          </AdminPanel>
        )}
      </aside>
    </div>
  );
}
