"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/can";
import { fullName } from "@/lib/data";
import { billingRequiredAt, proposalRequiredAt, BILLING_GATE_STAGE } from "@/lib/pipeline";
import { usePortalData } from "@/lib/portal-data";
import { STAGES, SOURCES } from "@/lib/types";
import type {
  AssignmentNotice,
  AssignmentNoticeLabLeader,
  Deal,
  Outcome,
  Source,
  Stage,
} from "@/lib/types";
import { BillingEntityPanel } from "@/components/pipeline/billing-entity-panel";
import { ProposalPanel } from "@/components/pipeline/proposal-panel";
import { InvoicesPanel } from "@/components/pipeline/invoices-panel";

const OL_SIGNER_KEY = "ol";

/* Pipeline v2 (design handoff): the deal drawer. The design draws one panel
   that both views and edits a deal — no separate read-only mode — so this
   replaces the old DealView (read) + DealDialog (edit) split with a single
   form, matching that. `pendingStage` is set when the board's drag-and-drop
   gate rejects a drop: it opens this drawer already showing the target stage
   so fixing the blocker (billing entity / proposal / contract) and hitting
   Save also completes the move, mirroring the prototype's openDeal + setState
   pattern. */
export function DealDrawer({
  deal,
  open,
  pendingStage,
  onClose,
  onSaved,
  onDeleted,
  onOpenRecord,
}: {
  deal: Deal | "new";
  open: boolean;
  pendingStage?: Stage;
  onClose: () => void;
  onSaved: (deal: Deal) => void;
  onDeleted: (id: string) => void;
  onOpenRecord: (type: "company" | "contact", id: string) => void;
}) {
  const { labs, people, proposals, role, me, myLabs } = usePortalData();
  const isNew = deal === "new";
  const existing = isNew ? null : deal;
  const editable = existing ? can.editDeal(existing, role!, myLabs, me) : can.addDeal(role!, myLabs);

  const leaders = useMemo(
    () => Object.entries(people).filter(([, p]) => p.role === "Admin" || p.role === "Lab Leader").map(([username, p]) => ({ username, name: fullName(p) || username })),
    [people]
  );
  const labLeaderOptions = useMemo(
    () => Object.entries(people).filter(([, p]) => p.role === "Lab Leader").map(([username, p]) => ({ username, name: fullName(p) || username })),
    [people]
  );

  const [title, setTitle] = useState(existing?.client ?? "");
  const [lab, setLab] = useState(existing?.lab ?? myLabs[0] ?? labs[0]?.id ?? "");
  const [owner, setOwner] = useState(existing?.owner ?? me ?? "");
  const [dealOwner, setDealOwner] = useState(existing?.dealOwner ?? existing?.owner ?? me ?? "");
  const [stage, setStage] = useState<Stage>(pendingStage ?? existing?.stage ?? "Lead");
  const [amount, setAmount] = useState(String(existing?.amount ?? ""));
  const [close, setClose] = useState(existing?.close ?? "");
  const [source, setSource] = useState<Source>(existing?.source ?? "Referral");
  const [recurring, setRecurring] = useState(existing?.recurring ?? false);
  const [companyId, setCompanyId] = useState<string | null>(existing?.companyId ?? null);
  const [contactId, setContactId] = useState<string | null>(existing?.contactId ?? null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showAssignment, setShowAssignment] = useState(false);
  const existingNotice = existing?.assignmentNotice;
  const noticeLocked = !!existingNotice && Object.keys(existingNotice.signatures || {}).length > 0;
  const [noticeLabLeaders, setNoticeLabLeaders] = useState<{ key: string; feeSharePct: string }[]>(
    existingNotice?.labLeaders.length
      ? existingNotice.labLeaders.map((l) => ({ key: l.key, feeSharePct: String(l.feeSharePct) }))
      : [{ key: dealOwner || owner || "", feeSharePct: "100" }]
  );
  const [noticeSubcontractorCosts, setNoticeSubcontractorCosts] = useState(String(existingNotice?.subcontractorCosts ?? 0));
  const [noticeHardCosts, setNoticeHardCosts] = useState(String(existingNotice?.hardCosts ?? 0));
  const [pendingOutcome, setPendingOutcome] = useState<Outcome>(existing?.outcome ?? "Won");
  const [signing, setSigning] = useState<string | null>(null);
  const [signatureText, setSignatureText] = useState("");

  const dealProposal = useMemo(
    () => (existing ? [...proposals].filter((p) => p.deal === existing.id).sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""))[0] : null),
    [proposals, existing]
  );

  const isClosed = stage === "Closed";
  const gated = billingRequiredAt(stage);
  const linked = !!companyId || !!contactId;
  const propGated = proposalRequiredAt(stage);
  const proposalSent = !!dealProposal?.sentAt;
  const canSave =
    !!title.trim() &&
    (linked || !gated) &&
    (!propGated || proposalSent) &&
    (!isClosed || (!!existing?.contractSigned && !!close));

  const hint = !title.trim()
    ? "A deal name is required"
    : !linked && gated
      ? `Link a company or a person to save at ${stage}`
      : propGated && !dealProposal
        ? `Attach a proposal before saving at ${stage}`
        : propGated && !proposalSent
          ? "Mark the proposal final and send it before saving at this stage"
          : isClosed && !existing?.contractSigned
            ? "A signed contract is required to close this deal"
            : isClosed && !close
              ? "Set the date this deal closed"
              : !linked
                ? `Unlinked — fine at ${stage}, required at ${BILLING_GATE_STAGE}`
                : "Ready to save";

  const buildNotice = (): AssignmentNotice | null => {
    const labLeadersOut: AssignmentNoticeLabLeader[] = [];
    for (const row of noticeLabLeaders) {
      const pct = Number(row.feeSharePct);
      if (!row.key || !Number.isFinite(pct) || pct < 0) return null;
      labLeadersOut.push({ key: row.key, feeSharePct: pct });
    }
    if (!labLeadersOut.length) return null;
    const pctSum = labLeadersOut.reduce((sum, l) => sum + l.feeSharePct, 0);
    if (Math.abs(pctSum - 100) > 0.01) return null;
    const subcontractorCosts = Number(noticeSubcontractorCosts);
    const hardCosts = Number(noticeHardCosts);
    if (!Number.isFinite(subcontractorCosts) || subcontractorCosts < 0) return null;
    if (!Number.isFinite(hardCosts) || hardCosts < 0) return null;
    return { labLeaders: labLeadersOut, subcontractorCosts, hardCosts, signatures: existingNotice?.signatures ?? {} };
  };

  const buildBody = (assignmentNotice?: AssignmentNotice) => ({
    client: title,
    lab,
    owner,
    dealOwner,
    stage,
    amount: Number(amount) || 0,
    close,
    source,
    recurring,
    companyId,
    contactId,
    ...(stage === "Closed" ? { outcome: pendingOutcome } : {}),
    ...(assignmentNotice ? { assignmentNotice } : {}),
  });

  const submit = async (assignmentNotice?: AssignmentNotice) => {
    setSaving(true);
    try {
      const body = buildBody(assignmentNotice);
      const saved = isNew
        ? await api<Deal>("/deals", { method: "POST", body: JSON.stringify(body) })
        : await api<Deal>(`/deals/${existing!.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(isNew ? "Deal created and linked" : "Deal saved");
      onSaved(saved);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save this deal.");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    const closing = stage === "Closed" && existing?.stage !== "Closed";
    if (closing && !existing?.assignmentNotice) {
      setShowAssignment(true);
      return;
    }
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
    if (!existing || !signatureText.trim()) return;
    setSigning(signerKey);
    try {
      const saved = await api<Deal>(`/deals/${existing.id}/assignment-notice/sign`, {
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
    if (!existing) return;
    if (!window.confirm(`Delete the deal for ${existing.client}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api(`/deals/${existing.id}`, { method: "DELETE" });
      toast.success("Deal deleted");
      onDeleted(existing.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete this deal.");
    } finally {
      setDeleting(false);
    }
  };

  if (showAssignment) {
    return (
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent showCloseButton={false} onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Assignment notice required</DialogTitle>
            <DialogDescription>
              Closing this deal requires naming which Lab Leader(s) are delivering the work and their fee split, plus any
              subcontractor and hard costs.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pv2-outcome">Outcome</Label>
              <Select value={pendingOutcome} onValueChange={(v) => setPendingOutcome(v as Outcome)}>
                <SelectTrigger id="pv2-outcome"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Won">Won</SelectItem>
                  <SelectItem value="Lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <LabLeaderFeeSplitEditor rows={noticeLabLeaders} setRows={setNoticeLabLeaders} options={labLeaderOptions} />

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pv2-subcontractor-costs">Subcontractor costs</Label>
                <Input id="pv2-subcontractor-costs" type="number" min={0} value={noticeSubcontractorCosts} onChange={(e) => setNoticeSubcontractorCosts(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pv2-hard-costs">Hard costs</Label>
                <Input id="pv2-hard-costs" type="number" min={0} value={noticeHardCosts} onChange={(e) => setNoticeHardCosts(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignment(false)} disabled={saving}>Cancel</Button>
            <Button disabled={saving} onClick={confirmAssignmentAndSave}>{saving ? "Saving…" : "Confirm & close deal"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="w-full gap-0 p-0 sm:max-w-[520px]"
        overlayClassName="bg-[rgba(17,17,17,0.28)] backdrop-blur-none"
        showCloseButton={false}
      >
        <SheetHeader className="flex-row items-center gap-3 border-b border-hair p-4">
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate">{isNew ? "New deal" : title.trim() || "Untitled deal"}</SheetTitle>
            <SheetDescription className="text-xs">
              {isNew ? "Needs a name and a billing entity" : `${labs.find((l) => l.id === lab)?.name ?? lab} · ${stage}`}
            </SheetDescription>
          </div>
          <Button variant="outline" size="icon-sm" className="rounded-full" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pv2-title">Deal name</Label>
              <Input id="pv2-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Grace Network — cohort two" disabled={!editable} />
            </div>

            <BillingEntityPanel
              stage={stage}
              companyId={companyId}
              contactId={contactId}
              onChangeCompany={setCompanyId}
              onChangeContact={setContactId}
              onOpenRecord={onOpenRecord}
              editable={editable}
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pv2-lab">Lab</Label>
                <Select value={lab} onValueChange={setLab} disabled={!editable}>
                  <SelectTrigger id="pv2-lab"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {labs.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pv2-stage">Stage</Label>
                <Select value={stage} onValueChange={(v) => setStage(v as Stage)} disabled={!editable}>
                  <SelectTrigger id="pv2-stage"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pv2-owner">Owner</Label>
                <Select value={owner} onValueChange={setOwner} disabled={!editable}>
                  <SelectTrigger id="pv2-owner"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {leaders.map((p) => <SelectItem key={p.username} value={p.username}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pv2-deal-owner">Deal owner</Label>
                <Select value={dealOwner} onValueChange={setDealOwner} disabled={!editable}>
                  <SelectTrigger id="pv2-deal-owner"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {leaders.map((p) => <SelectItem key={p.username} value={p.username}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pv2-source">Source</Label>
                <Select value={source} onValueChange={(v) => setSource(v as Source)} disabled={!editable}>
                  <SelectTrigger id="pv2-source"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pv2-amount">Amount</Label>
                <Input id="pv2-amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="10000" disabled={!editable} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pv2-close" className={isClosed && !close ? "text-red" : undefined}>
                {isClosed ? "Close date" : "Expected close"}
              </Label>
              <Input id="pv2-close" type="date" value={close} onChange={(e) => setClose(e.target.value)} disabled={!editable} />
            </div>

            <label className="flex items-center gap-2 text-sm text-ink">
              <Checkbox checked={recurring} onCheckedChange={(c) => setRecurring(!!c)} disabled={!editable} />
              Recurring engagement — bills monthly until paused or ended
            </label>

            {!isNew && <ProposalPanel deal={existing!} />}
            {!isNew && <InvoicesPanel deal={existing!} onDealUpdated={onSaved} />}

            {isClosed && !isNew && (
              <div className="rounded-2xl border border-hair bg-warm-panel p-4">
                <div className="mb-1 text-[11px] font-semibold tracking-wide text-warm-gray uppercase">Signed contract</div>
                <p className="text-xs text-ink-mute">
                  {existing?.contractSigned
                    ? "On file — a signed client contract is attached to this deal."
                    : "Required to close. Generate and sign the contract from the Proposal section above, or on the Contracts page."}
                </p>
                {existing?.contractSigned && (
                  <a href="/contracts" className="mt-2 inline-block text-xs font-semibold text-violet-deep hover:text-violet">Manage on Contracts →</a>
                )}
              </div>
            )}

            {!isNew && existing?.stage === "Closed" && existingNotice && (
              <div className="flex flex-col gap-4 border-t border-hair pt-4">
                <h3 className="text-sm font-medium text-ink">Assignment Notice</h3>
                <LabLeaderFeeSplitEditor rows={noticeLabLeaders} setRows={setNoticeLabLeaders} options={labLeaderOptions} disabled={!editable || noticeLocked} />
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pv2-subcontractor-costs-2">Subcontractor costs</Label>
                    <Input id="pv2-subcontractor-costs-2" type="number" min={0} value={noticeSubcontractorCosts} onChange={(e) => setNoticeSubcontractorCosts(e.target.value)} disabled={!editable || noticeLocked} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pv2-hard-costs-2">Hard costs</Label>
                    <Input id="pv2-hard-costs-2" type="number" min={0} value={noticeHardCosts} onChange={(e) => setNoticeHardCosts(e.target.value)} disabled={!editable || noticeLocked} />
                  </div>
                </div>
                <div className="flex flex-col gap-2" role="group" aria-labelledby="pv2-signatures-label">
                  <Label id="pv2-signatures-label">Signatures</Label>
                  {[...existingNotice.labLeaders.map((l) => l.key), OL_SIGNER_KEY].map((key) => {
                    const sig = existingNotice.signatures[key];
                    const label = key === OL_SIGNER_KEY ? "Optimistic Labs" : fullName(people[key]) || key;
                    const canSign = !sig && (role === "Admin" || (key !== OL_SIGNER_KEY && me === key));
                    return (
                      <div key={key} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-ink">{label}</span>
                        {sig ? (
                          <span className="text-xs text-ink-mute">Signed &ldquo;{sig.name}&rdquo; by {sig.verifiedName || sig.by}</span>
                        ) : canSign ? (
                          signing === key ? (
                            <div className="flex items-center gap-2">
                              <Input autoFocus placeholder="Type your name" value={signatureText} onChange={(e) => setSignatureText(e.target.value)} className="h-8 w-40" />
                              <Button size="sm" onClick={() => sign(key)} disabled={!signatureText.trim()}>Sign</Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setSigning(key)}>Sign</Button>
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
          </div>
        </div>

        <div className="flex flex-none items-center gap-2 border-t border-hair p-4">
          {!isNew && can.deleteDeal(role!) && (
            <Button variant="outline" className="rounded-full text-red" onClick={del} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          )}
          <span className={`flex-1 text-xs leading-tight ${canSave ? "text-ink-mute" : "text-red"}`}>{hint}</span>
          {editable && (
            <Button className="rounded-full" onClick={handleSave} disabled={saving || !canSave}>
              {saving ? "Saving…" : isNew ? "Create deal" : "Save"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
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
    <div className="flex flex-col gap-2" role="group" aria-labelledby="pv2-fee-split-label">
      <Label id="pv2-fee-split-label">Lab Leader fee split</Label>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Select value={row.key} onValueChange={(v) => setRows(rows.map((r, idx) => (idx === i ? { ...r, key: v } : r)))} disabled={disabled}>
            <SelectTrigger className="flex-1" aria-label={`Lab Leader for fee-share row ${i + 1}`}>
              <SelectValue placeholder="Lab Leader" />
            </SelectTrigger>
            <SelectContent>
              {options.map((p) => <SelectItem key={p.username} value={p.username}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={0}
            max={100}
            value={row.feeSharePct}
            onChange={(e) => setRows(rows.map((r, idx) => (idx === i ? { ...r, feeSharePct: e.target.value } : r)))}
            disabled={disabled}
            className="w-20"
            aria-label={`Fee share percent for row ${i + 1}`}
          />
          <span className="text-xs text-ink-mute">%</span>
          {!disabled && rows.length > 1 && (
            <Button variant="ghost" size="icon-sm" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}>✕</Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setRows([...rows, { key: "", feeSharePct: "" }])}>
          + Add Lab Leader
        </Button>
      )}
      <span className={`text-xs ${Math.abs(total - 100) > 0.01 ? "text-red" : "text-ink-mute"}`}>Total: {total}% (must equal 100%)</span>
    </div>
  );
}
