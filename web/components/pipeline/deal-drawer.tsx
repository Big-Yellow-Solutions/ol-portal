"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { fullName, isActive } from "@/lib/data";
import { assignmentState, billingRequiredAt, proposalRequiredAt, BILLING_GATE_STAGE, CLOSED_WON } from "@/lib/pipeline";
import { usePortalData } from "@/lib/portal-data";
import { STAGES, STAGE_LABELS, SOURCES } from "@/lib/types";
import type { Deal, Source, Stage } from "@/lib/types";
import { BillingEntityPanel } from "@/components/pipeline/billing-entity-panel";
import { DocumentUploadPanel } from "@/components/pipeline/document-upload-panel";
import { AssignmentTab } from "@/components/pipeline/assignment-tab";

/* Pipeline v2 (design handoff): the deal drawer. The design draws one panel
   that both views and edits a deal — no separate read-only mode — so this
   replaces the old DealView (read) + DealDialog (edit) split with a single
   form, matching that. `pendingStage` is set when the board's drag-and-drop
   gate rejects a drop: it opens this drawer already showing the target stage
   so fixing the blocker (billing entity / proposal / contract) and hitting
   Save also completes the move, mirroring the prototype's openDeal + setState
   pattern. */
type DrawerTab = "details" | "documents" | "assignment";

const DRAWER_TABS: { key: DrawerTab; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "documents", label: "Documents" },
  { key: "assignment", label: "Assignment" },
];

export function DealDrawer({
  deal,
  open,
  pendingStage,
  initialTab = "details",
  onClose,
  onSaved,
  onDealUpdated,
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
  /* Filing or approving an assignment updates the deal without leaving it —
     unlike Save, which closes the drawer. */
  onDealUpdated: (deal: Deal) => void;
  onDeleted: (id: string) => void;
  onOpenRecord: (type: "company" | "contact", id: string) => void;
}) {
  const { labs, people, proposals, files, role, me, myLabs } = usePortalData();
  const isNew = deal === "new";
  const existing = isNew ? null : deal;
  const editable = existing ? can.editDeal(existing, role!, myLabs, me) : can.addDeal(role!, myLabs);

  const [tab, setTab] = useState<DrawerTab>(initialTab);
  /* Filing an assignment returns the whole updated deal; keeping it here lets
     the tab flip straight to its receipt without closing and reopening. */
  const [liveDeal, setLiveDeal] = useState<Deal | null>(existing);
  const assignment = liveDeal ? assignmentState(liveDeal) : "locked";
  /* A new deal has no tabs, so it always shows the details form. */
  const showDetails = isNew || tab === "details";
  const showDocuments = !isNew && tab === "documents";
  const showAssignmentTab = !isNew && tab === "assignment";

  const leaders = useMemo(
    () => Object.entries(people).filter(([, p]) => isActive(p) && (p.role === "Admin" || p.role === "Lab Leader")).map(([username, p]) => ({ username, name: fullName(p) || username })),
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

  const buildBody = () => ({
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
  });

  const submit = async () => {
    setSaving(true);
    try {
      const body = buildBody();
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
    await submit();
  };

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
              // The Assignment tab reads amber while one is owed, so the deal
              // says what it needs without anyone opening the tab to find out.
              const owed = t.key === "assignment" && assignment === "needed";
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
                      : owed
                        ? "bg-amber-pale font-semibold text-amber"
                        : "font-medium text-ink-soft hover:bg-[#F1EEFE] hover:text-violet-deep"
                  )}
                >
                  {t.label}
                  {owed && <span className="ml-1.5 text-[11px] font-semibold">Needs you</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-4">
            {showDetails && (
              <>
                {/* Only a won deal owes an assignment. A lost one never does,
                    which is why the lost stage exists at all. */}
                {liveDeal && assignment === "needed" && (
                  <div className="rounded-2xl border border-amber/30 bg-amber-pale p-4">
                    <p className="text-[11px] font-semibold tracking-wide text-amber uppercase">
                      Lab Leader Assignment needed
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-amber">
                      {!hasContract
                        ? "Add the signed contract and close date first, then the assignment form unlocks the payout schedule."
                        : !close
                          ? "Set the close date, then fill out the assignment form — finance needs it before any payment is released."
                          : "Finance needs this completed before work begins and payments are released."}
                    </p>
                    {hasContract && !!close && (
                      <Button size="sm" className="mt-3 rounded-full bg-amber text-white hover:bg-amber/90" onClick={() => setTab("assignment")}>
                        Go to the assignment form →
                      </Button>
                    )}
                  </div>
                )}
                {liveDeal && (assignment === "filed" || assignment === "approved") && (
                  <div className="flex items-center gap-3 rounded-2xl border border-green/30 bg-green-pale/50 p-3.5">
                    <span className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-green-pale text-green">✓</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-ink">Assignment form on file</span>
                      <span className="block truncate text-xs text-ink-mute">
                        {assignment === "approved" ? "Approved" : "Awaiting approval"}
                        {liveDeal.assignment?.leaders.length
                          ? ` · ${liveDeal.assignment.leaders.map((l) => fullName(people[l.key]) || l.key).join(", ")}`
                          : ""}
                      </span>
                    </span>
                    <button type="button" className="shrink-0 text-xs font-semibold text-violet-deep hover:text-violet" onClick={() => setTab("assignment")}>
                      View
                    </button>
                  </div>
                )}
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
                    if (next === CLOSED_WON && stage !== CLOSED_WON) setClose("");
                    setStage(next);
                  }}
                  disabled={!editable}
                >
                  <SelectTrigger id="pv2-stage"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}
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

              </>
            )}

            {showAssignmentTab && liveDeal && (
              <AssignmentTab
                deal={liveDeal}
                editable={editable}
                onSaved={(saved) => {
                  setLiveDeal(saved);
                  onDealUpdated(saved);
                }}
              />
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
