"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { fmtDollars, fullName } from "@/lib/data";
import {
  ASSIGNMENT_APPROVER, CADENCES, POOL_PCT, SOFT_RESERVE_PCT,
  assignmentMath, assignmentState, initialsOf, splitEvenly,
} from "@/lib/pipeline";
import { usePortalData } from "@/lib/portal-data";
import { cn } from "@/lib/utils";
import type { Deal } from "@/lib/types";

const APPROVER_EMAIL = "liz@optimisticlabs.com";
const digits = (v: string) => v.replace(/\D/g, "");
const today = () => new Date().toISOString().slice(0, 10);

/* Pipeline v3 (design handoff), the deal drawer's third tab: the Lab Leader
   Assignment. Three faces, in the order a deal meets them —

   locked    the deal is not Closed Won, so there is nothing to fill in. A lost
             deal stays here forever, which is the point of the lost stage.
   form      won, nothing filed. Prefilled from the deal, then leaders, shares,
             costs and cadence, with the pool moving live underneath.
   receipt   filed. Amber while it waits on the approver, green once approved.

   The money shown here is recomputed by the server on every write; the local
   arithmetic exists so the preview moves while somebody types. */
export function AssignmentTab({
  deal,
  editable,
  onSaved,
}: {
  deal: Deal;
  editable: boolean;
  onSaved: (deal: Deal) => void;
}) {
  const { people, companies, contacts, me } = usePortalData();
  const state = assignmentState(deal);
  const filed = deal.assignment;

  const leaderOptions = useMemo(
    () =>
      Object.entries(people)
        .filter(([, p]) => p.role === "Admin" || p.role === "Lab Leader")
        .map(([key, p]) => ({ key, name: fullName(p) || key }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [people]
  );
  const nameOf = (key: string) => fullName(people[key]) || key;

  const billedTo =
    (deal.companyId ? companies.find((c) => c.id === deal.companyId)?.name : undefined) ??
    (deal.contactId ? contacts.find((c) => c.id === deal.contactId)?.name : undefined) ??
    deal.client;

  /* Seeded from the deal, then from a v2 Assignment Notice if the deal carried
     one — those leaders and costs were somebody's work even though the record
     was never filed in the v3 sense. */
  const legacy = deal.assignmentNotice;
  const [agreementRef, setAgreementRef] = useState(filed?.agreementRef ?? `${deal.client} — signed agreement`);
  const [clientName, setClientName] = useState(filed?.clientName ?? billedTo);
  const [contractValue, setContractValue] = useState(String(filed?.contractValue ?? deal.amount ?? 0));
  const [issued, setIssued] = useState(filed?.issued ?? today());
  const [selected, setSelected] = useState<string[]>(
    filed?.leaders.map((l) => l.key) ??
      legacy?.labLeaders.map((l) => l.key) ?? [deal.dealOwner || deal.owner].filter(Boolean)
  );
  const [shares, setShares] = useState<Record<string, number>>(() => {
    const from = filed?.leaders ?? legacy?.labLeaders.map((l) => ({ key: l.key, pct: l.feeSharePct }));
    if (from?.length) return Object.fromEntries(from.map((l) => [l.key, l.pct]));
    const owner = deal.dealOwner || deal.owner;
    return owner ? { [owner]: 100 } : {};
  });
  const [hardCosts, setHardCosts] = useState(String(filed?.hardCosts ?? legacy?.hardCosts ?? 0));
  const [subCosts, setSubCosts] = useState(String(filed?.subcontractorCosts ?? legacy?.subcontractorCosts ?? 0));
  const [cadence, setCadence] = useState<string>(filed?.cadence ?? (deal.recurring ? "Monthly" : "On signature"));
  const [notes, setNotes] = useState(filed?.notes ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /* "Edit" reopens the form over a filing that is still on the server; only a
     re-file replaces it. Local, so nothing pretends the record went away. */
  const [editing, setEditing] = useState(false);

  const value = Number(digits(contractValue)) || 0;
  const hard = Number(digits(hardCosts)) || 0;
  const sub = Number(digits(subCosts)) || 0;
  const leaders = selected.map((key) => ({ key, pct: shares[key] ?? 0 }));
  const shareTotal = leaders.reduce((sum, l) => sum + l.pct, 0);
  const math = assignmentMath({ contractValue: value, hardCosts: hard, subcontractorCosts: sub, leaders });

  const ready =
    !!selected.length && Math.abs(shareTotal - 100) < 0.01 &&
    !!agreementRef.trim() && !!clientName.trim() && value > 0;

  const isApprover = me === ASSIGNMENT_APPROVER;

  function toggleLeader(key: string) {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    setSelected(next);
    // Re-splitting on every change keeps the total at 100 without anyone doing
    // arithmetic; whoever wants a different split types over it afterwards.
    setShares(splitEvenly(next));
  }

  async function post(path: string, body?: unknown, done?: string) {
    setBusy(true);
    try {
      const saved = await api<Deal>(path, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      onSaved(saved);
      setEditing(false);
      if (done) toast.success(done);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save this assignment.");
    } finally {
      setBusy(false);
    }
  }

  const file = () =>
    ready &&
    post(
      `/deals/${deal.id}/assignment`,
      {
        agreementRef: agreementRef.trim(),
        clientName: clientName.trim(),
        contractValue: value,
        issued,
        cadence,
        hardCosts: hard,
        subcontractorCosts: sub,
        leaders,
        notes: notes.trim(),
      },
      `Assignment filed — approval email sent to ${APPROVER_EMAIL}`
    );

  /* ---------- 1. locked ---------- */
  if (state === "locked") {
    return (
      <div className="rounded-2xl border border-dashed border-hair-strong px-5 py-8 text-center">
        <p className="text-sm font-semibold text-ink">Not needed yet</p>
        <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] leading-relaxed text-ink-mute">
          {deal.stage === "Closed Lost"
            ? "A lost deal is never assigned — there is no engagement to deliver and no pool to split."
            : "The Lab Leader Assignment form opens once this deal is Closed Won with a signed contract on file."}
        </p>
      </div>
    );
  }

  /* ---------- 3. filed / approved receipt ---------- */
  if (filed && !editing) {
    const approved = filed.approved;
    const receipt: [string, string][] = [
      ["Agreement", filed.agreementRef],
      ["Client", filed.clientName],
      ["Leaders", filed.leaders.map((l) => `${nameOf(l.key)} — ${l.pct}%`).join(", ")],
      ["Contract value", fmtDollars(filed.contractValue)],
      ["Costs", `${fmtDollars(filed.hardCosts)} hard · ${fmtDollars(filed.subcontractorCosts)} sub · ${fmtDollars(filed.softReserve)} soft`],
      [`Pool · ${filed.poolPct ?? POOL_PCT}%`, fmtDollars(filed.pool)],
      ["Cadence", filed.cadence],
    ];
    return (
      <div className="flex flex-col gap-4">
        <div className={cn("rounded-2xl border p-4", approved ? "border-green/30 bg-green-pale/50" : "border-amber/30 bg-amber-pale")}>
          <div className="mb-1.5 flex items-center gap-2">
            <span className={cn("text-[11px] font-semibold tracking-wide uppercase", approved ? "text-green" : "text-amber")}>
              {approved ? "Approved" : "Filed"}
            </span>
            <span className="rounded-full border border-hair bg-white px-2.5 py-0.5 text-[11px] font-semibold text-ink-mute">
              {approved ? "Approved" : "Awaiting approval"}
            </span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-ink-mute">
            {approved
              ? `Approved by ${nameOf(filed.approvedBy ?? ASSIGNMENT_APPROVER)} on ${(filed.approvedAt ?? "").slice(0, 10)}. Finance can release payment against these figures.`
              : `Filed ${(filed.filedAt ?? "").slice(0, 10)} by ${nameOf(filed.filedBy)} · waiting on approval.`}
          </p>

          <div className="flex flex-col gap-px overflow-hidden rounded-xl border border-hair bg-hair-soft">
            {receipt.map(([k, v]) => (
              <div key={k} className="flex gap-3 bg-white px-3 py-2">
                <span className="w-[132px] shrink-0 text-[10px] font-semibold tracking-wide text-warm-gray uppercase">{k}</span>
                <span className="min-w-0 flex-1 text-[13px] font-medium text-ink">{v}</span>
              </div>
            ))}
          </div>

          {!approved && (
            <p className="mt-3 rounded-xl border border-hair bg-white px-3 py-2 text-[11px] leading-relaxed text-ink-mute">
              Email sent to {APPROVER_EMAIL} — &ldquo;Assignment filed for {deal.client} · needs your approval.&rdquo;
            </p>
          )}

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {!approved && isApprover && (
              <Button
                size="sm"
                className="rounded-full bg-green text-white hover:bg-green/90"
                disabled={busy}
                onClick={() => post(`/deals/${deal.id}/assignment/approve`, undefined, "Assignment approved — finance notified by email")}
              >
                <Check size={14} /> Approve assignment
              </Button>
            )}
            {approved
              ? isApprover && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={busy}
                    onClick={() => post(`/deals/${deal.id}/assignment/reopen`, undefined, "Assignment reopened for edits")}
                  >
                    Reopen and edit
                  </Button>
                )
              : editable && (
                  <Button variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={() => setEditing(true)}>
                    Edit the assignment
                  </Button>
                )}
          </div>

          {approved && !isApprover && (
            <p className="mt-2.5 text-[11px] text-ink-mute">
              Approved figures are locked. Ask {nameOf(ASSIGNMENT_APPROVER)} to reopen it if something needs to change.
            </p>
          )}
        </div>
      </div>
    );
  }

  /* ---------- 2. the form ---------- */
  const panel = "rounded-2xl border border-hair bg-warm-panel p-4";
  const panelLabel = "text-[11px] font-semibold tracking-wide text-warm-gray uppercase";
  const chip = "rounded-full px-2.5 py-0.5 text-[11px] font-semibold";

  return (
    <div className="flex flex-col gap-4">
      {/* a) from the deal */}
      <div className={panel}>
        <div className="mb-1 flex items-center gap-2">
          <span className={panelLabel}>From the deal</span>
          <span className={cn(chip, "bg-violet-pale text-violet-deep")}>Prefilled</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-ink-mute">
          Pulled from this deal and its signed contract. Fix anything wrong on the Details tab instead of here.
        </p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pv3-agreement">Client agreement reference</Label>
            <Input id="pv3-agreement" value={agreementRef} onChange={(e) => setAgreementRef(e.target.value)} disabled={!editable} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pv3-client">Client name</Label>
            <Input id="pv3-client" value={clientName} onChange={(e) => setClientName(e.target.value)} disabled={!editable} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pv3-value">Contract value</Label>
              <Input
                id="pv3-value"
                inputMode="numeric"
                value={value ? value.toLocaleString("en-US") : ""}
                onChange={(e) => setContractValue(digits(e.target.value))}
                disabled={!editable}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pv3-issued">Date issued</Label>
              <Input id="pv3-issued" type="date" value={issued} onChange={(e) => setIssued(e.target.value)} disabled={!editable} />
            </div>
          </div>
        </div>
      </div>

      {/* b) leaders */}
      <div className={panel}>
        <div className="mb-1 flex items-center gap-2">
          <span className={panelLabel}>Lab leaders assigned</span>
          <span className={cn(chip, "bg-amber-pale text-amber")}>Needs you</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-ink-mute">
          {selected.length
            ? `${selected.length} ${selected.length === 1 ? "leader" : "leaders"} selected. The deal owner is suggested — add or remove anyone.`
            : "Pick everyone who will deliver this engagement."}
        </p>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={!editable}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-hair-strong bg-white px-3.5 py-2.5 text-left text-sm text-ink hover:border-violet-deep disabled:opacity-60"
            >
              <span className="truncate">
                {selected.length === 0
                  ? "Select lab leaders"
                  : selected.length === 1
                    ? nameOf(selected[0])
                    : `${selected.length} lab leaders selected`}
              </span>
              <ChevronDown size={15} className={cn("shrink-0 text-violet-deep transition-transform", pickerOpen && "rotate-180")} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1.5">
            <div className="flex max-h-[260px] flex-col overflow-y-auto">
              {leaderOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  role="checkbox"
                  aria-checked={selected.includes(o.key)}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-violet-pale/40"
                  onClick={() => toggleLeader(o.key)}
                >
                  {/* Decorative, not a control: the row itself is the button,
                      and a real checkbox here would nest one button inside
                      another — invalid HTML, and React says so at hydration. */}
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-[5px] border",
                      selected.includes(o.key) ? "border-violet-deep bg-violet-deep text-white" : "border-hair-strong bg-white"
                    )}
                  >
                    {selected.includes(o.key) && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-violet-pale text-[10px] font-semibold text-violet-deep">
                    {initialsOf(o.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{o.name}</span>
                  {o.key === (deal.dealOwner || deal.owner) && (
                    <span className="shrink-0 text-[10px] font-semibold tracking-wide text-warm-gray uppercase">Deal owner</span>
                  )}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {selected.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {selected.map((key) => (
              <span key={key} className="inline-flex items-center gap-1.5 rounded-full bg-violet-pale px-2.5 py-1 text-xs font-medium text-violet-deep">
                {nameOf(key)}
                {editable && (
                  <button type="button" aria-label={`Remove ${nameOf(key)}`} onClick={() => toggleLeader(key)} className="hover:opacity-60">
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* c) shares */}
      <div className={cn("rounded-2xl border p-4", selected.length && Math.abs(shareTotal - 100) > 0.01 ? "border-red/40 bg-warm-panel" : "border-hair bg-warm-panel")}>
        <div className="mb-2 flex items-center gap-2">
          <span className={panelLabel}>Shares of the pool</span>
          <span className={cn("text-xs font-medium", !selected.length ? "text-ink-mute" : Math.abs(shareTotal - 100) < 0.01 ? "text-green" : "text-red")}>
            {!selected.length ? "No leaders yet" : Math.abs(shareTotal - 100) < 0.01 ? "Totals 100%" : `${shareTotal}% allocated`}
          </span>
          <span className="flex-1" />
          {editable && selected.length > 0 && (
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setShares(splitEvenly(selected))}>
              Split evenly
            </Button>
          )}
        </div>
        {selected.length === 0 ? (
          <p className="text-xs text-ink-mute">Select leaders above and their shares appear here.</p>
        ) : (
          <div className="flex flex-col">
            {selected.map((key) => {
              const pct = shares[key] ?? 0;
              const payout = math.payouts.find((x) => x.key === key)?.payout ?? 0;
              return (
                <div key={key} className="flex items-center gap-3 border-t border-hair py-2.5 first:border-t-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink">{nameOf(key)}</span>
                    <span className="block text-xs text-ink-mute">{pct ? `${fmtDollars(payout)} at current estimates` : "No share set"}</span>
                  </span>
                  <span className="flex w-[92px] shrink-0 items-center gap-1">
                    <Input
                      aria-label={`${nameOf(key)} share`}
                      inputMode="numeric"
                      value={String(pct)}
                      onChange={(e) => setShares({ ...shares, [key]: Number(digits(e.target.value).slice(0, 3)) || 0 })}
                      disabled={!editable}
                      className="h-8 text-sm"
                    />
                    <span className="text-xs text-ink-mute">%</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* d) costs and cadence */}
      <div className={panel}>
        <div className="mb-1 flex items-center gap-2">
          <span className={panelLabel}>Costs and cadence</span>
          <span className={cn(chip, "bg-amber-pale text-amber")}>Needs you</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-ink-mute">
          Estimates are fine. The soft cost reserve is held automatically at {SOFT_RESERVE_PCT}% of contract value; finance confirms actuals at close-out.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pv3-hard">Hard costs</Label>
            <Input id="pv3-hard" inputMode="numeric" value={hard ? hard.toLocaleString("en-US") : "0"} onChange={(e) => setHardCosts(digits(e.target.value))} disabled={!editable} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pv3-sub">Subcontractors</Label>
            <Input id="pv3-sub" inputMode="numeric" value={sub ? sub.toLocaleString("en-US") : "0"} onChange={(e) => setSubCosts(digits(e.target.value))} disabled={!editable} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Soft cost reserve</Label>
            <div className="flex items-center gap-2 rounded-xl bg-violet-pale px-3 py-2.5">
              <span className="flex-1 text-sm font-semibold text-violet-deep">{fmtDollars(math.softReserve)}</span>
              <span className="text-[11px] font-medium text-violet">Auto · {SOFT_RESERVE_PCT}%</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pv3-cadence">Payment cadence</Label>
            <Select value={cadence} onValueChange={setCadence} disabled={!editable}>
              <SelectTrigger id="pv3-cadence"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CADENCES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <Label htmlFor="pv3-notes">Notes for finance (optional)</Label>
          <Textarea
            id="pv3-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={`Anything ${nameOf(ASSIGNMENT_APPROVER).split(" ")[0]} should know before the pool is calculated.`}
            disabled={!editable}
          />
        </div>
      </div>

      {/* pool preview */}
      <div className="rounded-2xl border border-hair bg-white p-4">
        {([
          ["Contract value", value ? fmtDollars(value) : "—", false],
          ["Hard costs", hard ? `– ${fmtDollars(hard)}` : "—", true],
          ["Subcontractor costs", sub ? `– ${fmtDollars(sub)}` : "—", true],
          ["Soft cost reserve", value ? `– ${fmtDollars(math.softReserve)}` : "—", true],
          ["Net after costs", value ? fmtDollars(math.net) : "—", false],
        ] as [string, string, boolean][]).map(([k, v, muted]) => (
          <div key={k} className="flex items-center justify-between gap-3 border-b border-hair py-2.5">
            <span className={cn("text-[13px]", muted ? "text-ink-soft" : "text-ink")}>{k}</span>
            <span className={cn("text-[13px] font-medium", muted ? "text-ink-soft" : "text-ink")}>{v}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 pt-2.5">
          <span className="text-[13px] font-semibold text-violet-deep">Lab leader pool · {POOL_PCT}%</span>
          <span className="text-lg font-semibold text-violet-deep">{value ? fmtDollars(math.pool) : "—"}</span>
        </div>
        {selected.length > 0 && (
          <div className="mt-2.5 border-t border-hair pt-2.5">
            <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-warm-gray uppercase">Lab leader breakdown</span>
            {math.payouts.map((p) => (
              <div key={p.key} className="flex items-center gap-3 py-1">
                <span className="w-[38px] shrink-0 font-serif text-[13px] text-violet italic">{p.pct}%</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{nameOf(p.key)}</span>
                <span className="shrink-0 text-[13px] font-semibold text-ink">{fmtDollars(p.payout)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {editable && (
        <div>
          {editing && (
            <Button variant="ghost" size="sm" className="mb-2 w-full" onClick={() => setEditing(false)}>
              Cancel and go back to the filed assignment
            </Button>
          )}
          <Button className="w-full rounded-full" disabled={!ready || busy} onClick={file}>
            {busy ? "Filing…" : !ready ? "Finish the required fields" : editing ? "Re-file the assignment" : "File the assignment"}
          </Button>
          <p className="mt-2 text-center text-[11px] text-ink-mute">
            Filing emails {nameOf(ASSIGNMENT_APPROVER)} for approval. You can edit it until it is approved.
          </p>
        </div>
      )}
    </div>
  );
}
