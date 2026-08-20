"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer, type ScopeOption } from "@/components/optimist/composer";
import { GlyphIcon } from "@/components/optimist/icons";
import { StarMark } from "@/components/optimist/mark";
import { BotTurn, Thinking, UserTurn, type Turn } from "@/components/optimist/turn";
import {
  OptimistError,
  STARTERS,
  streamOptimist,
  type Attachment,
} from "@/lib/optimist";
import { can } from "@/lib/can";
import { usePortalData } from "@/lib/portal-data";

/* The Optimist (design_handoff_the_optimist).

   Two states, one route, no navigation between them: `turns.length === 0` is
   the landing hero, anything else is the conversation. The page itself never
   scrolls, only the thread does, which is why this escapes the shell's padded
   measure and fills the content area instead. */

const ALL_LABS = "all";

export default function OptimistPage() {
  const { loading, error, role, labs, myLabs } = usePortalData();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [scope, setScope] = useState(ALL_LABS);
  const [attachment, setAttachment] = useState<Attachment | null>(null);

  const conversationId = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /* Auto-scroll follows the answer until the reader scrolls away from the
     bottom, at which point it stops fighting them for the scroll position. */
  const pinned = useRef(true);

  const scopeOptions: ScopeOption[] = useMemo(() => {
    const visible = labs.filter((lab) => can.seesLab(role ?? "Contributor", myLabs, lab.id));
    return [{ id: ALL_LABS, name: "All labs" }, ...visible.map((l) => ({ id: l.id, name: l.name }))];
  }, [labs, myLabs, role]);

  useEffect(() => {
    if (!pinned.current) return;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, thinking]);

  useEffect(() => () => abort.current?.abort(), []);

  const send = useCallback(
    async (text: string, historyLength?: number) => {
      const message = text.trim();
      if (!message || streaming || thinking) return;

      const sent = attachment;
      setAttachment(null);
      setDraft("");
      setTurns((prev) => [...prev, { who: "user", text: message }]);
      setThinking(true);
      pinned.current = true;

      const controller = new AbortController();
      abort.current = controller;

      /* The first token is what turns the thinking dots into an answer, so the
         bot turn is not created until one actually arrives. */
      let started = false;
      const append = (chunk: string) => {
        setTurns((prev) => {
          const next = prev.slice();
          const last = next[next.length - 1];
          if (last?.who === "bot" && !last.done) {
            next[next.length - 1] = { ...last, text: last.text + chunk };
          }
          return next;
        });
      };

      try {
        setStreaming(true);
        await streamOptimist(
          {
            message,
            scope,
            conversationId: conversationId.current,
            attachment: sent,
            ...(historyLength !== undefined ? { historyLength } : {}),
          },
          (event) => {
            if (event.t === "meta" || event.t === "done") {
              conversationId.current = event.conversationId;
              if (event.t === "done") {
                setTurns((prev) => {
                  const next = prev.slice();
                  const last = next[next.length - 1];
                  if (last?.who === "bot") next[next.length - 1] = { ...last, done: true };
                  return next;
                });
              }
              return;
            }
            if (event.t === "text") {
              if (!started) {
                started = true;
                setThinking(false);
                setTurns((prev) => [...prev, { who: "bot", text: "", done: false }]);
              }
              append(event.v);
              return;
            }
            if (event.t === "error") {
              setThinking(false);
              setTurns((prev) => {
                const next = prev.slice();
                const last = next[next.length - 1];
                if (last?.who === "bot") {
                  next[next.length - 1] = { ...last, done: true, error: event.v };
                } else {
                  next.push({ who: "bot", text: "", done: true, error: event.v });
                }
                return next;
              });
              // Their words are not lost just because the answer was.
              setDraft((current) => current || message);
            }
          },
          controller.signal
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        setThinking(false);
        const notice =
          err instanceof OptimistError
            ? err.message
            : "The Optimist could not be reached. Check your connection and try again.";
        setTurns((prev) => [...prev, { who: "bot", text: "", done: true, error: notice }]);
        setDraft((current) => current || message);
      } finally {
        if (!controller.signal.aborted) {
          setStreaming(false);
          setThinking(false);
        }
      }
    },
    [attachment, scope, streaming, thinking]
  );

  /* Retry re-asks the question that produced this answer, dropping the answer
     and everything after it. `historyLength` tells the server to truncate its
     own copy to the same point so the two transcripts stay identical. */
  const retry = useCallback(
    (botIndex: number) => {
      const question = turns[botIndex - 1];
      if (!question || question.who !== "user" || streaming || thinking) return;
      const keep = botIndex - 1;
      setTurns((prev) => prev.slice(0, keep));
      void send(question.text, keep);
    },
    [turns, send, streaming, thinking]
  );

  const newChat = () => {
    abort.current?.abort();
    abort.current = null;
    conversationId.current = null;
    setTurns([]);
    setDraft("");
    setAttachment(null);
    setThinking(false);
    setStreaming(false);
  };

  if (loading) return <p className="text-sm text-ink-mute">Loading…</p>;
  if (error) return <p className="text-sm text-red">{error}</p>;
  /* Same gate the nav applies. The Optimist reads OL's commercial records, so
     it stays with the roles that can already see them. */
  if (role === "Contributor") {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl italic text-ink">The Optimist</h1>
        <p className="max-w-prose text-sm text-ink-mute">
          The Optimist is available to Optimistic Labs staff. Everything shared with
          you lives under Resources, Proposals and Files.
        </p>
      </div>
    );
  }

  const busy = thinking || streaming;
  const landing = turns.length === 0;

  const composer = (variant: "landing" | "reply") => (
    <Composer
      variant={variant}
      value={draft}
      onChange={setDraft}
      onSubmit={() => void send(draft)}
      busy={busy}
      scopes={scopeOptions}
      scope={scope}
      onScopeChange={setScope}
      attachment={attachment}
      onAttach={setAttachment}
      onNewChat={variant === "reply" ? newChat : undefined}
      autoFocus={variant === "reply"}
    />
  );

  return (
    <div className="absolute inset-0 flex flex-col">
      {landing ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[34px] overflow-y-auto px-8 max-[1000px]:px-[18px]">
          <div className="om-rise max-w-[720px] text-center">
            <span className="inline-flex items-center gap-[9px] text-[11px] font-semibold tracking-[.14em] text-warm-gray uppercase">
              <StarMark className="size-[13px] opacity-90" />
              The Optimist
            </span>
            <h1 className="mt-[14px] text-[46px] leading-[1.07] font-bold tracking-[-.02em] text-ink max-[640px]:text-[34px]">
              What are we building{" "}
              <span className="font-serif font-normal italic">today</span>?
            </h1>
            <p className="mx-auto mt-[14px] max-w-[520px] text-[17px] leading-[1.6] text-pretty text-ink-soft">
              Ask across your labs, proposals, pipeline, the bench, and every
              resource in the Portal.
            </p>
          </div>

          <div
            className="om-rise w-full max-w-[760px]"
            style={{ animationDelay: ".06s" }}
          >
            {composer("landing")}

            <div className="mt-[18px] flex flex-wrap justify-center gap-[9px]">
              {STARTERS.map((starter) => (
                <button
                  key={starter.label}
                  type="button"
                  disabled={busy}
                  onClick={() => void send(starter.prompt)}
                  className="flex cursor-pointer items-center gap-2 rounded-full border border-hair bg-white px-[15px] py-[9px] font-sans text-[13px] font-medium text-ink-soft shadow-card transition-[transform,box-shadow,color] duration-200 ease-[var(--ease-soft)] hover:-translate-y-px hover:text-violet-deep hover:shadow-[0_10px_22px_-12px_rgba(61,47,212,.45)] disabled:cursor-default"
                >
                  <span className="flex size-[22px] flex-none items-center justify-center rounded-[7px] bg-violet-pale text-violet-deep">
                    <GlyphIcon d={starter.glyph} />
                  </span>
                  {starter.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            ref={scroller}
            onScroll={() => {
              const el = scroller.current;
              if (!el) return;
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
            }}
            className="om-thread min-h-0 flex-1 overflow-y-auto"
          >
            <div className="mx-auto flex max-w-[760px] flex-col gap-[26px] p-8 max-[1000px]:px-[18px]">
              {turns.map((turn, i) =>
                turn.who === "user" ? (
                  <UserTurn key={i} text={turn.text} />
                ) : (
                  <BotTurn
                    key={i}
                    text={turn.text}
                    done={!!turn.done}
                    error={turn.error}
                    onRetry={() => retry(i)}
                  />
                )
              )}
              {thinking && <Thinking />}
            </div>
          </div>

          <div className="flex-none bg-[linear-gradient(to_top,var(--paper)_62%,rgba(248,246,242,0))]">
            <div className="mx-auto max-w-[760px] px-8 pt-2.5 pb-[22px] max-[1000px]:px-[18px]">
              {composer("reply")}
              <p className="mt-[9px] text-center text-[11px] text-warm-gray">
                The Optimist can be wrong. Check anything that leaves the Portal.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
