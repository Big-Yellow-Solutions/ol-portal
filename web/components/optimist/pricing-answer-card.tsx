"use client";

import { RippleMark } from "@/components/optimist/mark";
import { Pill } from "@/components/optimist/pill";
import { PricingTable } from "@/components/pricing-table";
import type { Pricing } from "@/lib/types";

/* 06 · Pricing becomes a table, not a paragraph (design_handoff_the_optimist,
   3f). When a turn sets structured pricing, show the real table immediately
   in the interview column, full size — the same PricingTable the customer and
   the document view use, so there is only ever one way pricing renders. */
export function PricingAnswerCard({
  proposalTitle,
  clientName,
  preamble,
  pricing,
  quickReplies,
  onQuickReply,
  nextQuestionHint,
  onContinue,
}: {
  proposalTitle: string;
  clientName?: string;
  preamble: string;
  pricing: Pricing;
  quickReplies: string[];
  onQuickReply: (label: string) => void;
  nextQuestionHint?: string;
  onContinue: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col overflow-y-auto px-14 py-10">
      <div className="flex items-center gap-3.5">
        <h1 className="font-serif text-2xl leading-[1.2] italic text-ink">{proposalTitle}</h1>
        {clientName && <span className="font-sans text-[13px] text-ink/50">{clientName}</span>}
      </div>

      <div className="mt-7.5 flex max-w-[660px] gap-3.5">
        <RippleMark className="mt-0.5 size-5 shrink-0 text-violet-deep" />
        <p className="font-sans text-[15px] leading-[1.6] text-ink/82">{preamble}</p>
      </div>

      <div className="mt-5 max-w-[660px]">
        <div className="flex items-center gap-2 rounded-[14px] border border-violet/25 bg-wash px-4.5 py-2.5">
          <span className="font-serif text-sm italic text-violet-deep">05</span>
          <span className="font-sans text-[11px] font-semibold uppercase tracking-[.1em] text-violet-deep">Pricing</span>
          <span className="ml-auto font-sans text-[11px] text-violet">structured figures, not prose</span>
        </div>
        <PricingTable pricing={pricing} />
      </div>

      {quickReplies.length > 0 && (
        <div className="mt-3.5 flex max-w-[660px] flex-wrap gap-2">
          {quickReplies.map((label, i) => (
            <Pill key={i} tone={i === 0 ? "subtle" : "outline"} size="sm" onClick={() => onQuickReply(label)}>
              {label}
            </Pill>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-3 border-t border-violet/16 pt-5.5">
        <span className="font-sans text-[10.5px] font-semibold uppercase tracking-[.18em] text-violet-deep">Next</span>
        <span className="font-sans text-[13.5px] text-ink/62">
          {nextQuestionHint ?? "Tell me what's next, or keep going."}
        </span>
        <Pill tone="primary" size="sm" className="ml-auto" onClick={onContinue}>
          Continue
        </Pill>
      </div>
    </div>
  );
}
