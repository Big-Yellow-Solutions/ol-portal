"use client";

import { useMemo } from "react";
import { fmtDollars } from "@/lib/data";
import { companyForContact, initialsOf } from "@/lib/pipeline";
import { usePortalData } from "@/lib/portal-data";

/* Pipeline v2 (design handoff), sections 2 & 3: Companies and People share one
   table layout, differing only in column labels and which collection drives
   the rows. */
export function ContactsTable({
  view,
  search,
  onOpenRecord,
}: {
  view: "companies" | "people";
  search: string;
  onOpenRecord: (type: "company" | "contact", id: string) => void;
}) {
  const { companies, contacts, deals } = usePortalData();
  const companyMap = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c])), [companies]);

  const q = search.trim().toLowerCase();

  const rows = useMemo(() => {
    const base =
      view === "people"
        ? contacts.map((c) => {
            // Their own company, or the one on a deal they are the contact for
            // — a point of contact on a company's deal is not an individual.
            const { company } = companyForContact(c, companyMap, deals);
            return {
              kind: "contact" as const,
              id: c.id,
              name: c.name,
              sub: c.title || "",
              count: deals.filter((d) => d.contactId === c.id).length,
              value: deals.filter((d) => d.contactId === c.id).reduce((sum, d) => sum + (d.amount || 0), 0),
              link: company ? company.name : "Individual — no company",
              linked: !!company,
            };
          })
        : companies.map((c) => ({
            kind: "company" as const,
            id: c.id,
            name: c.name,
            sub: c.kind || "",
            count: deals.filter((d) => d.companyId === c.id).length,
            value: deals.filter((d) => d.companyId === c.id).reduce((sum, d) => sum + (d.amount || 0), 0),
            link: c.contactId ? (contacts.find((p) => p.id === c.contactId)?.name ?? "") : "No primary contact",
            linked: !!c.contactId,
          }));
    return base
      .filter((r) => !q || `${r.name} ${r.sub} ${r.link}`.toLowerCase().includes(q))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [view, contacts, companies, deals, companyMap, q]);

  const recordCol = view === "people" ? "Person" : "Company";
  const linkCol = view === "people" ? "Company" : "Primary contact";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-px overflow-hidden rounded-2xl border border-hair bg-hair-soft">
        <div className="flex items-center gap-3.5 bg-white px-4.5 py-2.5">
          <span className="flex-1 text-[11px] font-semibold tracking-wide text-warm-gray uppercase">{recordCol}</span>
          <span className="w-[190px] shrink-0 text-[11px] font-semibold tracking-wide text-warm-gray uppercase">{linkCol}</span>
          <span className="w-[110px] shrink-0 text-[11px] font-semibold tracking-wide text-warm-gray uppercase">Open deals</span>
          <span className="w-[100px] shrink-0 text-right text-[11px] font-semibold tracking-wide text-warm-gray uppercase">Value</span>
        </div>
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            className="flex items-center gap-3.5 bg-white px-4.5 py-3 text-left hover:bg-[#FBFAFF]"
            onClick={() => onOpenRecord(r.kind === "contact" ? "contact" : "company", r.id)}
          >
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <span className={`flex size-8.5 shrink-0 items-center justify-center bg-violet-pale text-xs font-semibold text-violet-deep ${r.kind === "company" ? "rounded-lg" : "rounded-full"}`}>
                {initialsOf(r.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">{r.name}</span>
                <span className="block truncate text-xs text-ink-mute">{r.sub}</span>
              </span>
            </span>
            <span className={`w-[190px] shrink-0 truncate text-sm ${r.linked ? "text-ink" : "text-ink-mute"}`}>{r.link}</span>
            <span className="w-[110px] shrink-0 text-sm text-ink">{r.count || "—"}</span>
            <span className="w-[100px] shrink-0 text-right text-sm font-bold text-ink">{r.count ? fmtDollars(r.value) : "—"}</span>
          </button>
        ))}
        {rows.length === 0 && (
          <div className="bg-white px-4.5 py-8 text-center text-sm text-ink-mute">No {view} match this search.</div>
        )}
      </div>
      <p className="text-xs text-ink-mute">
        These are the same records used inside a deal. People who work at
        Optimistic Labs live in the{" "}
        <a href="/community?tab=members" className="font-semibold text-violet-deep hover:text-violet">
          Directory
        </a>
        .
      </p>
    </div>
  );
}
