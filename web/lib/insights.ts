/* Insights · the numbers.

   Everything the Insights page shows is derived here, from the rows
   GET /insights returns. No React, no fetching, and no value imports from the
   rest of the app — so `npm test` can run it directly under node.

   The design's prototype was written against a pipeline that had a
   Negotiating stage and stored each stage's entry date. The portal has
   neither: Negotiating is folded into Proposal & Negotiation (stored
   "Proposal Sent"), there is a Contracted stage (signed, payment pending), and
   "Closed" means paid. So here:

     won      = Contracted or Closed (the contract is signed)
     open     = Proposal Sent
     unpaid   = Proposal Sent or Contracted (Closed is paid, so it drops out)

   Stage-entry dates are only recorded from the day that shipped. Where a deal
   has no history we fall back to its last update, and the page says how many
   deals that applies to rather than presenting the figure as exact. */

import type { Stage } from "@/lib/types";

/* ---------- wire shapes (mirror backend/src/insights.mjs) ---------- */

export interface DealFinance {
  tcv: number;
  hard: number;
  sub: number;
  soft: number;
  payout: number;
  ol: number;
  /** Pool less what the named leaders are recorded as receiving. */
  unallocated: number;
  reconciles: boolean;
  /** "projected": no assignment filed, so costs are assumed to be zero. */
  source: "approved" | "filed" | "projected";
  /** Founder-run: no leader payout, the remainder after hard and contractor costs is OL's. */
  founderRun?: boolean;
}

export interface InsightsDeal {
  id: string;
  client: string;
  lab: string;
  stage: Stage;
  leader: string;
  leaderName: string;
  amount: number;
  created: string | null;
  updated: string | null;
  close: string | null;
  stageDates: Partial<Record<Stage, string>> | null;
  companyId: string | null;
  /** The company the deal bills to, when one is linked. */
  billing: string | null;
  hasAssignment: boolean;
  /** Why the deal was lost; null on a deal lost before reasons were required. */
  lostReason: string | null;
  finance: DealFinance;
}

export interface InsightsData {
  today: string;
  softPct: number;
  leaderPct: number;
  weights: { "Proposal Sent": number };
  updatedBy: string | null;
  updatedAt: string | null;
  labs: { id: string; name: string }[];
  deals: InsightsDeal[];
}

/* ---------- stages ---------- */

export const FUNNEL_STAGES: Stage[] = ["Lead", "Discovery", "Proposal Sent", "Contracted", "Closed"];
export const OPEN_STAGES: Stage[] = ["Proposal Sent"];
export const WON_STAGES: Stage[] = ["Contracted", "Closed"];
export const FILTER_STAGES: Stage[] = [...FUNNEL_STAGES, "Closed Lost"];
export const AGING_DAYS = 30;

export const isWon = (d: { stage: Stage }) => WON_STAGES.includes(d.stage);
export const isLost = (d: { stage: Stage }) => d.stage === "Closed Lost";

/* ---------- dates ---------- */

