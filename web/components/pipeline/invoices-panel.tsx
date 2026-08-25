"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/can";
import { fmtDollars, INVOICE_VARIANT } from "@/lib/data";
import { usePortalData } from "@/lib/portal-data";
import type { Deal, InvoiceRequest, InvoiceStatus } from "@/lib/types";

function nextStatusFor(status: InvoiceStatus): InvoiceStatus | null {
  if (status === "Admin review") return "Sent to client";
  if (status === "Sent to client") return "Paid";
  return null;
}

/* Ported from the (uncommitted, now-superseded) Deal View's Invoice tab: a
   per-deal invoice history, Admin-only status advancement (mirrors
   backend/src/app.mjs's ctx.can.reviewInvoices gate on PATCH /invoices/{id}),
   and a pause/resume toggle for recurring deals — /invoices itself keeps the
   cross-deal admin review queue and the QuickBooks card, which don't belong
   inside a single deal's drawer. */
export function InvoicesPanel({
  deal,
  onDealUpdated,
}: {
  deal: Deal;
  onDealUpdated: (deal: Deal) => void;
}) {
  const { invoices, setInvoices, role, myLabs, me } = usePortalData();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [pausing, setPausing] = useState(false);

  const isAdmin = role ? can.reviewInvoices(role) : false;
  const editable = can.editDeal(deal, role!, myLabs, me);
  const dealInvoices = useMemo(
    () => invoices.filter((i) => i.deal === deal.id).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    [invoices, deal.id]
  );

  async function requestInvoice() {
    setRequesting(true);
    try {
      const created = await api<InvoiceRequest>("/invoices", {
        method: "POST",
        body: JSON.stringify({ dealId: deal.id, recurring: deal.recurring }),
      });
      setInvoices((prev) => [created, ...prev]);
      toast.success("Invoice requested");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not request an invoice.");
    } finally {
      setRequesting(false);
    }
  }

  async function advance(invId: string, next: InvoiceStatus) {
    setUpdatingId(invId);
    try {
      await api(`/invoices/${invId}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      setInvoices((prev) => prev.map((i) => (i.id === invId ? { ...i, status: next } : i)));
      toast.success(`Marked ${next.toLowerCase()}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update this invoice.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function togglePause() {
    setPausing(true);
    try {
      const saved = await api<Deal>(`/deals/${deal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ recurPaused: !deal.recurPaused }),
      });
      onDealUpdated(saved);
      toast.success(saved.recurPaused ? "Recurring billing paused" : "Recurring billing resumed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update this deal.");
    } finally {
      setPausing(false);
    }
  }

  return (
    <div className="rounded-2xl border border-hair bg-warm-panel p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-warm-gray uppercase">Invoices</span>
        {editable && (
          <Button size="sm" variant="outline" className="rounded-full" onClick={requestInvoice} disabled={requesting}>
            {requesting ? "Requesting…" : "+ Request invoice"}
          </Button>
        )}
      </div>

      {deal.recurring && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-hair-soft bg-white px-3 py-2">
          <span className="text-xs text-ink-mute">
            Recurring · bills monthly{deal.recurPaused ? " · currently paused" : ""}
          </span>
          {editable && (
            <Button size="sm" variant="outline" className="rounded-full" onClick={togglePause} disabled={pausing}>
              {pausing ? "…" : deal.recurPaused ? "Resume" : "Pause"}
            </Button>
          )}
        </div>
      )}

      {dealInvoices.length === 0 ? (
        <p className="text-xs text-ink-mute">No invoices requested yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {dealInvoices.map((inv) => {
            const next = nextStatusFor(inv.status);
            return (
              <div key={inv.id} className="flex items-center justify-between gap-2 rounded-xl border border-hair-soft bg-white px-3 py-2">
                <span className="text-xs text-ink-mute">{inv.date}</span>
                <span className="text-sm font-semibold text-ink">{fmtDollars(inv.amount)}</span>
                <Badge variant={INVOICE_VARIANT[inv.status]}>{inv.status}</Badge>
                {isAdmin && next && (
                  <Button size="sm" variant="outline" disabled={updatingId === inv.id} onClick={() => advance(inv.id, next)}>
                    {updatingId === inv.id ? "…" : `Mark ${next.toLowerCase()}`}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
