"use client";

import { useMemo } from "react";
import { Mail, Phone, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fmtDollars } from "@/lib/data";
import { initialsOf } from "@/lib/pipeline";
import { usePortalData } from "@/lib/portal-data";

/* Pipeline v2 (design handoff), section 5b: the company/person record drawer.
   Opened either from the Companies/People tab or from a deal's Billing entity
   panel — `returnDealId` tracks the latter so "Back to deal" can reopen it. */
export function RecordDrawer({
  type,
  id,
  open,
  returnDealId,
  onClose,
  onBackToDeal,
  onOpenDeal,
}: {
  type: "company" | "contact";
  id: string;
  open: boolean;
  returnDealId: string | null;
  onClose: () => void;
  onBackToDeal: (dealId: string) => void;
  onOpenDeal: (dealId: string) => void;
}) {
  const { companies, contacts, deals, labs } = usePortalData();
  const companyMap = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c])), [companies]);
  const contactMap = useMemo(() => Object.fromEntries(contacts.map((c) => [c.id, c])), [contacts]);

  const record = type === "company" ? companyMap[id] : contactMap[id];
  if (!record) return null;

  const linked = type === "company"
    ? (record as { contactId?: string | null }).contactId ? contactMap[(record as { contactId?: string }).contactId!] : undefined
    : (record as { companyId?: string | null }).companyId ? companyMap[(record as { companyId?: string }).companyId!] : undefined;

  const recordDeals = deals.filter((d) => (type === "company" ? d.companyId === id : d.contactId === id));
  const totalValue = recordDeals.reduce((sum, d) => sum + (d.amount || 0), 0);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[520px]" overlayClassName="bg-[rgba(17,17,17,0.28)] backdrop-blur-none" showCloseButton={false}>
        <SheetHeader className="flex-row items-center gap-3 border-b border-hair p-4">
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate">{record.name}</SheetTitle>
            <SheetDescription className="text-xs">{type === "company" ? "Company record" : "Person record"}</SheetDescription>
          </div>
          {returnDealId && (
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => onBackToDeal(returnDealId)}>
              Back to deal
            </Button>
          )}
          <Button variant="outline" size="icon-sm" className="rounded-full" onClick={onClose} aria-label="Close">✕</Button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4 flex items-center gap-3.5">
            <span
              className={`flex size-13 shrink-0 items-center justify-center text-lg font-semibold text-violet-deep bg-violet-pale ${
                type === "company" ? "rounded-2xl" : "rounded-full"
              }`}
            >
              {initialsOf(record.name)}
            </span>
            <div className="min-w-0">
              <div className="truncate text-lg font-bold text-ink">{record.name}</div>
              <div className="mt-0.5 truncate text-sm text-ink-mute">
                {type === "company" ? (record as { kind?: string }).kind || "Company" : (record as { title?: string }).title || "Individual"}
              </div>
            </div>
          </div>

          <div className="mb-5 flex flex-col gap-px overflow-hidden rounded-2xl border border-hair bg-hair-soft">
            <span className="flex items-center gap-3 bg-white px-3.5 py-3">
              <Mail size={15} className="shrink-0 text-violet-deep" />
              <span className="min-w-0 flex-1 truncate text-sm">{record.email || "No email on file"}</span>
            </span>
            <span className="flex items-center gap-3 bg-white px-3.5 py-3">
              <Phone size={15} className="shrink-0 text-violet-deep" />
              <span className="min-w-0 flex-1 text-sm">{record.phone || "No phone on file"}</span>
            </span>
            {linked && (
              <span className="flex items-center gap-3 bg-white px-3.5 py-3">
                <Link2 size={15} className="shrink-0 text-violet-deep" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-violet-deep">{linked.name}</span>
                <span className="shrink-0 text-[11px] font-semibold tracking-wide text-warm-gray uppercase">
                  {type === "company" ? "Primary contact" : "Company"}
                </span>
              </span>
            )}
          </div>

          <div className="mb-2.5 flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-semibold tracking-wide text-warm-gray uppercase">All deals</span>
            <span className="text-xs text-ink-mute">
              {recordDeals.length ? `${recordDeals.length} ${recordDeals.length === 1 ? "deal" : "deals"} · ${fmtDollars(totalValue)}` : "None yet"}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {recordDeals.map((d) => (
              <button
                key={d.id}
                type="button"
                className="rounded-xl border border-hair bg-white p-3.5 text-left hover:border-violet-deep hover:bg-[#FBFAFF]"
                onClick={() => onOpenDeal(d.id)}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{d.client}</span>
                    <span className="mt-0.5 block text-xs text-ink-mute">
                      {(labs.find((l) => l.id === d.lab)?.name ?? d.lab)} · {fmtDollars(d.amount)} · {d.close}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border border-hair-strong bg-violet-pale px-2.5 py-0.5 text-[11px] font-semibold text-violet-deep">
                    {d.stage}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