const DAY = 864e5;
export const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (i: number) => MONTHS[i];
export const fmtDate = (iso: string, year = true): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${year ? `, ${y}` : ""}`;
};

/* ---------- per-deal dates, with the fallbacks ---------- */

const created = (d: InsightsDeal) => d.created ?? d.updated ?? "0000-01-01";

/** The day the deal entered its current stage: recorded if we have it,
 *  otherwise the last time anyone touched the deal. */
export function stageSince(d: InsightsDeal): string {
  return d.stageDates?.[d.stage] ?? d.updated ?? created(d);
}

export function hasHistory(d: InsightsDeal): boolean {
  return !!d.stageDates && Object.keys(d.stageDates).length > 0;
}

/** When a won deal became won (its contract was signed). A deal's `close` is
 *  the close date typed on the card; it is only trusted when it is not in the
 *  future, since on an open deal it is a forecast. */
export function wonDate(d: InsightsDeal, today: string): string | null {
  if (!isWon(d)) return null;
  const dates = WON_STAGES.map((s) => d.stageDates?.[s]).filter((x): x is string => !!x).sort();
  if (dates[0]) return dates[0];
  if (d.close && d.close <= today) return d.close;
  return d.updated ?? created(d);
}

export function lostDate(d: InsightsDeal): string | null {
  if (!isLost(d)) return null;
  return d.stageDates?.["Closed Lost"] ?? d.updated ?? created(d);
}

/** The stage a deal was in on the morning of `e` (exclusive end), or null if it
 *  did not exist yet or its history is unknowable. */
export function stageAt(d: InsightsDeal, e: string): Stage | null {
  if (!(created(d) < e)) return null;
  const lost = lostDate(d);
  if (lost && lost < e) return "Closed Lost";
  if (hasHistory(d)) {
    let at: Stage = "Lead";
    for (const s of FUNNEL_STAGES) {
      const when = d.stageDates?.[s];
      if (when && when < e) at = s;
    }
    return at;
  }
  // No history: the current stage is only known to hold after the last edit.
  return stageSince(d) < e && !isLost(d) ? d.stage : null;
}

/** Furthest funnel stage the deal ever reached, as an index into FUNNEL_STAGES. */
export function furthestIndex(d: InsightsDeal): number {
  let best = 0;
  for (const s of FUNNEL_STAGES) {
    if (d.stageDates?.[s]) best = Math.max(best, FUNNEL_STAGES.indexOf(s));
  }
  const cur = FUNNEL_STAGES.indexOf(d.stage);
  return cur > best ? cur : best;
}

/* ---------- filters and ranges ---------- */

export type RangeKey = "month" | "quarter" | "ytd" | "l12" | "custom";
export type Basis = "closed" | "created";
export type Status = "all" | "Open" | "Won" | "Lost";

export interface Filters {
  labs: string[];
  range: RangeKey;
  from: string;
  to: string;
  basis: Basis;
  stages: Stage[];
  leader: string;
  status: Status;
}

export const defaultFilters = (today: string): Filters => ({
  labs: [], range: "ytd", from: `${today.slice(0, 4)}-01-01`, to: today,
  basis: "closed", stages: [], leader: "all", status: "all",
});

export const RANGE_LABELS: Record<RangeKey, string> = {
  month: "This month", quarter: "This quarter", ytd: "Year to date", l12: "Last 12 months", custom: "Custom",
};

/** [start, end) — end is exclusive, so "today" is included by ending tomorrow. */
export function bounds(f: Filters, today: string): [string, string] {
  const tomorrow = addDays(today, 1);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (f.range) {
    case "month": {
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
      return [`${y}-${pad(m)}-01`, next];
    }
    case "quarter": {
      const q = Math.floor((m - 1) / 3) * 3 + 1;
      const next = q + 3 > 12 ? `${y + 1}-01-01` : `${y}-${pad(q + 3)}-01`;
      return [`${y}-${pad(q)}-01`, next];
    }
    case "l12":
      return [addDays(tomorrow, -365), tomorrow];
    case "custom":
      return f.from && f.to && f.from <= f.to ? [f.from, addDays(f.to, 1)] : [`${y}-01-01`, tomorrow];
    default:
      return [`${y}-01-01`, tomorrow];
  }
}

export function baseDeals(deals: InsightsDeal[], f: Filters): InsightsDeal[] {
  return deals.filter((d) => {
    if (f.labs.length && !f.labs.includes(d.lab)) return false;
    if (f.leader !== "all" && d.leader !== f.leader) return false;
    if (f.stages.length && !f.stages.includes(d.stage)) return false;
    if (f.status === "Won" && !isWon(d)) return false;
    if (f.status === "Lost" && !isLost(d)) return false;
    if (f.status === "Open" && (isWon(d) || isLost(d))) return false;
    return true;
  });
}

/* ---------- metrics ---------- */

export interface Totals {
  hard: number; sub: number; soft: number; payout: number; ol: number; unallocated: number;
}
export interface Metrics {
  won: InsightsDeal[];
  lostN: number;
  open: InsightsDeal[];
  wonN: number;
  wonV: number;
  openN: number;
  openV: number;
  weighted: number;
  winRate: number | null;
  avg: number | null;
  /** Median days from Proposal & Negotiation to signed; null with no history. */
  cycle: number | null;
  /** Of proposals sent in range, the share that reached Contracted. */
  proposalSigned: number | null;
  costs: Totals;
  ol: number;
  projectedN: number;
}

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length / 2;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[mid - 1] + s[mid]) / 2;
};

export interface MetricCtx { basis: Basis; today: string; weights: InsightsData["weights"] }

export function metrics(ds: InsightsDeal[], s: string, e: string, c: MetricCtx): Metrics {
  const inR = (x: string | null | undefined) => !!x && x >= s && x < e;
  const byCreated = c.basis === "created";
  const wd = (d: InsightsDeal) => (isWon(d) ? (byCreated ? created(d) : wonDate(d, c.today)) : null);
  const ld = (d: InsightsDeal) => (isLost(d) ? (byCreated ? created(d) : lostDate(d)) : null);
  const tomorrow = addDays(c.today, 1);
  const asOf = e < tomorrow ? e : tomorrow;

  const won = ds.filter((d) => inR(wd(d)));
  const lostN = ds.filter((d) => inR(ld(d))).length;
  const open = ds.filter((d) => {
    const at = stageAt(d, asOf);
    return !!at && OPEN_STAGES.includes(at);
  });
  const wonV = sum(won, (d) => d.finance.tcv);
  const cycle = median(
    won.flatMap((d) => {
      const sent = d.stageDates?.["Proposal Sent"];
      const done = wonDate(d, c.today);
      return sent && done ? [daysBetween(sent, done)] : [];
    }),
  );
  const sent = ds.filter((d) => inR(d.stageDates?.["Proposal Sent"]));
  const costs: Totals = {
    hard: sum(won, (d) => d.finance.hard),
    sub: sum(won, (d) => d.finance.sub),
    soft: sum(won, (d) => d.finance.soft),
    payout: sum(won, (d) => d.finance.payout),
    ol: sum(won, (d) => d.finance.ol),
    unallocated: sum(won, (d) => d.finance.unallocated),
  };
  const weightOf = (st: Stage | null) => (st === "Proposal Sent" ? c.weights["Proposal Sent"] : 0);
  return {
    won, lostN, open,
    wonN: won.length, wonV, openN: open.length,
    openV: sum(open, (d) => d.amount),
    weighted: sum(open, (d) => (d.amount * weightOf(stageAt(d, asOf))) / 100),
    winRate: won.length + lostN ? won.length / (won.length + lostN) : null,
    avg: won.length ? wonV / won.length : null,
    cycle,
    proposalSigned: sent.length ? sent.filter((d) => d.stageDates?.Contracted).length / sent.length : null,
    costs, ol: costs.ol,
    projectedN: won.filter((d) => d.finance.source === "projected").length,
  };
}

export interface FunnelRow {
  stage: Stage; n: number; value: number; aging: number; movedOn: number | null;
}
export function funnel(ds: InsightsDeal[], s: string, e: string, today: string): { rows: FunnelRow[]; lostN: number } {
  const cohort = ds.filter((d) => created(d) >= s && created(d) < e);
  const reach = FUNNEL_STAGES.map((_, i) => cohort.filter((d) => furthestIndex(d) >= i));
  const rows = FUNNEL_STAGES.map((stage, i) => ({
    stage,
    n: reach[i].length,
    value: sum(reach[i], (d) => d.amount),
    aging:
      stage === "Closed"
        ? 0
        : ds.filter((d) => d.stage === stage && daysBetween(stageSince(d), today) > AGING_DAYS).length,
    movedOn: i < FUNNEL_STAGES.length - 1 ? (reach[i].length ? reach[i + 1].length / reach[i].length : null) : null,
  }));
  return { rows, lostN: cohort.filter(isLost).length };
}

export interface MonthBar { key: string; label: string; title: string; total: number; perLab: Record<string, number> }
export function monthly(won: InsightsDeal[], f: Filters, s: string, e: string, today: string): MonthBar[] {
  const end = e < addDays(today, 1) ? e : addDays(today, 1);
  const byCreated = f.basis === "created";
  const keys: string[] = [];
  let [y, m] = s.split("-").map(Number);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    if (`${k}-01` >= end) break;
    keys.push(k);
    if (++m > 12) { m = 1; y++; }
  }
  return keys.map((k, i) => {
    const [ky, km] = k.split("-").map(Number);
    const inMonth = won.filter((d) => (byCreated ? created(d) : wonDate(d, today)!).slice(0, 7) === k);
    const perLab: Record<string, number> = {};
    for (const d of inMonth) perLab[d.lab] = (perLab[d.lab] ?? 0) + d.finance.tcv;
    const total = sum(Object.values(perLab), (v) => v);
    return {
      key: k, total, perLab,
      label: MONTHS[km - 1] + (km === 1 || i === 0 ? ` '${String(ky).slice(2)}` : ""),
      title: `${MONTHS[km - 1]} ${ky}`,
    };
  });
}

