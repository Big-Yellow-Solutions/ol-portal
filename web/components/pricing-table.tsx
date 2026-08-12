"use client";

/* Shared pricing renderer (Base Contract PRD FR3/FR4). The customer-facing
   proposal page, the signing page and the contract editor all render pricing
   through this component so that FR4 holds literally: the preview a Lab Leader
   sees and the page the customer opens are the same code.

   Tiered pricing can be interactive: when `onSelectTier` is passed the customer
   picks their package here, which is what gives the proposal a single total. */

import { pricingLines, pricingTotal, fmtMoney } from "@/lib/pricing";
import type { Pricing } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PricingTable({
  pricing,
  onSelectTier,
  accent,
}: {
  pricing: Pricing | null | undefined;
  onSelectTier?: (tierId: string) => void;
  accent?: string | null;
}) {
  if (!pricing) return null;
  const rows = pricingLines(pricing);
  if (!rows.length) return null;

  const total = pricingTotal(pricing);
  const selectable = pricing.kind === "tiered" && !!onSelectTier;
  const tierIds = pricing.kind === "tiered" ? pricing.tiers.map((t) => t.id) : [];
  const notes = pricing.kind === "tiered" ? undefined : pricing.notes;

  return (
    <div className="mt-2">
      <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row, i) => {
              const tierId = tierIds[i];
              const clickable = selectable && !!tierId;
              return (
                <tr
                  key={`${row.label}-${i}`}
                  onClick={clickable ? () => onSelectTier?.(tierId) : undefined}
                  className={cn(
                    "border-b border-foreground/10 last:border-b-0",
                    clickable && "cursor-pointer hover:bg-violet-pale/50",
                    row.selected && "bg-violet-pale"
                  )}
                >
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      {clickable && (
                        <span
                          aria-hidden
                          className={cn(
                            "inline-block size-4 shrink-0 rounded-full ring-1 ring-foreground/25",
                            row.selected && "ring-4 ring-violet-deep"
                          )}
                          style={row.selected && accent ? { boxShadow: `0 0 0 3px ${accent}` } : undefined}
                        />
                      )}
                      <span className="font-medium text-ink">{row.label}</span>
                      {row.recommended && (
                        <span
                          className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                          style={{ color: accent ?? undefined, borderColor: accent ?? undefined }}
                        >
                          Recommended
                        </span>
                      )}
                      {row.selected && (
                        <span className="rounded border border-green px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-green">
                          Selected
                        </span>
                      )}
                    </div>
                    {row.detail && <div className="mt-1 text-xs text-ink-mute">{row.detail}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right align-top tabular-nums text-ink">
                    {fmtMoney(row.amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink/70">
              <td className="px-4 py-3 font-semibold text-ink">Total</td>
              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-ink">
                {total === null ? (
                  <span className="text-sm font-normal text-ink-mute">
                    {selectable ? "Choose a package above" : "Pending package selection"}
                  </span>
                ) : (
                  fmtMoney(total)
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {notes && <p className="mt-2 text-xs text-ink-mute">{notes}</p>}
    </div>
  );
}
