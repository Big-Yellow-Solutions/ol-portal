"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PersonItem, personOptions } from "@/components/ui/person-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, FlaskConical } from "lucide-react";
import { fmtDollars, fullName } from "@/lib/data";
import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/can";
import { cn } from "@/lib/utils";
import { usePortalData } from "@/lib/portal-data";
import {
  billingOf,
  billingRequiredAt,
  proposalRequiredAt,
  CLOSED_WON,
  SHOW_COLUMN_TOTALS,
} from "@/lib/pipeline";
import { STAGES, STAGE_LABELS } from "@/lib/types";
import type { Deal, Stage } from "@/lib/types";
import { DealDrawer } from "@/components/pipeline/deal-drawer";
import { RecordDrawer } from "@/components/pipeline/record-drawer";
import { ContactsTable } from "@/components/pipeline/contacts-table";
import { DocumentsGrid } from "@/components/pipeline/documents-grid";
import { DealCard } from "@/components/pipeline/deal-card";

type ViewKey = "board" | "companies" | "people" | "documents";
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "board", label: "Board" },
  { key: "companies", label: "Companies" },
  { key: "people", label: "People" },
  { key: "documents", label: "Documents" },
];

export default function PipelinePage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-mute">Loading…</p>}>
      <PipelineBoard />
    </Suspense>
  );
}

