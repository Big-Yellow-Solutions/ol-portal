"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CONTRACT_VARIANT,
  DOC_KIND_LABEL,
  INVOICE_VARIANT,
  PROPOSAL_VARIANT,
  docKindOf,
  fmtDollars,
} from "@/lib/data";
import { billingOf } from "@/lib/pipeline";
import { usePortalData } from "@/lib/portal-data";
import { cn } from "@/lib/utils";
import type { BadgeVariant } from "@/lib/data";
import type { Deal } from "@/lib/types";

/* Pipeline v2, fourth view: every proposal, signed contract and invoice in the
   pipeline with its current version — the aggregate the Proposals tab only
   ever showed a third of.
 *
 * The design draws documents as uploaded files carrying their own version
 * history. This app's documents are the real ones — a structured proposal with
 * snapshot versions, a contract that goes out for signature, an invoice
 * request that moves through admin review — so a card reads its version and
 * status from the record rather than from a file. Where a record has no
 * version concept (an invoice request does not), the card says nothing rather
 * than inventing "v1".
 */

const PAGE_SIZE = 9;

type Kind = "all" | "proposals" | "contracts" | "invoices";

const KINDS: { key: Kind; label: string }[] = [
  { key: "all", label: "All documents" },
  { key: "proposals", label: "Proposals" },
  { key: "contracts", label: "Contracts" },
  { key: "invoices", label: "Invoices" },
];

type Sort = "newest" | "oldest" | "amount" | "name";

const SORTS: { key: Sort; label: string }[] = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "amount", label: "Largest amount" },
  { key: "name", label: "Name A–Z" },
];

interface DocCard {
  id: string;
  kind: Exclude<Kind, "all">;
  tag: string;
  name: string;
  client: string;
  status: string;
  variant: BadgeVariant;
  version?: number;
  /** "Sent Aug 14" — what last happened to this document, and when. */
  when: string;
  /** Sort key: the ISO-ish date behind `when`. */
  at: string;
  amount: number;
  /** "Grace Network — cohort two · Proposal Sent" */
  sub: string;
  /** "2 earlier versions on record", when the record actually keeps them. */
  versionNote?: string;
  action: string;
  deal?: Deal;
  /** Documents with no deal (a Contributor MSA) open on their own page. */
  href?: string;
  /** A finished document reads green rather than violet. */
  done: boolean;
}

function shortDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function DocumentsGrid({
  search,
  lab,
  onOpenDeal,
}: {
  search: string;
  lab: string;
  onOpenDeal: (dealId: string) => void;
}) {
  const { deals, proposals, contracts, invoices, companies, contacts } =
    usePortalData();
  const [kind, setKind] = useState<Kind>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [page, setPage] = useState(1);

  const companyMap = useMemo(
    () => Object.fromEntries(companies.map((c) => [c.id, c])),
    [companies]
  );
  const contactMap = useMemo(
    () => Object.fromEntries(contacts.map((c) => [c.id, c])),
    [contacts]
  );
  const dealMap = useMemo(
    () => Object.fromEntries(deals.map((d) => [d.id, d])),
    [deals]
  );

  const all = useMemo<DocCard[]>(() => {
    const out: DocCard[] = [];

    /* One card per deal, not per proposal row: a deal's proposal is a single
       document that has been revised, and the older rows are its history. */
    const latestByDeal = new Map<string, (typeof proposals)[number]>();
    for (const p of proposals) {
      if (!p.deal) continue;
      const cur = latestByDeal.get(p.deal);
      if (!cur || (p.updated ?? "") > (cur.updated ?? "")) latestByDeal.set(p.deal, p);
    }
    for (const p of latestByDeal.values()) {
      const deal = p.deal ? dealMap[p.deal] : undefined;
      const bill = deal
        ? billingOf(deal, companyMap, contactMap)
        : { name: p.client ?? "" };
      const sent = p.status === "Sent" || !!p.sentAt;
      const earlier = Math.max((p.versions?.length ?? 0) - 1, 0);
      out.push({
        id: `proposal:${p.id}`,
        kind: "proposals",
        tag: "Proposal",
        name: p.title,
        client: bill.name || p.client || "—",
        status: p.status,
        variant: PROPOSAL_VARIANT[p.status],
        version: p.version,
        when: p.sentAt
          ? `Sent ${shortDate(p.sentAt)}`
          : `Updated ${shortDate(p.updated)}`,
        at: p.sentAt || p.updated || "",
        amount: deal?.amount ?? 0,
        sub: deal ? `${deal.client} · ${deal.stage}` : (p.client ?? ""),
        versionNote:
          earlier > 0
            ? `${earlier} earlier version${earlier === 1 ? "" : "s"} on record`
            : undefined,
        action:
          p.status === "Customer Approved"
            ? "Open deal — request a contract"
            : p.status === "Customer Rejected"
              ? "Open deal — client declined"
              : p.status === "Revision Requested"
                ? "Open deal — revise and resend"
                : sent
                  ? "Open deal — awaiting client"
                  : "Open deal — mark final and send",
        deal,
        done: sent,
      });
    }

    for (const c of contracts) {
      const deal = c.deal ? dealMap[c.deal] : undefined;
      const signed = c.status === "Signed";
      out.push({
        id: `contract:${c.id}`,
        kind: "contracts",
        tag: DOC_KIND_LABEL[docKindOf(c)],
        name: c.client,
        client: c.client,
        status: c.status,
        variant: CONTRACT_VARIANT[c.status],
        when: signed
          ? `Signed ${shortDate(c.updated ?? c.created)}`
          : `Updated ${shortDate(c.updated ?? c.created)}`,
        at: c.updated || c.created || "",
        amount: c.amount ?? deal?.amount ?? 0,
        sub: deal ? `${deal.client} · ${deal.stage}` : DOC_KIND_LABEL[docKindOf(c)],
        action: deal
          ? signed
            ? "Open deal — view contract"
            : "Open deal — contract in progress"
          : "Open on Contracts →",
        deal,
        href: deal ? undefined : "/contracts",
        done: signed,
      });
    }

    for (const i of invoices) {
      const deal = dealMap[i.deal];
      out.push({
        id: `invoice:${i.id}`,
        kind: "invoices",
        tag: "Invoice",
        name: `${i.client} — invoice`,
        client: i.client,
        status: i.status,
        variant: INVOICE_VARIANT[i.status],
        when:
          i.status === "Paid" ? `Paid ${shortDate(i.date)}` : `Requested ${shortDate(i.date)}`,
        at: i.date || "",
        amount: i.amount ?? 0,
        sub: deal
          ? `${deal.client}${i.recurring ? " · recurring" : ""}`
          : i.recurring
            ? "Recurring"
            : "One-off",
        action: deal ? "Open deal — view invoice" : "Open on Invoice Requests →",
        deal,
        href: deal ? undefined : "/invoices",
        done: i.status === "Paid",
      });
    }

    return out;
  }, [proposals, contracts, invoices, dealMap, companyMap, contactMap]);

  const q = search.trim().toLowerCase();

  const matching = useMemo(() => {
    const rows = all.filter((d) => {
      if (kind !== "all" && d.kind !== kind) return false;
      if (lab !== "all" && d.deal?.lab !== lab) return false;
      if (!q) return true;
      return `${d.name} ${d.client} ${d.sub} ${d.status}`.toLowerCase().includes(q);
    });
    const sorted = [...rows];
    if (sort === "newest") sorted.sort((a, b) => b.at.localeCompare(a.at));
    else if (sort === "oldest") sorted.sort((a, b) => a.at.localeCompare(b.at));
    else if (sort === "amount") sorted.sort((a, b) => b.amount - a.amount);
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [all, kind, lab, q, sort]);

  const counts = useMemo(
    () => ({
      all: all.length,
      proposals: all.filter((d) => d.kind === "proposals").length,
      contracts: all.filter((d) => d.kind === "contracts").length,
      invoices: all.filter((d) => d.kind === "invoices").length,
    }),
    [all]
  );

  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  /* A filter change can leave the reader on a page that no longer exists.
     Clamping in render rather than correcting the state in an effect means the
     grid is never briefly empty, and widening the filter again returns them to
     the page they were on. */
  const current = Math.min(page, pages);
  const start = (current - 1) * PAGE_SIZE;
  const shown = matching.slice(start, start + PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {KINDS.map((k) => {
          const on = kind === k.key;
          return (
            <button
              key={k.key}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setKind(k.key);
                setPage(1);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-semibold transition-colors",
                on
                  ? "border-violet-deep bg-violet-pale text-violet-deep"
                  : "border-hair-strong bg-white text-ink-soft hover:bg-[#F4F2FF] hover:text-violet-deep"
              )}
            >
              {k.label}
              <span className="text-[11px] font-semibold tabular-nums opacity-70">
                {counts[k.key]}
              </span>
            </button>
          );
        })}
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-[13px] whitespace-nowrap text-warm-gray">
          Sort
          <Select
            value={sort}
            onValueChange={(v) => {
              setSort(v as Sort);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44 rounded-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.key} value={s.key}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-hair-strong px-6 py-11 text-center">
          <p className="text-sm text-ink-mute">No documents match this filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((d) => (
            <div
              key={d.id}
              className={cn(
                "flex flex-col rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(17,17,17,0.04)]",
                d.done ? "border-green/30" : "border-hair"
              )}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-[#F4F2FF] px-2 py-[3px] text-[10px] font-bold tracking-[0.09em] text-violet uppercase">
                  {d.tag}
                </span>
                <Badge variant={d.variant}>
                  {d.status}
                  {d.version ? ` · v${d.version}` : ""}
                </Badge>
                <span className="flex-1" />
                <span className="shrink-0 text-[11px] text-warm-gray">{d.when}</span>
              </div>

              <div className="text-[15px] leading-tight font-bold tracking-tight text-ink">
                {d.name}
              </div>
              <div className="mt-1.5 truncate text-xs text-warm-gray">{d.client}</div>

              <div className="my-3 h-px bg-hair-soft" />

              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate text-xs text-warm-gray">{d.sub}</span>
                <span className="flex-1" />
                <span className="shrink-0 text-sm font-bold tracking-tight text-ink tabular-nums">
                  {fmtDollars(d.amount)}
                </span>
              </div>

              {d.versionNote && (
                <div className="mt-2 text-[11px] text-warm-gray">{d.versionNote}</div>
              )}

              <span className="flex-1" />

              {d.deal ? (
                <button
                  type="button"
                  onClick={() => onOpenDeal(d.deal!.id)}
                  className="mt-3.5 w-full cursor-pointer rounded-full border border-hair-strong bg-white py-2 text-xs font-semibold text-violet-deep transition-colors hover:border-violet-deep hover:bg-[#F4F2FF]"
                >
                  {d.action}
                </button>
              ) : (
                <a
                  href={d.href}
                  className="mt-3.5 w-full rounded-full border border-hair-strong bg-white py-2 text-center text-xs font-semibold text-violet-deep transition-colors hover:border-violet-deep hover:bg-[#F4F2FF]"
                >
                  {d.action}
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {matching.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-mute">
            Showing {start + 1}–{start + shown.length} of {matching.length}{" "}
            {matching.length === 1 ? "document" : "documents"}
          </span>
          {pages > 1 && (
            <>
              <span className="flex-1" />
              <PageButton
                onClick={() => setPage(current - 1)}
                disabled={current === 1}
                label="Previous page"
              >
                <ChevronLeft size={14} />
              </PageButton>
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                <PageButton
                  key={n}
                  onClick={() => setPage(n)}
                  active={n === current}
                  label={`Page ${n}`}
                >
                  {n}
                </PageButton>
              ))}
              <PageButton
                onClick={() => setPage(current + 1)}
                disabled={current === pages}
                label="Next page"
              >
                <ChevronRight size={14} />
              </PageButton>
            </>
          )}
        </div>
      )}

      <p className="text-xs text-ink-mute">
        Every proposal, contract and invoice in the pipeline. Documents are
        managed inside a deal — open one to send a version, request a contract,
        or move an invoice along.
      </p>
    </div>
  );
}

function PageButton({
  children,
  onClick,
  disabled,
  active,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-9 cursor-pointer items-center justify-center rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border-violet-deep bg-violet-pale text-violet-deep"
          : "border-hair-strong bg-white text-ink-soft hover:bg-[#F4F2FF] hover:text-violet-deep",
        disabled && "cursor-not-allowed opacity-40 hover:bg-white hover:text-ink-soft"
      )}
    >
      {children}
    </button>
  );
}
