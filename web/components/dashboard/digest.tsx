"use client";

import Link from "next/link";
import { StarGlyph } from "@/components/shell/top-nav";
import { ArrowRightIcon } from "@/components/community/icons";
import { Eyebrow, Initials } from "@/components/community/primitives";
import { PhotoSlot } from "@/components/community/post-card";
import type { DigestStory } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

/* "Across the Network" — the network's front page, laid out like one: a
   masthead over a rule, a lead story down the left with the outside news
   beneath it, and three business briefs stacked to the right of a full-height
   divider. The stories are community posts (lib/dashboard.ts cuts them), so
   every headline opens the post it was cut from. */

function Byline({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold tracking-[0.1em] text-warm-gray uppercase">
      {children}
    </span>
  );
}

/* The design italicises one fragment of a headline — a date, a place — in the
   serif. `accent` has to be a literal slice of the headline; anything else
   renders as plain text rather than guessing where the emphasis belongs. */
function Headline({ story }: { story: DigestStory }) {
  const at = story.accent ? story.headline.indexOf(story.accent) : -1;
  if (at === -1) return <>{story.headline}</>;
  return (
    <>
      {story.headline.slice(0, at)}
      <span className="font-serif font-normal italic">{story.accent}</span>
      {story.headline.slice(at + (story.accent as string).length)}
    </>
  );
}

function Story({
  story,
  lead = false,
  className,
}: {
  story: DigestStory;
  lead?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={story.href}
      className={cn(
        "group flex min-w-0 flex-col text-ink transition-opacity hover:opacity-[0.82]",
        lead ? "gap-2.5" : "gap-1.5",
        className
      )}
    >
      <Eyebrow>{story.kicker}</Eyebrow>
      {lead ? (
        <h3 className="m-0 text-[25px] leading-[1.12] font-bold tracking-[-0.018em] text-pretty">
          <Headline story={story} />
        </h3>
      ) : (
        <h3 className="m-0 text-base leading-[1.3] font-bold tracking-[-0.012em] text-pretty">
          <Headline story={story} />
        </h3>
      )}
      {lead && story.photo && <PhotoSlot label="Quarterly photo" height={112} />}
      {story.dek && (
        <p
          className={cn(
            "m-0 leading-[1.5] text-pretty",
            lead ? "text-sm text-ink/[0.78]" : "text-[13px] text-ink/[0.72]"
          )}
        >
          {story.dek}
        </p>
      )}
      <Byline>{story.byline}</Byline>
    </Link>
  );
}

function Rule({ className }: { className?: string }) {
  return <div className={cn("h-px bg-hair", className)} />;
}

export function Digest({
  stories,
  edition,
  meInitials,
}: {
  stories: DigestStory[];
  edition: string;
  meInitials: string;
}) {
  const [lead, second, ...briefs] = stories;

  return (
    <section className="@container rounded-[20px] border border-hair bg-white px-[26px] pt-[22px] pb-5 shadow-card">
      {/* The masthead keeps its name on one line at any width; it is the
          edition line that gives way, dropping under the title once the card
          is too narrow to hold both. */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5 pb-3">
        <h2 className="m-0 flex items-center gap-[11px]">
          <StarGlyph size={15} className="text-violet-deep" />
          <span className="font-serif text-[27px] leading-none tracking-[-0.01em] whitespace-nowrap text-ink italic">
            Across the Network
          </span>
        </h2>
        {/* No stories, no edition line: "0 stories" is a count nobody asked
            for, and the empty state below already says it. */}
        {edition && (
          <span className="text-[11px] font-semibold tracking-[0.14em] text-warm-gray uppercase">
            {edition}
          </span>
        )}
      </div>
      <div className="h-0.5 bg-violet-deep" />

      {stories.length === 0 ? (
        <p className="m-0 py-6 text-sm text-warm-gray">
          Nothing has been posted to the network yet.
        </p>
      ) : (
        /* Three columns with the divider as the middle one, so the rule runs
           the full height of whichever column is taller. The split is a
           container query rather than a viewport one: whether two columns of
           stories fit depends on how wide this card is — which changes when
           the aside drops below it — not on how wide the window is. Under it
           the stories stack and the divider lies flat. */
        <div className="grid grid-cols-1 gap-y-4 pt-[18px] @min-[620px]:grid-cols-[minmax(0,1.2fr)_1px_minmax(0,1fr)] @min-[620px]:gap-x-[22px] @min-[620px]:gap-y-0">
          <div className="flex min-w-0 flex-col">
            <Story story={lead} lead />
            {second && (
              <>
                <Rule className="my-4" />
                <Story story={second} />
              </>
            )}
          </div>

          <Rule className="@min-[620px]:h-auto @min-[620px]:w-px" />

          <div className="flex min-w-0 flex-col">
            {briefs.map((story, i) => (
              <div key={story.id} className="flex flex-col">
                {i > 0 && <Rule />}
                <Story
                  story={story}
                  className={cn(i > 0 && "pt-4", i < briefs.length - 1 && "pb-4")}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <Rule className="mt-5" />
      <Link
        href="/community"
        className="group flex items-center gap-[13px] pt-[15px] text-ink transition-colors hover:text-violet-deep"
      >
        <Initials size={32} className="text-xs">
          {meInitials}
        </Initials>
        <span className="min-w-0 flex-1 text-[15px] text-warm-gray">
          Share a win, a link, or an ask with the network…
        </span>
        <span className="flex flex-none items-center gap-[7px] text-[13px] font-semibold whitespace-nowrap text-violet-deep">
          Post in the community
          <ArrowRightIcon size={15} />
        </span>
      </Link>
    </section>
  );
}