/** A round axis ceiling at or above v. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/* ---------- the two tables ---------- */

export interface UnpaidRow {
  deal: InsightsDeal;
  waiting: number;
  aging: boolean;
  /** Won (Contracted) deals only: no assignment, or recorded payouts differ from the pool. */
  unreconciled: boolean;
  reason: "no-assignment" | "unallocated" | null;
}

export function unpaidRows(ds: InsightsDeal[], today: string): UnpaidRow[] {
  return ds
    .filter((d) => d.stage === "Proposal Sent" || d.stage === "Contracted")
    .map((deal) => {
      const waiting = daysBetween(stageSince(deal), today);
      const signed = deal.stage === "Contracted";
      const reason = !signed ? null : !deal.hasAssignment ? "no-assignment" : !deal.finance.reconciles ? "unallocated" : null;
      return { deal, waiting, aging: waiting > AGING_DAYS, unreconciled: reason !== null, reason };
    });
}

export interface LostRow { deal: InsightsDeal; lostOn: string }

/** Deals lost in [s, e), newest first. Dated by when they were lost, or by
 *  creation under the "created" basis, matching how metrics() counts losses. */
export function lostRows(ds: InsightsDeal[], s: string, e: string, basis: Basis): LostRow[] {
  return ds
    .filter(isLost)
    .map((deal) => ({ deal, lostOn: lostDate(deal)!, on: basis === "created" ? created(deal) : lostDate(deal)! }))
    .filter((r) => r.on >= s && r.on < e)
    .map(({ deal, lostOn }) => ({ deal, lostOn }))
    .sort((a, b) => b.lostOn.localeCompare(a.lostOn));
}

