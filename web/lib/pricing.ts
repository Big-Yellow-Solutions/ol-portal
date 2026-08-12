/* Client-side twin of backend/src/pricing.mjs (Base Contract PRD FR3).

   Kept deliberately in step with the server: the server is authoritative and
   re-validates everything, but the proposal editor, the customer-facing
   proposal page, the contract editor and the signing page all need to render
   and total a pricing object without a round trip. If you change what a
   pricing object means, change it in both places. */

import type { Pricing, PricingTier } from "@/lib/types";

/** Money rounded to cents, so float noise never shows up in a total. */
const money = (n: number) => Math.round(n * 100) / 100;

/**
 * The single number that flows to the deal and the contract. Tiered pricing
 * has no total until the customer picks a package, so this returns null and
 * callers should say "pending selection" rather than show a misleading $0.
 */
export function pricingTotal(p: Pricing | null | undefined): number | null {
  if (!p) return null;
  if (p.kind === "flat") return p.amount;
  if (p.kind === "tiered") return p.tiers.find((t) => t.id === p.selected)?.amount ?? null;
  return money(p.items.reduce((s, i) => s + i.qty * i.rate, 0) - (p.discount ?? 0));
}

export interface PricingRow {
  label: string;
  amount: number;
  detail?: string | null;
  recommended?: boolean;
  selected?: boolean;
}

export function pricingLines(p: Pricing | null | undefined): PricingRow[] {
  if (!p) return [];
  if (p.kind === "flat") return [{ label: p.label || "Project fee", amount: p.amount }];
  if (p.kind === "tiered")
    return p.tiers.map((t) => ({
      label: t.name,
      amount: t.amount,
      detail: t.summary,
      recommended: t.recommended,
      selected: t.id === p.selected,
    }));

  const rows: PricingRow[] = p.items.map((i) => ({
    label: i.description,
    amount: money(i.qty * i.rate),
    detail: i.qty === 1 ? null : `${i.qty} × ${fmtMoney(i.rate)}`,
  }));
  if (p.discount) rows.push({ label: "Discount", amount: -p.discount });
  return rows;
}

export function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Short label for tables and cards, where a null total needs saying. */
export function pricingSummary(p: Pricing | null | undefined): string {
  const total = pricingTotal(p);
  if (total !== null) return fmtMoney(total);
  if (p?.kind === "tiered") return `${p.tiers.length} packages`;
  return "—";
}

/** Mirrors samePricing() server-side: compares figures, ignores presentation. */
export function samePricing(a: Pricing | null | undefined, b: Pricing | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "flat" && b.kind === "flat") return a.amount === b.amount;
  if (a.kind === "tiered" && b.kind === "tiered") {
    const key = (tiers: PricingTier[], selected?: string) =>
      tiers.map((t) => `${t.id}:${t.amount}`).sort().join("|") + `#${selected ?? ""}`;
    return key(a.tiers, a.selected) === key(b.tiers, b.selected);
  }
  if (a.kind === "itemized" && b.kind === "itemized") {
    const key = (p: typeof a) =>
      p.items.map((i) => `${i.description}:${i.qty}:${i.rate}`).sort().join("|") + `#${p.discount ?? 0}`;
    return key(a) === key(b);
  }
  return false;
}

export const emptyPricing = (kind: Pricing["kind"]): Pricing =>
  kind === "flat"
    ? { kind: "flat", amount: 0, label: "Project fee" }
    : kind === "tiered"
      ? { kind: "tiered", tiers: [{ id: "tier-1", name: "", amount: 0 }] }
      : { kind: "itemized", items: [{ description: "", qty: 1, rate: 0 }] };