function PipelineBoard() {
  const { loading, error, deals, labs, people, companies, contacts, proposals, contracts, invoices, files, role, me, myLabs, setDeals } =
    usePortalData();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const viewParam = searchParams.get("view");
  const view: ViewKey = VIEWS.some((v) => v.key === viewParam) ? (viewParam as ViewKey) : "board";
  const [search, setSearch] = useState("");
  const [labChoice, setLabChoice] = useState("all");
  const [ownerChoice, setOwnerChoice] = useState("all");
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);

  /* Who this pipeline belongs to.

     `role` and `myLabs` both come from /bootstrap, which resolves them from
     the PERSON record behind the caller's verified token — never from a query
     param, and never named here. Nothing on this page says "Sports Lab": it
     says whichever lab the caller's own record names.

     The lab and owner pickers are an Admin's tools. An Admin is the only role
     with more than one lab's pipeline to switch between, and the only one
     whose board carries other people's deals. For everyone else the two
     controls are not rendered, and the values read "all" regardless of the
     state behind them — so a stale choice cannot outlive a role change, and
     hiding a control is not the only thing keeping the filter honest. The
     scope that matters is the server's: /deals, /companies, /contacts,
     /proposals, /contracts and /invoices each return a Lab Leader only their
     own lab's records, whatever this page asks for. */
  const isAdmin = role === "Admin";
  const labFilter = isAdmin ? labChoice : "all";
  const ownerFilter = isAdmin ? ownerChoice : "all";
  const [draggingDeal, setDraggingDeal] = useState<Deal | null>(null);
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null);

  const [dealDrawer, setDealDrawer] = useState<{ deal: Deal | "new"; pendingStage?: Stage; tab?: "details" | "documents" } | null>(null);
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

  function openDeal(deal: Deal | "new", pendingStage?: Stage, tab?: "details" | "documents") {
    setDealDrawer({ deal, pendingStage, tab });
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

  /* The lab record(s) behind `myLabs`. A Lab Leader normally has one; the
     shape has always been a list, so two are joined rather than truncated. */
  const myLabRecords = useMemo(() => labs.filter((l) => myLabs.includes(l.id)), [labs, myLabs]);
  const scopeName = myLabRecords.map((l) => l.name).join(" & ");
  const scoped = role === "Lab Leader" && !!scopeName;

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

  /* Which deals have a proposal document uploaded onto them — the drop gate
     below reads this rather than a proposal record, because proposals are
     written outside the portal now and uploaded on the deal's Documents tab. */
  const dealsWithProposalFile = useMemo(
    () => new Set(files.filter((f) => f.kind === "proposal" && f.deal).map((f) => f.deal!)),
    [files]
  );

  const dealsWithContractFile = useMemo(
    () => new Set(files.filter((f) => f.kind === "contract" && f.deal).map((f) => f.deal!)),
    [files]
  );

  const leaders = useMemo(
    () => personOptions(people, { labs, filter: (p) => p.role === "Admin" || p.role === "Lab Leader" }),
    [people, labs]
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
  /* One card per deal's proposal, plus every contract, invoice and filed
     assignment — the same arithmetic DocumentsGrid does, so the tab count and
     the grid agree. */
  const documentCount = useMemo(
    () =>
      new Set(proposals.map((p) => p.deal).filter(Boolean)).size +
      contracts.length +
      invoices.length +
      deals.filter((d) => d.assignment).length,
    [proposals, contracts, invoices, deals]
  );

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
      toast.info(`${STAGE_LABELS[targetStage]} needs a billing entity — opening ${deal.client}`);
      openDeal(deal, targetStage);
      return;
    }
    if (proposalRequiredAt(targetStage)) {
      /* A proposal sent from the portal before uploads replaced that flow
         still clears the gate, mirroring backend/src/app.mjs. */
      const cleared =
        dealsWithProposalFile.has(deal.id) || !!latestProposalFor.get(deal.id)?.sentAt;
      if (!cleared) {
        toast.info(`${STAGE_LABELS[targetStage]} needs a proposal — upload one on this deal`);
        openDeal(deal, targetStage, "documents");
        return;
      }
    }
    /* Winning still needs the paperwork: no signed contract, no close. The
       assignment does NOT block it — a won deal is won, and the form is
       chased afterwards, which is the change v3 makes. */
    if (targetStage === CLOSED_WON) {
      const hasContract = !!deal.contractSigned || dealsWithContractFile.has(deal.id);
      if (!hasContract) {
        toast.info("Set the close date and add the signed contract.");
        openDeal(deal, CLOSED_WON, "documents");
        return;
      }
      if (!deal.assignment) {
        // A nudge, not a gate: the move goes through, then the drawer opens
        // on the deal so the form is one click away.
        await moveTo(deal, targetStage, "Closed Won — a Lab Leader Assignment form is needed");
        openDeal({ ...deal, stage: targetStage }, undefined, "details");
        return;
      }
    }

    await moveTo(deal, targetStage);
  }

  async function moveTo(deal: Deal, targetStage: Stage, note?: string) {
    const previous = deal.stage;
    setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, stage: targetStage } : d)));
    try {
      const saved = await api<Deal>(`/deals/${deal.id}`, { method: "PATCH", body: JSON.stringify({ stage: targetStage }) });
      setDeals((prev) => prev.map((d) => (d.id === saved.id ? saved : d)));
      if (note) toast.info(note);
      else toast.success(`${deal.client} moved to ${STAGE_LABELS[targetStage]}`);
    } catch (err) {
      setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, stage: previous } : d)));
      toast.error(err instanceof ApiError ? err.message : "Could not move this deal.");
    }
  }

  if (loading) return <p className="text-sm text-ink-mute">Loading…</p>;
  if (error) return <p className="text-sm text-red">{error}</p>;

  /* A Lab Leader whose account names no lab — never given one, or given one
     the directory no longer has — has no pipeline. Falling through would draw
     a board under a global heading with whatever the API happened to return,
     which is the one outcome this page must not have, so it says so instead. */
  if (role === "Lab Leader" && myLabRecords.length === 0)
    return (
      <div className="flex flex-col gap-5">
        <h1 className="font-serif text-[32px] leading-[1.06] font-normal tracking-[-0.015em] text-ink italic md:text-[40px]">
          Pipeline
        </h1>
        <div className="flex max-w-[640px] items-start gap-3 rounded-2xl border border-red/30 bg-white p-5">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-red" />
          <div>
            <p className="text-[15px] font-semibold text-ink">No lab is assigned to your account</p>
            <p className="mt-1.5 text-sm leading-[1.6] text-ink-soft">
              A Lab Leader&rsquo;s pipeline is their lab&rsquo;s pipeline, so there is nothing
              to show here until yours is set. Ask an Admin to add your lab to your account,
              and this page will fill in.
            </p>
          </div>
        </div>
      </div>
    );

  const heading = scoped ? `${scopeName} Pipeline` : "Pipeline";
  const where = scoped ? `in the ${scopeName}` : "across the pipeline";
  /* PRD 3.3 lets an Admin put a Lab Leader on a deal in another lab — it is
     theirs to run, so it is on their board and the copy has to admit it.
     Said only when one is actually there, rather than hedging for everyone. */
  const alsoLeadsElsewhere = scoped && deals.some((d) => !myLabs.includes(d.lab));

  const blurb =
    view === "companies"
      ? `Customer organizations ${where}. Open one to see its deals and primary contact.`
      : view === "people"
        ? `Individuals ${where} — some belong to a company, some are billed directly. Open one to see their deals.`
        : view === "documents"
          ? `Every proposal, signed contract, invoice, and assignment form ${where}, with its current version.`
          : scoped
            ? `Every ${scopeName} deal by stage${alsoLeadsElsewhere ? ", plus any deal you lead in another lab" : ""}. Drag a card to move it forward and add the necessary documents at each stage to get to Closed.`
            : "All of your deals by stage. Drag a card to move it forward and add the necessary documents at each stage to get to Closed.";

  const searchPlaceholder =
    view === "companies" ? "Search companies…" : view === "people" ? "Search people…" : view === "documents" ? "Search documents…" : "Search deals, companies, or people…";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[640px]">
          <h1 className="font-serif text-[32px] leading-[1.06] font-normal tracking-[-0.015em] text-ink italic md:text-[40px]">
            {heading}
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
              v.key === "board" ? deals.length : v.key === "companies" ? companies.length : v.key === "people" ? contacts.length : documentCount;
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
          {isAdmin && view !== "companies" && view !== "people" && (
            <Select value={labFilter} onValueChange={setLabChoice}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All labs" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All labs</SelectItem>
                {labs.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {isAdmin && view === "board" && (
            <Select value={ownerFilter} onValueChange={setOwnerChoice}>
              <SelectTrigger className="w-44"><SelectValue placeholder="All owners" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All owners</SelectItem>
                {leaders.map((p) => <PersonItem key={p.id} person={p} />)}
              </SelectContent>
            </Select>
          )}
          {/* What the pickers would have said, for a reader who has nothing to
              pick: the scope stated next to the search box, which is where the
              question "what am I searching?" gets asked. */}
          {scoped && (
            <span className="flex items-center gap-1.5 rounded-full bg-violet-pale px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap text-violet-deep">
              <FlaskConical size={14} aria-hidden />
              {scopeName}
            </span>
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
            const stageLabel = STAGE_LABELS[stage];
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
                  <h3 className="text-[15px] font-bold tracking-[-0.01em] whitespace-nowrap text-ink">{stageLabel}</h3>
                  <span className="rounded-full bg-violet-pale px-2 py-0.5 text-xs font-semibold tabular-nums text-violet-deep">{stageDeals.length}</span>
                  <span className="flex-1" />
                  {SHOW_COLUMN_TOTALS && stageDeals.length > 0 && (
                    <span className="truncate text-xs text-warm-gray">{fmtDollars(total)}</span>
                  )}
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

      {view === "documents" && (
        <DocumentsGrid search={search} lab={labFilter} onOpenDeal={(dealId) => {
          const d = deals.find((x) => x.id === dealId);
          if (d) openDeal(d);
        }} />
      )}

      {activeDrawer && (
        <DealDrawer
          key={activeDrawer.deal === "new" ? "new" : activeDrawer.deal.id}
          deal={activeDrawer.deal}
          pendingStage={activeDrawer.pendingStage}
          initialTab={activeDrawer.tab}
          open
          onClose={closeDealDrawer}
          onSaved={(saved) => {
            setDeals((prev) => (prev.some((d) => d.id === saved.id) ? prev.map((d) => (d.id === saved.id ? saved : d)) : [saved, ...prev]));
            closeDealDrawer();
          }}
          onDealUpdated={(saved) => {
            setDeals((prev) => prev.map((d) => (d.id === saved.id ? saved : d)));
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
          key={`${recordDrawer.type}:${recordDrawer.id}`}
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
