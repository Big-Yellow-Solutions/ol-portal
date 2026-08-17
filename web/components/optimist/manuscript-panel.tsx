import { RippleMark } from "@/components/optimist/mark";
import { MiniPricingTable } from "@/components/optimist/mini-pricing-table";
import { SECTION_KEYS, SECTION_LABELS } from "@/lib/types";
import type { Pricing } from "@/lib/types";
import { cn } from "@/lib/utils";

/* The 440px right column of every interview-family screen (design_handoff_the_optimist,
   3c/3d/3f/3g): progress header, six-segment bar, then a "sheet" card listing
   every section in its current state. This is the one place a Lab Leader sees
   the whole shape of the proposal while answering one question at a time. */

interface ManuscriptPanelProps {
  proposalTitle: string;
  draftSections: Record<string, string>;
  draftPricing?: Pricing | null;
  activeKey?: string | null;
  recentlyWritten?: Set<string>;
  /** Tag shown on just-written rows — "Just written" by default, "from the RFP"
   *  when the turn came from an ingested attachment. */
  justWrittenTag?: string;
  flaggedKeys?: Set<string>;
  versionLabel?: string;
  footerNote?: string;
}

export function ManuscriptPanel({
  proposalTitle,
  draftSections,
  draftPricing,
  activeKey,
  recentlyWritten,
  justWrittenTag = "Just written",
  flaggedKeys,
  versionLabel,
  footerNote,
}: ManuscriptPanelProps) {
  const drafted = SECTION_KEYS.filter((k) => draftSections[k]?.trim());
  const count = drafted.length;
  const flagged = flaggedKeys ?? new Set<string>();
  const wash = recentlyWritten ?? new Set<string>();

  return (
    <div className="flex min-w-0 flex-col border-l border-hair bg-desk p-7 px-8">
      <div className="flex items-baseline gap-2">
        <span className="font-sans text-[10.5px] font-semibold uppercase tracking-[.18em] text-ink/50">
          The manuscript
        </span>
        <span
          className={cn(
            "ml-auto font-serif text-[15px] italic leading-none",
            count > 0 ? "text-violet-deep" : "text-ink/40"
          )}
        >
          {count}
        </span>
        <span className="font-sans text-[11.5px] text-ink/50">of 6 drafted</span>
      </div>

      <div className="mt-2.5 mb-4.5 flex gap-1.5">
        {SECTION_KEYS.map((k) => (
          <span
            key={k}
            className={cn(
              "h-1 flex-1 rounded-full",
              draftSections[k]?.trim() ? "bg-violet-deep" : "bg-violet/25"
            )}
          />
        ))}
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-hidden rounded-lg bg-white p-7 shadow-[0_18px_44px_-22px_rgba(61,47,212,.45),0_1px_2px_rgba(17,17,17,.06)]"
      >
        <div className="flex items-center gap-1.5 border-b border-hair pb-3">
          <RippleMark className={cn("size-3.5", count > 0 ? "text-violet-deep" : "text-violet-light")} />
          <span className="truncate font-serif text-[13px] italic text-ink">{proposalTitle}</span>
          {versionLabel && (
            <span className="ml-auto shrink-0 font-sans text-[9.5px] text-ink/45">{versionLabel}</span>
          )}
        </div>

        <div className="flex flex-col gap-2.5 overflow-y-auto">
          {SECTION_KEYS.map((key) => {
            const content = draftSections[key]?.trim() ?? "";
            const isEmpty = !content;
            const isActive = key === activeKey;
            const justWritten = wash.has(key);
            const isPricing = key === "pricing";
            const isFlagged = flagged.has(key);

            if (justWritten) {
              return (
                <div key={key} className="-mx-2.5 rounded-lg bg-wash px-2.5 py-2 transition-colors duration-[6000ms]">
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-[10px] italic leading-none text-violet">
                      {String(SECTION_KEYS.indexOf(key) + 1).padStart(2, "0")}
                    </span>
                    <span className="font-sans text-[9px] font-semibold uppercase tracking-[.09em] text-violet-deep">
                      {SECTION_LABELS[key]}
                    </span>
                    <span className="ml-auto font-sans text-[8.5px] font-medium uppercase tracking-[.08em] text-violet">
                      {justWrittenTag}
                    </span>
                  </div>
                  {isPricing && draftPricing ? (
                    <MiniPricingTable pricing={draftPricing} />
                  ) : (
                    <div className="mt-1.5 ml-4.5 flex flex-col gap-1">
                      <span className="h-1 rounded-sm bg-violet/55" />
                      <span className="h-1 w-2/3 rounded-sm bg-violet/55" />
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={key}>
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "font-serif text-[10px] italic leading-none",
                      isEmpty ? "text-ink/22" : "text-violet-light"
                    )}
                  >
                    {String(SECTION_KEYS.indexOf(key) + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={cn(
                      "font-sans text-[9px] font-semibold uppercase tracking-[.09em]",
                      isEmpty ? "text-ink/30" : "text-ink/50"
                    )}
                  >
                    {SECTION_LABELS[key]}
                  </span>
                  {isActive && (
                    <span className="ml-auto font-sans text-[9px] text-violet">answering now</span>
                  )}
                  {isFlagged && !isActive && (
                    <span className="ml-auto size-[5px] shrink-0 rounded-full bg-amber" />
                  )}
                </div>
                {isActive && (
                  <div className="-mt-2 ml-4.5 h-6.5 rounded-[5px] border border-dashed border-violet/40" />
                )}
                {!isEmpty && isPricing && draftPricing && <MiniPricingTable pricing={draftPricing} />}
                {!isEmpty && !isPricing && (
                  <div className="mt-1.5 ml-4.5 flex flex-col gap-1">
                    <span className="h-[3.5px] rounded-sm bg-ink/16" />
                    <span className="h-[3.5px] w-3/5 rounded-sm bg-ink/16" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {flagged.size > 0 ? (
          <div className="mt-auto flex items-center gap-1.5 border-t border-hair pt-3">
            <span className="size-[5px] shrink-0 rounded-full bg-amber" />
            <span className="font-sans text-[10.5px] text-ink/50">
              {flagged.size === 1 ? "One section wants your attention" : `${flagged.size} sections want your attention`}
            </span>
          </div>
        ) : (
          <p className="mt-auto font-sans text-[11.5px] leading-normal text-ink/40">
            {footerNote ?? "Sections fill in as you answer. Nothing here is typed by hand."}
          </p>
        )}
      </div>
    </div>
  );
}
