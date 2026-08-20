"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StarGlyph } from "@/components/shell/top-nav";
import { ColumnsIcon, PinIcon, PlusIcon } from "@/components/community/icons";
import {
  Eyebrow,
  FIELD,
  Initials,
  Panel,
  TogglePill,
} from "@/components/community/primitives";
import { PostCard } from "@/components/community/post-card";
import { PostDetail } from "@/components/community/post-detail";
import { EventDetail } from "@/components/community/event-detail";
import { CommunityDialog } from "@/components/community/community-dialog";
import {
  CommunityRail,
  EventDateBlock,
  LabList,
} from "@/components/community/rail";
import {
  ALL_LABS,
  COMMUNITY_EVENTS,
  COMMUNITY_LABS,
  COMMUNITY_POSTS,
  INITIAL_RSVPS,
  PINNED_ANNOUNCEMENT,
  RSVP_CHOICES,
  type CommunityComment,
  type CommunityEvent,
  type CommunityPost,
  type RsvpChoice,
} from "@/lib/community";
import { usePortalData } from "@/lib/portal-data";
import { fullName, initials } from "@/lib/data";
import { cn } from "@/lib/utils";

type Tab = "feed" | "events" | "groups";

export default function CommunityPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-mute">Loading…</p>}>
      <Community />
    </Suspense>
  );
}

