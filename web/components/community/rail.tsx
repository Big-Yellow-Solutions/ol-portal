"use client";

import { ArrowRightIcon } from "@/components/community/icons";
import { Panel, TogglePill } from "@/components/community/primitives";
import type { CommunityEvent, CommunityLab, RsvpChoice } from "@/lib/community";
import { cn } from "@/lib/utils";

/* The lab list appears twice — as the left sidebar in "Sidebar layout" and
   inside the right rail otherwise — so it lives here once. */
export function LabList({
  labs,
  filter,
  onPick,
}: {
  labs: CommunityLab[];
  filter: string;
  onPick: (name: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {labs.map((lab) => {
        const on = filter === lab.name;
        return (
          <button
            key={lab.name}
            type="button"
            aria-current={on ? "true" : undefined}
            // The two spans sit apart visually via the flex gap, but the
            // accessible name concatenates them with no separator.
            aria-label={`${lab.name}, ${lab.count}`}
            onClick={() => onPick(lab.name)}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-[11px] py-[9px] text-left text-sm transition-colors",
              on
                ? "bg-violet-pale font-semibold text-violet-deep"
                : "font-medium text-ink-soft hover:bg-wash"
            )}
          >
            <span className="min-w-0 flex-1 truncate">{lab.name}</span>
            <span className="flex-none text-xs text-warm-gray">{lab.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function EventDateBlock({
  mon,
  day,
  size = "sm",
}: {
  mon: string;
  day: string;
  size?: "sm" | "lg";
}) {
  const large = size === "lg";
  return (
    <div
      className={cn(
        "flex-none overflow-hidden rounded-[10px] border border-hair-strong text-center",
        large ? "w-16 rounded-[12px]" : "w-11"
      )}
    >
      <div
        className={cn(
          "font-bold tracking-[0.12em] uppercase",
          large
            ? "bg-violet-deep py-1 text-[10px] tracking-[0.14em] text-white"
            : "bg-violet-pale py-[3px] text-[9px] text-violet-deep"
        )}
      >
        {mon}
      </div>
      <div
        className={cn(
          "font-bold",
          large ? "px-0 pt-[7px] pb-2 text-2xl" : "pt-1 pb-[5px] text-base"
        )}
      >
        {day}
      </div>
    </div>
  );
}

export { EventDateBlock };

export function CommunityRail({
  events,
  labs,
  filter,
  rsvps,
  goingLabel,
  onPickLab,
  onOpenEvent,
  onQuickRsvp,
  onAllEvents,
  onBrowseGroups,
  onOpenMessages,
}: {
  events: CommunityEvent[];
  labs: CommunityLab[];
  filter: string;
  rsvps: Record<string, RsvpChoice | null>;
  goingLabel: (e: CommunityEvent) => string;
  onPickLab: (name: string) => void;
  onOpenEvent: (id: string) => void;
  onQuickRsvp: (id: string) => void;
  onAllEvents: () => void;
  onBrowseGroups: () => void;
  onOpenMessages: () => void;
}) {
  return (
    <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24">
      <Panel className="p-5">
        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 className="m-0 text-base font-bold tracking-[-0.01em]">Upcoming</h2>
          <button
            type="button"
            onClick={onAllEvents}
            className="cursor-pointer text-[13px] font-medium text-violet-deep hover:text-violet"
          >
            All events →
          </button>
        </div>
        <div className="flex flex-col gap-3.5">
          {events.length === 0 && (
            <p className="m-0 text-[13px] text-warm-gray">
              Nothing scheduled yet.
            </p>
          )}
          {events.map((e) => {
            const mine = rsvps[e.id];
            return (
              <div key={e.id} className="flex gap-3">
                <EventDateBlock mon={e.mon} day={e.day} />
                <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                  <button
                    type="button"
                    onClick={() => onOpenEvent(e.id)}
                    className="cursor-pointer text-left text-sm leading-[1.35] font-semibold text-pretty text-ink hover:text-violet-deep"
                  >
                    {e.title}
                  </button>
                  <span className="text-xs text-warm-gray">{goingLabel(e)}</span>
                  <TogglePill
                    on={!!mine}
                    onClick={() => onQuickRsvp(e.id)}
                    className="mt-0.5 self-start px-[11px] py-[5px] text-xs"
                  >
                    {mine === "Going" ? "You are going" : (mine ?? "RSVP")}
                  </TogglePill>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel className="p-5">
        <h2 className="m-0 mb-3 text-base font-bold tracking-[-0.01em]">
          Your labs
        </h2>
        <LabList labs={labs} filter={filter} onPick={onPickLab} />
        <button
          type="button"
          onClick={onBrowseGroups}
          className="mt-3.5 block w-full cursor-pointer border-t border-hair-soft pt-3.5 text-left text-[13px] font-semibold text-violet-deep hover:text-violet"
        >
          Browse groups →
        </button>
      </Panel>

      <section className="rounded-[16px] bg-violet-deep p-5 text-white">
        <h2 className="m-0 text-base font-bold tracking-[-0.01em]">
          Need a real conversation?
        </h2>
        <p className="mt-2 mb-3.5 text-sm leading-[1.55] text-pretty text-white/[0.82]">
          Comments stay on the post. Direct and group messages open in a
          drawer, where you can @ someone to notify them.
        </p>
        <button
          type="button"
          onClick={onOpenMessages}
          className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-4 py-[9px] text-[13px] font-semibold text-violet-deep transition-colors hover:bg-violet-pale"
        >
          Open messages
          <ArrowRightIcon size={14} />
        </button>
      </section>
    </aside>
  );
}
