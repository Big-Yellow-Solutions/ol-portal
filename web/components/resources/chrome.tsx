"use client";

import { StarGlyph } from "@/components/shell/top-nav";
import { cn } from "@/lib/utils";

/* Page furniture for the Resources surface: the eyebrow + split headline every
   screen shares, the section headers, and the two pill buttons the design uses
   for actions. */

/** The headline splits mid-phrase — the second half is Playfair italic violet. */
export function PageHead({
  crumb,
  titleA,
  titleB,
  actions,
}: {
  crumb: string;
  titleA: string;
  titleB?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0">
        <span className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] text-warm-gray uppercase">
          <StarGlyph className="text-violet-deep" />
          {crumb}
        </span>
        <h1 className="mt-1.5 mb-0 text-[38px] leading-[1.08] font-bold tracking-[-0.015em] text-pretty">
          {titleA}
          {titleB && (
            <span className="font-serif font-normal text-violet-deep italic">
              {titleB}
            </span>
          )}
        </h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PillButton({
  tone = "outline",
  className,
  ...props
}: React.ComponentProps<"button"> & { tone?: "outline" | "solid" }) {
  return (
    <button
      type="button"
      className={cn(
        "cursor-pointer rounded-full px-[17px] py-[9px] text-[13px] font-semibold whitespace-nowrap transition-colors",
        tone === "solid"
          ? "border border-violet-deep bg-violet-deep text-white hover:border-violet hover:bg-violet"
          : "border border-[rgba(124,109,245,0.40)] bg-white text-violet-deep hover:bg-violet-pale",
        className
      )}
      {...props}
    />
  );
}

export function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mb-1 inline-flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-violet-deep transition-colors hover:text-violet"
    >
      ← Back to Resource Library
    </button>
  );
}

/** h2 with an optional count and a "View all" affordance on the right. */
export function SectionHead({
  title,
  count,
  onViewAll,
  viewAllLabel = "View all",
}: {
  title: string;
  count?: string;
  onViewAll?: () => void;
  viewAllLabel?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="m-0 text-[22px] font-bold tracking-[-0.01em]">{title}</h2>
      <span className="flex items-center gap-3.5">
        {count && <span className="text-[13px] text-warm-gray">{count}</span>}
        {onViewAll && (
          <PillButton onClick={onViewAll} className="px-4 py-2">
            {viewAllLabel}
          </PillButton>
        )}
      </span>
    </div>
  );
}

/** The uppercase label above a filter group or an aside list. */
export function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 text-[11px] font-semibold tracking-[0.16em] text-warm-gray uppercase">
      {children}
    </div>
  );
}

export function EmptyState({
  children,
  onClear,
}: {
  children: React.ReactNode;
  onClear?: () => void;
}) {
  return (
    <div className="rounded-[16px] border border-dashed border-[rgba(124,109,245,0.40)] bg-white p-[34px] text-center text-sm text-warm-gray">
      {children}{" "}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="cursor-pointer text-sm font-semibold text-violet-deep hover:text-violet"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