export interface LabRow {
  lab: string; name: string; openV: number; wonN: number; wonV: number; winRate: number | null;
  avg: number | null; cycle: number | null;
  hard: number | null; sub: number | null; soft: number | null; payout: number | null; ol: number;
}
export function labRows(
  ds: InsightsDeal[], labs: { id: string; name: string }[], s: string, e: string, c: MetricCtx,
): LabRow[] {
  return labs.map((l) => {
    const m = metrics(ds.filter((d) => d.lab === l.id), s, e, c);
    const share = (v: number) => (m.wonV ? v / m.wonV : null);
    return {
      lab: l.id, name: l.name, openV: m.openV, wonN: m.wonN, wonV: m.wonV, winRate: m.winRate,
      avg: m.avg, cycle: m.cycle,
      hard: share(m.costs.hard), sub: share(m.costs.sub), soft: share(m.costs.soft),
      payout: share(m.costs.payout), ol: m.ol,
    };
  });
}

export function sortRows<T>(rows: T[], key: keyof T, dir: 1 | -1): T[] {
  return [...rows].sort((a, b) => {
    const x = a[key] as unknown;
    const y = b[key] as unknown;
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * dir;
  });
}

/* ---------- formatting ---------- */

export const money = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);
export function compact(v: number | null | undefined): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, "")}K`;
  return `$${Math.round(v)}`;
}
export const pct = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

export interface Delta { text: string; tone: "up" | "down" | "none" }
export function delta(now: number | null, prev: number | null, mode: "pct" | "pts" = "pct"): Delta {
  if (now == null || prev == null) return { text: "No prior-period data", tone: "none" };
  if (mode === "pts") {
    const dd = (now - prev) * 100;
    return { text: `${dd >= 0 ? "+" : "−"}${Math.abs(dd).toFixed(0)} pts vs. prior period`, tone: dd >= 0 ? "up" : "down" };
  }
  if (!prev) return { text: now ? "New vs. prior period" : "Flat vs. prior period", tone: "none" };
  const dd = (now - prev) / prev;
  return { text: `${dd >= 0 ? "▲" : "▼"} ${Math.abs(dd * 100).toFixed(0)}% vs. prior period`, tone: dd >= 0 ? "up" : "down" };
}

/* ---------- lab colors ---------- */

const LAB_COLORS: Record<string, string> = {
  faith: "#3D2FD4", policy: "#7C6DF5", philanthropy: "#B0A6FA", sports: "#111111", impact: "#8C8478", "customer success": "#D6CFC4",
};
const FALLBACK = ["#3D2FD4", "#7C6DF5", "#B0A6FA", "#111111", "#8C8478", "#D6CFC4", "#5E574F", "#A39B90"];
export function labColor(name: string, index: number): string {
  const key = Object.keys(LAB_COLORS).find((k) => name.toLowerCase().includes(k));
  return key ? LAB_COLORS[key] : FALLBACK[index % FALLBACK.length];
}

/* ---------- URL hash ---------- */

export function filtersToHash(f: Filters, def: Filters): string {
  const p = new URLSearchParams();
  if (f.labs.length) p.set("labs", f.labs.join("|"));
  if (f.stages.length) p.set("stages", f.stages.join("|"));
  (["range", "basis", "leader", "status"] as const).forEach((k) => { if (f[k] !== def[k]) p.set(k, f[k]); });
  if (f.range === "custom") { p.set("from", f.from); p.set("to", f.to); }
  return p.toString();
}

export function filtersFromHash(hash: string, def: Filters, labIds: string[]): Filters {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const f: Filters = { ...def };
  const labs = p.get("labs");
  if (labs) f.labs = labs.split("|").filter((l) => labIds.includes(l));
  const stages = p.get("stages");
  if (stages) f.stages = stages.split("|").filter((s): s is Stage => (FILTER_STAGES as string[]).includes(s));
  const range = p.get("range");
  if (range && range in RANGE_LABELS) f.range = range as RangeKey;
  const basis = p.get("basis");
  if (basis === "closed" || basis === "created") f.basis = basis;
  const status = p.get("status");
  if (status === "all" || status === "Open" || status === "Won" || status === "Lost") f.status = status;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = p.get("from"), to = p.get("to");
  if (from && iso.test(from)) f.from = from;
  if (to && iso.test(to)) f.to = to;
  if (p.get("leader")) f.leader = p.get("leader")!;
  return f;
}

export const isDefault = (f: Filters, def: Filters) => filtersToHash(f, def) === "";

/* ---------- CSV ---------- */

const csvCell = (v: unknown) => {
  const t = String(v ?? "");
  // A cell that opens with = + - @ is read as a formula by a spreadsheet, and
  // a deal title is typed by a person — quote it as text instead.
  const safe = /^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t) ? `'${t}` : t;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCsv = (lines: unknown[][]) => lines.map((l) => l.map(csvCell).join(",")).join("\n");

