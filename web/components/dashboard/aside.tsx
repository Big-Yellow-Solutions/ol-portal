"use client";

import Link from "next/link";
import { Initials, Panel } from "@/components/community/primitives";
import { leaderLab, type Leader } from "@/lib/dashboard";
import { fmtCompact } from "@/lib/data";
import type { Stage } from "@/lib/types";
import { cn } from "@/lib/utils";

/* The two cards down the right of Home. Both are the same 16px panel with a
   heading, a link to the full screen, and a hairline footer carrying one line
   of context — the design's rhythm for an aside. */

function CardHead({
  title,
  href,
  action,
}: {
  title: string;
  href: string;
  action: string;
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="m-0 text-base font-bold tracking-[-0.01em]">{title}</h2>
      <Link
        href={href}
        className="flex-none text-[13px] font-medium text-violet-deep hover:text-violet"
      >
        {action}
      </Link>
    </div>
  );
}

function CardFoot({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-hair-soft pt-3.5 text-[13px] text-warm-gray">
      {children}
    </div>
  );
}

/* The bar deepens as a deal advances, so the card reads as a run from left to
   right without needing a legend. The design draws three stages and gives them
   the ramp's three violets; the Portal's pipeline opens a stage earlier, so
   Lead takes a tint mixed from the ramp's own light end rather than a fourth
   colour invented for it. */
const STAGE_FILL: Record<Exclude<Stage, "Closed" | "Closed Lost">, string> = {
  Lead: "color-mix(in oklab, var(--color-violet-light) 58%, var(--color-violet-pale))",
  Discovery: "var(--color-violet-light)",
  "Proposal Sent": "var(--color-violet)",
  Negotiating: "var(--color-violet-deep)",
};

export interface StageTotal {
  stage: Exclude<Stage, "Closed" | "Closed Lost">;
  amount: number;
}

export function PipelineCard({
  title,
  stages,
  nudge,
}: {
  title: string;
  stages: StageTotal[];
  nudge: React.ReactNode;
}) {
  /* Each bar is its stage's share of the largest stage, not of the total —
     the card compares stages to each other, and shares-of-total would leave
     every bar short in a healthy pipeline. */
  const peak = Math.max(...stages.map((s) => s.amount), 0);

  return (
    <Panel className="p-5">
      <CardHead title={title} href="/pipeline" action="View all →" />
      {peak === 0 ? (
        <p className="m-0 text-[13px] text-warm-gray">
          No open deals right now.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {stages.map((s) => (
            <div key={s.stage}>
              <div className="mb-1.5 flex justify-between gap-3 text-[13px]">
                <span className="text-ink-soft">{s.stage}</span>
                <span className="font-semibold tabular-nums">
                  {fmtCompact(s.amount)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-violet-pale">
                <div
                  className="h-1.5 rounded-full"
                  style={{
                    width: `${Math.round((s.amount / peak) * 100)}%`,
                    background: STAGE_FILL[s.stage],
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      {nudge && <CardFoot>{nudge}</CardFoot>}
    </Panel>
  );
}

/* Presence dot. Online is the brand violet; away is the ramp's light violet,
   which is what the design uses here — not the flatter grey the feed's
   avatars carry, because this card is about who is reachable now. */
function PresenceAvatar({ leader }: { leader: Leader }) {
  return (
    <span className="relative flex flex-none">
      <Initials size={34} className="text-xs">
        {leader.initials}
      </Initials>
      <span
        aria-hidden="true"
        className={cn(
          "absolute right-0 bottom-0 size-[9px] rounded-full border-2 border-white",
          leader.online ? "bg-violet-deep" : "bg-violet-light"
        )}
      />
    </span>
  );
}

export function PresenceCard({
  leaders,
  more,
  onMessage,
}: {
  leaders: Leader[];
  more: number;
  onMessage: (leader: Leader) => void;
}) {
  return (
    <Panel className="p-5">
      <CardHead title="Around right now" href="/bench" action="Directory →" />
      {leaders.length === 0 ? (
        <p className="m-0 text-[13px] text-warm-gray">
          No one else is around right now.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {leaders.map((leader) => (
            <div
              key={leader.name}
              className="-mx-2 flex items-center gap-3 rounded-[10px] p-2 transition-colors hover:bg-paper"
            >
              <PresenceAvatar leader={leader} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {leader.name}
                </span>
                <span className="block truncate text-xs text-warm-gray">
                  {leaderLab(leader) || (leader.online ? "online" : "away")}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onMessage(leader)}
                aria-label={`Message ${leader.name}`}
                className="flex-none cursor-pointer rounded-full border border-hair-strong bg-white px-[13px] py-1.5 text-xs font-medium whitespace-nowrap text-violet-deep transition-colors hover:bg-violet-pale"
              >
                Message
              </button>
            </div>
          ))}
        </div>
      )}
      {more > 0 && (
        <CardFoot>
          {more} more {more === 1 ? "leader" : "leaders"} in the{" "}
          <Link href="/bench" className="text-violet-deep hover:text-violet">
            directory
          </Link>
        </CardFoot>
      )}
    </Panel>
  );
}
