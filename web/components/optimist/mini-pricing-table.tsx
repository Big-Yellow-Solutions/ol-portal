import { pricingLines, pricingTotal, fmtMoney } from "@/lib/pricing";
import type { Pricing } from "@/lib/types";
import { cn } from "@/lib/utils";

/* The manuscript panel's miniature pricing renderer (design_handoff_the_optimist,
   3f): 6px radius, 10px type. A separate small component from PricingTable on
   purpose — do not try to make one component do both sizes. */
export function MiniPricingTable({ pricing }: { pricing: Pricing | null | undefined }) {
  if (!pricing) return null;
  const rows = pricingLines(pricing);
  if (!rows.length) return null;
  const total = pricingTotal(pricing);

  return (
    <div className="mt-2 overflow-hidden rounded-[6px] border border-violet/30 bg-white">
      {rows.map((row, i) => (
        <div
          key={`${row.label}-${i}`}
          className={cn(
            "flex items-center gap-[5px] border-b border-violet/16 px-[9px] py-1.5 last:border-b-0",
            row.selected && "bg-violet-pale"
          )}
        >
          {row.selected && <span className="size-[5px] shrink-0 rounded-full bg-violet-deep" />}
          <span
            className={cn(
              "flex-1 truncate font-sans text-[10px] leading-none",
              row.selected ? "font-medium text-ink" : "text-ink/75"
            )}
          >
            {row.label}
          </span>
          <span
            className={cn(
              "font-sans text-[10px] leading-none tabular-nums",
              row.selected ? "font-medium text-ink" : "text-ink/75"
            )}
          >
            {fmtMoney(row.amount)}
          </span>
        </div>
      ))}
      <div className="flex items-center border-t-[1.5px] border-ink/60 px-[9px] py-1.5">
        <span className="flex-1 font-sans text-[10px] leading-none font-semibold text-ink">Total</span>
        <span className="font-sans text-[10.5px] leading-none font-semibold tabular-nums text-ink">
          {total === null ? "—" : fmtMoney(total)}
        </span>
      </div>
    </div>
  );
}
