"use client";

import { useEffect, useRef } from "react";
import { RippleMark } from "@/components/optimist/mark";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/* 05 · Step out of the script (design_handoff_the_optimist, 3e). The one place
   the old chat UI survives: user turns keep their bubble, but the assistant is
   deliberately unbubbled — plain prose beside the ripple mark — so it reads as
   the thing writing the document, not a peer in a chat. The pending question
   is preserved state, not discarded. */
export function OffScriptView({
  messages,
  pendingQuestionNumber,
  remainingCount,
  input,
  onInputChange,
  onSend,
  sending,
  onBack,
}: {
  messages: ChatMessage[];
  pendingQuestionNumber: number;
  remainingCount: number;
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  onBack: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  return (
    <div className="flex min-w-0 flex-col overflow-hidden px-10 py-8">
      <div className="flex items-center gap-[9px]">
        <svg width="11" height="11" viewBox="326 26 256 256" fill="currentColor" className="text-violet">
          <path d="M453.663 26.2242L456.258 96.9932C457.336 126.411 481.035 149.965 510.458 150.862L581.222 153.031L510.453 155.626C481.035 156.704 457.481 180.403 456.584 209.826L454.415 280.59L451.82 209.821C450.742 180.403 427.043 156.849 397.62 155.952L326.856 153.783L397.625 151.188C427.043 150.11 450.597 126.411 451.494 96.9876L453.663 26.2242Z" />
        </svg>
        <span className="font-sans text-[10.5px] font-semibold uppercase tracking-[.18em] text-violet-deep">
          Off-script
        </span>
        <button onClick={onBack} className="ml-auto flex items-center gap-1.5 font-sans text-xs font-medium text-violet-deep">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M10 3L5 8l5 5" />
          </svg>
          {`Back to question ${String(pendingQuestionNumber).padStart(2, "0")}`}
        </button>
      </div>

      <div ref={logRef} className="mt-5.5 flex flex-1 flex-col gap-3.5 overflow-y-auto">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div
              key={i}
              className="max-w-[80%] self-end rounded-tl-[14px] rounded-tr-[14px] rounded-br-[5px] rounded-bl-[14px] bg-violet-deep px-[15px] py-[11px] font-sans text-sm leading-[1.55] text-white"
            >
              {m.content}
            </div>
          ) : (
            <div key={i} className="flex max-w-[88%] gap-3 self-start">
              <RippleMark className="mt-0.5 size-5 shrink-0 text-violet-deep" />
              <p className="font-sans text-sm leading-[1.55] text-ink-soft">{m.content}</p>
            </div>
          )
        )}
      </div>

      {pendingQuestionNumber > 0 && (
        <div className="my-3 flex items-center gap-3 rounded-[10px] bg-amber-pale px-3.5 py-2.5">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--amber)" strokeWidth={1.5}>
            <circle cx="8" cy="8" r="6.2" />
            <path d="M8 5v3.4l2 1.4" />
          </svg>
          <span className="font-sans text-[12.5px] text-amber">
            {`Question ${String(pendingQuestionNumber).padStart(2, "0")} is still waiting. ${remainingCount} more after it.`}
          </span>
        </div>
      )}

      <div className="mt-1 flex items-center gap-2.5 rounded-2xl border border-violet/28 bg-white py-3 pr-3 pl-4 shadow-[0_0_0_4px_var(--wash)]">
        <input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSend();
            }
          }}
          disabled={sending}
          placeholder="Message The Optimist…"
          className="flex-1 bg-transparent font-sans text-sm text-ink placeholder:text-ink/40 focus:outline-none"
        />
        <button
          onClick={onSend}
          disabled={sending || !input.trim()}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-deep transition-opacity",
            (sending || !input.trim()) && "opacity-40"
          )}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth={1.7} strokeLinecap="round">
            <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
