"use client";

import { Calendar, GripVertical, Repeat } from "lucide-react";
import { fmtDollars } from "@/lib/data";
import { assignmentState, billingOf, cadenceOf, SHOW_BILLING_ON_CARDS } from "@/lib/pipeline";
import { cn } from "@/lib/utils";
import type { Deal } from "@/lib/types";

/* Short form of a close date — "Aug 31". Parsed by parts rather than by
   `new Date(iso)`, which reads a bare YYYY-MM-DD as UTC midnight and so shows
   the previous day to anyone west of Greenwich. */
function fmtClose(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* A deal on the board. */
export function DealCard({
  deal,
  labName,
  ownerName,
  billing,
  canDrag,
  isDragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  deal: Deal;
  labName: string;
  ownerName: string;
  billing: ReturnType<typeof billingOf>;
  canDrag: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const cadence = cadenceOf(deal);
  return (
    <button
      onClick={onClick}
      draggable={canDrag}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", deal.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative flex w-full flex-col gap-0 rounded-[16px] border bg-card p-[13px] text-left shadow-[0_1px_2px_rgba(17,17,17,0.04)] transition hover:border-violet-deep hover:shadow-[0_18px_34px_-16px_rgba(61,47,212,0.30)] hover:-translate-y-0.5",
        billing.due ? "border-red/45" : "border-hair",
        canDrag && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-45"
      )}
    >
      {canDrag && (
        <span aria-hidden className="absolute top-1/2 left-0.5 -translate-y-1/2 text-ink-mute opacity-0 transition-opacity group-hover:opacity-100">
          <GripVertical size={14} />
        </span>
      )}

      <div className="mb-2.5 flex items-center gap-1.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-violet-pale px-2.5 py-1 text-[10px] font-bold tracking-[0.09em] text-violet-deep uppercase">
          <span aria-hidden className="size-1.5 rounded-full bg-violet" />
          {labName}
        </span>
        <span className="flex-1" />
        {deal.stage === "Closed" && deal.outcome === "Won" && (
          <span className="rounded-full bg-green-pale px-2.5 py-0.5 text-[11px] font-semibold text-green">Won</span>
        )}
        {deal.stage === "Closed Lost" && (
          <span className="rounded-full bg-warm-panel px-2.5 py-0.5 text-[11px] font-semibold text-warm-gray">Lost</span>
        )}
        {/* Pipeline v3: a won deal with no assignment on file says so on the
            board, so the work finance is waiting on is visible without
            opening anything. */}
        {assignmentState(deal) === "needed" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-pale px-2.5 py-0.5 text-[11px] font-semibold text-amber">
            <span aria-hidden className="size-1.5 rounded-full bg-amber" />
            Assignment
          </span>
        )}
        {deal.recurring && <Repeat size={14} className="shrink-0 text-violet" aria-label="Recurring deal" />}
      </div>

      <h4 className="text-[15px] leading-[1.3] font-bold tracking-[-0.015em] text-ink">{deal.client}</h4>
      {cadence && <p className="mt-1 truncate text-[11px] font-medium text-violet">{cadence}</p>}

      {SHOW_BILLING_ON_CARDS && (
      <div className="mt-2.5 flex items-center gap-2">
        <span
          className={cn(
            "flex size-6.5 shrink-0 items-center justify-center text-[11px] font-semibold",
            billing.kind === "company" ? "rounded-[9px]" : "rounded-full",
            billing.ok ? "bg-violet-pale text-violet-deep" : billing.due ? `border border-dashed border-red/55 text-red` : "border border-dashed border-hair-strong text-violet-deep"
          )}
        >
          {billing.initials}
        </span>
        <span className="min-w-0">
          <span className={cn("block truncate text-[13px] font-semibold", billing.ok ? "text-ink" : billing.due ? "text-red" : "text-ink-mute")}>{billing.name}</span>
          <span className="block truncate text-xs text-ink-mute">{billing.sub}</span>
        </span>
      </div>
      )}

      <div className="mt-[11px] mb-2.5 h-px bg-hair-soft" />

      <div className="flex items-center gap-2">
        <span className="flex min-w-0 shrink items-center gap-1.5 text-xs whitespace-nowrap text-ink-mute">
          <Calendar size={13} aria-hidden />
          {fmtClose(deal.close)}
        </span>
        <span className="flex-1" />
        <span className="shrink-0 text-[15px] font-bold tracking-[-0.01em] text-ink tabular-nums">{fmtDollars(deal.amount)}</span>
      </div>
      <div className="mt-2 truncate text-[11px] text-ink-mute">{ownerName}</div>
    </button>
  );
}
