"use client";

/* Invite a Contributor named on a signed client contract (PRD 2.2).

   The gate is server-side: a Lab Leader may only invite an email that a signed
   contract in one of their labs already names. This dialog is the button for
   it, and deliberately asks for nothing — everything it sends comes off the
   contract, so there is no form to get wrong.

   Contributor paper doesn't use this. An executed MSA invites its Contributor
   by itself (Contributor MSA PRD FR4), which is why the caller only offers
   this on client contracts. */

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
import { api, ApiError } from "@/lib/api";
import type { Contract } from "@/lib/types";

export function InviteContributorDialog({
  contract,
  open,
  onOpenChange,
}: {
  contract: Contract;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [sending, setSending] = useState(false);
  const name = contract.contributorName ?? "";
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.join(" ");

  const send = async () => {
    setSending(true);
    try {
      await api("/admin/invites", {
        method: "POST",
        body: JSON.stringify({
          firstName: first || name || "Contributor",
          lastName: last || "",
          email: contract.contributorEmail,
          role: "Contributor",
          labs: [contract.lab],
        }),
      });
      toast.success(`Invite sent to ${contract.contributorEmail}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send the invite.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite {contract.contributorName}</DialogTitle>
          <DialogDescription>
            Sends a portal invite to {contract.contributorEmail} as a Contributor on{" "}
            {contract.client}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={send} disabled={sending}>
            {sending ? "Sending…" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
