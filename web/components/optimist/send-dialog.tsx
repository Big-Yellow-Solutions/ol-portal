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
import { Pill } from "@/components/optimist/pill";
import { pricingTotal, fmtMoney } from "@/lib/pricing";
import { SECTION_KEYS } from "@/lib/types";
import { api, ApiError } from "@/lib/api";
import type { Proposal } from "@/lib/types";

/* 09 · Send (design_handoff_the_optimist, 3i). Only reachable once Final. The
   version being frozen is named up front, so there's no doubt what the client
   is about to receive. */

export function SendDialog({
  proposal,
  open,
  onOpenChange,
  onSent,
}: {
  proposal: Proposal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (proposal: Proposal, result: { url: string; text: string }) => void;
}) {
  const [clientEmail, setClientEmail] = useState(proposal.clientEmail ?? "");
  const [sending, setSending] = useState(false);

  const finalSnapshot = proposal.versions?.find((v) => v.v === proposal.finalVersion);
  const frozenSections = finalSnapshot?.sections ?? proposal.sections;
  const frozenPricing = finalSnapshot?.pricing ?? proposal.pricing ?? null;
  const draftedCount = SECTION_KEYS.filter((k) => frozenSections?.[k]?.trim()).length;
  const total = pricingTotal(frozenPricing);

  const sendVia = async (sendEmail: boolean) => {
    setSending(true);
    try {
      const result = await api<{
        id: string;
        sentVersion: number;
        draftAhead: boolean;
        url: string;
        text: string;
        emailSent: boolean;
        emailError?: string;
      }>(`/proposals/${proposal.id}/send`, {
        method: "POST",
        body: JSON.stringify({ clientEmail, sendEmail }),
      });
      onSent(
        { ...proposal, status: "Sent", sentVersion: result.sentVersion, clientEmail },
        { url: result.url, text: result.text }
      );
      if (sendEmail) {
        toast.success(result.emailSent ? "Emailed to client" : result.emailError || "Send failed");
      } else {
        await navigator.clipboard.writeText(result.text);
        toast.success("Copied the client email text to your clipboard");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send this proposal.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[18px] p-[26px_28px] sm:max-w-[464px]">
        <DialogHeader className="gap-2">
          <DialogTitle className="font-serif text-[22px] leading-[1.25] font-normal italic text-ink">
            {`Send ${proposal.title} to the client`}
          </DialogTitle>
          <DialogDescription className="font-sans text-[13.5px] leading-[1.55] text-ink/62">
            Freezes the Final version behind a one-time link. Choose how to deliver it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2.5 rounded-[10px] bg-paper px-3.5 py-2.5">
          <span className="font-serif text-sm italic text-violet-deep">{`v${proposal.finalVersion ?? proposal.version}`}</span>
          <span className="rounded-full bg-violet-deep px-2 py-0.5 font-sans text-[9px] font-medium tracking-[.09em] text-white uppercase">
            Final
          </span>
          <span className="font-sans text-[12.5px] text-ink/62">
            {`${draftedCount} of 6 sections${total !== null ? ` · ${fmtMoney(total)}` : ""}`}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opt-client-email" className="text-[12.5px] font-medium text-ink">
            Client email
          </Label>
          <Input
            id="opt-client-email"
            type="email"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            className="h-auto rounded-xl border-violet/28 px-3.5 py-2.5 text-sm"
          />
        </div>

        <DialogFooter className="static mx-0 mb-0 flex-row gap-2.5 border-none bg-transparent p-0 pt-1">
          <Pill tone="outline" size="md" className="flex-1" onClick={() => sendVia(false)} disabled={sending}>
            Copy email text
          </Pill>
          <Pill tone="primary" size="md" className="flex-1" onClick={() => sendVia(true)} disabled={sending || !clientEmail}>
            {sending ? "Sending…" : "Email the client"}
          </Pill>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
