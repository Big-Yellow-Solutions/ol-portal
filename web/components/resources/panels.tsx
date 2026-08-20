"use client";

import { PanelLabel } from "@/components/resources/chrome";
import { Panel } from "@/components/community/primitives";
import { RESOURCE_TYPE_LABELS } from "@/lib/types";
import type { ResourceItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/* The asides: the library's type/tag filters, and the label/value + related
   panels that sit beside a course or resource. */

export function FilterChip({
  on,
  className,
  ...props
}: React.ComponentProps<"button"> & { on: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn(
        "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
        on
          ? "border-violet-deep bg-violet-deep text-white"
          : "border-hair-strong bg-white text-ink/[0.78] hover:bg-wash",
        className
      )}
      {...props}
    />
  );
}

export function FilterAside({
  types,
  activeType,
  onType,
  tags,
  activeTag,
  onTag,
}: {
  types: { key: string; label: string; count: number }[];
  activeType: string;
  onType: (key: string) => void;
  tags: string[];
  activeTag: string;
  onTag: (tag: string) => void;
}) {
  return (
    <aside className="rounded-[16px] border border-hair bg-white p-[18px] shadow-card lg:sticky lg:top-24">
      <PanelLabel>Type</PanelLabel>
      <div className="mb-5 flex flex-col gap-0.5">
        {types.map((t) => {
          const on = activeType === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={on}
              onClick={() => onType(t.key)}
              className={cn(
                "-mx-1.5 flex cursor-pointer items-center justify-between gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm transition-colors",
                on
                  ? "bg-violet-pale font-semibold text-violet-deep"
                  : "font-medium text-ink-soft hover:bg-wash"
              )}
            >
              {t.label}
              <span className="opacity-60">{t.count}</span>
            </button>
          );
        })}
      </div>

      {tags.length > 0 && (
        <>
          <PanelLabel>Tags</PanelLabel>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <FilterChip key={t} on={activeTag === t} onClick={() => onTag(t)}>
                {t}
              </FilterChip>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

/** The "About this course" / "Details" label-value list. */
export function DetailPanel({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: { label: string; value: React.ReactNode }[];
  footer?: React.ReactNode;
}) {
  return (
    <Panel className="p-5">
      <h2 className="m-0 mb-3.5 text-base font-bold tracking-[-0.01em]">{title}</h2>
      <div className="flex flex-col gap-2.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-3">
            <span className="text-warm-gray">{r.label}</span>
            <span className="text-right font-semibold">{r.value}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-4">{footer}</div>}
    </Panel>
  );
}

export function RelatedPanel({
  items,
  onOpen,
}: {
  items: ResourceItem[];
  onOpen: (r: ResourceItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <Panel className="p-5">
      <h2 className="m-0 mb-3 text-base font-bold tracking-[-0.01em]">Related</h2>
      <div className="flex flex-col gap-1.5">
        {items.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpen(r)}
            className="-mx-2 flex cursor-pointer flex-col gap-[3px] rounded-[10px] px-2 py-2.5 text-left transition-colors hover:bg-paper"
          >
            <span className="text-[11px] font-semibold tracking-[0.14em] text-violet-deep uppercase">
              {RESOURCE_TYPE_LABELS[r.type]}
            </span>
            <span className="text-sm leading-[1.4] font-medium text-ink">
              {r.title}
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

/** The violet-pale "you published this" card, Admins only. */
export function AdminPanel({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[16px] border border-hair bg-violet-pale p-5">
      <h2 className="m-0 mb-2 text-[15px] font-bold tracking-[-0.01em]">{title}</h2>
      <p className="m-0 mb-3.5 text-[13px] leading-[1.55] text-ink/[0.78]">{body}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}
