"use client";

import { useState } from "react";
import { PinIcon } from "@/components/community/icons";
import {
  Eyebrow,
  FIELD,
  Initials,
  Panel,
} from "@/components/community/primitives";
import { PostCard } from "@/components/community/post-card";
import {
  ALL_LABS,
  PINNED_ANNOUNCEMENT,
  type CommunityLab,
  type CommunityPost,
} from "@/lib/community";
import { cn } from "@/lib/utils";

/* The Feed tab: the pinned announcement, the composer, the lab chips and the
   posts. The draft lives here rather than on the page because nothing outside
   this tab reads it — the page only hears about a post once it is submitted.

   `onPost` is awaited, and a rejection keeps the draft: the text somebody just
   typed is the one thing this component must not lose. `labs` is what the
   chips filter by (every lab), `postLabs` is what the composer may file under
   (the ones this person is in) — they are different lists on purpose. */
export function CommunityFeed({
  labs,
  postLabs,
  filter,
  posts,
  loading,
  error,
  meInitials,
  liked,
  likes,
  comments,
  onPickLab,
  onPost,
  onLike,
  onOpen,
  onAuthor,
}: {
  labs: CommunityLab[];
  postLabs: string[];
  filter: string;
  posts: CommunityPost[];
  loading: boolean;
  error: string | null;
  meInitials: string;
  liked: (post: CommunityPost) => boolean;
  likes: (post: CommunityPost) => number;
  comments: (post: CommunityPost) => number;
  onPickLab: (name: string) => void;
  onPost: (text: string, lab: string) => Promise<void>;
  onLike: (post: CommunityPost) => void;
  onOpen: (post: CommunityPost) => void;
  onAuthor: (who: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [postTo, setPostTo] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  /* The filter can be a lab this person cannot post to — they can read every
     lab's chip but only file under their own — so the select falls back to
     the network rather than showing a value that is not one of its options. */
  const chosen = postTo ?? filter;
  const target = postLabs.includes(chosen) ? chosen : ALL_LABS;

  const submit = async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      await onPost(text, target);
      setDraft("");
    } catch {
      // The page has already said what went wrong; the draft stays put so it
      // can be sent again.
    } finally {
      setPosting(false);
    }
  };

  const canSubmit = !!draft.trim() && !posting;

  return (
    <>
      {PINNED_ANNOUNCEMENT && (
        <section className="flex gap-3.5 rounded-[16px] border border-hair-strong bg-violet-pale px-5 py-[18px]">
          <PinIcon size={17} className="mt-0.5 flex-none text-violet-deep" />
          <div className="min-w-0">
            <Eyebrow>Pinned announcement</Eyebrow>
            <h2 className="mt-1.5 mb-0 text-lg leading-[1.3] font-bold tracking-[-0.012em]">
              {PINNED_ANNOUNCEMENT.title}
            </h2>
            <p className="mt-1.5 mb-0 text-sm leading-[1.55] text-pretty text-ink/[0.78]">
              {PINNED_ANNOUNCEMENT.body}
            </p>
            <span className="mt-2 block text-[11px] font-semibold tracking-[0.1em] text-warm-gray uppercase">
              {PINNED_ANNOUNCEMENT.meta}
            </span>
          </div>
        </section>
      )}

      <Panel className="px-[18px] py-4">
        <div className="flex gap-3">
          <Initials tone="solid">{meInitials}</Initials>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Share a win, a link, or an ask with the network…"
              aria-label="Write a post"
              rows={3}
              disabled={posting}
              className={cn(
                FIELD,
                "w-full resize-none rounded-[12px] px-3.5 py-[11px] text-[15px] leading-[1.5]"
              )}
            />
            <div className="flex flex-wrap items-center justify-end gap-2.5">
              <label className="flex items-center gap-[7px] text-[13px] whitespace-nowrap text-warm-gray">
                Posting to
                <select
                  value={target}
                  onChange={(e) => setPostTo(e.target.value)}
                  disabled={posting}
                  className={cn(
                    FIELD,
                    "cursor-pointer rounded-full px-[11px] py-[7px] text-[13px] font-semibold text-violet-deep disabled:cursor-not-allowed"
                  )}
                >
                  {postLabs.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className={cn(
                  "rounded-full px-5 py-[9px] text-sm font-semibold transition-colors",
                  canSubmit
                    ? "cursor-pointer bg-violet-deep text-white hover:bg-violet"
                    : "cursor-not-allowed bg-violet-pale text-violet-deep/50"
                )}
              >
                {posting ? "Posting…" : "Post"}
              </button>
            </div>
          </div>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        {labs.map((l) => {
          const on = filter === l.name;
          return (
            <button
              key={l.name}
              type="button"
              aria-pressed={on}
              onClick={() => onPickLab(l.name)}
              className={cn(
                "cursor-pointer rounded-full border px-3.5 py-[7px] text-[13px] transition-colors",
                on
                  ? "border-violet-deep bg-violet-deep font-semibold text-white"
                  : "border-hair-strong bg-white font-medium text-ink-soft hover:bg-wash"
              )}
            >
              {l.name}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="rounded-[16px] border border-dashed border-hair-strong bg-white p-10 text-center">
          <p className="m-0 text-[15px] leading-[1.55] text-pretty text-red">
            {error}
          </p>
          <p className="mt-1.5 mb-0 text-[13px] text-warm-gray">
            Nothing has been lost — reload the page to try again.
          </p>
        </div>
      ) : loading ? (
        <p className="px-1 text-sm text-ink-mute">Loading the feed…</p>
      ) : posts.length === 0 ? (
        /* The composer is directly above this, so the empty state says what
           the feed is for rather than repeating the button that fills it. */
        <div className="rounded-[16px] border border-dashed border-hair-strong bg-white p-10 text-center">
          <p className="m-0 text-[15px] leading-[1.55] text-pretty text-warm-gray">
            {filter === ALL_LABS
              ? "Nothing has been posted yet. Wins, links and asks the network should see land here."
              : `Nothing in ${filter} yet.`}
          </p>
          {filter !== ALL_LABS && (
            <button
              type="button"
              onClick={() => onPickLab(ALL_LABS)}
              className="mt-2 cursor-pointer text-[13px] font-semibold text-violet-deep hover:text-violet"
            >
              See every lab
            </button>
          )}
        </div>
      ) : (
        posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            liked={liked(p)}
            likes={likes(p)}
            comments={comments(p)}
            onLike={() => onLike(p)}
            onOpen={() => onOpen(p)}
            onAuthor={() => onAuthor(p.who)}
          />
        ))
      )}
    </>
  );
}
