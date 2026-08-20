"use client";

import Image from "next/image";
import { CommentIcon, PencilIcon } from "@/components/community/icons";
import { cn } from "@/lib/utils";

/* A bench card. The whole card opens the conversation with that person, which
   the design draws as a hover lift over the entire surface — but a div with a
   click handler is unreachable by keyboard, so the reach is the Message
   button's own overlay instead: pointers get the whole card, assistive tech
   and the Tab key get one clearly named control. Everything else on the card
   that is clickable sits above that overlay. */

export interface BenchPerson {
  id: string;
  name: string;
  initials: string;
  role: string;
  engage?: string;
  tags: string[];
  /* Email, or the phone number if that is all this person publishes. The
     server strips whichever they chose to hide, so anything here is public. */
  contact?: string;
  photo?: string;
}

const ABOVE = "relative z-[1]";

export function PersonCard({
  person,
  tag,
  mine,
  canEdit,
  onTag,
  onMessage,
  onEdit,
}: {
  person: BenchPerson;
  tag: string | null;
  mine: boolean;
  canEdit: boolean;
  onTag: (tag: string) => void;
  onMessage: () => void;
  onEdit: () => void;
}) {
  return (
    <article className="relative flex flex-col gap-3.5 rounded-[16px] border border-hair bg-white p-5 shadow-card transition-[transform,box-shadow] duration-[250ms] ease-soft hover:-translate-y-1 hover:shadow-lift motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="flex items-center gap-3">
        <span className="flex size-[42px] flex-none items-center justify-center overflow-hidden rounded-full bg-violet-pale text-sm font-semibold text-violet-deep">
          {person.photo ? (
            <Image
              src={person.photo}
              alt=""
              width={42}
              height={42}
              className="size-full object-cover"
            />
          ) : (
            person.initials
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold tracking-[-0.01em] text-ink">
            {person.name}
          </span>
          <span className="mt-0.5 block truncate text-xs text-warm-gray">
            {person.role}
          </span>
        </span>
      </div>

      <p className="m-0 text-[15px] leading-[1.55] text-pretty">
        {person.engage ? (
          <>
            <span className="text-warm-gray">Engage for:</span> {person.engage}
          </>
        ) : (
          <span className="text-warm-gray">
            No profile yet
            {mine ? " — add what people should engage you for." : "."}
          </span>
        )}
      </p>

      {person.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {person.tags.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tag === t}
              onClick={() => onTag(t)}
              className={cn(
                ABOVE,
                "cursor-pointer rounded-full border px-3 py-[5px] text-xs font-medium transition-colors",
                tag === t
                  ? "border-violet-deep bg-violet-deep text-white"
                  : "border-hair-strong bg-paper text-ink-soft hover:border-violet-deep hover:text-violet-deep"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-hair-soft pt-3.5">
        <span className="min-w-0 flex-1 truncate text-[13px] text-warm-gray">
          {person.contact}
        </span>
        <span className="flex flex-none items-center gap-1.5">
          {mine ? (
            /* Your own card has no conversation to open, so the reach over
               the whole card is the one action it does have. */
            <button
              type="button"
              onClick={onEdit}
              className="flex cursor-pointer items-center gap-[7px] rounded-full border border-hair-strong bg-white px-[15px] py-[7px] text-xs font-semibold whitespace-nowrap text-violet-deep transition-colors after:absolute after:inset-0 after:content-[''] hover:bg-violet-pale"
            >
              <PencilIcon size={13} />
              Edit profile
            </button>
          ) : (
            <>
              {canEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label={`Edit ${person.name}'s profile`}
                  className={cn(
                    ABOVE,
                    "flex cursor-pointer items-center rounded-full border border-hair-strong bg-white p-[7px] text-violet-deep transition-colors hover:bg-violet-pale"
                  )}
                >
                  <PencilIcon size={13} />
                </button>
              )}
              <button
                type="button"
                onClick={onMessage}
                className="flex cursor-pointer items-center gap-[7px] rounded-full border border-hair-strong bg-white px-[15px] py-[7px] text-xs font-semibold whitespace-nowrap text-violet-deep transition-colors after:absolute after:inset-0 after:content-[''] hover:bg-violet-pale"
              >
                <CommentIcon size={13} />
                Message
              </button>
            </>
          )}
        </span>
      </div>
    </article>
  );
}
