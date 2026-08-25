"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { PROPOSAL_VARIANT, fmtDollars } from "@/lib/data";
import { billingOf } from "@/lib/pipeline";
import { usePortalData } from "@/lib/portal-data";
import type { Proposal } from "@/lib/types";

/* Pipeline v2 (design handoff), section 4: every proposal in flight across
   the pipeline — the aggregate view deal-view-proposal-tab.tsx never had
   (Admin/Lab Leader previously only saw a proposal from inside its one deal).
   web/app/(portal)/proposals/page.tsx already redirects them here for exactly
   this reason; a Contributor keeps using that page. */
export function ProposalsGrid({
  search,
  lab,
  onOpenDeal,
}: {
  search: string;
  lab: string;
  onOpenDeal: (dealId: string) => void;
}) {
  const { deals, proposals, companies, contacts } = usePortalData();
  const companyMap = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c])), [companies]);
  const contactMap = useMemo(() => Object.fromEntries(contacts.map((c) => [c.id, c])), [contacts]);

  const q = search.trim().toLowerCase();

  const cards = useMemo(() => {
    const latestByDeal = new Map<string, Proposal>();
    for (const p of proposals) {
      if (!p.deal) continue;
      const cur = latestByDeal.get(p.deal);
      if (!cur || (p.updated ?? "") > (cur.updated ?? "")) latestByDeal.set(p.deal, p);
    }
    return [...latestByDeal.entries()]
      .map(([dealId, proposal]) => ({ deal: deals.find((d) => d.id === dealId), proposal }))
      .filter((row): row is { deal: NonNullable<typeof row.deal>; proposal: Proposal } => !!row.deal)
      .filter((row) => lab === "all" || row.deal.lab === lab)
      .filter((row) => {
        if (!q) return true;
        const bill = billingOf(row.deal, companyMap, contactMap);
        return `${row.proposal.title} ${row.deal.client} ${bill.name}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (b.proposal.updated ?? "").localeCompare(a.proposal.updated ?? ""));
  }, [proposals, deals, lab, q, companyMap, contactMap]);

  if (cards.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-hair-strong px-6 py-11 text-center">
        <p className="text-sm text-ink-mute">No proposals match this filter.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map(({ deal, proposal }) => {
        const bill = billingOf(deal, companyMap, contactMap);
        const sent = proposal.status === "Sent" || !!proposal.sentAt;
        const action =
          proposal.status === "Customer Approved"
            ? "Open deal — approved, needs a contract"
            : proposal.status === "Customer Rejected"
              ? "Open deal — client declined"
              : proposal.status === "Revision Requested"
                ? "Open deal — revise and resend"
                : sent
                  ? "Open deal — awaiting client"
                  : "Open deal — mark final and send";
        return (
          <div key={proposal.id} className={`rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(17,17,17,0.04)] ${sent ? "border-green/30" : "border-hair"}`}>
            <div className="mb-3 flex items-center gap-2">
              <Badge variant={PROPOSAL_VARIANT[proposal.status]}>
                {proposal.status}
                {proposal.version ? ` · v${proposal.version}` : ""}
              </Badge>
              <span className="flex-1" />
              <span className="shrink-0 text-[11px] text-warm-gray">{proposal.updated}</span>
            </div>
            <div className="text-[15px] leading-tight font-bold tracking-tight text-ink">{proposal.title}</div>
            <div className="mt-1.5 truncate text-xs text-warm-gray">{bill.name}</div>
            <div className="my-3 h-px bg-hair-soft" />
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate text-xs text-warm-gray">
                {deal.client} · {deal.stage}
              </span>
              <span className="flex-1" />
              <span className="shrink-0 text-sm font-bold tracking-tight text-ink">{fmtDollars(deal.amount)}</span>
            </div>
            <button
              type="button"
              onClick={() => onOpenDeal(deal.id)}
              className="mt-3.5 w-full rounded-full border border-hair-strong bg-white py-2 text-xs font-semibold text-violet-deep hover:border-violet-deep hover:bg-[#F4F2FF]"
            >
              {action}
            </button>
          </div>
        );
      })}
    </div>
      <p className="text-xs text-ink-mute">Proposals are managed from inside each deal. Open a card to send it, revise it, or check on approval.</p>
    </div>
  );
}
