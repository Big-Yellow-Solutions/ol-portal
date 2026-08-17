import { Eyebrow } from "@/components/optimist/mark";
import { Pill } from "@/components/optimist/pill";
import { SECTION_KEYS } from "@/lib/types";
import type { Proposal } from "@/lib/types";
import { cn } from "@/lib/utils";

/* 01 · Arrive (design_handoff_the_optimist, 3a). The interview can't start
   without a proposal, so this screen sells the one action and shows what's
   already in flight. */

function draftedCount(p: Proposal) {
  return SECTION_KEYS.filter((k) => p.sections?.[k]?.trim()).length;
}

function ProgressMeter({ count }: { count: number }) {
  return (
    <div className="flex gap-[3px]">
      {Array.from({ length: 6 }, (_, i) => (
        <span
          key={i}
          className={cn("h-[3px] w-[15px] rounded-full", i < count ? "bg-violet-deep" : "bg-violet/25")}
        />
      ))}
    </div>
  );
}

export function ArriveScreen({
  proposals,
  labNames,
  onSelect,
  onNew,
}: {
  proposals: Proposal[];
  labNames: Record<string, string>;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const inProgress = [...proposals].sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-10 py-12">
      <div className="w-full max-w-[820px]">
        <Eyebrow>Proposal writing</Eyebrow>
        <h1 className="mt-4 font-sans text-[38px] leading-[1.18] font-bold tracking-[-.02em] text-ink">
          Pick a proposal, or start a{" "}
          <em className="font-serif text-[38px] leading-[1.18] font-normal not-italic italic text-violet-deep">
            new
          </em>{" "}
          one.
        </h1>
        <p className="mt-3 max-w-[520px] font-sans text-base leading-[1.6] text-ink/62">
          Tell The Optimist about the client and the work, and it will start drafting.
        </p>
        <div className="mt-6.5 flex items-center gap-3">
          <Pill tone="primary" size="lg" onClick={onNew}>
            + New proposal
          </Pill>
          <span className="font-sans text-[13.5px] text-ink/50">
            It opens with what it already knows from the deal.
          </span>
        </div>

        {inProgress.length > 0 && (
          <div className="mt-10 border-t border-hair pt-4.5">
            <div className="mb-3.5 font-sans text-[10.5px] font-semibold uppercase tracking-[.18em] text-ink/45">
              In progress
            </div>
            <div className="flex flex-col">
              {inProgress.map((p) => {
                const count = draftedCount(p);
                const labName = labNames[p.lab] ?? p.lab;
                return (
                  <button
                    key={p.id}
                    onClick={() => onSelect(p.id)}
                    className={cn(
                      "flex items-center gap-4 rounded-[10px] px-3.5 py-3.5 text-left transition-colors",
                      "border border-transparent hover:border-violet/20",
                      p === inProgress[0] && "border-violet/20 bg-white"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-sans text-[14.5px] font-medium text-ink">{p.title}</div>
                      <div className="mt-0.5 truncate font-sans text-[12.5px] text-ink/55">
                        {p.client} · {labName}
                      </div>
                    </div>
                    <ProgressMeter count={count} />
                    <span
                      className={cn(
                        "w-[88px] shrink-0 text-right font-sans text-xs",
                        p.final ? "font-medium text-green" : "text-ink/50"
                      )}
                    >
                      {p.final ? "Final" : count > 0 ? `${count} of 6` : "Not started"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