function Community() {
  const router = useRouter();
  const params = useSearchParams();
  const { people, me, role } = usePortalData();
  const meRecord = me ? people[me] : undefined;
  const meName = fullName(meRecord) || me || "You";
  const meInitials = initials(meRecord);

  const [tab, setTab] = useState<Tab>("feed");
  const [rail, setRail] = useState(true);
  const [filter, setFilter] = useState(ALL_LABS);
  const [postTo, setPostTo] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /* Home's digest links straight at a story: /community?post=p1 opens that
     post's thread on arrival, the way Resources' ?r= does, and survives the
     static export. */
  const linkedPost = params.get("post");
  const [pickedPost, setPickedPost] = useState<string | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [rsvps, setRsvps] =
    useState<Record<string, RsvpChoice | null>>(INITIAL_RSVPS);
  const [extra, setExtra] = useState<CommunityPost[]>([]);
  const [threads, setThreads] = useState<Record<string, CommunityComment[]>>({});

  /* A link is the state while it is in the URL, so closing has to clear the
     query too — otherwise a reload reopens a thread the reader dismissed. */
  const openId = linkedPost ?? pickedPost;
  const closePost = () => {
    setPickedPost(null);
    if (linkedPost) router.replace("/community");
  };

  const allPosts = useMemo(
    () => extra.concat(COMMUNITY_POSTS),
    [extra]
  );
  const visiblePosts = allPosts.filter(
    (p) => filter === ALL_LABS || p.lab === filter || p.lab === ALL_LABS
  );

  const commentsFor = (p: CommunityPost) => p.comments.concat(threads[p.id] ?? []);
  const likesFor = (p: CommunityPost) => p.likes + (liked[p.id] ? 1 : 0);
  const goingLabel = (e: CommunityEvent) =>
    `${e.base + (rsvps[e.id] === "Going" ? 1 : 0)} of ${e.cap} going`;

  const toggleLike = (id: string) =>
    setLiked((s) => ({ ...s, [id]: !s[id] }));

  const setRsvp = (id: string, choice: RsvpChoice) =>
    setRsvps((s) => ({ ...s, [id]: s[id] === choice ? null : choice }));

  const pickLab = (name: string) => {
    setFilter(name);
    setTab("feed");
  };

  const submitPost = () => {
    const text = draft.trim();
    if (!text) return;
    setExtra((s) => [
      {
        id: `x${Date.now()}`,
        who: meName,
        initials: meInitials,
        online: true,
        lab: postTo ?? filter,
        time: "just now",
        kind: "Update",
        likes: 0,
        text,
        comments: [],
      },
      ...s,
    ]);
    setDraft("");
  };

  const addComment = (id: string, text: string) =>
    setThreads((s) => ({
      ...s,
      [id]: (s[id] ?? []).concat({
        who: meName,
        initials: meInitials,
        time: "just now",
        text,
      }),
    }));

  const openPost = allPosts.find((p) => p.id === openId);
  const openEvent = COMMUNITY_EVENTS.find((e) => e.id === openEventId);

  const tabs: { key: Tab; name: string; count: number }[] = [
    { key: "feed", name: "Feed", count: allPosts.length },
    { key: "events", name: "Events", count: COMMUNITY_EVENTS.length },
    { key: "groups", name: "Groups", count: COMMUNITY_LABS.length - 1 },
  ];

  // The design's copy says event creation belongs to Admins and Lab Leaders.
  const canManageEvents = role === "Admin" || role === "Lab Leader";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-warm-gray uppercase">
            <StarGlyph className="text-violet-deep" />
            Community
          </span>
          <h1 className="mt-1.5 mb-0 text-[34px] leading-[1.1] font-bold tracking-[-0.015em]">
            What is happening{" "}
            <span className="font-serif font-normal text-violet-deep italic">
              across the labs
            </span>
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setRail((r) => !r)}
          className="flex flex-none cursor-pointer items-center gap-2 rounded-full border border-hair-strong px-3.5 py-2 text-[13px] font-semibold text-violet-deep transition-colors hover:bg-violet-pale"
        >
          <ColumnsIcon size={14} />
          {rail ? "Sidebar layout" : "Rail layout"}
        </button>
      </div>

      <div className="flex items-center gap-[26px] overflow-x-auto border-b border-hair">
        {tabs.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-current={on ? "page" : undefined}
              onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px flex cursor-pointer items-center gap-2 border-b-2 pb-3 text-[15px] whitespace-nowrap transition-colors",
                on
                  ? "border-violet-deep font-bold text-ink"
                  : "border-transparent font-medium text-warm-gray hover:text-ink"
              )}
            >
              {t.name}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  on
                    ? "bg-violet-pale text-violet-deep"
                    : "bg-[rgba(124,109,245,0.10)] text-warm-gray"
                )}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          "grid items-start gap-[26px]",
          rail
            ? "lg:grid-cols-[minmax(0,1fr)_340px]"
            : "lg:grid-cols-[236px_minmax(0,1fr)]"
        )}
      >
        {!rail && (
          <aside className="flex min-w-0 flex-col gap-2">
            <span className="px-1 pb-1 text-[11px] font-semibold tracking-[0.14em] text-warm-gray uppercase">
              Your labs
            </span>
            <LabList labs={COMMUNITY_LABS} filter={filter} onPick={pickLab} />
            <button
              type="button"
              onClick={() => setTab("groups")}
              className="mt-2 block cursor-pointer rounded-[12px] border border-dashed border-hair-strong p-3 text-left text-[13px] leading-[1.45] text-violet-deep transition-colors hover:bg-wash"
            >
              Browse groups
              <span className="mt-[3px] block text-xs text-warm-gray">
                Cross-lab working groups are coming
              </span>
            </button>
          </aside>
        )}

        <main className="flex min-w-0 flex-col gap-4">
          {tab === "feed" && (
            <>
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
                      className={cn(
                        FIELD,
                        "w-full resize-none rounded-[12px] px-3.5 py-[11px] text-[15px] leading-[1.5]"
                      )}
                    />
                    <div className="flex flex-wrap items-center justify-end gap-2.5">
                      <label className="flex items-center gap-[7px] text-[13px] whitespace-nowrap text-warm-gray">
                        Posting to
                        <select
                          value={postTo ?? filter}
                          onChange={(e) => setPostTo(e.target.value)}
                          className={cn(
                            FIELD,
                            "cursor-pointer rounded-full px-[11px] py-[7px] text-[13px] font-semibold text-violet-deep"
                          )}
                        >
                          {COMMUNITY_LABS.map((l) => (
                            <option key={l.name} value={l.name}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={submitPost}
                        disabled={!draft.trim()}
                        className={cn(
                          "rounded-full px-5 py-[9px] text-sm font-semibold transition-colors",
                          draft.trim()
                            ? "cursor-pointer bg-violet-deep text-white hover:bg-violet"
                            : "cursor-not-allowed bg-violet-pale text-violet-deep/50"
                        )}
                      >
                        Post
                      </button>
                    </div>
                  </div>
                </div>
              </Panel>

              <div className="flex flex-wrap items-center gap-2">
                {COMMUNITY_LABS.map((l) => {
                  const on = filter === l.name;
                  return (
                    <button
                      key={l.name}
                      type="button"
                      aria-pressed={on}
                      onClick={() => pickLab(l.name)}
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

              {visiblePosts.map((p) => (
                <PostCard
                  key={p.id}
                  post={p}
                  liked={!!liked[p.id]}
                  likes={likesFor(p)}
                  comments={commentsFor(p).length}
                  onLike={() => toggleLike(p.id)}
                  onOpen={() => setPickedPost(p.id)}
                />
              ))}
            </>
          )}

          {tab === "events" && (
            <>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[13px] text-warm-gray">
                  Admins and Lab Leaders can create events.
                </span>
                {canManageEvents && (
                  <span className="flex flex-wrap items-center gap-3.5">
                    {/* Events admin is the next artboard in the design project
                        and is not built yet, so these stay visible and inert
                        rather than pointing at a route that does not exist. */}
                    <button
                      type="button"
                      disabled
                      title="Events admin is designed but not built yet"
                      className="cursor-not-allowed text-[13px] font-semibold whitespace-nowrap text-violet-deep/50"
                    >
                      Manage events →
                    </button>
                    <button
                      type="button"
                      disabled
                      title="Events admin is designed but not built yet"
                      className="flex cursor-not-allowed items-center gap-2 rounded-full bg-violet-deep/50 px-[18px] py-2.5 text-sm font-semibold whitespace-nowrap text-white"
                    >
                      <PlusIcon size={14} />
                      New event
                    </button>
                  </span>
                )}
              </div>

              {COMMUNITY_EVENTS.map((e) => (
                <Panel as="article" key={e.id} className="flex gap-[18px] p-5">
                  <EventDateBlock mon={e.mon} day={e.day} size="lg" />
                  <div className="flex min-w-0 flex-1 flex-col gap-[9px]">
                    <Eyebrow>{e.group}</Eyebrow>
                    <h3 className="m-0 text-[19px] leading-[1.25] font-bold tracking-[-0.014em]">
                      {e.title}
                    </h3>
                    <span className="text-[13px] text-warm-gray">
                      {e.when} · {e.place}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {RSVP_CHOICES.map((choice) => (
                        <TogglePill
                          key={choice}
                          on={rsvps[e.id] === choice}
                          onClick={() => setRsvp(e.id, choice)}
                        >
                          {choice}
                        </TogglePill>
                      ))}
                      <span className="flex-1" />
                      <span className="text-[13px] whitespace-nowrap text-warm-gray">
                        {goingLabel(e)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setOpenEventId(e.id)}
                        className="cursor-pointer text-[13px] font-semibold whitespace-nowrap text-violet-deep hover:text-violet"
                      >
                        Details →
                      </button>
                    </div>
                  </div>
                </Panel>
              ))}
            </>
          )}

          {tab === "groups" && (
            <>
              <p className="m-0 max-w-[60ch] text-sm leading-[1.6] text-pretty text-warm-gray">
                Groups follow your lab affiliation, so membership stays in sync
                with the Portal. Nothing to join or manage.
              </p>
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(272px,1fr))]">
                {COMMUNITY_LABS.slice(1).map((l) => {
                  const n = allPosts.filter((p) => p.lab === l.name).length;
                  return (
                    <Panel
                      as="article"
                      key={l.name}
                      className="flex flex-col gap-2.5 p-5"
                    >
                      <h3 className="m-0 text-[17px] font-bold tracking-[-0.012em]">
                        {l.name}
                      </h3>
                      <span className="text-[13px] text-warm-gray">
                        {l.count} · {n} {n === 1 ? "post" : "posts"}
                      </span>
                      <span className="flex-1" />
                      <div className="flex items-center gap-3.5 border-t border-hair-soft pt-3">
                        <button
                          type="button"
                          onClick={() => pickLab(l.name)}
                          className="cursor-pointer text-[13px] font-semibold text-violet-deep hover:text-violet"
                        >
                          View feed →
                        </button>
                        <a
                          href="/bench"
                          className="text-[13px] font-medium text-warm-gray hover:text-violet-deep"
                        >
                          Message the group
                        </a>
                      </div>
                    </Panel>
                  );
                })}
                <article className="flex flex-col gap-2.5 rounded-[16px] border border-dashed border-hair-strong bg-violet-pale/40 p-5">
                  <h3 className="m-0 text-[17px] font-bold tracking-[-0.012em] text-violet-deep">
                    Member-created groups
                  </h3>
                  <span className="text-[13px] leading-[1.55] text-pretty text-warm-gray">
                    Cross-lab working groups you can browse and join are planned
                    for a later release.
                  </span>
                  <span className="flex-1" />
                  <span className="text-[11px] font-semibold tracking-[0.12em] text-warm-gray uppercase">
                    Coming later
                  </span>
                </article>
              </div>
            </>
          )}
        </main>

        {rail && (
          <CommunityRail
            events={COMMUNITY_EVENTS}
            labs={COMMUNITY_LABS}
            filter={filter}
            rsvps={rsvps}
            goingLabel={goingLabel}
            onPickLab={pickLab}
            onOpenEvent={setOpenEventId}
            onQuickRsvp={(id) => setRsvp(id, "Going")}
            onAllEvents={() => setTab("events")}
            onBrowseGroups={() => setTab("groups")}
          />
        )}
      </div>

      <CommunityDialog
        open={!!openPost}
        onOpenChange={(o) => !o && closePost()}
        kicker={openPost?.kind ?? ""}
        title={openPost ? `Post by ${openPost.who}` : "Post"}
        width={660}
      >
        {openPost && (
          <PostDetail
            post={openPost}
            comments={commentsFor(openPost)}
            liked={!!liked[openPost.id]}
            likes={likesFor(openPost)}
            meInitials={meInitials}
            onLike={() => toggleLike(openPost.id)}
            onComment={(text) => addComment(openPost.id, text)}
          />
        )}
      </CommunityDialog>

      <CommunityDialog
        open={!!openEvent}
        onOpenChange={(o) => !o && setOpenEventId(null)}
        kicker={openEvent ? `Event · ${openEvent.group}` : ""}
        title={openEvent?.title ?? "Event"}
        width={640}
      >
        {openEvent && (
          <EventDetail
            event={openEvent}
            rsvp={rsvps[openEvent.id] ?? null}
            going={goingLabel(openEvent)}
            onRsvp={(choice) => setRsvp(openEvent.id, choice)}
          />
        )}
      </CommunityDialog>
    </>
  );
}
