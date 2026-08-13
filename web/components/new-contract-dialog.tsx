"use client";

/* Create an agreement directly, with no proposal behind it.

   Two kinds start here (Contributor MSA PRD FR1):

     Client contract   the PRD's happy path is proposal → approval → contract,
                       and that stays the default. But not every engagement
                       starts with a formal proposal: renewals, handshake
                       deals, and work already agreed over email all need paper
                       without a proposal round, and forcing a fake proposal
                       just to reach a contract would put a lie in the audit
                       trail. A deal is optional but offered first, because
                       attaching one is what lets the signed contract roll the
                       pipeline forward and feed invoicing.

     Contributor MSA   the master agreement OL executes with someone it engages
                       to help deliver work. Never has a proposal and never has
                       a deal — it isn't customer work, it's the relationship
                       that later task orders hang off. Money is agreed per
                       task order, so there is no price here either.

   One dialog rather than two because everything structural is shared: lab
   scoping, template resolution, and the fact that what you get back still
   needs terms and signatories before it can go anywhere. */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { PricingEditor } from "@/components/pricing-editor";
import { api, ApiError } from "@/lib/api";
import { usePortalData } from "@/lib/portal-data";
import type { ContentTemplate, Contract, DocKind, Pricing } from "@/lib/types";

const NO_DEAL = "__none";
const AUTO_TEMPLATE = "__auto";

/* Which template kind supplies each document's standard terms. Keeping the
   pools separate is what stops a Contributor being handed the client services
   agreement by accident. */
const TEMPLATE_KIND: Record<"client" | "msa", string> = { client: "contract", msa: "msa" };

interface SecondMsaError {
  needsSecondMsaAck?: boolean;
  existingMsa?: string;
}

