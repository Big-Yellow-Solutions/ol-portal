/* Home's two editorial panels — the "Across the Network" digest and the
 * "Around right now" presence list — read out of the same community records
 * the feed does. Nothing here holds content of its own: the digest is the
 * posts re-cut to headline length, and the presence list is the people who
 * wrote them. When lib/community.ts's loaders become fetches, these keep
 * working unchanged.
 */

import {
  ALL_LABS,
  COMMUNITY_THREADS,
  DIGEST_ORDER,
  type CommunityPost,
  type LeaderThread,
} from "@/lib/community";

export interface DigestStory {
  id: string;
  kicker: string;
  headline: string;
  /* The fragment of the headline the design sets in serif italic. */
  accent?: string;
  dek?: string;
  byline: string;
  photo?: string;
  href: string;
}

export interface Leader {
  name: string;
  initials: string;
  lab: string;
  online: boolean;
  /* Introduced themselves to the network recently — the design tags them. */
  isNew: boolean;
  thread: LeaderThread;
}

/* Who to credit. An outside link is credited to its publication and the
   leader who surfaced it; anything written inside the network is credited to
   its author and their lab. An all-labs post has no lab to name. */
function byline(post: CommunityPost): string {
  const lab = post.lab === ALL_LABS ? null : post.lab;
  return [post.linkSource, post.who, post.linkSource ? null : lab, post.time]
    .filter(Boolean)
    .join(" · ");
}

export function digestStories(posts: CommunityPost[]): DigestStory[] {
  const ranked = posts.filter((p) => p.headline);
  const rank = (p: CommunityPost) => {
    const i = DIGEST_ORDER.indexOf(p.id);
    return i === -1 ? DIGEST_ORDER.length : i;
  };
  return ranked
    .slice()
    .sort((a, b) => rank(a) - rank(b))
    .map((post) => ({
      id: post.id,
      kicker: post.kind,
      headline: post.headline as string,
      accent: post.accent,
      dek: post.dek,
      byline: byline(post),
      photo: post.photo,
      href: `/community?post=${post.id}`,
    }));
}

const EMPTY_THREAD: LeaderThread = { messages: [], quick: [] };

/* The leaders behind the digest, most present first. Organisation accounts
   post but are not people, so they carry no presence flag and are skipped. */
export function presenceLeaders(
  posts: CommunityPost[],
  meName: string
): Leader[] {
  const isNew = new Set(
    posts.filter((p) => p.kind === "New leader").map((p) => p.who)
  );
  const seen = new Map<string, Leader>();
  for (const post of posts) {
    if (post.online === undefined || post.who === meName) continue;
    if (seen.has(post.who)) continue;
    seen.set(post.who, {
      name: post.who,
      initials: post.initials,
      lab: post.lab === ALL_LABS ? "" : post.lab,
      online: post.online,
      isNew: isNew.has(post.who),
      thread: COMMUNITY_THREADS[post.who] ?? EMPTY_THREAD,
    });
  }
  return [...seen.values()].sort(
    (a, b) => Number(b.online) - Number(a.online)
  );
}

/* "Sports Lab · new", the sub-label under a presence row. */
export function leaderLab(leader: Leader): string {
  return [leader.lab, leader.isNew ? "new" : null].filter(Boolean).join(" · ");
}

/* "Philanthropy Lab · online", the drawer's header meta. */
export function leaderMeta(leader: Leader): string {
  return [leaderLab(leader), leader.online ? "online" : "away"]
    .filter(Boolean)
    .join(" · ");
}

/* "Tuesday, 11 August" — the eyebrow above the greeting. Assembled rather
   than handed to one locale pattern: no built-in format gives day-before-month
   with the comma after the weekday, which is how the design writes it. */
export function todayLabel(now: Date): string {
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const date = now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
  });
  return `${weekday}, ${date}`;
}

/* "Tuesday edition · 5 stories" — the digest's masthead right-hand rule. */
export function editionLabel(now: Date, stories: number): string {
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return `${weekday} edition · ${stories} ${stories === 1 ? "story" : "stories"}`;
}

/* "9:20 AM", the timestamp the drawer stamps on a message as it is sent. */
export function messageTime(now: Date): string {
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
