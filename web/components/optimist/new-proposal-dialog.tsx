"use client";

import { useState } from "react";
import { toast } from "sonner";
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
import { Pill } from "@/components/optimist/pill";
import { fmtMoney } from "@/lib/pricing";
import { api, ApiError } from "@/lib/api";
import type { Proposal } from "@/lib/types";

/* 02 · Name it (design_handoff_the_optimist, 3b). The deal already supplies
   client, lab and value, so the form only asks for the one thing it can't
   infer: the title. */

export function NewProposalDialog({
  open,
  onOpenChange,
  deals,
  labNames,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deals: { id: string; client: string; lab: string; amount: number }[];
  labNames: Record<string, string>;
  onCreated: (proposal: Proposal) => void;
}) {
  const [dealId, setDealId] = useState(deals[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!dealId || !title.trim()) return;
    setCreating(true);
    try {
      const created = await api<Proposal>("/proposals", {
        method: "POST",
        body: JSON.stringify({ dealId, title: title.trim() }),
      });
      onCreated(created);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create this proposal.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[18px] p-[26px_28px] sm:max-w-[464px]">
        <DialogHeader className="gap-2">
          <DialogTitle className="font-serif text-[22px] leading-[1.2] font-normal italic text-ink">
            New proposal
          </DialogTitle>
          <DialogDescription className="font-sans text-[13.5px] leading-[1.55] text-ink/62">
            Every proposal starts from a deal — its client, lab, and owner come from there.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="opt-deal" className="text-[12.5px] font-medium text-ink">
              Deal
            </Label>
            <Select value={dealId} onValueChange={setDealId}>
              <SelectTrigger
                id="opt-deal"
                className="h-auto w-full rounded-xl border-violet/28 px-3.5 py-2.5 text-sm"
              >
                <span className="size-[7px] shrink-0 rounded-full bg-violet" />
                <SelectValue placeholder="Pick a deal" />
              </SelectTrigger>
              <SelectContent>
                {deals.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.client} <span className="text-ink-mute">· {labNames[d.lab] ?? d.lab} · {fmtMoney(d.amount)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="opt-title" className="text-[12.5px] font-medium text-ink">
              Title
            </Label>
            <Input
              id="opt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-auto rounded-xl border-violet/28 px-3.5 py-2.5 text-sm focus-visible:border-violet focus-visible:ring-[3px] focus-visible:ring-violet-pale"
            />
          </div>
        </div>
        <DialogFooter className="static mx-0 mb-0 flex-row items-center gap-2.5 border-none bg-transparent p-0 pt-1.5 sm:justify-start">
          <span className="font-sans text-xs text-ink/50">Creating it opens question one.</span>
          <Pill
            tone="primary"
            size="md"
            className="ml-auto"
            onClick={create}
            disabled={creating || !dealId || !title.trim()}
          >
            {creating ? "Creating…" : "Create"}
          </Pill>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
