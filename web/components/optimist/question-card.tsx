"use client";

import { StarMark } from "@/components/optimist/mark";
import { Pill } from "@/components/optimist/pill";

/* 03 · Question one, and 04 · Hand it a document (design_handoff_the_optimist,
   3c/3d). One question at a time, in large type, with an escape hatch to
   free-form chat and to auto-fill. The attachment result block (3d) renders
   inline above the answer field when the last turn ingested a file. */

const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "are",
  "was", "were", "do", "does", "did", "it", "that", "this", "you", "your",
  "we", "our", "they", "them", "their", "what", "how", "who", "which",
  "with", "from", "about", "have", "has", "had", "can", "will", "would",
  "should", "could", "not", "no", "yes", "did",
]);

/** Best-effort pick of one "signal word" to italicize in a question headline —
 *  the backend returns plain conversational text with no markup, so this is a
 *  heuristic (last content word), not a guarantee of the ideal word. */
function pickSignalIndex(words: string[]): number {
  for (let i = words.length - 1; i >= 0; i--) {
    const clean = words[i].replace(/[^a-zA-Z']/g, "");
    if (clean.length > 3 && !STOPWORDS.has(clean.toLowerCase())) return i;
  }
  return -1;
}

function QuestionHeadline({ text, applySignal }: { text: string; applySignal: boolean }) {
  const words = text.split(" ");
  const signalIndex = applySignal ? pickSignalIndex(words) : -1;
  return (
    <h2 className="mt-4 max-w-[660px] text-wrap-pretty font-sans text-[34px] leading-[1.22] font-bold tracking-[-.018em] text-ink">
      {words.map((w, i) => (
        <span key={i}>
          {i === signalIndex ? (
            <em className="font-serif text-[34px] leading-[1.22] font-normal not-italic italic text-violet-deep">
              {w}
            </em>
          ) : (
            w
          )}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </h2>
  );
}

export interface AttachmentLanding {
  label: string;
  sectionLabel: string | null;
}

export interface AttachmentResult {
  name: string;
  meta: string;
  landed: AttachmentLanding[];
  unresolved: string[];
}

function AttachmentResultBlock({ result }: { result: AttachmentResult }) {
  return (
    <div className="mt-5.5 max-w-[660px] rounded-2xl border border-violet/22 bg-white p-4.5">
      <div className="flex items-center gap-3 border-b border-violet/16 pb-3.5">
        <div className="flex h-[42px] w-[34px] shrink-0 items-center justify-center rounded-[5px] bg-violet-pale font-sans text-[9px] font-semibold tracking-wide text-violet-deep">
          PDF
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-sans text-[13.5px] font-medium text-ink">{result.name}</div>
          <div className="mt-0.5 font-sans text-[11.5px] text-ink/55">{result.meta}</div>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-green-pale px-2.5 py-1 font-sans text-[11px] font-medium text-green">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2}>
            <path d="M3 8.5l3.2 3L13 5" />
          </svg>
          Read
        </span>
      </div>
      <div className="flex flex-col gap-2 pt-3.5">
        {result.landed.map((l, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--green)" strokeWidth={2.2} className="shrink-0">
              <path d="M3 8.5l3.2 3L13 5" />
            </svg>
            <span className="font-sans text-[13px] text-ink/75">
              {l.label}
              {l.sectionLabel && (
                <>
                  {" → "}
                  <em className="font-serif not-italic italic text-violet-deep">{l.sectionLabel}</em>
                </>
              )}
            </span>
          </div>
        ))}
        {result.unresolved.map((text, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="size-3 shrink-0 rounded-full border-[1.5px] border-amber/50" />
            <span className="font-sans text-[13px] text-ink/75">{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function QuestionCard({
  proposalTitle,
  clientName,
  questionNumber,
  sectionHint,
  questionText,
  applySignalWord,
  groundingLine,
  attachmentResult,
  input,
  onInputChange,
  onAnswer,
  onAttachClick,
  attachInputRef,
  onAttachFile,
  attachedFileName,
  sending,
  quickReplies,
  onSkip,
  transcriptSummary,
  onOffScript,
  onAutoFill,
}: {
  proposalTitle: string;
  clientName?: string;
  questionNumber: number;
  sectionHint: string;
  questionText: string;
  applySignalWord: boolean;
  groundingLine?: string;
  attachmentResult?: AttachmentResult;
  input: string;
  onInputChange: (v: string) => void;
  onAnswer: () => void;
  onAttachClick: () => void;
  attachInputRef: React.RefObject<HTMLInputElement | null>;
  onAttachFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  attachedFileName?: string | null;
  sending: boolean;
  quickReplies?: { label: string; tone?: "subtle" | "outline" }[];
  onSkip?: () => void;
  transcriptSummary?: string;
  onOffScript: () => void;
  onAutoFill: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col overflow-y-auto px-14 py-10">
      <div className="flex items-center gap-3.5">
        <h1 className="font-serif text-2xl leading-[1.2] italic text-ink">{proposalTitle}</h1>
        {clientName && <span className="font-sans text-[13px] text-ink/50">{clientName}</span>}
      </div>

      <div className="mt-8.5 flex items-center gap-[9px]">
        <StarMark className="size-[11px] text-violet" />
        <span className="font-sans text-[10.5px] font-semibold uppercase tracking-[.18em] text-violet-deep">
          {`Question ${String(questionNumber).padStart(2, "0")}`}
        </span>
        <span className="font-sans text-[11.5px] text-ink/45">{sectionHint}</span>
      </div>

      <QuestionHeadline text={questionText} applySignal={applySignalWord} />

      {groundingLine && (
        <p className="mt-3.5 max-w-[560px] font-sans text-[15.5px] leading-[1.6] text-ink/62">{groundingLine}</p>
      )}

      {attachmentResult && <AttachmentResultBlock result={attachmentResult} />}

      <div className="mt-6.5 max-w-[660px] rounded-2xl border border-violet/28 bg-white p-5 shadow-[0_0_0_4px_var(--wash)]">
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onAnswer();
            }
          }}
          disabled={sending}
          rows={2}
          placeholder="Tell The Optimist about the client and the work, and it will start drafting."
          className="w-full resize-none bg-transparent font-sans text-[15.5px] leading-[1.6] text-ink placeholder:text-ink/40 focus:outline-none"
        />
        <div className="mt-3.5 flex items-center gap-2 border-t border-violet/16 pt-3.5">
          <Pill tone="outline" size="sm" onClick={onAttachClick} disabled={sending}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M10.5 5.5l-4.6 4.6a1.7 1.7 0 002.4 2.4l4.9-4.9a3 3 0 00-4.2-4.2L4 8.3" />
            </svg>
            {attachedFileName ?? "Attach a file"}
          </Pill>
          <input ref={attachInputRef} type="file" hidden onChange={onAttachFile} disabled={sending} />
          <span className="ml-auto font-sans text-[11.5px] text-ink/40">Enter to answer, Shift+Enter for a new line</span>
          <Pill tone="primary" size="sm" onClick={onAnswer} disabled={sending || !input.trim()}>
            Answer
          </Pill>
        </div>
      </div>

      {(quickReplies?.length || onSkip) && (
        <div className="mt-4 flex max-w-[660px] flex-wrap gap-2">
          {quickReplies?.map((q, i) => (
            <Pill key={i} tone={q.tone === "subtle" ? "subtle" : "outline"} size="sm" onClick={() => onInputChange(q.label)}>
              {q.label}
            </Pill>
          ))}
          {onSkip && (
            <Pill tone="dashed" size="sm" onClick={onSkip}>
              Skip for now
            </Pill>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center gap-4 border-t border-violet/16 pt-6">
        <button
          onClick={onOffScript}
          className="flex items-center gap-1.5 font-sans text-[12.5px] font-medium text-violet-deep"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M3 4h10v7H6l-3 2.5V4z" />
          </svg>
          Say something else instead
        </button>
        {transcriptSummary ? (
          <span className="ml-auto font-sans text-[12.5px] text-ink/45">{transcriptSummary}</span>
        ) : (
          <button
            onClick={onAutoFill}
            disabled={sending}
            className="ml-auto font-sans text-[12.5px] text-ink/45"
          >
            Auto-fill the rest
          </button>
        )}
      </div>
    </div>
  );
}
