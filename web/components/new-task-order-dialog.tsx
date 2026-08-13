"use client";

/* Authorise one piece of work under a signed MSA (Contributor MSA PRD 5.3).

   A task order is where the substance lives: what the Contributor is doing,
   by when, for how much. The standard terms are not restated here — they come
   from the MSA by reference, which is why this dialog asks for so much less
   than the contract editor does. Many task orders can run against one MSA
   without it ever being re-signed (FR6).

   Its own file rather than a branch inside NewContractDialog: nothing is
   shared beyond the submit button. The MSA is already chosen, the lab and
   counterparty are inherited, and there is no template to pick. */

import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { PricingEditor } from "@/components/pricing-editor";
import { api, ApiError } from "@/lib/api";
import type { Contract, Pricing } from "@/lib/types";

export function NewTaskOrderDialog({
  msa,
  open,
  onOpenChange,
  onCreated,
}: {
  msa: Contract;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (taskOrder: Contract) => void;
}) {
  const [scope, setScope] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [timeline, setTimeline] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [saving, setSaving] = useState(false);

  const create = async () => {
    setSaving(true);
    try {
      const created = await api<Contract>("/contracts", {
        method: "POST",
        body: JSON.stringify({
          docKind: "task-order",
          parentId: msa.id,
          sections: { scope, deliverables, timeline },
          startDate,
          endDate,
          pricing,
        }),
      });
      toast.success(`${created.id} created under ${msa.id}`);
      onCreated(created);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create the task order.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New task order</DialogTitle>
          <DialogDescription>
            Under {msa.id} with {msa.client}. The MSA&apos;s terms govern this work and are not
            restated here.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="to-scope">What they&apos;re doing</Label>
            <Textarea
              id="to-scope"
              rows={4}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="The work being authorised under this task order"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="to-deliverables">Deliverables</Label>
            <Textarea
              id="to-deliverables"
              rows={3}
              value={deliverables}
              onChange={(e) => setDeliverables(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="to-timeline">Timeline</Label>
            <Textarea
              id="to-timeline"
              rows={2}
              value={timeline}
              onChange={(e) => setTimeline(e.target.value)}
              placeholder="e.g. six weeks from kickoff, with a checkpoint at week three"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to-start">Start date</Label>
              <Input
                id="to-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to-end">End date</Label>
              <Input
                id="to-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Compensation</Label>
            <PricingEditor value={pricing} onChange={setPricing} />
            <p className="text-xs text-ink-mute">
              A task order can&apos;t be sent for signature without a timeline and a figure here.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            className="bg-violet-deep hover:bg-violet"
            onClick={create}
            disabled={saving || !scope.trim()}
          >
            {saving ? "Creating…" : "Create task order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
