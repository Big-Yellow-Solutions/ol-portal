"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AnimatePresence, motion } from "framer-motion";
import { Calendar, GripVertical, Repeat } from "lucide-react";
import { fmtDollars, fullName, initials } from "@/lib/data";
import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/can";
import { cn } from "@/lib/utils";
import { usePortalData } from "@/lib/portal-data";
import { STAGES, SOURCES } from "@/lib/types";
import type {
  AssignmentNotice,
  AssignmentNoticeLabLeader,
  Deal,
  Outcome,
  Person,
  Source,
  Stage,
} from "@/lib/types";

const OL_SIGNER_KEY = "ol";

const OPEN_STAGES = STAGES.filter((s) => s !== "Closed");

const BOARD_STAGES: Stage[] = [...OPEN_STAGES, "Closed"];

// deal.close is a plain "YYYY-MM-DD" string. Parsing it with `new Date(iso)`
// would read it as UTC midnight and render the previous day in western
// timezones, so build the date from its parts instead.
function fmtClose(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function PipelinePage() {
  const { loading, error, deals, labs, people, role, me, myLabs, setDeals } =
    usePortalData();
  const [search, setSearch] = useState("");
  const [labFilter, setLabFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [openDeal, setOpenDeal] = useState<Deal | "new" | null>(null);
  const [draggingDeal, setDraggingDeal] = useState<Deal | null>(null);
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null);

  // Drag-to-restage. Closing a deal is deliberately NOT done by dragging:
  // the server rejects a move to "Closed" without an Assignment Notice, and
  // closing also needs a Won/Lost outcome, so a drop on Closed hands off to
  // DealDialog which already runs that flow.
  const moveDeal = async (deal: Deal, stage: Stage) => {
    if (deal.stage === stage) return;
    if (!can.editDeal(deal, role!, myLabs, me)) {
      toast.error("You don't have permission to move this deal.");
      return;
    }
    if (stage === "Closed") {
      toast.info("Closing a deal needs an outcome and an Assignment Notice.");
      setOpenDeal(deal);
      return;
    }

    const previous = deal.stage;
    setDeals((prev) =>
      prev.map((d) => (d.id === deal.id ? { ...d, stage } : d))
    );
    try {
      const saved = await api<Deal>(`/deals/${deal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ stage }),
      });
      setDeals((prev) => prev.map((d) => (d.id === saved.id ? saved : d)));
    } catch (err) {
      setDeals((prev) =>
        prev.map((d) => (d.id === deal.id ? { ...d, stage: previous } : d))
      );
      toast.error(
        err instanceof ApiError ? err.message : "Could not move this deal."
      );
    }
  };

  const leaders = useMemo(
    () =>
      Object.entries(people)
        .filter(([, p]) => p.role === "Admin" || p.role === "Lab Leader")
        .map(([username, p]) => ({ username, name: fullName(p) || username })),
    [people]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deals.filter((d) => {
      if (labFilter !== "all" && d.lab !== labFilter) return false;
      if (ownerFilter !== "all" && d.owner !== ownerFilter) return false;
      if (q && !d.client.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [deals, labFilter, ownerFilter, search]);

  const labName = (id: string) => labs.find((l) => l.id === id)?.name ?? id;
  const personName = (username?: string) =>
    username ? fullName(people[username]) || username : "—";

  const closedDeals = filtered.filter((d) => d.stage === "Closed");

  if (loading) return <p className="text-sm text-ink-mute">Loading…</p>;
  if (error) return <p className="text-sm text-red">{error}</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl italic text-ink">Pipeline</h1>
          <p className="mt-1 text-sm text-ink-mute">Deals by stage, across labs.</p>
        </div>
        {can.addDeal(role!, myLabs) && (
          <Button className="bg-violet-deep hover:bg-violet" onClick={() => setOpenDeal("new")}>
            + New deal
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Input
          type="search"
          placeholder="Search by client…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={labFilter} onValueChange={setLabFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All labs" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All labs</SelectItem>
            {labs.map((l) => (
              <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All owners" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            {leaders.map((p) => (
              <SelectItem key={p.username} value={p.username}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {BOARD_STAGES.map((stage) => {
          const stageDeals =
            stage === "Closed"
              ? closedDeals
              : filtered.filter((d) => d.stage === stage);
          const isDropTarget =
            !!draggingDeal &&
            dragOverStage === stage &&
            draggingDeal.stage !== stage;

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
                // ignore bubbling from children still inside this column
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setDragOverStage((s) => (s === stage ? null : s));
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverStage(null);
                const id = e.dataTransfer.getData("text/plain");
                const dropped = deals.find((d) => d.id === id) ?? draggingDeal;
                setDraggingDeal(null);
                if (dropped) void moveDeal(dropped, stage);
              }}
              className={cn(
                "flex flex-col gap-3 rounded-2xl p-1 transition-colors",
                isDropTarget && "bg-violet-pale ring-2 ring-violet-deep/40"
              )}
            >
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-sm font-semibold text-ink">{stage}</h3>
                <span className="rounded-full bg-violet-pale px-2 py-0.5 text-xs font-semibold tabular-nums text-violet-deep">
                  {stageDeals.length}
                </span>
              </div>

              <div className="flex min-h-[96px] flex-col gap-3">
                <AnimatePresence initial={false}>
                  {stageDeals.map((deal) => (
                    <motion.div
                      key={deal.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.15 }}
                    >
                      <DealCard
                        deal={deal}
                        labName={labName(deal.lab)}
                        ownerName={personName(deal.owner)}
                        owner={people[deal.owner]}
                        canDrag={can.editDeal(deal, role!, myLabs, me)}
                        isDragging={draggingDeal?.id === deal.id}
                        onDragStart={() => setDraggingDeal(deal)}
                        onDragEnd={() => {
                          setDraggingDeal(null);
                          setDragOverStage(null);
                        }}
                        onClick={() => setOpenDeal(deal)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>

                {stageDeals.length === 0 && (
                  <div className="flex h-24 items-center justify-center rounded-2xl border-2 border-dashed border-foreground/15 text-xs text-ink-mute">
                    {draggingDeal ? "Drop here" : "No deals"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {openDeal && (
        <DealDialog
          deal={openDeal === "new" ? null : openDeal}
          open={!!openDeal}
          onOpenChange={(open) => {
            if (!open) setOpenDeal(null);
          }}
          onSaved={(saved) => {
            setDeals((prev) => {
              const exists = prev.some((d) => d.id === saved.id);
              return exists ? prev.map((d) => (d.id === saved.id ? saved : d)) : [saved, ...prev];
            });
            setOpenDeal(null);
          }}
          onDeleted={(id) => {
            setDeals((prev) => prev.filter((d) => d.id !== id));
            setOpenDeal(null);
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
  owner,
  canDrag,
  isDragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  deal: Deal;
  labName: string;
  ownerName: string;
  owner: Person | undefined;
  canDrag: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
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
        "group relative flex w-full flex-col gap-4 rounded-2xl border border-foreground/10 bg-card p-4 text-left shadow-sm transition hover:border-violet-deep hover:shadow-md",
        canDrag && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40"
      )}
    >
      {canDrag && (
        <span
          aria-hidden
          className="absolute left-0.5 top-1/2 -translate-y-1/2 text-ink-mute opacity-0 transition-opacity group-hover:opacity-100"
        >
          <GripVertical size={14} />
        </span>
      )}

      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-violet-pale px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-violet-deep">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-violet-deep" />
          {labName}
        </span>
        {deal.stage === "Closed" && deal.outcome && (
          <Badge variant={deal.outcome === "Won" ? "success" : "destructive"}>
            {deal.outcome}
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="text-[15px] font-semibold leading-snug text-ink">
          {deal.client}
        </h4>
        <p className="text-xs text-ink-mute">{ownerName}</p>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-foreground/10 pt-3">
        <div className="flex min-w-0 items-center gap-2.5 text-xs text-ink-mute">
          {deal.close && (
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              <Calendar size={14} aria-hidden />
              {fmtClose(deal.close)}
            </span>
          )}
          {deal.recurring && (
            <span className="flex shrink-0 items-center" title="Recurring deal">
              <Repeat size={14} aria-hidden />
              <span className="sr-only">Recurring deal</span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="tabular-nums text-sm font-semibold text-ink">
            {fmtDollars(deal.amount)}
          </span>
          <Avatar size="sm">
            {owner?.photo && <AvatarImage src={owner.photo} alt="" />}
            <AvatarFallback>{owner ? initials(owner) : "—"}</AvatarFallback>
          </Avatar>
        </div>
      </div>
    </button>
  );
}

function DealDialog({
  deal,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  deal: Deal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (deal: Deal) => void;
  onDeleted: (id: string) => void;
}) {
  const { labs, people, role, me, myLabs } = usePortalData();
  const isNew = !deal;
  const editable = deal
    ? can.editDeal(deal, role!, myLabs, me)
    : can.addDeal(role!, myLabs);

  const leaders = useMemo(
    () =>
      Object.entries(people)
        .filter(([, p]) => p.role === "Admin" || p.role === "Lab Leader")
        .map(([username, p]) => ({ username, name: fullName(p) || username })),
    [people]
  );
  // Assignment Notice fee-share lines can only name real Lab Leaders — an
  // Admin can sign the separate "ol" (Optimistic Labs) line, but can't be
  // listed as a fee-share Lab Leader themselves (matches app.mjs).
  const labLeaderOptions = useMemo(
    () =>
      Object.entries(people)
        .filter(([, p]) => p.role === "Lab Leader")
        .map(([username, p]) => ({ username, name: fullName(p) || username })),
    [people]
  );

  const [client, setClient] = useState(deal?.client ?? "");
  const [lab, setLab] = useState(deal?.lab ?? myLabs[0] ?? labs[0]?.id ?? "");
  const [owner, setOwner] = useState(deal?.owner ?? me ?? "");
  const [dealOwner, setDealOwner] = useState(deal?.dealOwner ?? deal?.owner ?? me ?? "");
  const [stage, setStage] = useState<Stage>(deal?.stage ?? "Lead");
  const [amount, setAmount] = useState(String(deal?.amount ?? ""));
  const [close, setClose] = useState(deal?.close ?? "");
  const [source, setSource] = useState<Source>(deal?.source ?? "Referral");
  const [recurring, setRecurring] = useState(deal?.recurring ?? false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showAssignment, setShowAssignment] = useState(false);
  const existingNotice = deal?.assignmentNotice;
  const noticeLocked = !!existingNotice && Object.keys(existingNotice.signatures || {}).length > 0;
  const [noticeLabLeaders, setNoticeLabLeaders] = useState<
    { key: string; feeSharePct: string }[]
  >(
    existingNotice?.labLeaders.length
      ? existingNotice.labLeaders.map((l) => ({ key: l.key, feeSharePct: String(l.feeSharePct) }))
      : [{ key: dealOwner || owner || "", feeSharePct: "100" }]
  );
  const [noticeSubcontractorCosts, setNoticeSubcontractorCosts] = useState(
    String(existingNotice?.subcontractorCosts ?? 0)
  );
  const [noticeHardCosts, setNoticeHardCosts] = useState(String(existingNotice?.hardCosts ?? 0));
  const [pendingOutcome, setPendingOutcome] = useState<Outcome>(deal?.outcome ?? "Won");
  const [signing, setSigning] = useState<string | null>(null);
  const [signatureText, setSignatureText] = useState("");

  const buildNotice = (): AssignmentNotice | null => {
    const labLeaders: AssignmentNoticeLabLeader[] = [];
    for (const row of noticeLabLeaders) {
      const pct = Number(row.feeSharePct);
      if (!row.key || !Number.isFinite(pct) || pct < 0) return null;
      labLeaders.push({ key: row.key, feeSharePct: pct });
    }
    if (!labLeaders.length) return null;
    const pctSum = labLeaders.reduce((sum, l) => sum + l.feeSharePct, 0);
    if (Math.abs(pctSum - 100) > 0.01) return null;
    const subcontractorCosts = Number(noticeSubcontractorCosts);
    const hardCosts = Number(noticeHardCosts);
    if (!Number.isFinite(subcontractorCosts) || subcontractorCosts < 0) return null;
    if (!Number.isFinite(hardCosts) || hardCosts < 0) return null;
    return { labLeaders, subcontractorCosts, hardCosts, signatures: existingNotice?.signatures ?? {} };
  };

  const buildBody = (assignmentNotice?: AssignmentNotice) => ({
    client,
    lab,
    owner,
    dealOwner,
    stage,
    amount: Number(amount) || 0,
    close,
    source,
    recurring,
    ...(stage === "Closed" ? { outcome: pendingOutcome } : {}),
    ...(assignmentNotice ? { assignmentNotice } : {}),
  });

  const submit = async (assignmentNotice?: AssignmentNotice) => {
    setSaving(true);
    try {
      const body = buildBody(assignmentNotice);
      const saved = isNew
        ? await api<Deal>("/deals", { method: "POST", body: JSON.stringify(body) })
        : await api<Deal>(`/deals/${deal!.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(isNew ? "Deal created" : "Deal saved");
      onSaved(saved);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save this deal.");
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const closing = stage === "Closed" && deal?.stage !== "Closed";
    if (closing && !deal?.assignmentNotice) {
      setShowAssignment(true);
      return;
    }
    // Already-Closed deals carry their (possibly just-edited) notice along
    // with every other save, unless it's locked behind a signature.
    const notice = stage === "Closed" && !noticeLocked ? buildNotice() : existingNotice;
    if (stage === "Closed" && !noticeLocked && !notice) {
      toast.error("Assignment Notice fee shares must add up to 100%.");
      return;
    }
    await submit(notice ?? undefined);
  };

  const confirmAssignmentAndSave = async () => {
    const notice = buildNotice();
    if (!notice) {
      toast.error("Add at least one Lab Leader with fee shares summing to 100%.");
      return;
    }
    await submit(notice);
    setShowAssignment(false);
  };

  const sign = async (signerKey: string) => {
    if (!deal || !signatureText.trim()) return;
    setSigning(signerKey);
    try {
      const saved = await api<Deal>(`/deals/${deal.id}/assignment-notice/sign`, {
        method: "POST",
        body: JSON.stringify({ signerKey, signatureText: signatureText.trim() }),
      });
      toast.success("Signed");
      onSaved(saved);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not record this signature.");
    } finally {
      setSigning(null);
      setSignatureText("");
    }
  };

  const del = async () => {
    if (!deal) return;
    if (!window.confirm(`Delete the deal for ${deal.client}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api(`/deals/${deal.id}`, { method: "DELETE" });
      toast.success("Deal deleted");
      onDeleted(deal.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete this deal.");
    } finally {
      setDeleting(false);
    }
  };

  const requestInvoice = async () => {
    if (!deal) return;
    try {
      await api("/invoices", {
        method: "POST",
        body: JSON.stringify({ dealId: deal.id, recurring: deal.recurring }),
      });
      toast.success("Invoice requested");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not request an invoice.");
    }
  };

  if (showAssignment) {
    return (
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent showCloseButton={false} onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Assignment notice required</DialogTitle>
            <DialogDescription>
              Closing this deal requires naming which Lab Leader(s) are delivering the work and
              their fee split, plus any subcontractor and hard costs.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Outcome</Label>
              <Select value={pendingOutcome} onValueChange={(v) => setPendingOutcome(v as Outcome)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Won">Won</SelectItem>
                  <SelectItem value="Lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <LabLeaderFeeSplitEditor
              rows={noticeLabLeaders}
              setRows={setNoticeLabLeaders}
              options={labLeaderOptions}
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Subcontractor costs</Label>
                <Input
                  type="number"
                  min={0}
                  value={noticeSubcontractorCosts}
                  onChange={(e) => setNoticeSubcontractorCosts(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Hard costs</Label>
                <Input
                  type="number"
                  min={0}
                  value={noticeHardCosts}
                  onChange={(e) => setNoticeHardCosts(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignment(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              className="bg-violet-deep hover:bg-violet"
              disabled={saving}
              onClick={confirmAssignmentAndSave}
            >
              {saving ? "Saving…" : "Confirm & close deal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "New deal" : deal!.client}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>Client</Label>
            <Input value={client} onChange={(e) => setClient(e.target.value)} disabled={!editable} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Lab</Label>
            <Select value={lab} onValueChange={setLab} disabled={!editable}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {labs.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Stage</Label>
            <Select value={stage} onValueChange={(v) => setStage(v as Stage)} disabled={!editable}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Owner (Lab Leader)</Label>
            <Select value={owner} onValueChange={setOwner} disabled={!editable}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {leaders.map((p) => (
                  <SelectItem key={p.username} value={p.username}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Deal owner</Label>
            <Select value={dealOwner} onValueChange={setDealOwner} disabled={!editable}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {leaders.map((p) => (
                  <SelectItem key={p.username} value={p.username}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Amount</Label>
            <Input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!editable}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Expected close</Label>
            <Input type="date" value={close} onChange={(e) => setClose(e.target.value)} disabled={!editable} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Source</Label>
            <Select value={source} onValueChange={(v) => setSource(v as Source)} disabled={!editable}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
            <Checkbox checked={recurring} onCheckedChange={(c) => setRecurring(!!c)} disabled={!editable} />
            Recurring engagement
          </label>
        </div>

        {!isNew && deal!.stage === "Closed" && existingNotice && (
          <div className="flex flex-col gap-4 border-t border-hair pt-4">
            <h3 className="text-sm font-medium text-ink">Assignment Notice</h3>

            <LabLeaderFeeSplitEditor
              rows={noticeLabLeaders}
              setRows={setNoticeLabLeaders}
              options={labLeaderOptions}
              disabled={!editable || noticeLocked}
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Subcontractor costs</Label>
                <Input
                  type="number"
                  min={0}
                  value={noticeSubcontractorCosts}
                  onChange={(e) => setNoticeSubcontractorCosts(e.target.value)}
                  disabled={!editable || noticeLocked}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Hard costs</Label>
                <Input
                  type="number"
                  min={0}
                  value={noticeHardCosts}
                  onChange={(e) => setNoticeHardCosts(e.target.value)}
                  disabled={!editable || noticeLocked}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Signatures</Label>
              {[...existingNotice.labLeaders.map((l) => l.key), OL_SIGNER_KEY].map((key) => {
                const sig = existingNotice.signatures[key];
                const label = key === OL_SIGNER_KEY ? "Optimistic Labs" : fullName(people[key]) || key;
                const canSign =
                  !sig &&
                  (role === "Admin" || (key !== OL_SIGNER_KEY && me === key));
                return (
                  <div key={key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-ink">{label}</span>
                    {sig ? (
                      <span className="text-xs text-ink-mute">
                        Signed &ldquo;{sig.name}&rdquo; by {sig.verifiedName || sig.by}
                      </span>
                    ) : canSign ? (
                      signing === key ? (
                        <div className="flex items-center gap-2">
                          <Input
                            autoFocus
                            placeholder="Type your name"
                            value={signatureText}
                            onChange={(e) => setSignatureText(e.target.value)}
                            className="h-8 w-40"
                          />
                          <Button size="sm" onClick={() => sign(key)} disabled={!signatureText.trim()}>
                            Sign
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setSigning(key)}>
                          Sign
                        </Button>
                      )
                    ) : (
                      <span className="text-xs text-ink-mute">Not signed</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex gap-2">
            {!isNew && can.deleteDeal(role!) && (
              <Button variant="outline" className="text-red" onClick={del} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            )}
            {!isNew && deal!.amount > 0 && (
              <Button variant="outline" onClick={requestInvoice}>
                Request invoice
              </Button>
            )}
          </div>
          {editable && (
            <Button className="bg-violet-deep hover:bg-violet" onClick={save} disabled={saving}>
              {saving ? "Saving…" : isNew ? "Create deal" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LabLeaderFeeSplitEditor({
  rows,
  setRows,
  options,
  disabled,
}: {
  rows: { key: string; feeSharePct: string }[];
  setRows: (rows: { key: string; feeSharePct: string }[]) => void;
  options: { username: string; name: string }[];
  disabled?: boolean;
}) {
  const total = rows.reduce((sum, r) => sum + (Number(r.feeSharePct) || 0), 0);

  return (
    <div className="flex flex-col gap-2">
      <Label>Lab Leader fee split</Label>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Select
            value={row.key}
            onValueChange={(v) =>
              setRows(rows.map((r, idx) => (idx === i ? { ...r, key: v } : r)))
            }
            disabled={disabled}
          >
            <SelectTrigger className="flex-1"><SelectValue placeholder="Lab Leader" /></SelectTrigger>
            <SelectContent>
              {options.map((p) => (
                <SelectItem key={p.username} value={p.username}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={0}
            max={100}
            value={row.feeSharePct}
            onChange={(e) =>
              setRows(rows.map((r, idx) => (idx === i ? { ...r, feeSharePct: e.target.value } : r)))
            }
            disabled={disabled}
            className="w-20"
          />
          <span className="text-xs text-ink-mute">%</span>
          {!disabled && rows.length > 1 && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
            >
              ✕
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setRows([...rows, { key: "", feeSharePct: "" }])}
        >
          + Add Lab Leader
        </Button>
      )}
      <span className={cn("text-xs", Math.abs(total - 100) > 0.01 ? "text-red" : "text-ink-mute")}>
        Total: {total}% (must equal 100%)
      </span>
    </div>
  );
}
