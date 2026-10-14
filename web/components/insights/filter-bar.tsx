"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { stageLabel, type Stage } from "@/lib/types";
import {
  FILTER_STAGES, RANGE_LABELS, isDefault,
  type Basis, type Filters, type RangeKey, type Status,
} from "@/lib/insights";

/* The sticky bar under the portal header. Every control writes to one Filters
   object owned by the page, which mirrors it to the URL hash. */

const CONTROL =
  "rounded-[10px] border border-[rgba(124,109,245,.24)] bg-white px-3 py-[9px] text-[13px] text-ink";

function Box({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "flex size-4 flex-none items-center justify-center rounded-[5px] border",
        on ? "border-violet-deep bg-violet-deep text-white" : "border-[rgba(124,109,245,.45)] bg-white",
      )}
    >
      {on && <Check size={11} strokeWidth={3} />}
    </span>
  );
}

function MultiSelect({
  label, summary, width, children,
}: { label: string; summary: string; width: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(CONTROL, "flex items-center gap-2 whitespace-nowrap")}
      >
        <span className="text-ink-mute">{label}</span>
        <span className="font-semibold">{summary}</span>
        <ChevronDown size={14} className="text-violet-deep" />
      </button>
      {open && (
        <div
          role="listbox" aria-multiselectable
          style={{ width }}
          className="absolute top-[calc(100%+6px)] left-0 z-30 rounded-xl border border-[rgba(124,109,245,.2)] bg-white p-1.5 shadow-[0_18px_40px_-12px_rgba(17,17,17,.22)]"
        >
          {children}
        </div>
      )}
    </div>
  );
}

const Row = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button" role="option" aria-selected={on} onClick={onClick}
    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-wash"
  >
    <Box on={on} />
    {children}
  </button>
);

function Segmented<T extends string>({
  value, options, onChange, label,
}: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-[10px] border border-[rgba(124,109,245,.24)] bg-white p-[3px]">
      {options.map((o) => (
        <button
          key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}
          className={cn(
            "rounded-[7px] px-[11px] py-1.5 text-[13px] whitespace-nowrap",
            value === o.v ? "bg-violet-deep font-semibold text-white" : "font-medium text-ink-soft",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FilterBar({
  filters, defaults, onChange, labs, leaders, labColor,
}: {
  filters: Filters;
  defaults: Filters;
  onChange: (patch: Partial<Filters>) => void;
  labs: { id: string; name: string }[];
  leaders: { key: string; name: string }[];
  labColor: (id: string) => string;
}) {
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const labSummary = !filters.labs.length ? "All labs"
    : filters.labs.length === 1 ? (labs.find((l) => l.id === filters.labs[0])?.name ?? "1 lab")
    : `${filters.labs.length} labs`;
  const stageSummary = !filters.stages.length ? "All"
    : filters.stages.length === 1 ? stageLabel(filters.stages[0]) : `${filters.stages.length} stages`;

  return (
    <div className="sticky top-16 z-30 -mx-4 flex flex-wrap items-center gap-2.5 border-b border-[rgba(124,109,245,.16)] bg-paper px-4 py-3 md:-mx-8 md:px-8">
      <MultiSelect label="Lab" summary={labSummary} width={240}>
        <Row on={!filters.labs.length} onClick={() => onChange({ labs: [] })}>All labs</Row>
        {labs.map((l) => (
          <Row key={l.id} on={filters.labs.includes(l.id)} onClick={() => onChange({ labs: toggle(filters.labs, l.id) })}>
            <span className="size-[9px] flex-none rounded-[3px]" style={{ background: labColor(l.id) }} />
            {l.name}
          </Row>
        ))}
      </MultiSelect>

      <select
        aria-label="Date range" value={filters.range}
        onChange={(e) => onChange({ range: e.target.value as RangeKey })}
        className={CONTROL}
      >
        {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => <option key={k} value={k}>{RANGE_LABELS[k]}</option>)}
      </select>
      {filters.range === "custom" && (
        <span className="flex items-center gap-2 text-[13px] text-ink-mute">
          <input type="date" aria-label="From" value={filters.from} onChange={(e) => onChange({ from: e.target.value })} className={CONTROL} />
          to
          <input type="date" aria-label="To" value={filters.to} onChange={(e) => onChange({ to: e.target.value })} className={CONTROL} />
        </span>
      )}

      <Segmented<Basis>
        label="Date basis" value={filters.basis} onChange={(basis) => onChange({ basis })}
        options={[{ v: "closed", label: "Closed date" }, { v: "created", label: "Created date" }]}
      />

      <MultiSelect label="Stage" summary={stageSummary} width={230}>
        {FILTER_STAGES.map((s: Stage) => (
          <Row key={s} on={filters.stages.includes(s)} onClick={() => onChange({ stages: toggle(filters.stages, s) })}>
            {stageLabel(s)}
          </Row>
        ))}
      </MultiSelect>

      <select aria-label="Lab leader" value={filters.leader} onChange={(e) => onChange({ leader: e.target.value })} className={CONTROL}>
        <option value="all">All lab leaders</option>
        {leaders.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
      </select>

      <Segmented<Status>
        label="Status" value={filters.status} onChange={(status) => onChange({ status })}
        options={[{ v: "all", label: "All" }, { v: "Open", label: "Open" }, { v: "Won", label: "Won" }, { v: "Lost", label: "Lost" }]}
      />

      {!isDefault(filters, defaults) && (
        <button type="button" onClick={() => onChange({ ...defaults })} className="text-[13px] font-semibold text-violet-deep">
          Reset
        </button>
      )}
    </div>
  );
}
