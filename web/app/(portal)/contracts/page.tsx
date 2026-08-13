"use client";

/* Contracts (Base Contract PRD 5.4-5.5, Contributor MSA PRD).

   The page walks the second half of the flow end to end: approved proposals
   waiting for a contract sit at the top, contracts in flight sit below with
   whatever action is actually next on each one, and the Admin countersignature
   is offered only to the Admin the contract routes to.

   Customer paper and contributor paper are split across two tabs rather than
   interleaved. They're the same record type and the same signing flow, but
   they're different businesses — who OL is selling to, and who OL is engaging
   — and a single list sorted by date reads as neither (PRD 8). */

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContractEditor } from "@/components/contract-editor";
import { CountersignDialog } from "@/components/countersign-dialog";
import { InviteContributorDialog } from "@/components/invite-contributor-dialog";
import { NewContractDialog } from "@/components/new-contract-dialog";
import { NewTaskOrderDialog } from "@/components/new-task-order-dialog";
import {
  CONTRACT_VARIANT, DOC_KIND_LABEL, docKindOf, fmtDollars, fullName, isContributorDoc,
} from "@/lib/data";
import { pricingTotal } from "@/lib/pricing";
import { api, ApiError } from "@/lib/api";
import { usePortalData } from "@/lib/portal-data";
import type { Contract, Proposal } from "@/lib/types";

