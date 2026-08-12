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
import { fmtDollars, fullName, STAGE_VARIANT } from "@/lib/data";
import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/can";
import { usePortalData } from "@/lib/portal-data";
import { STAGES, SOURCES } from "@/lib/types";
import type { AssignmentNotice, Deal, Outcome, Source, Stage } from "@/lib/types";

const OPEN_STAGES = STAGES.filter((s) => s !== "Closed");

export default function PipelinePage() {
  const { loading, error, deals, labs, people, role, me, myLabs, setDeals } =
    usePortalData();
  const [search, setSearch] = useState("");
  const [labFilter, setLabFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [openDeal, setOpenDeal] = useState<Deal | "new" | null>(null);

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
        {OPEN_STAGES.map((stage) => (
          <div key={stage} className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-ink-mute">
              <span>{stage}</span>
              <span>{filtered.filter((d) => d.stage === stage).length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {filtered
                .filter((d) => d.stage === stage)
                .map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    labName={labName(deal.lab)}
                    ownerName={personName(deal.owner)}
                    onClick={() => setOpenDeal(deal)}
                  />
                ))}
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-ink-mute">
            <span>Closed</span>
            <span>{closedDeals.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {closedDeals.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                labName={labName(deal.lab)}
                ownerName={personName(deal.owner)}
                onClick={() => setOpenDeal(deal)}
              />
            ))}
          </div>
        </div>
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
  onClick,
}: {
  deal: Deal;
  labName: string;
  ownerName: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-1 rounded-lg bg-card p-3 text-left ring-1 ring-foreground/10 transition hover:ring-violet-deep"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">{deal.client}</span>
        {deal.stage === "Closed" && deal.outcome && (
          <Badge variant={deal.outcome === "Won" ? "success" : "destructive"}>
            {deal.outcome}
          </Badge>
        )}
      </div>
      <div className="text-xs text-ink-mute">{labName}</div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-mute">{ownerName}</span>
        <span className="tabular-nums text-ink">{fmtDollars(deal.amount)}</span>
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
  const [clientContactName, setClientContactName] = useState(
    deal?.assignmentNotice?.clientContactName ?? ""
  );
  const [scopeSummary, setScopeSummary] = useState(deal?.assignmentNotice?.scopeSummary ?? "");
  const [pendingOutcome, setPendingOutcome] = useState<Outcome>("Won");

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
    await submit();
  };

  const confirmAssignmentAndSave = async () => {
    if (!clientContactName.trim() || !scopeSummary.trim()) {
      toast.error("Client contact name and scope summary are both required.");
      return;
    }
    await submit({ clientContactName, scopeSummary });
    setShowAssignment(false);
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assignment notice required</DialogTitle>
            <DialogDescription>
              Closing this deal requires naming who&apos;s assigned to deliver the work.
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
            <div className="flex flex-col gap-1.5">
              <Label>Client contact name</Label>
              <Input value={clientContactName} onChange={(e) => setClientContactName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Scope summary</Label>
              <Input value={scopeSummary} onChange={(e) => setScopeSummary(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
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
