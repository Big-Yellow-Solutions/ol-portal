"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Clock, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  compact, fmtDate, money, pct, sortRows,
  type LabRow, type LostRow, type Metrics, type UnpaidRow,
} from "@/lib/insights";
import { Panel, PanelTitle } from "./panels";

const HEAD = "px-3 py-2.5 text-xs font-semibold tracking-[.04em] whitespace-nowrap uppercase";
const CELL = "px-3 py-3 whitespace-nowrap tabular-nums";

export function ExportButton({ onClick, small, label = "Export CSV" }: { onClick: () => void; small?: boolean; label?: string }) {
  return (
    <button
      type="button" onClick={onClick}
      className={cn(
        "flex flex-none items-center gap-2 rounded-full border border-violet-deep bg-white font-semibold text-violet-deep hover:bg-violet-pale",
        small ? "px-3.5 py-[7px] text-[13px]" : "px-[18px] py-2.5 text-sm",
      )}
    >
      <Download size={small ? 14 : 15} strokeWidth={2.2} />{label}
    </button>
  );
}

type Dir = 1 | -1;

function SortHead<K extends string>({
  col, sort, onSort, left, first, last,
}: {
  col: { k: K; label: string };
  sort: { k: K; d: Dir };
  onSort: (k: K) => void;
  left?: boolean; first?: boolean; last?: boolean;
}) {
  const on = sort.k === col.k;
  return (
    <th
      scope="col" aria-sort={on ? (sort.d < 0 ? "descending" : "ascending") : "none"}
      className={cn(left ? "text-left" : "text-right", first && "pl-6", last && "pr-6")}
    >
      <button
        type="button" onClick={() => onSort(col.k)}
        className={cn(HEAD, "w-full", left ? "text-left" : "text-right", on ? "text-violet-deep" : "text-ink-mute")}
      >
        {col.label}{on ? (sort.d < 0 ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
}

/* ---------- lab comparison ---------- */

type LabKey = keyof Pick<LabRow, "name" | "openV" | "wonN" | "wonV" | "winRate" | "avg" | "cycle" | "hard" | "sub" | "soft" | "payout" | "ol">;
const LAB_COLS: { k: LabKey; label: string }[] = [
  { k: "name", label: "Lab" }, { k: "openV", label: "Open pipeline" }, { k: "wonN", label: "Won #" }, { k: "wonV", label: "Won $" },
  { k: "winRate", label: "Win rate" }, { k: "avg", label: "Avg deal" }, { k: "cycle", label: "Sales cycle" },
  { k: "hard", label: "Hard" }, { k: "sub", label: "Subs" }, { k: "soft", label: "Soft" }, { k: "payout", label: "Payouts" }, { k: "ol", label: "OL share" },
];

export function LabTable({
  rows, total, color, onOpen, onExport,
}: {
  rows: LabRow[]; total: Metrics; color: (id: string) => string; onOpen: (id: string) => void; onExport: () => void;
}) {
  const [sort, setSort] = useState<{ k: LabKey; d: Dir }>({ k: "wonV", d: -1 });
  const sorted = useMemo(() => sortRows(rows, sort.k, sort.d), [rows, sort]);
  const onSort = (k: LabKey) => setSort((s) => ({ k, d: s.k === k ? ((-s.d) as Dir) : k === "name" ? 1 : -1 }));
  const flag = (v: number | null) => (v != null && v >= 0.2 ? "font-semibold text-[#8A3B12]" : "");
  const totalShare = (v: number) => (total.wonV ? v / total.wonV : null);
  return (
    <Panel className="px-0 pb-2">
      <div className="flex items-start justify-between gap-3 px-6 pb-3.5">
        <PanelTitle title="Lab comparison" sub="Click a lab to open its view. Cost columns are a share of won TCV." />
        <ExportButton small onClick={onExport} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[rgba(124,109,245,.2)]">
              {LAB_COLS.map((c, i) => (
                <SortHead key={c.k} col={c} sort={sort} onSort={onSort} left={i === 0} first={i === 0} last={i === LAB_COLS.length - 1} />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.lab} className="border-b border-[rgba(124,109,245,.12)] hover:bg-[#FBFAFF]">
                <td className={cn(CELL, "pl-6")}>
                  <button type="button" onClick={() => onOpen(r.lab)} className="flex items-center gap-2 font-medium hover:text-violet-deep">
                    <span className="size-[9px] rounded-[3px]" style={{ background: color(r.lab) }} />{r.name}
                  </button>
                </td>
                <td className={cn(CELL, "text-right")}>{compact(r.openV)}</td>
                <td className={cn(CELL, "text-right")}>{r.wonN}</td>
                <td className={cn(CELL, "text-right font-semibold")}>{compact(r.wonV)}</td>
                <td className={cn(CELL, "text-right")}>{pct(r.winRate)}</td>
                <td className={cn(CELL, "text-right")}>{compact(r.avg)}</td>
                <td className={cn(CELL, "text-right")}>{r.cycle == null ? "—" : `${Math.round(r.cycle)} days`}</td>
                <td className={cn(CELL, "text-right", flag(r.hard))}>{pct(r.hard)}</td>
                <td className={cn(CELL, "text-right", flag(r.sub))}>{pct(r.sub)}</td>
                <td className={cn(CELL, "text-right")}>{pct(r.soft)}</td>
                <td className={cn(CELL, "text-right")}>{pct(r.payout)}</td>
                <td className={cn(CELL, "pr-6 text-right font-semibold text-violet-deep")}>{compact(r.ol)}</td>
              </tr>
            ))}
            <tr className="bg-paper font-bold">
              <td className={cn(CELL, "pl-6")}>All labs</td>
              <td className={cn(CELL, "text-right")}>{compact(total.openV)}</td>
              <td className={cn(CELL, "text-right")}>{total.wonN}</td>
              <td className={cn(CELL, "text-right")}>{compact(total.wonV)}</td>
              <td className={cn(CELL, "text-right")}>{pct(total.winRate)}</td>
              <td className={cn(CELL, "text-right")}>{compact(total.avg)}</td>
              <td className={cn(CELL, "text-right")}>{total.cycle == null ? "—" : `${Math.round(total.cycle)} days`}</td>
              <td className={cn(CELL, "text-right")}>{pct(totalShare(total.costs.hard))}</td>
              <td className={cn(CELL, "text-right")}>{pct(totalShare(total.costs.sub))}</td>
              <td className={cn(CELL, "text-right")}>{pct(totalShare(total.costs.soft))}</td>
              <td className={cn(CELL, "text-right")}>{pct(totalShare(total.costs.payout))}</td>
              <td className={cn(CELL, "pr-6 text-right text-violet-deep")}>{compact(total.ol)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ---------- open and unpaid deals ---------- */

type DealKey = "client" | "lab" | "leader" | "stage" | "waiting" | "value" | "hard" | "sub" | "soft" | "payout" | "ol";
const DEAL_COLS: { k: DealKey; label: string }[] = [
  { k: "client", label: "Deal" }, { k: "lab", label: "Lab" }, { k: "leader", label: "Lab leader" }, { k: "stage", label: "Stage" },
  { k: "waiting", label: "Days waiting" }, { k: "value", label: "Value" }, { k: "hard", label: "Hard" }, { k: "sub", label: "Subs" },
  { k: "soft", label: "Soft" }, { k: "payout", label: "Payout" }, { k: "ol", label: "OL share" },
];
const TEXT_COLS = new Set<DealKey>(["client", "lab", "leader", "stage"]);

export function DealsTable({
  rows, labName, onOpen, onExport,
}: {
  rows: UnpaidRow[]; labName: (id: string) => string; onOpen: (id: string) => void; onExport: (visible: UnpaidRow[]) => void;
}) {
  const [sort, setSort] = useState<{ k: DealKey; d: Dir }>({ k: "value", d: -1 });
  const [onlyAging, setOnlyAging] = useState(false);
  const [onlyRecon, setOnlyRecon] = useState(false);
  const agingN = rows.filter((r) => r.aging).length;
  const reconN = rows.filter((r) => r.unreconciled).length;

  const flat = useMemo(() => rows.map((r) => {
    const costed = r.deal.stage === "Contracted" && r.deal.hasAssignment;
    const f = r.deal.finance;
    return {
      r, client: r.deal.client, lab: labName(r.deal.lab), leader: r.deal.leaderName, stage: r.deal.stage,
      waiting: r.waiting, value: r.deal.amount,
      hard: costed ? f.hard : null, sub: costed ? f.sub : null, soft: costed ? f.soft : null,
      payout: costed ? f.payout : null, ol: costed ? f.ol : null,
    };
  }), [rows, labName]);
  const visible = useMemo(() => {
    const kept = flat.filter((x) => (!onlyAging || x.r.aging) && (!onlyRecon || x.r.unreconciled));
    return sortRows(kept, sort.k, sort.d);
  }, [flat, onlyAging, onlyRecon, sort]);
  const onSort = (k: DealKey) => setSort((s) => ({ k, d: s.k === k ? ((-s.d) as Dir) : TEXT_COLS.has(k) ? 1 : -1 }));

  const toggle = (on: boolean, set: (v: boolean) => void, icon: React.ReactNode, text: string, n: number) => (
    <button
      type="button" aria-pressed={on} onClick={() => set(!on)}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-[7px] text-[13px] font-medium",
        on ? "border-[#8A3B12] bg-[#8A3B12] text-white" : "border-[rgba(138,59,18,.3)] bg-white text-[#8A3B12]",
      )}
    >
      {icon}{text} <span className="font-semibold">{n}</span>
    </button>
  );

  return (
    <Panel className="px-0 pb-2">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 pb-3.5">
        <PanelTitle
          title="Open and unpaid deals"
          sub={`${rows.length} deal${rows.length === 1 ? "" : "s"} in Proposal & Negotiation, or signed and still awaiting payment. Click a row to open the deal.`}
        />
        <div className="flex flex-wrap gap-2">
          {toggle(onlyAging, setOnlyAging, <Clock size={14} />, "Waiting 30+ days", agingN)}
          {toggle(onlyRecon, setOnlyRecon, <AlertTriangle size={14} />, "Doesn't reconcile", reconN)}
          <ExportButton small onClick={() => onExport(visible.map((x) => x.r))} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1260px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[rgba(124,109,245,.2)]">
              {DEAL_COLS.map((c, i) => (
                <SortHead key={c.k} col={c} sort={sort} onSort={onSort} left={TEXT_COLS.has(c.k)} first={i === 0} last={i === DEAL_COLS.length - 1} />
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map(({ r, ...x }) => {
              const d = r.deal;
              const signed = d.stage === "Contracted";
              return (
                <tr
                  key={d.id} onClick={() => onOpen(d.id)}
                  className="cursor-pointer border-b border-[rgba(124,109,245,.12)] hover:bg-[#FBFAFF]"
                >
                  <td className="max-w-[280px] py-3 pr-3 pl-6">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onOpen(d.id); }}
                      className="block max-w-full truncate text-left font-semibold hover:text-violet-deep"
                    >
                      {d.client}
                    </button>
                    {d.billing && <div className="truncate text-xs text-ink-mute">{d.billing}</div>}
                  </td>
                  <td className={CELL + " text-left"}>{x.lab}</td>
                  <td className={CELL + " text-left"}>{x.leader}</td>
                  <td className={CELL + " text-left"}>
                    <span
                      className={cn(
                        "inline-block rounded-full px-2.5 py-[3px] text-xs font-semibold",
                        signed ? "bg-[#FBEFE6] text-[#8A3B12]" : "bg-violet-pale text-violet-deep",
                      )}
                    >
                      {signed ? "Contracted · awaiting payment" : "Proposal & Negotiation"}
                    </span>
                  </td>
                  <td className={cn(CELL, "text-right")}>
                    {r.aging
                      ? <span className="rounded-full bg-[#FBEFE6] px-2 py-0.5 text-xs font-semibold text-[#8A3B12]">{r.waiting}d</span>
                      : `${r.waiting}d`}
                  </td>
                  <td className={cn(CELL, "text-right font-semibold")}>{money(d.amount)}</td>
                  <td className={cn(CELL, "text-right")}>{x.hard == null ? "—" : money(x.hard)}</td>
                  <td className={cn(CELL, "text-right")}>{x.sub == null ? "—" : money(x.sub)}</td>
                  <td className={cn(CELL, "text-right")}>{x.soft == null ? "—" : money(x.soft)}</td>
                  <td className={cn(CELL, "text-right")}>{x.payout == null ? "—" : money(x.payout)}</td>
                  <td className={cn(CELL, "pr-6 text-right")}>
                    <div className="font-semibold text-violet-deep">{x.ol == null ? "—" : money(x.ol)}</div>
                    {d.finance.founderRun && (
                      <span className="mt-1 inline-block rounded-full bg-violet-pale px-2 py-0.5 text-[11px] font-semibold text-violet-deep">Founder-run</span>
                    )}
                    {r.reason === "no-assignment" && (
                      <span className="mt-1 inline-block rounded-full bg-[#FBEFE6] px-2 py-0.5 text-[11px] font-semibold text-[#8A3B12]">No assignment filed</span>
                    )}
                    {r.reason === "unallocated" && (
                      <span className="mt-1 inline-block rounded-full bg-[#FBEFE6] px-2 py-0.5 text-[11px] font-semibold text-[#8A3B12]">
                        {money(Math.abs(d.finance.unallocated))} unallocated
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr><td colSpan={DEAL_COLS.length} className="px-6 py-10 text-center text-sm text-ink-mute">No deals match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ---------- lost deals ---------- */

export function LostTable({
  rows, labName, onOpen,
}: {
  rows: LostRow[]; labName: (id: string) => string; onOpen: (id: string) => void;
}) {
  const total = rows.reduce((t, r) => t + r.deal.amount, 0);
  return (
    <Panel className="px-0 pb-2">
      <div className="px-6 pb-3.5">
        <PanelTitle
          title="Lost deals"
          sub={`${rows.length} deal${rows.length === 1 ? "" : "s"} lost in this range, ${money(total)} in all. Click a row to open the deal.`}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[rgba(124,109,245,.2)]">
              {["Deal", "Lab", "Lab leader", "Lost on", "Value", "Reason"].map((h, i, all) => (
                <th
                  key={h} scope="col"
                  className={cn(HEAD, "text-ink-mute", h === "Value" ? "text-right" : "text-left", i === 0 && "pl-6", i === all.length - 1 && "pr-6")}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ deal: d, lostOn }) => (
              <tr
                key={d.id} onClick={() => onOpen(d.id)}
                className="cursor-pointer border-b border-[rgba(124,109,245,.12)] hover:bg-[#FBFAFF]"
              >
                <td className="max-w-[260px] py-3 pr-3 pl-6">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpen(d.id); }}
                    className="block max-w-full truncate text-left font-semibold hover:text-violet-deep"
                  >
                    {d.client}
                  </button>
                </td>
                <td className={CELL + " text-left"}>{labName(d.lab)}</td>
                <td className={CELL + " text-left"}>{d.leaderName}</td>
                <td className={CELL + " text-left"}>{fmtDate(lostOn)}</td>
                <td className={cn(CELL, "text-right font-semibold")}>{money(d.amount)}</td>
                <td className="min-w-[260px] max-w-[420px] py-3 pr-6 pl-3 text-left">
                  {d.lostReason
                    ? <span className="whitespace-pre-wrap">{d.lostReason}</span>
                    : <span className="text-ink-mute">No reason recorded</span>}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={6} className="px-6 py-10 text-center text-sm text-ink-mute">No deals were lost in this range.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
