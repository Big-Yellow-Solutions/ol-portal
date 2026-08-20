"use client";

import { CalendarIcon, PlaceIcon } from "@/components/community/icons";
import { TogglePill } from "@/components/community/primitives";
import { PhotoSlot } from "@/components/community/post-card";
import { RSVP_CHOICES, type CommunityEvent, type RsvpChoice } from "@/lib/community";

export function EventDetail({
  event,
  rsvp,
  going,
  onRsvp,
}: {
  event: CommunityEvent;
  rsvp: RsvpChoice | null;
  going: string;
  onRsvp: (choice: RsvpChoice) => void;
}) {
  return (
    <>
      <h2 className="m-0 text-[25px] leading-[1.18] font-bold tracking-[-0.016em] text-pretty">
        {event.title}
      </h2>

      <PhotoSlot label="Event photo" height={170} />

      <div className="flex flex-col gap-[7px]">
        <span className="flex items-center gap-[9px] text-sm">
          <CalendarIcon className="flex-none text-violet-deep" />
          {event.when}
        </span>
        <span className="flex items-center gap-[9px] text-sm">
          <PlaceIcon className="flex-none text-violet-deep" />
          {event.place}
        </span>
      </div>

      <p className="m-0 text-[15px] leading-[1.6] text-pretty text-ink/80">
        {event.body}
      </p>

      <div className="flex flex-wrap items-center gap-2 border-t border-hair-soft pt-3.5">
        {RSVP_CHOICES.map((choice) => (
          <TogglePill
            key={choice}
            on={rsvp === choice}
            onClick={() => onRsvp(choice)}
          >
            {choice}
          </TogglePill>
        ))}
        <span className="flex-1" />
        <span className="text-[13px] whitespace-nowrap text-warm-gray">
          {going}
        </span>
      </div>

      <span className="text-xs text-warm-gray">
        Attendee list is visible to {event.host}, who created this event.
      </span>
    </>
  );
}