export default function ContractsPage() {
  const {
    loading, error, contracts, proposals, labs, people, role, me, setContracts, setProposals,
  } = usePortalData();
  const [editing, setEditing] = useState<Contract | null>(null);
  const [inviting, setInviting] = useState<Contract | null>(null);
  const [countersigning, setCountersigning] = useState<Contract | null>(null);
  const [creating, setCreating] = useState(false);
  const [taskOrderFor, setTaskOrderFor] = useState<Contract | null>(null);
  const [side, setSide] = useState<"client" | "contributor">("client");
  const [busy, setBusy] = useState<string | null>(null);

  const labName = (id: string) => labs.find((l) => l.id === id)?.name ?? id;
  const personName = (username?: string) =>
    username ? fullName(people[username]) || username : "—";

  if (loading) return <p className="text-sm text-ink-mute">Loading…</p>;
  if (error) return <p className="text-sm text-red">{error}</p>;

  const isReadOnly = role === "Contributor";

  // PRD 5.4.1: only a customer-approved proposal can become a contract, and
  // only once. Anything already converted drops off this list.
  const contractedProposals = new Set(contracts.map((c) => c.proposal).filter(Boolean));
  const awaitingContract = proposals.filter(
    (p) => p.approvedVersion && !contractedProposals.has(p.id)
  );

  const replace = (saved: Contract) =>
    setContracts((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));

  /* Task orders sort directly under the MSA they belong to rather than by date,
     so a relationship reads as one thing. Everything else keeps the newest-first
     order the list already had. */
  const shown = contracts.filter((c) =>
    side === "contributor" ? isContributorDoc(c) : !isContributorDoc(c)
  );
  const ordered =
    side === "contributor"
      ? shown
          .filter((c) => docKindOf(c) === "msa")
          .flatMap((msa) => [msa, ...shown.filter((c) => c.parentId === msa.id)])
          // An orphan can exist if an MSA is outside this viewer's labs but a
          // task order under it isn't; showing it alone beats hiding it.
          .concat(shown.filter((c) => c.parentId && !shown.some((m) => m.id === c.parentId)))
      : shown;

  const generate = async (proposal: Proposal) => {
    setBusy(proposal.id);
    try {
      const created = await api<Contract & { alreadyExisted?: boolean }>("/contracts", {
        method: "POST",
        body: JSON.stringify({ proposalId: proposal.id }),
      });
      setContracts((prev) =>
        prev.some((c) => c.id === created.id) ? prev.map((c) => (c.id === created.id ? created : c)) : [created, ...prev]
      );
      if (!created.templateId) {
        toast.warning(
          `${created.id} created, but ${labName(created.lab)} has no contract template, so it has no standard terms yet.`
        );
      } else {
        toast.success(`${created.id} created from ${proposal.id}`);
      }
      setEditing(created);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not generate the contract.");
    } finally {
      setBusy(null);
    }
  };

  const sendForSignature = async (contract: Contract) => {
    setBusy(contract.id);
    try {
      const saved = await api<Contract & { emailSent?: boolean; emailError?: string }>(
        `/contracts/${contract.id}/send-for-signature`,
        { method: "POST" }
      );
      replace(saved);
      toast[saved.emailSent ? "success" : "warning"](
        saved.emailSent
          ? `Sent to ${contract.clientSignerEmail} for signature.`
          : `Marked out for signature, but the email did not send: ${saved.emailError ?? "unknown error"}`
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send this contract.");
    } finally {
      setBusy(null);
    }
  };

  const generatePdf = async (contract: Contract) => {
    setBusy(contract.id);
    try {
      const { fileId } = await api<{ fileId: string }>(`/contracts/${contract.id}/pdf`, {
        method: "POST",
      });
      const { url } = await api<{ url: string }>(`/files/${fileId}/download`);
      window.open(url, "_blank");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not generate the PDF.");
    } finally {
      setBusy(null);
    }
  };

  /* Exactly one action is "next" on any contract, so the row offers that one
     rather than a menu the Lab Leader has to reason about. */
  const nextAction = (c: Contract) => {
    if (c.status === "Signed") {
      /* A signed MSA isn't a finished thing — it's what work gets authorised
         under, so the next action on one is always the next task order (FR6).
         The MSA itself is never re-signed for it. */
      if (docKindOf(c) === "msa") return { label: "New task order", run: () => setTaskOrderFor(c) };
      return null;
    }
    if (c.status === "Out for Signature") {
      if (!c.signatures?.client) return { label: "Waiting on client", disabled: true };
      if (role === "Admin" && (!c.olSignatory || c.olSignatory === me))
        return { label: "Countersign", run: () => setCountersigning(c) };
      return { label: `Waiting on ${c.olSignatoryName ?? "OL"}`, disabled: true };
    }
    return { label: "Send for signature", run: () => sendForSignature(c) };
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl italic text-ink">
            {isReadOnly ? "Your agreements" : "Contracts"}
          </h1>
          <p className="mt-1 text-sm text-ink-mute">
            {isReadOnly
              ? "Everything you've signed with Optimistic Labs, for your reference."
              : side === "contributor"
                ? "Master agreements with the people you engage, and the task orders authorised under them."
                : "Generated from an approved proposal, or written directly. Signed by the client, then countersigned by an Admin."}
          </p>
        </div>
        {!isReadOnly && (
          <Button className="bg-violet-deep hover:bg-violet" onClick={() => setCreating(true)}>
            {side === "contributor" ? "New MSA" : "New contract"}
          </Button>
        )}
      </div>

      {!isReadOnly && (
        <Tabs value={side} onValueChange={(v) => setSide(v as "client" | "contributor")}>
          <TabsList>
            <TabsTrigger value="client">Client contracts</TabsTrigger>
            <TabsTrigger value="contributor">Contributor agreements</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {!isReadOnly && side === "client" && awaitingContract.length > 0 && (
        <Card className="border-green/40 bg-green-pale/40">
          <CardHeader>
            <CardTitle className="font-serif text-base">
              Approved and ready for a contract
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {awaitingContract.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-white px-3 py-2"
              >
                <div className="text-sm">
                  <span className="font-medium text-ink">{p.client}</span>
                  <span className="text-ink-mute">
                    {" "}
                    · {p.title} · approved v{p.approvedVersion}
                  </span>
                </div>
                <Button
                  size="sm"
                  disabled={busy === p.id}
                  onClick={() => generate(p)}
                >
                  {busy === p.id ? "Generating…" : "Generate contract"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {isReadOnly ? (
        contracts.length === 0 ? (
          <p className="text-sm text-ink-mute">You have no contracts yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {contracts.map((c) => (
              <Card key={c.id}>
                <CardHeader>
                  <CardTitle className="font-serif text-base">
                    {c.docLabel ?? DOC_KIND_LABEL[docKindOf(c)]}
                  </CardTitle>
                  <p className="text-xs text-ink-mute">
                    {c.id}
                    {c.parentId ? ` · under ${c.parentId}` : ""}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  <div className="text-ink-mute">{labName(c.lab)}</div>
                  <Badge variant={CONTRACT_VARIANT[c.status]} className="w-fit">
                    {c.status}
                  </Badge>
                  {/* An MSA carries no figure of its own; money is per task order. */}
                  {docKindOf(c) !== "msa" && (
                    <div className="tabular-nums text-ink">
                      {fmtDollars(pricingTotal(c.pricing) ?? c.amount)}
                    </div>
                  )}
                  {(c.executedFileId || c.pdfFileId) && (
                    <Button variant="outline" size="sm" onClick={() => generatePdf(c)}>
                      Download PDF
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : ordered.length === 0 ? (
        <p className="text-sm text-ink-mute">
          {side === "contributor"
            ? "No contributor agreements yet. An MSA is the starting point: sign one, then authorise work under it with task orders."
            : "No contracts yet."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{side === "contributor" ? "Contributor" : "Client"}</TableHead>
                <TableHead>Lab</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Next</TableHead>
                <TableHead>PDF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((c) => {
                const action = nextAction(c);
                const kind = docKindOf(c);
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      {/* Task orders indent under the MSA they were issued
                          under, so the relationship reads as a group rather
                          than as unrelated rows that happen to share a name. */}
                      <div className={c.parentId ? "border-l-2 border-violet-pale pl-3" : undefined}>
                        <button
                          className="text-left font-medium text-ink hover:text-violet-deep"
                          onClick={() => setEditing(c)}
                        >
                          {c.client}
                        </button>
                        <div className="text-xs text-ink-mute">
                          {c.id}
                          {c.parentId ? ` · under ${c.parentId}` : ""}
                        </div>
                        {kind !== "client" && (
                          <Badge variant="secondary" className="mt-1">
                            {c.docLabel ?? DOC_KIND_LABEL[kind]}
                          </Badge>
                        )}
                        {c.hasDeviations && (
                          <Badge variant="warning" className="mt-1">
                            Deviates from proposal
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{labName(c.lab)}</TableCell>
                    <TableCell>{personName(c.owner)}</TableCell>
                    <TableCell className="tabular-nums">
                      {kind === "msa" ? (
                        <span className="text-xs text-ink-mute">per task order</span>
                      ) : (
                        fmtDollars(pricingTotal(c.pricing) ?? c.amount)
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={CONTRACT_VARIANT[c.status]}>{c.status}</Badge>
                      {c.status === "Signed" && c.executedAt && (
                        <div className="mt-1 text-xs text-ink-mute">
                          {new Date(c.executedAt).toLocaleDateString("en-US")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {action &&
                        (action.disabled ? (
                          <span className="text-xs text-ink-mute">{action.label}</span>
                        ) : (
                          <Button
                            size="sm"
                            variant={action.label === "Countersign" ? "default" : "outline"}
                            disabled={busy === c.id}
                            onClick={action.run}
                          >
                            {busy === c.id ? "Working…" : action.label}
                          </Button>
                        ))}
                      {/* Only on client paper. An executed MSA invites its
                          Contributor by itself (FR4), so offering the button
                          there would either duplicate an invite already sent or
                          look broken against someone who is already a member. */}
                      {kind === "client" && c.status === "Signed" && c.contributorEmail && (
                        <Button size="sm" variant="outline" onClick={() => setInviting(c)}>
                          Invite contributor
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy === c.id}
                        onClick={() => generatePdf(c)}
                      >
                        {c.status === "Signed" ? "Executed copy" : "Draft PDF"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* `role` is always set past the loading guard above; the fallback is the
          non-privileged one so a null can never widen permissions. */}
      {editing && (
        <ContractEditor
          contract={editing}
          people={people}
          role={role ?? "Lab Leader"}
          open={!!editing}
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={(saved) => {
            replace(saved);
            setEditing(saved);
          }}
        />
      )}

      {countersigning && (
        <CountersignDialog
          contract={countersigning}
          open={!!countersigning}
          onOpenChange={(open) => !open && setCountersigning(null)}
          onSigned={async (saved) => {
            replace(saved);
            setCountersigning(null);
            // Execution rolls the deal forward server-side, so pull proposals
            // back down to keep the "ready for a contract" list honest.
            setProposals(await api<Proposal[]>("/proposals"));
          }}
        />
      )}

      {creating && (
        <NewContractDialog
          open={creating}
          onOpenChange={setCreating}
          initialKind={side === "contributor" ? "msa" : "client"}
          onCreated={(created) => {
            setContracts((prev) => [created, ...prev]);
            setCreating(false);
            // The dialog can switch kind after it opens, so follow what was
            // actually made rather than assuming the tab it was opened from.
            setSide(isContributorDoc(created) ? "contributor" : "client");
            // Straight into the editor: a fresh document still needs terms and
            // signatories before it can go anywhere.
            setEditing(created);
          }}
        />
      )}

      {taskOrderFor && (
        <NewTaskOrderDialog
          msa={taskOrderFor}
          open={!!taskOrderFor}
          onOpenChange={(open) => !open && setTaskOrderFor(null)}
          onCreated={(created) => {
            setContracts((prev) => [created, ...prev]);
            setTaskOrderFor(null);
            setEditing(created);
          }}
        />
      )}

      {inviting && (
        <InviteContributorDialog
          contract={inviting}
          open={!!inviting}
          onOpenChange={(open) => !open && setInviting(null)}
        />
      )}
    </div>
  );
}
