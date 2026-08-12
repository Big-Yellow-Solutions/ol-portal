"use client";

/* Create a contract directly, with no proposal behind it.

   The PRD's happy path is proposal → approval → contract, and that stays the
   default. But not every engagement starts with a formal proposal: renewals,
   handshake deals, and work already agreed over email all need paper without a
   proposal round, and forcing a fake proposal just to reach a contract would
   put a lie in the audit trail.

   A deal is optional but offered first, because attaching one is what lets the
   signed contract roll the pipeline forward and feed invoicing. */

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
import type { ContentTemplate, Contract, Pricing } from "@/lib/types";

const NO_DEAL = "__none";
const AUTO_TEMPLATE = "__auto";

export function NewContractDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (contract: Contract) => void;
}) {
  const { deals, labs, role, me } = usePortalData();
  const [dealId, setDealId] = useState<string>(NO_DEAL);
  const [client, setClient] = useState("");
  const [lab, setLab] = useState("");
  const [templateId, setTemplateId] = useState(AUTO_TEMPLATE);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<ContentTemplate[]>("/templates")
      .then((all) => setTemplates(all.filter((t) => t.kind === "contract" && t.active !== false)))
      .catch(() => setTemplates([]));
  }, []);

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
  const usableLabs = labs;
  const templateFor = templates.find(
    (t) => t.id === templateId || (templateId === AUTO_TEMPLATE && (t.lab === lab || !t.lab))
  );

  const create = async () => {
    setSaving(true);
    try {
      const created = await api<Contract>("/contracts", {
        method: "POST",
        body: JSON.stringify({
          ...(dealId !== NO_DEAL ? { dealId } : {}),
          client,
          lab,
          ...(templateId !== AUTO_TEMPLATE ? { templateId } : {}),
          pricing,
        }),
      });
      toast.success(`${created.id} created`);
      onCreated(created);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create the contract.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New contract</DialogTitle>
          <DialogDescription>
            For work agreed without a formal proposal. You will add the terms and signatories next,
            then send it for signature.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-client">Client</Label>
              <Input
                id="new-client"
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder="Organization name"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Lab</Label>
              <Select value={lab || undefined} onValueChange={setLab}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a lab" />
                </SelectTrigger>
                <SelectContent>
                  {usableLabs.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Contract terms</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO_TEMPLATE}>Use this lab&apos;s standard terms</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {t.lab ? "" : " (OL-wide)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templates.length === 0 ? (
              <p className="text-xs text-red">
                No contract terms exist yet. The contract will be created without any, and cannot
                be sent for signature until an Admin adds a template.
              </p>
            ) : (
              !templateFor && (
                <p className="text-xs text-amber">
                  No standard terms are set up for that lab. Pick one explicitly, or the contract
                  will have none.
                </p>
              )
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Pricing</Label>
            <PricingEditor value={pricing} onChange={setPricing} />
          </div>
        </div>

        <DialogFooter>
          <Button
            className="bg-violet-deep hover:bg-violet"
            onClick={create}
            disabled={saving || !client.trim() || !lab}
          >
            {saving ? "Creating…" : "Create and add terms"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
