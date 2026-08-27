"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileText } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/can";
import { PROPOSAL_VARIANT, CONTRACT_VARIANT } from "@/lib/data";
import { track } from "@/lib/analytics";
import { usePortalData } from "@/lib/portal-data";
import { ChevronDown } from "lucide-react";
import { VersionViewer } from "@/components/pipeline/version-viewer";
import { SECTION_KEYS, SECTION_LABELS } from "@/lib/types";
import type { ProposalVersionSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { Contract, Deal, Proposal } from "@/lib/types";

const emptySections = (): Record<string, string> => Object.fromEntries(SECTION_KEYS.map((k) => [k, ""]));

/* Pipeline v2 (design handoff) draws the deal drawer's "Proposal" section as
   a small ad hoc file attachment (name/version/status, a couple of buttons).
   The real Proposal here is a structured, multi-section document with its own
   versioning, send-to-client, and customer decision loop (see
   backend/src/proposals.mjs) — reproducing the design's simpler shape would
   mean building a second, disconnected proposal system next to the one this
   app already has. This ports deal-view-proposal-tab.tsx's actual logic into
   the new drawer's compact layout instead of inventing that duplicate. */
export function ProposalPanel({ deal }: { deal: Deal }) {
  const { role, me, myLabs, proposals, contracts, setProposals, setContracts } = usePortalData();

  const proposal = useMemo(
    () =>
      [...proposals].filter((p) => p.deal === deal.id).sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""))[0] ??
      null,
    [proposals, deal.id]
  );
  const contract = useMemo(
    () => contracts.find((c) => c.deal === deal.id && (c.docKind ?? "client") === "client") ?? null,
    [contracts, deal.id]
  );

  const [starting, setStarting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editSections, setEditSections] = useState<Record<string, string>>(emptySections());
  const [savingSections, setSavingSections] = useState(false);
  const [markingFinal, setMarkingFinal] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [clientEmail, setClientEmail] = useState("");
  const [sendEmailFlag, setSendEmailFlag] = useState(true);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);

  if (!role) return null;
  const editable = role === "Admin" || (role === "Lab Leader" && can.editDeal(deal, role, myLabs, me));

  async function startProposal() {
    setStarting(true);
    try {
      const created = await api<Proposal>("/proposals", {
        method: "POST",
        body: JSON.stringify({ dealId: deal.id, title: `${deal.client} proposal` }),
      });
      setProposals((prev) => [created, ...prev]);
      track("dealview.proposal_started", { dealId: deal.id });
      toast.success("Proposal started");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not start a proposal.");
    } finally {
      setStarting(false);
    }
  }

  function openEditSections() {
    setEditSections({ ...emptySections(), ...(proposal?.sections ?? {}) });
    setEditOpen(true);
  }

  async function saveSections() {
    if (!proposal) return;
    setSavingSections(true);
    try {
      const updated = await api<Proposal>(`/proposals/${proposal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sections: editSections }),
      });
      setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      track("dealview.proposal_edited", { dealId: deal.id, proposalId: proposal.id });
      toast.success("Proposal saved");
      setEditOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the proposal.");
    } finally {
      setSavingSections(false);
    }
  }

  async function markFinal() {
    if (!proposal) return;
    setMarkingFinal(true);
    try {
      const updated = await api<Proposal>(`/proposals/${proposal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ final: true }),
      });
      setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      track("dealview.proposal_marked_final", { dealId: deal.id, proposalId: proposal.id });
      toast.success("Marked Final");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not mark this version Final.");
    } finally {
      setMarkingFinal(false);
    }
  }

  function openSend() {
    setClientEmail(proposal?.clientEmail ?? "");
    setSendOpen(true);
  }

  async function submitSend() {
    if (!proposal) return;
    setSending(true);
    try {
      const updated = await api<Proposal>(`/proposals/${proposal.id}/send`, {
        method: "POST",
        body: JSON.stringify({ ...(clientEmail ? { clientEmail } : {}), sendEmail: sendEmailFlag && !!clientEmail }),
      });
      setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      track("dealview.proposal_sent", { dealId: deal.id, proposalId: proposal.id });
      toast.success("Proposal sent");
      setSendOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send this proposal.");
    } finally {
      setSending(false);
    }
  }

  async function generateContract() {
    if (!proposal) return;
    setGenerating(true);
    try {
      const created = await api<Contract & { alreadyExisted?: boolean }>("/contracts", {
        method: "POST",
        body: JSON.stringify({ proposalId: proposal.id }),
      });
      setContracts((prev) => (prev.some((c) => c.id === created.id) ? prev.map((c) => (c.id === created.id ? created : c)) : [created, ...prev]));
      track("dealview.contract_generated", { dealId: deal.id, proposalId: proposal.id });
      toast.success(created.alreadyExisted ? "This proposal already has a contract" : "Contract generated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not generate a contract.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="rounded-2xl border border-hair bg-warm-panel p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-warm-gray uppercase">Proposal</span>
        {proposal && <Badge variant={PROPOSAL_VARIANT[proposal.status]}>{proposal.status}</Badge>}
      </div>

      {!proposal ? (
        <>
          <p className="mb-3 text-xs leading-relaxed text-ink-mute">
            Sections, pricing and send-to-client all live here once a proposal is started.
          </p>
          {editable && (
            <Button size="sm" onClick={startProposal} disabled={starting} className="rounded-full">
              {starting ? "Starting…" : "+ Start a proposal"}
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="mb-3 text-xs text-ink-mute">
            v{proposal.version || 0}
            {proposal.final ? " · Final" : ""}
            {proposal.dirty ? " · unsaved changes" : ""}
          </p>

          <div className="mb-3 rounded-xl border border-violet-deep bg-white p-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-pale">
                <FileText size={15} className="text-violet-deep" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{proposal.title}</span>
                <span className="block text-xs text-ink-mute">
                  {proposal.sentAt ? `Sent v${proposal.sentVersion}` : "Draft"}
                </span>
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hair-soft pt-3">
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setPreviewOpen(true)}>
                Preview
              </Button>
              {editable && (
                <>
                  <Button variant="outline" size="sm" className="rounded-full" onClick={openEditSections}>
                    Edit sections
                  </Button>
                  {!proposal.final && (
                    <Button size="sm" className="rounded-full" onClick={markFinal} disabled={markingFinal}>
                      {markingFinal ? "Marking…" : "Mark Final"}
                    </Button>
                  )}
                  {proposal.final && (
                    <Button size="sm" className="rounded-full" onClick={openSend}>
                      {proposal.sentAt ? "Send updated version" : "Mark final and send"}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          <VersionHistory proposal={proposal} />

          <ContributorShare deal={deal} proposal={proposal} editable={editable} />

          {proposal.decision && (
            <p className="mb-3 text-xs text-ink-mute">
              Customer {proposal.decision.action === "approve" ? "approved" : proposal.decision.action === "reject" ? "declined" : "requested changes to"} v
              {proposal.decision.version}
              {proposal.decision.comment ? `: "${proposal.decision.comment}"` : ""}
            </p>
          )}

          {proposal.approvedVersion && (
            <div className="rounded-xl border border-hair-soft bg-white p-3">
              <div className="mb-1 text-[11px] font-semibold tracking-wide text-warm-gray uppercase">Contract</div>
              {contract ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant={CONTRACT_VARIANT[contract.status]}>{contract.status}</Badge>
                  <a href="/contracts" className="text-xs font-semibold text-violet-deep hover:text-violet">
                    Manage on Contracts →
                  </a>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-ink-mute">{deal.client} approved — generate the contract to start signing.</p>
                  {editable && (
                    <Button size="sm" className="rounded-full" onClick={generateContract} disabled={generating}>
                      {generating ? "Generating…" : "Generate contract"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {proposal && (
        <>
          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{proposal.title}</DialogTitle>
                <DialogDescription>Read-only — use Edit sections to make changes.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                {SECTION_KEYS.map((k) => (
                  <div key={k}>
                    <h3 className="font-heading text-sm text-ink">{SECTION_LABELS[k]}</h3>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-ink-soft">{proposal.sections?.[k] || "—"}</p>
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit proposal sections</DialogTitle>
                <DialogDescription>Saving commits a new version.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                {SECTION_KEYS.map((k) => (
                  <div key={k} className="flex flex-col gap-1.5">
                    <Label htmlFor={`sec-${k}`}>{SECTION_LABELS[k]}</Label>
                    <Textarea id={`sec-${k}`} rows={4} value={editSections[k] ?? ""} onChange={(e) => setEditSections((prev) => ({ ...prev, [k]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button onClick={saveSections} disabled={savingSections}>{savingSections ? "Saving…" : "Save"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={sendOpen} onOpenChange={setSendOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Send to client</DialogTitle>
                <DialogDescription>Sends the Final version (v{proposal.finalVersion}) behind a private link.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pv2-client-email">Client email</Label>
                  <Input id="pv2-client-email" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="client@example.com" />
                </div>
                <label className="flex items-center gap-2 text-sm text-ink-soft">
                  <Checkbox checked={sendEmailFlag} onCheckedChange={(v) => setSendEmailFlag(!!v)} />
                  Email the client directly
                </label>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSendOpen(false)}>Cancel</Button>
                <Button onClick={submitSend} disabled={sending}>{sending ? "Sending…" : "Send"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

function ContributorShare({ deal, proposal, editable }: { deal: Deal; proposal: Proposal; editable: boolean }) {
  const { setProposals } = usePortalData();
  const [name, setName] = useState(proposal.contributorName ?? "");
  const [email, setEmail] = useState(proposal.contributorEmail ?? "");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const updated = await api<Proposal>(`/proposals/${proposal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ contributorName: name, contributorEmail: email }),
      });
      setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      track("dealview.proposal_shared", { dealId: deal.id, proposalId: proposal.id });
      toast.success("Contributor updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update the contributor.");
    } finally {
      setSaving(false);
    }
  }

  if (!editable) {
    return proposal.contributorName ? (
      <p className="mb-3 text-xs text-ink-mute">Shared with {proposal.contributorName}</p>
    ) : null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button type="button" onClick={() => setOpen(true)} className="mb-3 block text-xs font-medium text-violet-deep hover:text-violet">
        {proposal.contributorName ? `Shared with ${proposal.contributorName}` : "Share with a Contributor"}
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share with a Contributor</DialogTitle>
          <DialogDescription>Naming a Contributor lets them view this proposal.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pv2-contrib-name">Name</Label>
            <Input id="pv2-contrib-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pv2-contrib-email">Email</Label>
            <Input id="pv2-contrib-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* The design's version history: a caret toggle that opens a list of earlier
   versions, each row opening the read-only viewer. The newest snapshot is the
   proposal's current version, so it is not "earlier" and is left out. */
function VersionHistory({ proposal }: { proposal: Proposal }) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<ProposalVersionSnapshot | null>(null);

  const earlier = [...(proposal.versions ?? [])]
    .sort((a, b) => b.v - a.v)
    .slice(1);
  if (earlier.length === 0) return null;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-warm-gray transition-colors hover:text-violet-deep"
      >
        <ChevronDown
          size={13}
          className={cn("transition-transform duration-150", open && "rotate-180")}
          aria-hidden
        />
        {earlier.length} earlier version{earlier.length === 1 ? "" : "s"}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-1">
          {earlier.map((v) => (
            <button
              key={v.v}
              type="button"
              onClick={() => setViewing(v)}
              className="flex cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-white"
            >
              <span className="flex-none rounded-full bg-violet-pale px-2 py-0.5 text-[10px] font-bold text-violet-deep">
                v{v.v}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink">
                {proposal.title}
              </span>
              <span className="flex-none text-[11px] text-warm-gray">
                {[v.status, v.date].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
        </div>
      )}

      <VersionViewer
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
        snapshot={viewing}
        title={proposal.title}
        supersededBy={viewing ? proposal.version : undefined}
      />
    </div>
  );
}
