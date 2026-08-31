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
import { cn } from "@/lib/utils";
import { DealDrawerFooter } from "@/components/pipeline/deal-drawer-footer";
import { LabLeaderFeeSplitEditor } from "@/components/pipeline/fee-split-editor";
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
import { DocumentUploadPanel } from "@/components/pipeline/document-upload-panel";

const OL_SIGNER_KEY = "ol";

/* Pipeline v2 (design handoff): the deal drawer. The design draws one panel
   that both views and edits a deal — no separate read-only mode — so this
   replaces the old DealView (read) + DealDialog (edit) split with a single
   form, matching that. `pendingStage` is set when the board's drag-and-drop
   gate rejects a drop: it opens this drawer already showing the target stage
   so fixing the blocker (billing entity / proposal / contract) and hitting
   Save also completes the move, mirroring the prototype's openDeal + setState
   pattern. */
type DrawerTab = "details" | "documents";

const DRAWER_TABS: { key: DrawerTab; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "documents", label: "Documents" },
];

export function DealDrawer({
  deal,
  open,
  pendingStage,
  initialTab = "details",
  onClose,
  onSaved,
  onDeleted,
  onOpenRecord,
}: {
  deal: Deal | "new";
  open: boolean;
  pendingStage?: Stage;
  /* Which tab to land on. The board's proposal and contract gates open the
     drawer straight on Documents, because that is where the blocker is. */
  initialTab?: DrawerTab;
  onClose: () => void;
  onSaved: (deal: Deal) => void;
  onDeleted: (id: string) => void;
  onOpenRecord: (type: "company" | "contact", id: string) => void;
}) {
  const { labs, people, proposals, files, role, me, myLabs } = usePortalData();
  const isNew = deal === "new";
  const existing = isNew ? null : deal;
  const editable = existing ? can.editDeal(existing, role!, myLabs, me) : can.addDeal(role!, myLabs);

  const [tab, setTab] = useState<DrawerTab>(initialTab);
  /* A new deal has no tabs, so it always shows the details form. */
  const showDetails = isNew || tab === "details";
  const showDocuments = !isNew && tab === "documents";

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
  /* An expected-close date is a forecast; a close date is a fact. The design
     will not let the first quietly become the second, so arriving at Closed
     clears it — both on a drag that lands here and on the stage select
     below — and the Save gate then asks for the real one. */
  const [close, setClose] = useState(
    pendingStage === "Closed" && existing?.stage !== "Closed" ? "" : (existing?.close ?? "")
  );
  const [source, setSource] = useState<Source>(existing?.source ?? "Referral");
  const [recurring, setRecurring] = useState(existing?.recurring ?? false);
  const [companyId, setCompanyId] = useState<string | null>(existing?.companyId ?? null);
  const [contactId, setContactId] = useState<string | null>(existing?.contactId ?? null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pausing, setPausing] = useState(false);

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

  /* Proposals are written outside the portal and uploaded onto the deal, so
     an uploaded proposal document is what clears the stage gate. A proposal
     that was marked final and sent from here before that changed still
     counts, so deals already past the gate are not asked to re-upload a
     document nobody kept — backend/src/app.mjs accepts the same two. */
  const hasProposal = useMemo(
    () =>
      !!existing &&
      (files.some((f) => f.deal === existing.id && f.kind === "proposal") ||
        proposals.some((p) => p.deal === existing.id && !!p.sentAt)),
    [files, proposals, existing]
  );

  /* The signed contract works the same way: rollUpDeal sets `contractSigned`
     for paper signed through the portal, and a contract uploaded onto the deal
     covers paper signed outside it — backend/src/app.mjs accepts either. */
  const hasContract = useMemo(
    () =>
      !!existing &&
      (!!existing.contractSigned ||
        files.some((f) => f.deal === existing.id && f.kind === "contract")),
    [files, existing]
  );

  const isClosed = stage === "Closed";
  const gated = billingRequiredAt(stage);
  const linked = !!companyId || !!contactId;
  const propGated = proposalRequiredAt(stage);
  const canSave =
    !!title.trim() &&
    (linked || !gated) &&
    (!propGated || hasProposal) &&
    (!isClosed || (hasContract && !!close));

  const hint = !title.trim()
    ? "A deal name is required"
    : !linked && gated
      ? `Link a company or a person to save this deal at ${stage}`
      : propGated && !hasProposal
        ? `Upload a proposal before saving this deal at ${stage}`
        : isClosed && !hasContract
          ? "Upload the signed contract before closing this deal"
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

  /* Pausing recurring billing used to live in the drawer's Invoices section,
     which is now an upload box for invoice documents. The control moved to
     sit with the recurring flag it acts on; it PATCHes immediately rather
     than waiting on Save, exactly as it did before. */
  const togglePause = async () => {
    if (!existing) return;
    setPausing(true);
    try {
      const saved = await api<Deal>(`/deals/${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ recurPaused: !existing.recurPaused }),
      });
      toast.success(saved.recurPaused ? "Recurring billing paused" : "Recurring billing resumed");
      onSaved(saved);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update this deal.");
    } finally {
      setPausing(false);
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

        {/* A new deal has no documents yet — every panel below is gated on an
            existing record — so the strip only appears once there is one. */}
        {!isNew && (
          <div className="flex flex-none items-end gap-0.5 border-b border-hair px-4">
            {DRAWER_TABS.map((t) => {
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "-mb-px cursor-pointer rounded-t-[10px] px-3.5 pt-2.5 pb-2 text-sm whitespace-nowrap transition-colors",
                    on
                      ? "border-b-2 border-violet-deep bg-violet-pale font-semibold text-violet-deep"
                      : "font-medium text-ink-soft hover:bg-[#F1EEFE] hover:text-violet-deep"
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-4">
            {showDetails && (
              <>
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
                <Select
                  value={stage}
                  onValueChange={(v) => {
                    const next = v as Stage;
                    if (next === "Closed" && stage !== "Closed") setClose("");
                    setStage(next);
                  }}
                  disabled={!editable}
                >
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

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm text-ink">
                <Checkbox checked={recurring} onCheckedChange={(c) => setRecurring(!!c)} disabled={!editable} />
                Recurring engagement — bills monthly until paused or ended
              </label>
              {existing?.recurring && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hair-soft bg-warm-panel px-3 py-2">
                  <span className="text-xs text-ink-mute">
                    Bills monthly{existing.recurPaused ? " · currently paused" : ""}
                  </span>
                  {editable && (
                    <Button size="sm" variant="outline" className="rounded-full" onClick={togglePause} disabled={pausing}>
                      {pausing ? "…" : existing.recurPaused ? "Resume" : "Pause"}
                    </Button>
                  )}
                </div>
              )}
            </div>

              </>
            )}

            {showDocuments && (
              <>
            <DocumentUploadPanel
              deal={existing!}
              kind="proposal"
              label="Upload Proposal"
              hint="Attach the proposal document for this deal. Uploading again supersedes it — earlier versions stay on record."
              editable={editable}
            />
            <DocumentUploadPanel
              deal={existing!}
              kind="contract"
              label="Upload Contract"
              hint="Attach the signed contract for this deal. Uploading again supersedes it — earlier versions stay on record."
              editable={editable}
            />
            <DocumentUploadPanel
              deal={existing!}
              kind="invoice"
              label="Upload Invoice"
              hint="Attach each invoice issued for this deal. Uploads are saved immediately."
              editable={editable}
            />

            {isClosed && (
              <div className="rounded-2xl border border-hair bg-warm-panel p-4">
                <div className="mb-1 text-[11px] font-semibold tracking-wide text-warm-gray uppercase">Signed contract</div>
                <p className="text-xs text-ink-mute">
                  {existing?.contractSigned
                    ? "On file — a signed client contract is attached to this deal."
                    : hasContract
                      ? "On file — a signed contract is uploaded above."
                      : "Required to close. Upload the signed contract above, or build and sign one on the Contracts page."}
                </p>
                {existing?.contractSigned && (
                  <a href="/contracts" className="mt-2 inline-block text-xs font-semibold text-violet-deep hover:text-violet">Manage on Contracts →</a>
                )}
              </div>
            )}

            {existing?.stage === "Closed" && existingNotice && (
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
              </>
            )}
          </div>
        </div>

        <DealDrawerFooter
          hint={hint}
          tone={canSave ? "mute" : "warn"}
          onDelete={!isNew && can.deleteDeal(role!) ? del : undefined}
          deleting={deleting}
          onSave={editable ? handleSave : undefined}
          saving={saving}
          saveLabel={isNew ? "Create deal" : "Save"}
          saveDisabled={!canSave}
        />
      </SheetContent>
    </Sheet>
  );
}
