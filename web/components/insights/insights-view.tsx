"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { fullName } from "@/lib/data";
import { usePortalData } from "@/lib/portal-data";
import { stageLabel } from "@/lib/types";
import {
  addDays, baseDeals, bounds, dealsCsv, defaultFilters, filtersFromHash, filtersToHash, fmtDate, funnel,
  hasHistory, labColor, labRows, labsCsv, metrics, monthly, unpaidRows,
  type Filters, type InsightsData, type Metrics, type UnpaidRow,
} from "@/lib/insights";
import { FilterBar } from "./filter-bar";
import { FunnelPanel, KpiCards, MoneyPanel, WonChart, type MoneyRow } from "./panels";
import { DealsTable, ExportButton, LabTable } from "./tables";

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const EMPTY: Metrics = {
  won: [], lostN: 0, open: [], wonN: 0, wonV: 0, openN: 0, openV: 0, weighted: 0, winRate: null, avg: null,
  cycle: null, proposalSigned: null, ol: 0, projectedN: 0,
  costs: { hard: 0, sub: 0, soft: 0, payout: 0, ol: 0, unallocated: 0 },
};

export function InsightsView() {
  const router = useRouter();
  const { me, people } = usePortalData();
  const [data, setData] = useState<InsightsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [weight, setWeight] = useState(25);

  useEffect(() => {
    let live = true;
    api<InsightsData>("/insights")
      .then((d) => {
        if (!live) return;
        setData(d);
        setWeight(d.weights["Proposal Sent"]);
        const def = defaultFilters(d.today);
        setFilters(filtersFromHash(window.location.hash, def, d.labs.map((l) => l.id)));
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 403) { router.replace("/"); setError("forbidden"); }
        else setError("Couldn't load Insights. Try again in a moment.");
      });
    return () => { live = false; };
  }, [router]);

  const def = useMemo(() => (data ? defaultFilters(data.today) : null), [data]);

  // Filters live in the URL hash so a view can be shared; only non-defaults are written.
  useEffect(() => {
    if (!filters || !def) return;
    const h = filtersToHash(filters, def);
    if (h !== window.location.hash.slice(1)) {
      window.history.replaceState(null, "", h ? `#${h}` : window.location.pathname + window.location.search);
    }
  }, [filters, def]);

  const patch = useCallback((p: Partial<Filters>) => setFilters((f) => (f ? { ...f, ...p } : f)), []);

  const labs = useMemo(() => data?.labs ?? [], [data]);
  const colorOf = useCallback(
    (id: string) => labColor(labs.find((l) => l.id === id)?.name ?? "", Math.max(0, labs.findIndex((l) => l.id === id))),
    [labs],
  );
  const labName = useCallback((id: string) => labs.find((l) => l.id === id)?.name ?? id, [labs]);

  const view = useMemo(() => {
    if (!data || !filters) return null;
    const { today } = data;
    const [b0, b1] = bounds(filters, today);
    const span = Math.round((Date.parse(b1) - Date.parse(b0)) / 864e5);
    const p0 = addDays(b0, -span);
    const ctx = { basis: filters.basis, today, weights: { "Proposal Sent": weight } };
    const ds = baseDeals(data.deals, filters);
    const m = metrics(ds, b0, b1, ctx);
    const pm = metrics(ds, p0, b0, ctx);
    const visLabs = filters.labs.length ? labs.filter((l) => filters.labs.includes(l.id)) : labs;
    return {
      b0, b1, ds, m, pm, visLabs, ctx,
      rangeLabel: `${fmtDate(b0)} – ${fmtDate(addDays(b1, -1))}`,
      fun: funnel(ds, b0, b1, today),
      months: monthly(m.won, filters, b0, b1, today),
      labRows: labRows(ds, visLabs, b0, b1, ctx),
      unpaid: unpaidRows(ds, today),
      noHistory: ds.filter((d) => !hasHistory(d)).length,
    };
  }, [data, filters, labs, weight]);

  const leaders = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of data?.deals ?? []) if (d.leader) seen.set(d.leader, d.leaderName);
    return [...seen].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const saveWeight = useCallback(async (v: number) => {
    try {
      await api("/insights/weights", { method: "PATCH", body: JSON.stringify({ weights: { "Proposal Sent": v } }) });
      setWeight(v);
      toast.success("Weighting saved for every Admin.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the weighting.");
      throw e;
    }
  }, []);

  /* The export is logged first and handed over second: if the audit write
     fails there is no file, because a finance export nobody can account for
     is worse than one that has to be retried. */
  const logAndExport = async (kind: "deals" | "labs", rows: number, scope: string, range: string, name: string, csv: string) => {
    try {
      await api("/insights/exports", { method: "POST", body: JSON.stringify({ kind, rows, scope, range }) });
    } catch {
      toast.error("Couldn't log this export, so it wasn't downloaded. Try again.");
      return;
    }
    download(`${name}-${data!.today}.csv`, csv);
    const who = me ? fullName(people[me]) || me : "you";
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    toast(`Exported ${rows} ${kind === "deals" ? "deals" : "labs"}. Logged as ${who}, ${time}.`);
  };

  if (error === "forbidden") return null; // the page is already redirecting non-Admins
  if (error) return <p className="text-sm text-[#8A3B12]">{error}</p>;

  const isLabView = !!filters && filters.labs.length === 1;
  const scopeTitle = !filters ? "All labs" : isLabView ? labName(filters.labs[0]) : filters.labs.length ? `${filters.labs.length} labs` : "All labs";
  const suffix = isLabView ? ` for ${scopeTitle}` : "";
  const m = view?.m ?? EMPTY;
  const stamp = () => `${new Date().toLocaleString()} by ${me ? fullName(people[me]) || me : "Admin"}`;

  const exportDeals = (rows: UnpaidRow[]) =>
    view && logAndExport("deals", rows.length, scopeTitle, view.rangeLabel, "ol-insights-deals",
      dealsCsv({ generated: stamp(), scope: scopeTitle, range: view.rangeLabel, m: view.m, rows, labName, stageName: stageLabel }));
  const exportLabs = () =>
    view && logAndExport("labs", view.labRows.length, scopeTitle, view.rangeLabel, "ol-insights-labs",
      labsCsv({ generated: stamp(), range: view.rangeLabel, rows: view.labRows, total: view.m }));

  const moneyRows: MoneyRow[] = view
    ? isLabView
      ? [{ label: scopeTitle, m: view.m, strong: true }]
      : [
          { label: scopeTitle, m: view.m, strong: true },
          ...view.visLabs
            .map((l) => ({ label: l.name, m: metrics(view.ds.filter((d) => d.lab === l.id), view.b0, view.b1, view.ctx) }))
            .filter((r) => r.m.wonV > 0),
        ]
    : [];
  const moneyNote = view?.m.projectedN
    ? `${view.m.projectedN} won deal${view.m.projectedN === 1 ? " has" : "s have"} no assignment filed yet, so ${view.m.projectedN === 1 ? "its" : "their"} figures are projected with $0 hard and subcontractor costs.`
    : "";

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="mb-2.5 font-serif text-[32px] leading-[1.06] font-normal tracking-[-0.015em] text-ink italic md:text-[40px]">Insights</h1>
          <p className="max-w-[680px] text-[17px] leading-[1.6] text-ink-soft">
            How each lab is doing and where contract value goes. Read-only, built from deals, proposals, contracts and assignments.
          </p>
        </div>
        <ExportButton onClick={() => view && exportDeals(view.unpaid)} />
      </div>

      {filters && def && (
        <FilterBar filters={filters} defaults={def} onChange={patch} labs={labs} leaders={leaders} labColor={colorOf} />
      )}

      <div className="flex items-baseline gap-3.5">
        <h2 className="text-[22px] font-bold tracking-[-.01em]">{scopeTitle}</h2>
        {view && <span className="text-sm text-ink-mute">{view.rangeLabel}</span>}
        {isLabView && (
          <button type="button" onClick={() => patch({ labs: [] })} className="ml-auto text-sm font-semibold text-violet-deep">← All labs</button>
        )}
      </div>
      {view && view.noHistory > 0 && (
        <p className="-mt-3 text-xs text-ink-mute">
          {view.noHistory} deal{view.noHistory === 1 ? " has" : "s have"} no stage history yet (it&rsquo;s recorded from now on), so dates and
          days waiting for {view.noHistory === 1 ? "it use" : "them use"} the last update.
        </p>
      )}

      <KpiCards m={m} p={view?.pm ?? EMPTY} loading={!view} />

      {view && (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <FunnelPanel rows={view.fun.rows} lostN={view.fun.lostN} scopeSuffix={suffix} weight={weight} onWeight={saveWeight} />
            <WonChart
              months={view.months} scopeSuffix={suffix}
              labs={view.visLabs.map((l) => ({ id: l.id, name: l.name, color: colorOf(l.id) }))}
            />
          </div>
          <MoneyPanel
            rows={moneyRows} total={view.m} softPct={data!.softPct} leaderPct={data!.leaderPct}
            note={moneyNote} scopeSuffix={suffix}
          />
          {!isLabView && (
            <LabTable rows={view.labRows} total={view.m} color={colorOf} onOpen={(id) => patch({ labs: [id] })} onExport={exportLabs} />
          )}
          <DealsTable rows={view.unpaid} labName={labName} onOpen={(id) => router.push(`/pipeline?deal=${encodeURIComponent(id)}`)} onExport={exportDeals} />
        </>
      )}
    </div>
  );
}
