"use client";

/* Deal flow board (Base Contract PRD FR17) — Admin only.

   Answers the question the PRD's problem statement opens with: where does a
   deal actually sit, without asking the Lab Leader. One row per deal, showing
   the proposal and contract stage side by side, so "proposal sent but never
   opened" and "signed three weeks ago and still not closed" are both visible
   at a glance rather than inferred from three separate pages. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CONTRACT_VARIANT, PROPOSAL_VARIANT, fmtDollars, fullName } from "@/lib/data";
import { pricingTotal } from "@/lib/pricing";
import { usePortalData } from "@/lib/portal-data";
import type { Contract, Deal, Proposal } from "@/lib/types";
import { isClosedStage } from "@/lib/pipeline";

interface Row {
  deal: Deal;
  proposal: Proposal | null;
  contract: Contract | null;
  /** What is actually holding this deal up right now. */
  waitingOn: string;
  stalled: boolean;
}

const DAY = 24 * 60 * 60 * 1000;
const daysSince = (iso?: string) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : null);

export default function DealFlowPage() {
  const { loading, error, role, deals, proposals, contracts, labs, people } = usePortalData();
  const [labFilter, setLabFilter] = useState("all");
  const [search, setSearch] = useState("");

  const rows: Row[] = useMemo(() => {
    return deals
      .map((deal) => {
        // The current proposal is the most recently updated one on the deal;
        // PRD 7 allows only one active at a time.
        const proposal =
          proposals
            .filter((p) => p.deal === deal.id)
            .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""))[0] ?? null;
        const contract = contracts.find((c) => c.deal === deal.id) ?? null;
        return { deal, proposal, contract, ...waitingOn(deal, proposal, contract) };
      })
      .sort((a, b) => Number(b.stalled) - Number(a.stalled));
  }, [deals, proposals, contracts]);

  if (loading) return <p className="text-sm text-ink-mute">Loading…</p>;
  if (error) return <p className="text-sm text-red">{error}</p>;
  if (role !== "Admin")
    return <p className="text-sm text-ink-mute">The deal flow board is for Admins.</p>;

  const labName = (id: string) => labs.find((l) => l.id === id)?.name ?? id;
  const visible = rows.filter(
    (r) =>
      (labFilter === "all" || r.deal.lab === labFilter) &&
      (!search.trim() ||
        r.deal.client.toLowerCase().includes(search.trim().toLowerCase()) ||
        (r.proposal?.title ?? "").toLowerCase().includes(search.trim().toLowerCase()))
  );

  const counts = {
    live: rows.filter((r) => !isClosedStage(r.deal.stage)).length,
    outForSignature: rows.filter((r) => r.contract?.status === "Out for Signature").length,
    signed: rows.filter((r) => r.contract?.status === "Signed").length,
    stalled: rows.filter((r) => r.stalled).length,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl italic text-ink">Deal flow</h1>
        <p className="mt-1 text-sm text-ink-mute">
          Every deal across every lab, and what each one is waiting on.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Live deals" value={counts.live} />
        <Stat label="Out for signature" value={counts.outForSignature} />
        <Stat label="Signed" value={counts.signed} />
        <Stat label="Needs a nudge" value={counts.stalled} tone={counts.stalled ? "warn" : undefined} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search client or proposal"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={labFilter} onValueChange={setLabFilter}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All labs</SelectItem>
            {labs.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Lab</TableHead>
              <TableHead>Lab Leader</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Proposal</TableHead>
              <TableHead>Contract</TableHead>
              <TableHead>Waiting on</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map(({ deal, proposal, contract, waitingOn: waiting, stalled }) => (
              <TableRow key={deal.id} className={stalled ? "bg-amber-pale/40" : undefined}>
                <TableCell>
                  <div className="font-medium text-ink">{deal.client}</div>
                  <div className="text-xs text-ink-mute">{deal.id}</div>
                </TableCell>
                <TableCell>{labName(deal.lab)}</TableCell>
                <TableCell>{fullName(people[deal.owner ?? ""]) || deal.owner || "—"}</TableCell>
                <TableCell className="tabular-nums">
                  {fmtDollars(pricingTotal(contract?.pricing ?? proposal?.pricing) ?? deal.amount)}
                </TableCell>
                <TableCell>
                  {proposal ? (
                    <div className="flex flex-col gap-1">
                      <Badge variant={PROPOSAL_VARIANT[proposal.status]} className="w-fit">
                        {proposal.status}
                      </Badge>
                      <span className="text-xs text-ink-mute">
                        v{proposal.sentVersion ?? proposal.version}
                        {proposal.viewCount
                          ? ` · opened ${proposal.viewCount}×`
                          : proposal.sentAt
                            ? " · not opened yet"
                            : ""}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-ink-mute">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {contract ? (
                    <div className="flex flex-col gap-1">
                      <Badge variant={CONTRACT_VARIANT[contract.status]} className="w-fit">
                        {contract.status}
                      </Badge>
                      {contract.hasDeviations && (
                        <Badge variant="warning" className="w-fit">
                          Deviates
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-ink-mute">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-ink-soft">{waiting}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {visible.length === 0 && <p className="text-sm text-ink-mute">Nothing matches that filter.</p>}

      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/contracts">Go to contracts</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/pipeline">Go to pipeline</Link>
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <Card className={tone === "warn" && value > 0 ? "border-amber bg-amber-pale/40" : undefined}>
      <CardContent className="pt-6">
        <div className="text-2xl font-semibold tabular-nums text-ink">{value}</div>
        <div className="mt-1 text-sm text-ink-mute">{label}</div>
      </CardContent>
    </Card>
  );
}

/* The single most useful column on this page: not the status, but the thing a
   human would have to chase. "Stalled" is deliberately conservative — a week
   without movement on something waiting on someone else. */
function waitingOn(
  deal: Deal,
  proposal: Proposal | null,
  contract: Contract | null
): { waitingOn: string; stalled: boolean } {
  if (contract?.status === "Signed") {
    if (deal.stage !== "Closed")
      return { waitingOn: "Signed — not marked Closed Won yet", stalled: true };
    return { waitingOn: "Done", stalled: false };
  }
  if (contract?.status === "Out for Signature") {
    if (!contract.signatures?.client) {
      const days = daysSince(contract.sentForSignatureAt);
      return {
        waitingOn: `Client signature${days !== null ? ` · ${days}d` : ""}`,
        stalled: (days ?? 0) >= 7,
      };
    }
    return {
      waitingOn: `${contract.olSignatoryName ?? "OL"} to countersign`,
      stalled: (daysSince(contract.signatures.client.at) ?? 0) >= 2,
    };
  }
  if (contract) return { waitingOn: `${contract.owner ? "Lab Leader" : "Someone"} to send it out`, stalled: false };

  if (proposal?.approvedVersion) return { waitingOn: "Generate the contract", stalled: true };
  if (proposal?.status === "Revision Requested")
    return { waitingOn: "Lab Leader to revise and resend", stalled: true };
  if (proposal?.status === "Sent") {
    const days = daysSince(proposal.sentAt);
    if (!proposal.viewCount)
      return { waitingOn: `Client hasn't opened it${days !== null ? ` · ${days}d` : ""}`, stalled: (days ?? 0) >= 3 };
    return { waitingOn: `Client decision${days !== null ? ` · ${days}d` : ""}`, stalled: (days ?? 0) >= 7 };
  }
  if (proposal) return { waitingOn: "Proposal in draft", stalled: false };
  return { waitingOn: "No proposal yet", stalled: false };
}