export function NewContractDialog({
  open,
  onOpenChange,
  onCreated,
  initialKind = "client",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (contract: Contract) => void;
  initialKind?: "client" | "msa";
}) {
  const { deals, labs, role, me } = usePortalData();
  const [docKind, setDocKind] = useState<"client" | "msa">(initialKind);
  const [dealId, setDealId] = useState<string>(NO_DEAL);
  const [client, setClient] = useState("");
  const [lab, setLab] = useState("");
  const [templateId, setTemplateId] = useState(AUTO_TEMPLATE);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isMsa = docKind === "msa";

  useEffect(() => {
    api<ContentTemplate[]>("/templates")
      .then((all) => setTemplates(all.filter((t) => t.active !== false)))
      .catch(() => setTemplates([]));
  }, []);

  // Switching kind invalidates a template picked from the other pool, and any
  // deal attached to what is now an MSA.
  const chooseKind = (next: "client" | "msa") => {
    setDocKind(next);
    setTemplateId(AUTO_TEMPLATE);
    setDuplicateOf(null);
    if (next === "msa") {
      setDealId(NO_DEAL);
      setPricing(null);
    }
  };

  // Contracting on an existing deal should not mean re-typing what the deal
  // already knows, so picking one fills the rest in.
  const chooseDeal = (id: string) => {
    setDealId(id);
    const deal = deals.find((d) => d.id === id);
    if (deal) {
      setClient(deal.client);
      setLab(deal.lab);
    }
  };

  // Only deals that aren't already contracted, and only ones this person could
  // contract on anyway.
  const selectableDeals = deals.filter(
    (d) => !d.contractSigned && (role === "Admin" || d.owner === me || labs.some((l) => l.id === d.lab))
  );
  const kindTemplates = templates.filter((t) => t.kind === TEMPLATE_KIND[docKind]);
  const templateFor = kindTemplates.find(
    (t) => t.id === templateId || (templateId === AUTO_TEMPLATE && (t.lab === lab || !t.lab))
  );

  const counterpartyLabel = isMsa ? "Contributor" : "Client";

  const create = async (allowSecondMsa = false) => {
    setSaving(true);
    try {
      const created = await api<Contract>("/contracts", {
        method: "POST",
        body: JSON.stringify({
          ...(isMsa ? { docKind: "msa" as DocKind } : {}),
          ...(!isMsa && dealId !== NO_DEAL ? { dealId } : {}),
          client,
          lab,
          ...(templateId !== AUTO_TEMPLATE ? { templateId } : {}),
          ...(isMsa
            ? {
                clientSignerName: signerName || client,
                clientSignerEmail: signerEmail,
                ...(allowSecondMsa ? { allowSecondMsa: true } : {}),
              }
            : { pricing }),
        }),
      });
      toast.success(`${created.id} created`);
      onCreated(created);
    } catch (err) {
      /* One MSA per Contributor is the expectation, not a rule (PRD 7), so the
         server refuses a second one once and lets an explicit confirm through. */
      const body = err instanceof ApiError ? (err.body as SecondMsaError | undefined) : undefined;
      if (body?.needsSecondMsaAck) {
        setDuplicateOf(body.existingMsa ?? "an existing MSA");
      } else {
        toast.error(err instanceof ApiError ? err.message : "Could not create the agreement.");
      }
    } finally {
      setSaving(false);
    }
  };

  const ready = client.trim() && lab && (!isMsa || signerEmail.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isMsa ? "New contributor MSA" : "New contract"}</DialogTitle>
          <DialogDescription>
            {isMsa
              ? "The master agreement with someone you're engaging to help deliver work. Task orders for specific engagements come later, once this is signed."
              : "For work agreed without a formal proposal. You will add the terms and signatories next, then send it for signature."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Agreement type</Label>
            <Select value={docKind} onValueChange={(v) => chooseKind(v as "client" | "msa")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client">Client contract</SelectItem>
                <SelectItem value="msa">Contributor MSA</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!isMsa && (
            <div className="flex flex-col gap-1.5">
              <Label>Deal (optional)</Label>
              <Select value={dealId} onValueChange={chooseDeal}>
                <SelectTrigger>
                  <SelectValue placeholder="Not tied to a deal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEAL}>Not tied to a deal</SelectItem>
                  {selectableDeals.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.client} · {d.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-ink-mute">
                Attaching a deal is what lets the signed contract move the pipeline and feed
                invoicing.
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-client">{counterpartyLabel}</Label>
              <Input
                id="new-client"
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder={isMsa ? "Their full or business name" : "Organization name"}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Lab</Label>
              <Select value={lab || undefined} onValueChange={setLab}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a lab" />
                </SelectTrigger>
                <SelectContent>
                  {labs.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isMsa && (
                <p className="text-xs text-ink-mute">
                  The lab engaging them. They can work across labs later; this is who owns the
                  relationship.
                </p>
              )}
            </div>
          </div>

          {isMsa && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="msa-signer">Who signs</Label>
                <Input
                  id="msa-signer"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder={client || "Their name"}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="msa-email">Their email</Label>
                <Input
                  id="msa-email"
                  type="email"
                  value={signerEmail}
                  onChange={(e) => setSignerEmail(e.target.value)}
                />
              </div>
              <p className="text-xs text-ink-mute sm:col-span-2">
                They don&apos;t need a portal login to review or sign. If they aren&apos;t already a
                member, they&apos;re invited to set up a profile once the MSA is fully executed.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>{isMsa ? "MSA terms" : "Contract terms"}</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO_TEMPLATE}>Use this lab&apos;s standard terms</SelectItem>
                {kindTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {t.lab ? "" : " (OL-wide)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {kindTemplates.length === 0 ? (
              <p className="text-xs text-red">
                No {isMsa ? "MSA" : "contract"} terms exist yet. It will be created without any, and
                cannot be sent for signature until an Admin adds a template.
              </p>
            ) : (
              !templateFor && (
                <p className="text-xs text-amber">
                  No standard terms are set up for that lab. Pick one explicitly, or it will have
                  none.
                </p>
              )
            )}
          </div>

          {!isMsa && (
            <div className="flex flex-col gap-1.5">
              <Label>Pricing</Label>
              <PricingEditor value={pricing} onChange={setPricing} />
            </div>
          )}
        </div>

        {duplicateOf && (
          <div className="rounded-md border-l-4 border-amber bg-amber-pale px-3 py-3">
            <p className="text-sm font-medium text-ink">They already have an MSA</p>
            <p className="mt-1 text-sm text-ink-soft">
              {signerEmail} is already on {duplicateOf}. A second one is allowed, but usually what
              you want instead is a task order under the MSA they already signed.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => create(true)} disabled={saving}>
                Create a second MSA anyway
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDuplicateOf(null)}>
                Go back
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            className="bg-violet-deep hover:bg-violet"
            onClick={() => create()}
            disabled={saving || !ready || !!duplicateOf}
          >
            {saving ? "Creating…" : "Create and add terms"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
