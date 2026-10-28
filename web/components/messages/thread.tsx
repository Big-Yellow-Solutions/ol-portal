"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightIcon, BellIcon } from "@/components/community/icons";
import { FIELD } from "@/components/community/primitives";
import {
  ME,
  segments,
  useMessages,
  type MessagePerson,
} from "@/lib/messages";
import { cn } from "@/lib/utils";

/* Thread mode. Two things carry the design's weight here: a mention is a
   promise that someone gets notified, so it is styled as a token inside the
   bubble and restated underneath in plain words ("Dana was notified"); and an
   incoming message that names *you* rings its own bubble, so the one message
   you have to answer is findable in a long scroll. */

/* Typing "@" opens the picker; it closes as soon as the draft stops ending in
   a bare @token.

   Only people in the conversation can be @-ed. The server notifies members
   and nobody else — someone outside could not open what the notification
   points at — so offering anyone on the bench, and styling the name as if it
   rang a bell, promised a notification that never went out. */
const TRAILING_MENTION = /@([A-Za-z]*)$/;

export function Thread() {
  const { active, me, roster, person, send } = useMessages();
  const [draft, setDraft] = useState("");
  const [mq, setMq] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const group = !!active && active.members.length > 1;
  const msgs = active?.msgs ?? [];

  /* Land on the newest message, the way an open conversation reads. */
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  const inThread = useMemo(() => active?.members ?? [], [active]);
  const people = useMemo(
    () => [me, ...roster.filter((p) => inThread.includes(p.id))],
    [me, roster, inThread]
  );

  const pool = useMemo(() => {
    const q = (mq ?? "").toLowerCase();
    return roster
      .filter((p) => inThread.includes(p.id))
      .filter((p) => {
        if (!q) return true;
        const last = p.name.split(" ").slice(1).join(" ");
        return (
          p.name.toLowerCase().startsWith(q) ||
          last.toLowerCase().startsWith(q)
        );
      });
  }, [roster, mq, inThread]);

  /* What the draft will do when sent: every highlighted name gets a
     notification. The composer paints the same runs, so what is purple here
     is exactly who is told. */
  const draftParts = useMemo(() => segments(draft, people), [draft, people]);
  const willNotify = useMemo(
    () => [
      ...new Set(
        draftParts
          .map((s) => s.id)
          .filter((id): id is string => !!id && id !== ME)
          .map((id) => person(id).first)
      ),
    ],
    [draftParts, person]
  );

  /* The composer is an <input>, which cannot style part of its own text. The
     coloured copy sits over it, pointer-events off, and the real text is made
     transparent; this follows the input when a long draft scrolls it. */
  const input = useRef<HTMLInputElement>(null);
  const [scrollX, setScrollX] = useState(0);
  const syncScroll = () => setScrollX(input.current?.scrollLeft ?? 0);

  const insertMention = (p: MessagePerson) => {
    setDraft((d) => d.replace(TRAILING_MENTION, `@${p.first} `));
    setMq(null);
  };

  const submit = () => {
    if (!draft.trim()) return;
    send(draft);
    setDraft("");
    setMq(null);
  };

  const ready = draft.trim().length > 0;

  return (
    <>
      <div
        ref={scroller}
        className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-paper p-[18px]"
      >
        {msgs.length === 0 ? (
          <p className="m-0 pt-2 text-center text-[13px] text-warm-gray">
            No messages yet. Say hello.
          </p>
        ) : (
          <div className="pb-1 text-center text-[11px] font-semibold tracking-[0.08em] text-warm-gray uppercase">
            Today
          </div>
        )}
        {msgs.map((m, i) => {
          const mine = m.from === ME;
          const parts = segments(m.text, people);
          const ids = [
            ...new Set(
              parts.map((s) => s.id).filter((id): id is string => !!id)
            ),
          ];
          const callsMe = !mine && ids.includes(ME);
          const others = ids
            .filter((id) => id !== ME)
            .map((id) => person(id).first);
          const notified = mine
            ? ids.map((id) => (id === ME ? "You" : person(id).first))
            : callsMe
              ? ["You", ...others]
              : others;

          return (
            <div
              key={m.id}
              className={cn(
                "flex flex-col gap-1",
                mine ? "items-end" : "items-start"
              )}
            >
              {group && !mine && (!msgs[i - 1] || msgs[i - 1].from !== m.from) && (
                <div className="px-0.5 text-[11px] font-semibold text-warm-gray">
                  {person(m.from).name}
                </div>
              )}
              <div
                className={cn(
                  "max-w-[82%] rounded-[14px] px-3.5 py-[11px] text-sm leading-[1.5] text-pretty",
                  m.pending && "opacity-70",
                  mine
                    ? "rounded-br-[5px] bg-violet-deep text-white"
                    : "rounded-bl-[5px] border bg-white text-ink",
                  !mine &&
                    (callsMe
                      ? "border-violet-deep shadow-[0_0_0_3px_rgba(124,109,245,0.16)]"
                      : "border-hair")
                )}
              >
                {parts.map((s, j) => (
                  <span
                    key={j}
                    className={cn(
                      s.id &&
                        "-mx-px rounded-[6px] px-1 py-px font-semibold",
                      s.id &&
                        (mine
                          ? "bg-[rgba(255,255,255,0.22)] text-white"
                          : s.id === ME
                            ? "bg-violet-deep text-white"
                            : "bg-violet-pale text-violet-deep")
                    )}
                  >
                    {s.text}
                  </span>
                ))}
              </div>
              {notified.length > 0 && (
                <div className="flex items-center gap-[5px] text-[11px] font-medium text-violet-deep">
                  <BellIcon size={11} />
                  {notified.join(", ")}
                  {notified.length === 1 && notified[0] !== "You"
                    ? " was notified"
                    : " were notified"}
                </div>
              )}
              <div className="text-[11px] text-warm-gray">{m.time}</div>
            </div>
          );
        })}
      </div>

      <div className="relative flex-none border-t border-hair px-[18px] pt-3.5 pb-[18px]">
        {mq !== null && (
          <div className="absolute right-[18px] bottom-[calc(100%-6px)] left-[18px] z-[5] overflow-hidden rounded-[14px] border border-hair-strong bg-white shadow-lift">
            <div className="border-b border-hair-soft px-3.5 py-[9px] text-[11px] font-semibold tracking-[0.1em] text-warm-gray uppercase">
              Notify someone
            </div>
            <div className="max-h-[212px] overflow-y-auto p-1.5">
              {pool.slice(0, 6).map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => insertMention(p)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-[11px] rounded-[10px] px-[9px] py-2 text-left transition-colors hover:bg-paper",
                    i === 0 && "bg-paper"
                  )}
                >
                  <span className="flex size-7 flex-none items-center justify-center rounded-full bg-violet-pale text-[11px] font-semibold text-violet-deep">
                    {p.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink">
                      {p.name}
                    </span>
                    <span className="block truncate text-[11px] text-warm-gray">
                      {p.role}
                    </span>
                  </span>
                </button>
              ))}
              {pool.length === 0 && (
                <div className="p-3.5 text-[13px] text-warm-gray">
                  No one in this chat by that name
                </div>
              )}
            </div>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-end gap-2"
        >
          <div className="relative min-w-0 flex-1">
          <input
            ref={input}
            value={draft}
            onScroll={syncScroll}
            onSelect={syncScroll}
            onChange={(e) => {
              const v = e.target.value;
              const hit = v.match(TRAILING_MENTION);
              setDraft(v);
              setMq(hit ? hit[1] : null);
              requestAnimationFrame(syncScroll);
            }}
            onKeyDown={(e) => {
              if (mq === null) return;
              if (e.key === "Escape") {
                e.preventDefault();
                setMq(null);
              } else if (
                (e.key === "Enter" || e.key === "Tab") &&
                pool.length > 0
              ) {
                e.preventDefault();
                insertMention(pool[0]);
              }
            }}
            placeholder="Write a message — @ to notify someone"
            aria-label="Write a message"
            className={cn(
              FIELD,
              "block w-full rounded-[12px] px-[13px] py-[11px] text-sm leading-5 text-transparent caret-ink placeholder:text-warm-gray"
            )}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[12px] border border-transparent px-[13px] py-[11px] text-sm leading-5 whitespace-pre"
          >
            <span
              className="inline-block min-w-full text-ink"
              style={{ transform: `translateX(${-scrollX}px)` }}
            >
              {draftParts.map((s, j) => (
                /* No padding or weight on the highlight: either would make
                   this copy wider than the input's own text and the two
                   would drift apart down the line. */
                <span
                  key={j}
                  className={cn(
                    s.id && "rounded-[4px] bg-[rgba(124,109,245,0.22)] text-violet-deep"
                  )}
                >
                  {s.text}
                </span>
              ))}
            </span>
          </div>
          </div>
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
        {willNotify.length > 0 && (
          <div className="mt-2 flex items-center gap-[5px] text-[11px] font-medium text-violet-deep">
            <BellIcon size={11} />
            {willNotify.join(", ")} will be notified
          </div>
        )}
      </div>
    </>
  );
}
