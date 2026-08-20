"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightIcon, BellIcon } from "@/components/community/icons";
import { FIELD } from "@/components/community/primitives";
import {
  ME,
  quickReplies,
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
   a bare @token. */
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

  const people = useMemo(() => [me, ...roster], [me, roster]);

  const inThread = useMemo(() => active?.members ?? [], [active]);
  const pool = useMemo(() => {
    const q = (mq ?? "").toLowerCase();
    return roster
      .filter((p) => {
        if (!q) return true;
        const last = p.name.split(" ").slice(1).join(" ");
        return (
          p.name.toLowerCase().startsWith(q) ||
          last.toLowerCase().startsWith(q)
        );
      })
      /* People already in the chat first — the likeliest @ in any thread. */
      .sort(
        (a, b) =>
          Number(inThread.includes(b.id)) - Number(inThread.includes(a.id))
      );
  }, [roster, mq, inThread]);

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

  const quick = quickReplies(active);
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
              key={`${i}-${m.time}`}
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
                  {inThread.includes(p.id) && (
                    <span className="flex-none rounded-full bg-violet-pale px-2 py-[3px] text-[10px] font-semibold tracking-[0.06em] text-violet-deep uppercase">
                      In chat
                    </span>
                  )}
                </button>
              ))}
              {pool.length === 0 && (
                <div className="p-3.5 text-[13px] text-warm-gray">
                  No one by that name
                </div>
              )}
            </div>
          </div>
        )}

        {quick.length > 0 && (
          <div className="mb-2.5 flex gap-2 overflow-x-auto">
            {quick.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  send(q);
                  setDraft("");
                  setMq(null);
                }}
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
            submit();
          }}
          className="flex items-end gap-2"
        >
          <input
            value={draft}
            onChange={(e) => {
              const v = e.target.value;
              const hit = v.match(TRAILING_MENTION);
              setDraft(v);
              setMq(hit ? hit[1] : null);
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
