"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, Calendar, GripVertical, Repeat } from "lucide-react";
import { fmtDollars, fullName } from "@/lib/data";
import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/can";
import { cn } from "@/lib/utils";
import { usePortalData } from "@/lib/portal-data";
import { billingOf, billingRequiredAt, cadenceOf, proposalRequiredAt } from "@/lib/pipeline";
import { STAGES } from "@/lib/types";
import type { Deal, Stage } from "@/lib/types";
import { DealDrawer } from "@/components/pipeline/deal-drawer";
import { RecordDrawer } from "@/components/pipeline/record-drawer";
import { ContactsTable } from "@/components/pipeline/contacts-table";
import { ProposalsGrid } from "@/components/pipeline/proposals-grid";

type ViewKey = "board" | "companies" | "people" | "proposals";
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "board", label: "Board" },
  { key: "companies", label: "Companies" },
  { key: "people", label: "People" },
  { key: "proposals", label: "Proposals" },
];

function fmtClose(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function PipelinePage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-mute">Loading…</p>}>
      <PipelineBoard />
    </Suspense>
  );
}

function PipelineBoard() {
  const { loading, error, deals, labs, people, companies, contacts, proposals, role, me, myLabs, setDeals } =
    usePortalData();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const viewParam = searchParams.get("view");
  const view: ViewKey = VIEWS.some((v) => v.key === viewParam) ? (viewParam as ViewKey) : "board";
  const [search, setSearch] = useState("");
  const [labFilter, setLabFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [draggingDeal, setDraggingDeal] = useState<Deal | null>(null);
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null);

  const [dealDrawer, setDealDrawer] = useState<{ deal: Deal | "new"; pendingStage?: Stage } | null>(null);
  const [recordDrawer, setRecordDrawer] = useState<{ type: "company" | "contact"; id: string; returnDealId: string | null } | null>(null);

  const viewingId = searchParams.get("deal");
  const viewingDeal = useMemo(() => (viewingId ? (deals.find((d) => d.id === viewingId) ?? null) : null), [viewingId, deals]);
  const activeDrawer = dealDrawer ?? (viewingDeal ? { deal: viewingDeal } : null);

  function setView(v: ViewKey) {
    const qp = new URLSearchParams(searchParams.toString());
    if (v === "board") qp.delete("view");
    else qp.set("view", v);
    const qs = qp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function openDeal(deal: Deal | "new", pendingStage?: Stage) {
    setDealDrawer({ deal, pendingStage });
    // Only sync the URL for a plain open (a real deal, not mid drag-gate
    // correction) — a pendingStage override is transient and shouldn't be
    // shareable as a stale link.
    if (deal !== "new" && !pendingStage) {
      const qp = new URLSearchParams(searchParams.toString());
      qp.set("deal", deal.id);
      router.push(`${pathname}?${qp.toString()}`, { scroll: false });
    }
  }
  function closeDealDrawer() {
    setDealDrawer(null);
    if (searchParams.get("deal")) {
      const qp = new URLSearchParams(searchParams.toString());
      qp.delete("deal");
      const qs = qp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }

  const companyMap = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c])), [companies]);
  const contactMap = useMemo(() => Object.fromEntries(contacts.map((c) => [c.id, c])), [contacts]);
  const latestProposalFor = useMemo(() => {
    const map = new Map<string, (typeof proposals)[number]>();
    for (const p of proposals) {
      if (!p.deal) continue;
      const cur = map.get(p.deal);
      if (!cur || (p.updated ?? "") > (cur.updated ?? "")) map.set(p.deal, p);
    }
    return map;
  }, [proposals]);

  const leaders = useMemo(
    () => Object.entries(people).filter(([, p]) => p.role === "Admin" || p.role === "Lab Leader").map(([username, p]) => ({ username, name: fullName(p) || username })),
    [people]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deals.filter((d) => {
      if (labFilter !== "all" && d.lab !== labFilter) return false;
      if (ownerFilter !== "all" && d.owner !== ownerFilter) return false;
      if (onlyUnlinked && (d.companyId || d.contactId || !billingRequiredAt(d.stage))) return false;
      if (!q) return true;
      const bill = billingOf(d, companyMap, contactMap);
      return `${d.client} ${bill.name} ${d.owner}`.toLowerCase().includes(q);
    });
  }, [deals, labFilter, ownerFilter, onlyUnlinked, search, companyMap, contactMap]);

  const nUnlinked = useMemo(
    () => deals.filter((d) => !d.companyId && !d.contactId && billingRequiredAt(d.stage)).length,
    [deals]
  );
  const proposalDealCount = useMemo(() => new Set(proposals.map((p) => p.deal).filter(Boolean)).size, [proposals]);

  const labName = (id: string) => labs.find((l) => l.id === id)?.name ?? id;
  const reduceMotion = useReducedMotion();
  const cardMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, scale: 0.96 }, transition: { duration: 0.15 } };

  async function handleDrop(deal: Deal, targetStage: Stage) {
    if (deal.stage === targetStage) return;
    if (!can.editDeal(deal, role!, myLabs, me)) {
      toast.error("You don't have permission to move this deal.");
      return;
    }
    if (billingRequiredAt(targetStage) && !deal.companyId && !deal.contactId) {
      toast.info(`${targetStage} needs a billing entity — opening ${deal.client}`);
      openDeal(deal, targetStage);
      return;
    }
    if (proposalRequiredAt(targetStage)) {
      const proposal = latestProposalFor.get(deal.id);
      if (!proposal?.sentAt) {
        toast.info(proposal ? `${targetStage} needs the proposal marked final and sent` : `${targetStage} needs a sent proposal — start one first`);
        openDeal(deal, targetStage);
        return;
      }
    }
    if (targetStage === "Closed") {
      toast.info("Closing a deal needs an outcome, a signed contract, and an Assignment Notice.");
      openDeal(deal, "Closed");
      return;
    }

    const previous = deal.stage;
    setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, stage: targetStage } : d)));
    try {
      const saved = await api<Deal>(`/deals/${deal.id}`, { method: "PATCH", body: JSON.stringify({ stage: targetStage }) });
      setDeals((prev) => prev.map((d) => (d.id === saved.id ? saved : d)));
      toast.success(`${deal.client} moved to ${targetStage}`);
    } catch (err) {
      setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, stage: previous } : d)));
      toast.error(err instanceof ApiError ? err.message : "Could not move this deal.");
    }
  }

  if (loading) return <p className="text-sm text-ink-mute">Loading…</p>;
  if (error) return <p className="text-sm text-red">{error}</p>;

  const blurb =
    view === "companies"
      ? "Organizations that can be invoiced, with what each is worth across the pipeline. Open one to see its deals and primary contact."
      : view === "people"
        ? "Individuals across the pipeline — some belong to a company, some are billed directly. Open one to see their deals."
        : view === "proposals"
          ? "Every proposal in flight, drafted or sent. Open one to send the current version or start a revision."
          : "Deals by stage, across labs. Drag a card to move it forward; a deal needs a billing entity before it reaches Proposal Sent.";

  const searchPlaceholder =
    view === "companies" ? "Search companies…" : view === "people" ? "Search people…" : view === "proposals" ? "Search proposals…" : "Search deals, companies, or people…";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[640px]">
          <h1 className="font-serif text-[32px] leading-[1.06] font-normal tracking-[-0.015em] text-ink italic md:text-[40px]">
            Pipeline
          </h1>
          <p className="mt-2.5 text-[17px] leading-[1.6] text-ink-soft">{blurb}</p>
        </div>
        {can.addDeal(role!, myLabs) && (
          <Button className="rounded-full" onClick={() => setDealDrawer({ deal: "new" })}>
            + New deal
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-0">
        <div className="flex items-end gap-0.5 overflow-x-auto">
          {VIEWS.map((v) => {
            const count =
              v.key === "board" ? deals.length : v.key === "companies" ? companies.length : v.key === "people" ? contacts.length : proposalDealCount;
            const active = view === v.key;
            return (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 rounded-t-[10px] px-4 pt-[11px] pb-3 text-[15px] whitespace-nowrap transition-colors",
                  active
                    ? "border-b-2 border-violet-deep bg-violet-pale font-semibold text-violet-deep"
                    : "font-medium text-ink-soft hover:bg-[#F1EEFE] hover:text-violet-deep"
                )}
              >
                {v.label}
                <span className={cn("rounded-full px-1.5 py-px text-[11px] font-semibold", active ? "bg-white text-violet-deep" : "bg-violet-deep/10 text-violet")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 pb-2.5">
          <Input
            type="search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[240px]"
          />
          {view !== "companies" && view !== "people" && (
            <Select value={labFilter} onValueChange={setLabFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All labs" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All labs</SelectItem>
                {labs.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {view === "board" && (
            <Select value={ownerFilter} onValueChange={setOwnerFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="All owners" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All owners</SelectItem>
                {leaders.map((p) => <SelectItem key={p.username} value={p.username}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {view === "board" && nUnlinked > 0 && (
            <button
              onClick={() => setOnlyUnlinked((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium whitespace-nowrap",
                onlyUnlinked ? "border-red bg-red text-white" : "border-red/30 bg-white text-red"
              )}
            >
              <AlertCircle size={14} />
              Needs billing entity <span className="font-bold">{nUnlinked}</span>
            </button>
          )}
        </div>
      </div>

      {view === "board" && (
        <div className="flex items-start gap-2 overflow-x-auto pb-3">
          {STAGES.map((stage) => {
            const stageDeals = filtered.filter((d) => d.stage === stage);
            const total = stageDeals.reduce((sum, d) => sum + (d.amount || 0), 0);
            const isDropTarget = !!draggingDeal && dragOverStage === stage && draggingDeal.stage !== stage;
            return (
              <div
                key={stage}
                onDragOver={(e) => {
                  if (!draggingDeal) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverStage !== stage) setDragOverStage(stage);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setDragOverStage((s) => (s === stage ? null : s));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverStage(null);
                  const id = e.dataTransfer.getData("text/plain");
                  const dropped = deals.find((d) => d.id === id) ?? draggingDeal;
                  setDraggingDeal(null);
                  if (dropped) void handleDrop(dropped, stage);
                }}
                className={cn("min-w-[240px] flex-1 rounded-2xl p-1.5 transition-colors", isDropTarget && "bg-violet-pale ring-2 ring-violet-light/60")}
              >
                <div className="flex items-center gap-2 px-1 pb-3">
                  <h3 className="text-[15px] font-bold tracking-[-0.01em] text-ink">{stage}</h3>
                  <span className="rounded-full bg-violet-pale px-2 py-0.5 text-xs font-semibold tabular-nums text-violet-deep">{stageDeals.length}</span>
                  <span className="flex-1" />
                  {stageDeals.length > 0 && <span className="truncate text-xs text-warm-gray">{fmtDollars(total)}</span>}
                </div>

                <div className="flex min-h-[96px] flex-col gap-3">
                  <AnimatePresence initial={false}>
                    {stageDeals.map((deal) => (
                      <motion.div key={deal.id} layout={!reduceMotion} {...cardMotion}>
                        <DealCard
                          deal={deal}
                          labName={labName(deal.lab)}
                          ownerName={fullName(people[deal.owner]) || deal.owner}
                          billing={billingOf(deal, companyMap, contactMap)}
                          canDrag={can.editDeal(deal, role!, myLabs, me)}
                          isDragging={draggingDeal?.id === deal.id}
                          onDragStart={() => setDraggingDeal(deal)}
                          onDragEnd={() => {
                            setDraggingDeal(null);
                            setDragOverStage(null);
                          }}
                          onClick={() => openDeal(deal)}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {stageDeals.length === 0 && (
                    <div className="flex h-[88px] items-center justify-center rounded-2xl border border-dashed border-hair-strong text-xs text-warm-gray">
                      {draggingDeal ? "Drop here" : "Nothing here"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(view === "companies" || view === "people") && (
        <ContactsTable view={view} search={search} onOpenRecord={(type, id) => setRecordDrawer({ type, id, returnDealId: null })} />
      )}

      {view === "proposals" && (
        <ProposalsGrid search={search} lab={labFilter} onOpenDeal={(dealId) => {
          const d = deals.find((x) => x.id === dealId);
          if (d) openDeal(d);
        }} />
      )}

      {activeDrawer && (
        <DealDrawer
          deal={activeDrawer.deal}
          pendingStage={activeDrawer.pendingStage}
          open
          onClose={closeDealDrawer}
          onSaved={(saved) => {
            setDeals((prev) => (prev.some((d) => d.id === saved.id) ? prev.map((d) => (d.id === saved.id ? saved : d)) : [saved, ...prev]));
            closeDealDrawer();
          }}
          onDeleted={(id) => {
            setDeals((prev) => prev.filter((d) => d.id !== id));
            closeDealDrawer();
          }}
          onOpenRecord={(type, id) => {
            const returnDealId = activeDrawer.deal !== "new" ? activeDrawer.deal.id : null;
            setDealDrawer(null);
            setRecordDrawer({ type, id, returnDealId });
          }}
        />
      )}

      {recordDrawer && (
        <RecordDrawer
          type={recordDrawer.type}
          id={recordDrawer.id}
          open
          returnDealId={recordDrawer.returnDealId}
          onClose={() => setRecordDrawer(null)}
          onBackToDeal={(dealId) => {
            setRecordDrawer(null);
            const d = deals.find((x) => x.id === dealId);
            if (d) openDeal(d);
          }}
          onOpenDeal={(dealId) => {
            setRecordDrawer(null);
            const d = deals.find((x) => x.id === dealId);
            if (d) openDeal(d);
          }}
        />
      )}
    </div>
  );
}

function DealCard({
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
        {deal.recurring && <Repeat size={14} className="shrink-0 text-violet" aria-label="Recurring deal" />}
      </div>

      <h4 className="text-[15px] leading-[1.3] font-bold tracking-[-0.015em] text-ink">{deal.client}</h4>
      {cadence && <p className="mt-1 truncate text-[11px] font-medium text-violet">{cadence}</p>}

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
