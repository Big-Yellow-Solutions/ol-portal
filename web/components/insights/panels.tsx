"use client";

import { useState } from "react";
import { ArrowDown, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { stageLabel } from "@/lib/types";
import {
  compact, delta, money, niceMax, pct,
  type Delta, type FunnelRow, type Metrics, type MonthBar,
} from "@/lib/insights";

const PANEL = "rounded-2xl border border-[rgba(124,109,245,.2)] bg-white";
const TONE: Record<Delta["tone"], string> = { up: "text-violet-deep", down: "text-[#8A3B12]", none: "text-ink-mute" };

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn(PANEL, "px-6 py-[22px]", className)}>{children}</section>;
}
export const PanelTitle = ({ title, sub }: { title: string; sub?: React.ReactNode }) => (
  <div>
    <h2 className="text-[17px] font-bold text-ink">{title}</h2>
    {sub && <p className="mt-1 text-[13px] leading-normal text-ink-mute">{sub}</p>}
  </div>
);

/* ---------- KPI cards ---------- */

export function KpiCards({ m, p, loading }: { m: Metrics; p: Metrics; loading: boolean }) {
  const cards = [
    { label: "Open pipeline", value: compact(m.openV), sub: `${m.openN} deal${m.openN === 1 ? "" : "s"} in progress`, d: delta(m.openV, p.openV) },
    { label: "Weighted pipeline", value: compact(m.weighted), sub: "By stage probability", d: delta(m.weighted, p.weighted) },
    { label: "Won (TCV)", value: compact(m.wonV), sub: `${m.wonN} deal${m.wonN === 1 ? "" : "s"} signed`, d: delta(m.wonV, p.wonV) },
    { label: "Win rate", value: pct(m.winRate), sub: `${m.wonN} won · ${m.lostN} lost`, d: delta(m.winRate, p.winRate, "pts") },
    { label: "Avg deal size", value: compact(m.avg), sub: `Proposals signed ${pct(m.proposalSigned)}`, d: delta(m.avg, p.avg) },
    { label: "OL share", value: compact(m.ol), sub: m.wonV ? `${pct(m.ol / m.wonV)} of won TCV` : "No won deals", d: delta(m.ol, p.ol) },
  ];
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
      {cards.map((c) => (
        <div key={c.label} className={cn(PANEL, "flex flex-col gap-1.5 px-[18px] pt-[18px] pb-4")}>
          <span className="text-xs font-semibold tracking-[.08em] text-ink-mute uppercase">{c.label}</span>
          {loading ? (
            <span className="h-8 w-24 animate-pulse rounded bg-wash" />
          ) : (
            <span className="text-[30px] leading-[1.1] font-bold tracking-[-.02em] text-ink tabular-nums">{c.value}</span>
          )}
          <span className="text-[13px] text-ink-mute">{loading ? " " : c.sub}</span>
          <span className={cn("mt-1 text-xs font-semibold", TONE[c.d.tone])}>{loading ? " " : c.d.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- funnel ---------- */

export function FunnelPanel({
  rows, lostN, scopeSuffix, weight, onWeight,
}: {
  rows: FunnelRow[]; lostN: number; scopeSuffix: string;
  weight: number; onWeight: (v: number) => Promise<void>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const empty = rows.every((r) => r.n === 0);
  // null means "show the saved value"; a string is an edit in progress.
  const [edit, setEdit] = useState<string | null>(null);
  const draft = edit ?? String(weight);
  const commit = () => {
    const n = Math.min(100, Math.max(0, Math.round(Number(draft))));
    if (edit === null || !Number.isFinite(n) || draft.trim() === "" || n === weight) return setEdit(null);
    setEdit(String(n));
    void onWeight(n).finally(() => setEdit(null));
  };
  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <PanelTitle title="Pipeline funnel" sub="Deals created in range, by furthest stage reached" />
        <span className="text-[13px] text-ink-mute">{lostN} lost</span>
      </div>
      {empty ? (
        <p className="py-10 text-center text-sm text-ink-mute">No deals were created in this range{scopeSuffix}.</p>
      ) : (
        <div className="mt-3.5">
          {rows.map((r, i) => (
            <div key={r.stage}>
              <div className="grid grid-cols-[minmax(110px,170px)_1fr_34px_72px] items-center gap-3 py-1.5">
                <div>
                  <div className="text-sm font-semibold text-ink">{stageLabel(r.stage)}</div>
                  {r.aging > 0 && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-[#8A3B12]"><Clock size={12} />{r.aging} aging 30d+</div>
                  )}
                </div>
                <div className="h-[26px] rounded-md bg-wash">
                  <span
                    className="block h-full rounded-md"
                    style={{
                      width: `${(r.value / max) * 100}%`,
                      background: i === rows.length - 1 ? "#3D2FD4" : "#7C6DF5",
                      opacity: 1 - (rows.length - 1 - i) * 0.1,
                    }}
                  />
                </div>
                <span className="text-right text-sm font-bold tabular-nums">{r.n}</span>
                <span className="text-right text-sm text-ink-soft tabular-nums">{compact(r.value)}</span>
              </div>
              {r.movedOn != null && (
                <div className="flex items-center gap-1 py-0.5 pl-[calc(min(170px,100%)+12px)] text-xs text-violet-deep max-sm:pl-0">
                  <ArrowDown size={12} />{pct(r.movedOn)} moved on
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="mt-[18px] flex flex-wrap items-center gap-2 border-t border-[rgba(124,109,245,.16)] pt-3.5 text-[13px] text-ink-soft">
        <span className="text-ink-mute">Weighting</span>
        <span>{stageLabel("Proposal Sent")}</span>
        <input
          aria-label="Proposal and Negotiation probability, percent"
          inputMode="numeric" value={draft}
          onChange={(e) => setEdit(e.target.value.replace(/[^\d]/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="w-[52px] rounded-lg border border-[rgba(124,109,245,.3)] bg-white px-2 py-1 text-right font-semibold tabular-nums outline-none focus:border-violet-deep"
        />
        <span>%</span>
        <span className="text-ink-mute">· Lead and Discovery count as 0%. Applies to every Admin.</span>
      </div>
    </Panel>
  );
}

/* ---------- won value over time ---------- */

export function WonChart({
  months, labs, scopeSuffix,
}: {
  months: MonthBar[];
  labs: { id: string; name: string; color: string }[];
  scopeSuffix: string;
}) {
  const multi = labs.length > 1;
  const top = niceMax(Math.max(0, ...months.map((x) => x.total)));
  const any = months.some((x) => x.total > 0);
  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <PanelTitle title="Won value over time" sub="Monthly TCV of deals with a signed contract" />
        {multi && any && (
          <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
            {labs.filter((l) => months.some((x) => x.perLab[l.id])).map((l) => (
              <span key={l.id} className="flex items-center gap-1.5 text-xs">
                <span className="size-[9px] rounded-[3px]" style={{ background: l.color }} />{l.name}
              </span>
            ))}
          </div>
        )}
      </div>
      {!any ? (
        <p className="py-10 text-center text-sm text-ink-mute">No deals were won in this range{scopeSuffix}.</p>
      ) : (
        <div className="mt-7 flex gap-2">
          <div className="flex h-[230px] w-10 flex-none flex-col justify-between text-right text-[11px] text-ink-mute tabular-nums">
            <span>{compact(top)}</span><span>{compact(top / 2)}</span><span>$0</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative flex h-[230px] items-end gap-1.5 border-b border-[rgba(124,109,245,.3)]">
              <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-[rgba(124,109,245,.2)]" />
              <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-[rgba(124,109,245,.2)]" />
              {months.map((x) => {
                const h = (x.total / top) * 100;
                return (
                  <div key={x.key} className="relative z-10 h-full min-w-0 flex-1" title={`${x.title}: ${money(x.total)}`}>
                    {x.total > 0 && (
                      <span className="absolute left-0 w-full text-center text-[11px] font-semibold whitespace-nowrap tabular-nums" style={{ bottom: `calc(${h}% + 4px)` }}>
                        {compact(x.total)}
                      </span>
                    )}
                    <div
                      className="absolute bottom-0 left-1/2 flex w-full max-w-[44px] -translate-x-1/2 flex-col-reverse overflow-hidden rounded-t-[5px]"
                      style={{ height: `${h}%` }}
                    >
                      {labs.filter((l) => x.perLab[l.id]).map((l) => (
                        <span key={l.id} className="block" style={{ flex: `${x.perLab[l.id]} 0 0`, background: multi ? l.color : "#3D2FD4" }} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {months.map((x) => (
                <span key={x.key} className="min-w-0 flex-1 text-center text-[11px] whitespace-nowrap text-ink-mute">{x.label}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ---------- where the money goes ---------- */

export const COST_SEGMENTS = [
  { k: "hard", label: "Hard costs", color: "#111111", fg: "#fff" },
  { k: "sub", label: "Subcontractors", color: "#5E574F", fg: "#fff" },
  { k: "soft", label: "Soft costs", color: "#A39B90", fg: "#111" },
  { k: "payout", label: "Lab leader payouts", color: "#B0A6FA", fg: "#111" },
  { k: "ol", label: "OL share", color: "#3D2FD4", fg: "#fff" },
  { k: "unallocated", label: "Unallocated", color: "#E8A47E", fg: "#111" },
] as const;

export interface MoneyRow { label: string; m: Metrics; strong?: boolean }

export function MoneyPanel({
  rows, total, softPct, leaderPct, note, scopeSuffix,
}: { rows: MoneyRow[]; total: Metrics; softPct: number; leaderPct: number; note: string; scopeSuffix: string }) {
  const empty = total.wonV <= 0;
  return (
    <Panel>
      <PanelTitle
        title="Where the money goes"
        sub={
          <>
            Won deals only. Contract margin = value − hard costs − soft costs (fixed {softPct}%) − subcontractors. Lab leaders get{" "}
            {leaderPct}% of margin; OL keeps {100 - leaderPct}%. {note}
          </>
        }
      />
      {empty ? (
        <p className="py-10 text-center text-sm text-ink-mute">
          No won deals in this range{scopeSuffix}. Costs appear once a contract is signed.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-[18px] gap-y-2.5">
            {COST_SEGMENTS.map((c) => (
              <div key={c.k} className="flex gap-2">
                <span className="mt-1 size-3 flex-none rounded" style={{ background: c.color }} />
                <div>
                  <div className="text-xs text-ink-mute">{c.label}</div>
                  <div className="text-[17px] font-bold tabular-nums">{money(total.costs[c.k])}</div>
                  <div className="text-xs text-ink-mute">{pct(total.costs[c.k] / total.wonV, 1)} of TCV</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-[18px] flex flex-col gap-2.5">
            {rows.map((r) => (
              <div key={r.label} className="grid grid-cols-[minmax(90px,150px)_1fr_72px] items-center gap-3.5">
                <span className={cn("truncate text-sm", r.strong ? "font-bold" : "font-medium text-ink-soft")}>{r.label}</span>
                <div className={cn("flex overflow-hidden rounded-lg bg-wash", r.strong ? "h-[34px]" : "h-6")}>
                  {COST_SEGMENTS.filter((c) => r.m.costs[c.k] > 0.5).map((c) => {
                    const share = r.m.costs[c.k] / r.m.wonV;
                    return (
                      <span
                        key={c.k}
                        title={`${c.label}: ${money(r.m.costs[c.k])} (${pct(share, 1)})`}
                        className="flex min-w-[2px] items-center justify-center overflow-hidden text-xs font-semibold whitespace-nowrap"
                        style={{ flex: `${r.m.costs[c.k]} 0 0`, background: c.color, color: c.fg }}
                      >
                        {share >= 0.07 ? pct(share) : ""}
                      </span>
                    );
                  })}
                </div>
                <span className="text-right text-sm tabular-nums">{compact(r.m.wonV)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
