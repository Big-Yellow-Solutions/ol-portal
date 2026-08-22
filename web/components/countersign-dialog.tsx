"use client";

/* OL countersignature (Base Contract PRD FR13).

   Second and last step of the sequential flow: the client has signed, and the
   Admin the contract routes to signs for Optimistic Labs. The same consent and
   signing act as the customer side, plus the authenticated account, which the
   audit certificate records as the stronger attribution of the two.

   Executing the contract triggers the countersigned PDF, delivery to both
   parties and the deal roll-up server-side, so this dialog does nothing after
   the call except hand back the updated record. */

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
import {
  SignatureCapture,
  emptySignature,
  signatureReady,
  signaturePayload,
} from "@/components/signature-capture";
import { PricingTable } from "@/components/pricing-table";
import { api, ApiError } from "@/lib/api";
import { usePortalData } from "@/lib/portal-data";
import { fullName } from "@/lib/data";
import type { Contract } from "@/lib/types";

export function CountersignDialog({
  contract,
  open,
  onOpenChange,
  onSigned,
}: {
  contract: Contract;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSigned: (contract: Contract) => void | Promise<void>;
}) {
  const { people, me } = usePortalData();
  const [signature, setSignature] = useState(() =>
    emptySignature(fullName(me ? people[me] : undefined) || "", "")
  );
  const [submitting, setSubmitting] = useState(false);

  const clientSig = contract.signatures?.client;

  const submit = async () => {
    setSubmitting(true);
    try {
      const saved = await api<Contract>(`/contracts/${contract.id}/countersign`, {
        method: "POST",
        body: JSON.stringify(signaturePayload(signature)),
      });
      toast.success(`${contract.id} is fully executed. Both parties have been emailed a copy.`);
      await onSigned(saved);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not countersign this contract.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Countersign {contract.id} · {contract.client}
          </DialogTitle>
          <DialogDescription>
            Signing here executes the agreement, generates the countersigned PDF and emails a copy
            to both parties.
          </DialogDescription>
        </DialogHeader>

        {clientSig && (
          <div className="rounded-md bg-green-pale p-3 text-sm text-ink">
            Signed by {clientSig.name}
            {clientSig.title && `, ${clientSig.title}`} on{" "}
            {new Date(clientSig.at).toLocaleString("en-US")}
            {clientSig.signatureType === "docusign" && (
              <span className="text-ink-mute"> (via DocuSign)</span>
            )}
            {clientSig.signatureType === "drawn" && clientSig.signatureImage && (
              /* eslint-disable-next-line @next/next/no-img-element -- a data:
                 URL signature, not an optimizable asset */
              <img
                src={clientSig.signatureImage}
                alt={`Signature of ${clientSig.name}`}
                className="mt-2 h-12"
              />
            )}
          </div>
        )}

        {contract.hasDeviations && (
          <div className="rounded-md border-l-4 border-amber bg-amber-pale px-3 py-2 text-sm">
            <p className="font-medium text-ink">
              This contract departs from the approved proposal
            </p>
            <ul className="mt-1 list-disc pl-4 text-ink-soft">
              {contract.deviations?.map((d) => (
                <li key={d.field}>{d.summary}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-md bg-paper p-3">
          <p className="text-xs uppercase tracking-wide text-ink-mute">Contract value</p>
          <PricingTable pricing={contract.pricing} />
          {contract.paymentSchedule && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">
              {contract.paymentSchedule}
            </p>
          )}
        </div>

        <SignatureCapture
          value={signature}
          onChange={setSignature}
          nameLabel="Your name, as it should appear"
        />

        {contract.documentHash && (
          <p className="break-all text-[10px] text-ink-mute">
            Document fingerprint (SHA-256): {contract.documentHash}
          </p>
        )}

        <DialogFooter>
          <Button
            className="bg-violet-deep hover:bg-violet"
            onClick={submit}
            disabled={submitting || !signatureReady(signature)}
          >
            {submitting ? "Executing…" : "Countersign and execute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
