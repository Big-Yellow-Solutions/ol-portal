"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { ArrowRightIcon, CloseIcon } from "@/components/community/icons";
import { FIELD, Initials } from "@/components/community/primitives";
import { leaderMeta, type Leader } from "@/lib/dashboard";
import type { ChatMessage } from "@/lib/community";
import { cn } from "@/lib/utils";

/* Messaging a leader without leaving Home. The design draws a hand-rolled
   drawer; this is the app's Sheet restyled to it, so focus trapping, Escape
   and the scrim's click-to-close come from the primitive and only the surface
   is the design's — a 400px column of transcript over a fixed composer.

   The thread is session state. Sending appends immediately, which is the
   right behaviour either way: when the Directory's messages API lands, the
   append becomes the optimistic write and the reconcile follows it. */

export function MessageDrawer({
  leader,
  messages,
  onClose,
  onSend,
}: {
  leader: Leader | null;
  messages: ChatMessage[];
  onClose: () => void;
  onSend: (leader: Leader, text: string) => void;
}) {
  return (
    <Sheet open={!!leader} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        showCloseButton={false}
        overlayClassName="bg-[rgba(17,17,17,0.28)] supports-backdrop-filter:backdrop-blur-none"
        /* Inline, because the primitive's own `sm:max-w-sm` is a class at the
           same specificity and would otherwise win at 384px. Paired with
           w-full this is the design's `min(400px, 100vw)`. */
        style={{ maxWidth: 400 }}
        className="w-full gap-0 border-l border-hair bg-white p-0 shadow-lift"
      >
        {leader && (
          /* Keyed on the person, so opening a different conversation starts on
             an empty composer instead of the last one's half-typed draft. */
          <Conversation
            key={leader.name}
            leader={leader}
            messages={messages}
            onSend={onSend}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Conversation({
  leader,
  messages,
  onSend,
}: {
  leader: Leader;
  messages: ChatMessage[];
  onSend: (leader: Leader, text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  /* Land on the newest message, the way an open conversation reads. */
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = (text: string) => {
    if (!text.trim()) return;
    onSend(leader, text.trim());
    setDraft("");
  };

  const ready = draft.trim().length > 0;

  return (
    <>
      <header className="flex flex-none items-center gap-3 border-b border-hair px-[18px] py-4">
        <span className="relative flex flex-none">
          <Initials size={38}>{leader.initials}</Initials>
          <span
            aria-hidden="true"
            className={cn(
              "absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-white",
              leader.online ? "bg-violet-deep" : "bg-violet-light"
            )}
          />
        </span>
        <span className="min-w-0 flex-1">
          <SheetTitle className="truncate font-sans text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {leader.name}
          </SheetTitle>
          <SheetDescription className="truncate text-xs text-warm-gray">
            {leaderMeta(leader)}
          </SheetDescription>
        </span>
        <SheetClose
          aria-label="Close"
          className="flex size-8 flex-none cursor-pointer items-center justify-center rounded-full border border-hair-strong bg-white text-violet-deep transition-colors hover:bg-violet-pale"
        >
          <CloseIcon size={14} />
        </SheetClose>
      </header>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-paper p-[18px]">
        {messages.length === 0 ? (
          <p className="m-0 text-center text-[13px] text-warm-gray">
            No messages yet. Say hello.
          </p>
        ) : (
          <span className="pb-1 text-center text-[11px] font-semibold tracking-[0.08em] text-warm-gray uppercase">
            Today
          </span>
        )}
        {messages.map((m, i) => (
          <div
            key={`${i}-${m.time}`}
            className={cn(
              "flex flex-col gap-1",
              m.fromMe ? "items-end" : "items-start"
            )}
          >
            <div
              className={cn(
                "max-w-[82%] rounded-[14px] px-3.5 py-[11px] text-sm leading-[1.5] text-pretty",
                m.fromMe
                  ? "rounded-br-[5px] bg-violet-deep text-white"
                  : "rounded-bl-[5px] border border-hair bg-white text-ink"
              )}
            >
              {m.text}
            </div>
            <span className="text-[11px] text-warm-gray">{m.time}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="flex-none border-t border-hair px-[18px] pt-3.5 pb-[18px]">
        {leader.thread.quick.length > 0 && (
          <div className="mb-2.5 flex gap-2 overflow-x-auto">
            {leader.thread.quick.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                className="flex-none cursor-pointer rounded-full border border-hair-strong bg-white px-[13px] py-1.5 text-xs font-medium whitespace-nowrap text-violet-deep transition-colors hover:bg-violet-pale"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          className="flex items-end gap-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a message"
            aria-label={`Message ${leader.name}`}
            className={cn(
              FIELD,
              "min-w-0 flex-1 rounded-[12px] px-[13px] py-[11px] text-sm"
            )}
          />
          <button
            type="submit"
            aria-label="Send"
            aria-disabled={!ready}
            className={cn(
              "flex size-[42px] flex-none cursor-pointer items-center justify-center rounded-[12px] transition-colors",
              ready
                ? "bg-violet-deep text-white"
                : "bg-violet-pale text-violet-light"
            )}
          >
            <ArrowRightIcon size={16} />
          </button>
        </form>
      </div>
    </>
  );
}
