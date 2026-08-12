"use client";

/* Contract editor (Base Contract PRD 5.4.3, FR11).

   Two classes of field live here and they behave differently on purpose:

     inherited   scope, deliverables, timeline and pricing, carried over from
                 the version the customer approved. Editable, but a change is
                 a declared deviation: the save is refused once with a 409, the
                 dialog explains exactly what differs, and only an explicit
                 confirm sends it through. That is what keeps the audit trail
                 honest about whether the contract matches what was agreed.

     contract-only   payment schedule, term dates, signatory details. Ordinary
                 fields the Lab Leader fills in without ceremony.

   Everything locks once the contract goes out for signature — the customer is
   looking at a hashed document by then. */

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PricingEditor } from "@/components/pricing-editor";
import { api, ApiError } from "@/lib/api";
import { fullName } from "@/lib/data";
import type { Contract, Deviation, Person, Pricing, Role } from "@/lib/types";

interface DeviationError {
  needsDeviationAck?: boolean;
  deviations?: Deviation[];
}

export function ContractEditor({
  contract,
  people,
  role,
  open,
  onOpenChange,
  onSaved,
}: {
  contract: Contract;
  people: Record<string, Person>;
  role: Role;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (contract: Contract) => void;
}) {
  const [paymentSchedule, setPaymentSchedule] = useState(contract.paymentSchedule ?? "");
  const [startDate, setStartDate] = useState(contract.startDate ?? "");
  const [endDate, setEndDate] = useState(contract.endDate ?? "");
  const [signerName, setSignerName] = useState(contract.clientSignerName ?? "");
  const [signerTitle, setSignerTitle] = useState(contract.clientSignerTitle ?? "");
  const [signerEmail, setSignerEmail] = useState(contract.clientSignerEmail ?? "");
  const [olSignatory, setOlSignatory] = useState(contract.olSignatory ?? "");
  const [scope, setScope] = useState(contract.sections?.scope ?? "");
  const [deliverables, setDeliverables] = useState(contract.sections?.deliverables ?? "");
  const [timeline, setTimeline] = useState(contract.sections?.timeline ?? "");
  const [contributorName, setContributorName] = useState(contract.contributorName ?? "");
  const [contributorEmail, setContributorEmail] = useState(contract.contributorEmail ?? "");
  const [pricing, setPricing] = useState<Pricing | null>(contract.pricing ?? null);

  const [pendingDeviations, setPendingDeviations] = useState<Deviation[] | null>(null);
  const [deviationNote, setDeviationNote] = useState("");
  const [saving, setSaving] = useState(false);

  const admins = Object.entries(people).filter(([, p]) => p.role === "Admin");
  const locked = contract.status === "Out for Signature" || contract.status === "Signed";

  const payload = (acknowledge: boolean) => ({
    paymentSchedule,
    startDate,
    endDate,
    clientSignerName: signerName,
    clientSignerTitle: signerTitle,
    clientSignerEmail: signerEmail,
    olSignatory,
    sections: { ...(contract.sections ?? {}), scope, deliverables, timeline },
    pricing,
    // Naming a Contributor is admin-only server-side, so only send the fields
    // when an Admin is driving — otherwise a Lab Leader's save would 403.
    ...(role === "Admin" ? { contributorName, contributorEmail } : {}),
    ...(acknowledge ? { acknowledgeDeviation: true, deviationNote } : {}),
  });

  const save = async (acknowledge = false) => {
    setSaving(true);
    try {
      const saved = await api<Contract>(`/contracts/${contract.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload(acknowledge)),
      });
      toast.success("Contract saved");
      setPendingDeviations(null);
      onSaved(saved);
    } catch (err) {
      // The server refuses an undeclared deviation exactly once; the second
      // attempt carries the acknowledgement and the Lab Leader's note.
      const body = err instanceof ApiError ? (err.body as DeviationError | undefined) : undefined;
      if (body?.needsDeviationAck) {
        setPendingDeviations(body.deviations ?? []);
      } else {
        toast.error(err instanceof ApiError ? err.message : "Could not save this contract.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {contract.id} · {contract.client}
          </DialogTitle>
          <DialogDescription>
            {contract.inherited
              ? `Scope and pricing carried over from ${contract.proposal ?? "the proposal"} v${contract.inherited.version}, approved by the customer.`
              : "This contract predates the approved-proposal link."}
          </DialogDescription>
        </DialogHeader>

        {locked && (
          <p className="rounded-md bg-violet-pale px-3 py-2 text-sm text-ink">
            This contract is {contract.status.toLowerCase()} and can no longer be edited.
          </p>
        )}

        {(contract.deviations?.length ?? 0) > 0 && (
          <div className="rounded-md border-l-4 border-amber bg-amber-pale px-3 py-2 text-sm">
            <p className="font-medium text-ink">Departs from the approved proposal</p>
            <ul className="mt-1 list-disc pl-4 text-ink-soft">
              {contract.deviations?.map((d) => (
                <li key={d.field}>{d.summary}</li>
              ))}
            </ul>
          </div>
        )}

        <fieldset disabled={locked} className="flex flex-col gap-5">
          <section className="flex flex-col gap-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-mute">
              Contract terms
            </h3>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="payment">Payment schedule</Label>
              <Textarea
                id="payment"
                rows={3}
                placeholder="e.g. 50% on signature, 50% on delivery of the final playbook"
                value={paymentSchedule}
                onChange={(e) => setPaymentSchedule(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="start">Start date</Label>
                <Input
                  id="start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="end">End date</Label>
                <Input
                  id="end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-mute">
              Signatories
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="signer">Client signer</Label>
                <Input
                  id="signer"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="signer-title">Their title</Label>
                <Input
                  id="signer-title"
                  value={signerTitle}
                  onChange={(e) => setSignerTitle(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="signer-email">Their email</Label>
              <Input
                id="signer-email"
                type="email"
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Optimistic Labs countersignature</Label>
              <Select value={olSignatory || undefined} onValueChange={setOlSignatory}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an Admin" />
                </SelectTrigger>
                <SelectContent>
                  {admins.map(([key, p]) => (
                    <SelectItem key={key} value={key}>
                      {fullName(p) || key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-ink-mute">
                Only an Admin countersigns for OL, never the Lab Leader on the deal.
              </p>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-mute">
              {contract.inherited ? "Inherited from the approved proposal" : "Scope and pricing"}
            </h3>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scope">Scope</Label>
              <Textarea id="scope" rows={4} value={scope} onChange={(e) => setScope(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="deliverables">Deliverables</Label>
              <Textarea
                id="deliverables"
                rows={3}
                value={deliverables}
                onChange={(e) => setDeliverables(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="timeline">Timeline</Label>
              <Textarea
                id="timeline"
                rows={2}
                value={timeline}
                onChange={(e) => setTimeline(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Pricing</Label>
              <PricingEditor value={pricing} onChange={setPricing} disabled={locked} />
              {contract.inherited && (
                <p className="text-xs text-ink-mute">
                  These figures came from the approved proposal. Changing them is a deviation and
                  has to be confirmed before it saves.
                </p>
              )}
            </div>
          </section>

          {role === "Admin" && (
            <section className="flex flex-col gap-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-mute">
                Contributor
              </h3>
              <p className="text-xs text-ink-mute">
                Naming a Contributor here is what lets the Lab Leader invite them to the portal
                once this contract is signed.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="contrib-name">Name</Label>
                  <Input
                    id="contrib-name"
                    value={contributorName}
                    onChange={(e) => setContributorName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="contrib-email">Email</Label>
                  <Input
                    id="contrib-email"
                    type="email"
                    value={contributorEmail}
                    onChange={(e) => setContributorEmail(e.target.value)}
                  />
                </div>
              </div>
            </section>
          )}
        </fieldset>

        {pendingDeviations && (
          <div className="rounded-md border-l-4 border-amber bg-amber-pale px-3 py-3">
            <p className="text-sm font-medium text-ink">
              This differs from what the customer approved
            </p>
            <ul className="mt-1 list-disc pl-4 text-sm text-ink-soft">
              {pendingDeviations.map((d) => (
                <li key={d.field}>{d.summary}</li>
              ))}
            </ul>
            <div className="mt-3 flex flex-col gap-1.5">
              <Label htmlFor="dev-note">Why (recorded on the contract)</Label>
              <Input
                id="dev-note"
                placeholder="e.g. client asked to add a second workshop on the call"
                value={deviationNote}
                onChange={(e) => setDeviationNote(e.target.value)}
              />
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => save(true)} disabled={saving}>
                Save as a declared deviation
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPendingDeviations(null)}>
                Go back and edit
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            className="bg-violet-deep hover:bg-violet"
            onClick={() => save(false)}
            disabled={saving || locked || !!pendingDeviations}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
