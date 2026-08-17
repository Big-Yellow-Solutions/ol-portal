"use client";

import { Eyebrow } from "@/components/optimist/mark";
import { Pill } from "@/components/optimist/pill";

/* 07 · Six of six (design_handoff_the_optimist, 3g). The interview ends by
   naming what's thin, instead of going quiet. "Thin" here is a client-side
   length heuristic over the drafted sections, not model judgment — the
   backend contract has no field for it — so the per-section explanation is
   deliberately generic rather than fabricating specific insight. */

export interface FlaggedSection {
  key: string;
  label: string;
}

function headline(flaggedCount: number) {
  if (flaggedCount === 0) return { plain: "All six sections are ", signal: "drafted", rest: "." };
  const clause = flaggedCount === 1 ? "One is" : `${flaggedCount} are`;
  return { plain: "All six sections are ", signal: "drafted", rest: `. ${clause} thinner than I'd like.` };
}

export function InterviewComplete({
  proposalTitle,
  clientName,
  flagged,
  questionsAnswered,
  onFixIt,
  onReadThrough,
  onSaveVersion,
  onOffScript,
}: {
  proposalTitle: string;
  clientName?: string;
  flagged: FlaggedSection[];
  questionsAnswered: number;
  onFixIt: (key: string) => void;
  onReadThrough: () => void;
  onSaveVersion: () => void;
  onOffScript: () => void;
}) {
  const h = headline(flagged.length);

  return (
    <div className="flex min-w-0 flex-col overflow-y-auto px-14 py-10">
      <div className="flex items-center gap-3.5">
        <h1 className="font-serif text-2xl leading-[1.2] italic text-ink">{proposalTitle}</h1>
        {clientName && <span className="font-sans text-[13px] text-ink/50">{clientName}</span>}
      </div>

      <Eyebrow className="mt-9">Interview complete</Eyebrow>

      <h2 className="mt-4 max-w-[640px] text-wrap-pretty font-sans text-[34px] leading-[1.22] font-bold tracking-[-.018em] text-ink">
        {h.plain}
        <em className="font-serif text-[34px] leading-[1.22] font-normal not-italic italic text-violet-deep">
          {h.signal}
        </em>
        {h.rest}
      </h2>

      {flagged.length > 0 && (
        <div className="mt-6 flex max-w-[640px] flex-col gap-2.5">
          {flagged.map((f) => (
            <div key={f.key} className="flex gap-3.5 rounded-2xl border border-violet/20 bg-white p-4.5">
              <span className="shrink-0 font-serif text-[15px] leading-[1.4] italic text-violet">{f.key}</span>
              <div>
                <div className="font-sans text-sm leading-[1.4] font-medium text-ink">{f.label} is shorter than the rest</div>
                <p className="mt-1 font-sans text-[13px] leading-[1.5] text-ink/62">
                  Tell me more and I&rsquo;ll expand it — or say what&rsquo;s missing and I&rsquo;ll ask.
                </p>
              </div>
              <Pill tone="outline" size="sm" className="ml-auto shrink-0 self-center" onClick={() => onFixIt(f.key)}>
                Fix it
              </Pill>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6.5 flex items-center gap-3">
        <Pill tone="primary" size="lg" onClick={onReadThrough}>
          Read it through
        </Pill>
        <Pill tone="outline" size="md" onClick={onSaveVersion}>
          Save version
        </Pill>
        <span className="font-sans text-[12.5px] text-ink/50">Autosaved as you answered. Nothing is Final yet.</span>
      </div>

      <div className="mt-auto flex items-center gap-4 border-t border-violet/16 pt-6">
        <button onClick={onOffScript} className="flex items-center gap-1.5 font-sans text-[12.5px] font-medium text-violet-deep">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M3 4h10v7H6l-3 2.5V4z" />
          </svg>
          Keep talking to it
        </button>
        <span className="ml-auto font-sans text-[12.5px] text-ink/45">
          {`${questionsAnswered} question${questionsAnswered === 1 ? "" : "s"} answered · transcript`}
        </span>
      </div>
    </div>
  );
}
