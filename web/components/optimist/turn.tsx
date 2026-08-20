"use client";

import { useEffect, useState } from "react";
import { useMessages } from "@/lib/messages";
import { RippleMark } from "@/components/optimist/mark";
import {
  ChatIcon,
  CheckIcon,
  CopyIcon,
  RetryIcon,
} from "@/components/optimist/icons";

/* One exchange, in the two shapes the design draws.

   A user turn is a bubble, right-aligned and capped at 78% of the column. An
   assistant turn is not a bubble at all: avatar, label, then the answer set
   as a document across the full column. That asymmetry is the point, so
   resist any urge to make them symmetrical. */

export interface Turn {
  who: "user" | "bot";
  text: string;
  done?: boolean;
  /** Set on an assistant turn that failed; rendered under the partial text. */
  error?: string;
}

export function UserTurn({ text }: { text: string }) {
  return (
    <div className="om-rise-turn flex justify-end">
      <div className="max-w-[78%] rounded-[16px] rounded-br-[6px] bg-violet-deep px-[17px] py-[13px] text-[15px] leading-[1.55] whitespace-pre-wrap text-pretty text-white">
        {text}
      </div>
    </div>
  );
}

export function OptimistAvatar() {
  return (
    <span className="mt-0.5 flex size-[30px] flex-none items-center justify-center rounded-full bg-violet-pale">
      <RippleMark className="size-4 text-violet-deep" />
    </span>
  );
}

export function BotTurn({
  text,
  done,
  error,
  onRetry,
}: {
  text: string;
  done: boolean;
  error?: string;
  onRetry: () => void;
}) {
  const { openList } = useMessages();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; silently leaving the label alone is
      // a truer signal than a success tick that lied.
    }
  };

  return (
    <div className="om-rise-turn flex justify-start">
      <div className="flex w-full gap-[14px]">
        <OptimistAvatar />
        <div className="min-w-0 flex-1">
          <div className="mb-[7px] text-[11px] font-semibold tracking-[.1em] text-warm-gray uppercase">
            The Optimist
          </div>
          <div className="text-[15px] leading-[1.68] whitespace-pre-wrap text-pretty text-ink">
            {text}
            {!done && (
              <span className="om-caret ml-[3px] inline-block h-4 w-2 rounded-[2px] bg-violet-deep align-[-2px]" />
            )}
          </div>

          {error && (
            /* Undesigned state. The handoff's own suggestion: an inline
               retriable notice under the failed turn, with the person's text
               still recoverable (the page puts it back in the composer). */
            <p className="mt-3 rounded-[12px] border border-red/25 bg-red-pale px-3 py-2 text-[13px] leading-[1.5] text-red">
              {error}
            </p>
          )}

          {done && (
            <div className="mt-[14px] flex items-center gap-2">
              <ActionPill onClick={copy}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? "Copied" : "Copy"}
              </ActionPill>
              <ActionPill onClick={onRetry}>
                <RetryIcon />
                Retry
              </ActionPill>
              <ActionPill onClick={openList}>
                <ChatIcon />
                Share
              </ActionPill>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionPill({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1.5 rounded-full border border-hair-interactive bg-white px-3 py-1.5 font-sans text-xs font-medium text-warm-gray transition-colors hover:bg-violet-pale hover:text-violet-deep"
    >
      {children}
    </button>
  );
}

/* Between send and the first token. Three dots and nothing else: the design
   deliberately does not narrate what the assistant is doing. */
export function Thinking() {
  return (
    <div
      className="om-rise-turn flex items-center gap-[14px]"
      role="status"
      aria-label="The Optimist is looking things up"
    >
      <span className="flex size-[30px] flex-none items-center justify-center rounded-full bg-violet-pale">
        <RippleMark className="size-4 text-violet-deep" />
      </span>
      <span className="flex items-center gap-[5px]">
        <span className="om-pulse size-1.5 rounded-full bg-violet-deep" />
        <span
          className="om-pulse size-1.5 rounded-full bg-violet-deep"
          style={{ animationDelay: ".16s" }}
        />
        <span
          className="om-pulse size-1.5 rounded-full bg-violet-deep"
          style={{ animationDelay: ".32s" }}
        />
      </span>
    </div>
  );
}