const r2 = (v: number | null | undefined) => (v == null ? "" : (Math.round(v * 100) / 100).toFixed(2));
const p1 = (v: number | null | undefined) => (v == null ? "" : `${(v * 100).toFixed(1)}%`);

export function dealsCsv(args: {
  generated: string; scope: string; range: string; m: Metrics; rows: UnpaidRow[]; labName: (id: string) => string;
  stageName: (s: string) => string;
}): string {
  const { generated, scope, range, m, rows } = args;
  return toCsv([
    ["Summary"], ["Generated", generated], ["Scope", scope], ["Date range", range],
    ["Open pipeline", r2(m.openV)], ["Weighted pipeline", r2(m.weighted)], ["Won TCV", r2(m.wonV)],
    ["Won deals", m.wonN], ["Win rate", p1(m.winRate)], ["Average deal size", r2(m.avg)], ["OL share", r2(m.ol)], [],
    ["Deal", "Billing entity", "Lab", "Lab leader", "Stage", "Days in stage", "Value", "Hard costs",
      "Subcontractor costs", "Soft costs", "Lab leader payout", "OL share", "Unallocated", "Figures"],
    ...rows.map(({ deal: d, waiting }) => {
      const costed = d.stage === "Contracted";
      return [
        d.client, d.billing ?? "", args.labName(d.lab), d.leaderName, args.stageName(d.stage), waiting, r2(d.amount),
        costed ? r2(d.finance.hard) : "", costed ? r2(d.finance.sub) : "", costed ? r2(d.finance.soft) : "",
        costed ? r2(d.finance.payout) : "", costed ? r2(d.finance.ol) : "", costed ? r2(d.finance.unallocated) : "",
        costed ? d.finance.source : "",
      ];
    }),
  ]);
}

export function labsCsv(args: { generated: string; range: string; rows: LabRow[]; total: Metrics }): string {
  const { rows, total } = args;
  return toCsv([
    ["Lab comparison"], ["Generated", args.generated], ["Date range", args.range], [],
    ["Lab", "Open pipeline", "Won #", "Won $", "Win rate", "Avg deal size", "Sales cycle (days)",
      "Hard % of TCV", "Subs % of TCV", "Soft % of TCV", "Payouts % of TCV", "OL share"],
    ...rows.map((r) => [r.name, r2(r.openV), r.wonN, r2(r.wonV), p1(r.winRate), r2(r.avg),
      r.cycle == null ? "" : Math.round(r.cycle), p1(r.hard), p1(r.sub), p1(r.soft), p1(r.payout), r2(r.ol)]),
    ["All labs", r2(total.openV), total.wonN, r2(total.wonV), p1(total.winRate), r2(total.avg),
      total.cycle == null ? "" : Math.round(total.cycle),
      p1(total.wonV ? total.costs.hard / total.wonV : null), p1(total.wonV ? total.costs.sub / total.wonV : null),
      p1(total.wonV ? total.costs.soft / total.wonV : null), p1(total.wonV ? total.costs.payout / total.wonV : null),
      r2(total.ol)],
  ]);
}
