/* Community content.
 *
 * Posts have a backend now (backend/src/community.mjs, `GET|POST /posts`),
 * so the feed no longer holds them: this module is the client for that API
 * plus the small amount of translation the surfaces need between what the
 * store keeps and what the design draws.
 *
 * The two shapes, and why there are two:
 *
 *   PostRecord    what the API stores and returns — an author key, a lab key,
 *                 ISO timestamps. Stable, and safe to persist.
 *   CommunityPost what a card renders — a person's name and initials, a lab's
 *                 name, "3h ago". All of it derived, none of it stored, so a
 *                 renamed person or a renamed lab reads correctly on a post
 *                 written a year earlier.
 *
 * `toCommunityPost` is the join between them, and the portal's own roster
 * (usePortalData) is what it joins against.
 *
 * Events, RSVPs and threads still have no API. They stay empty here, and each
 * surface has an empty state for the state they are in.
 */

import { api } from "@/lib/api";
import { fullName, initials } from "@/lib/data";
import type { Lab, Person } from "@/lib/types";

export interface CommunityComment {
  who: string;
  initials: string;
  online?: boolean;
  time: string;
  text: string;
}

export interface CommunityPost {
  id: string;
  who: string;
  initials: string;
  online?: boolean;
  lab: string;
  time: string;
  kind: string;
  likes: number;
  text: string;
  linkSource?: string;
  linkTitle?: string;
  photo?: string;
  comments: CommunityComment[];
  /* The front-page edit of the same story. The dashboard's "Across the
     Network" digest is not a second feed — it is these posts, rewritten to
     headline length by whoever posted them. `accent` is the fragment of the
     headline the design sets in serif italic; it must appear in `headline`
     verbatim or it is ignored. A post with no `headline` never reaches the
     digest. */
  headline?: string;
  dek?: string;
  accent?: string;
}

export interface CommunityEvent {
  id: string;
  mon: string;
  day: string;
  group: string;
  title: string;
  when: string;
  place: string;
  host: string;
  /* Attendees before the signed-in person's own RSVP is counted. */
  base: number;
  cap: number;
  body: string;
}

/* A lab as the feed chips, the rail rows and the Groups tab draw it. The
   names are the Portal's own labs; `count` is that lab's share of the bench. */
export interface CommunityLab {
  name: string;
  count: string;
}

export interface Announcement {
  title: string;
  body: string;
  meta: string;
}

export const ALL_LABS = "All labs";

/* ---------- the posts API ---------- */

/* Mirrors POST_KINDS in backend/src/community.mjs. The server validates
   against its own copy, so a kind that is not on both lists is refused. */
export const POST_KINDS = ["Update", "Ask", "Win", "Link", "Introduction"] as const;
export type PostKind = (typeof POST_KINDS)[number];

/* One stored post. `lab` is a lab id, and its absence is the scope "everyone"
   rather than a missing value — the composer's "All labs" option. */
export interface PostRecord {
  id: string;
  author: string;
  authorName: string;
  text: string;
  kind: PostKind;
  lab?: string;
  tags: string[];
  likes: number;
  comments: CommunityComment[];
  created: string;
  updated: string;
}

export interface NewPost {
  text: string;
  lab?: string;
  kind?: PostKind;
  tags?: string[];
}

export const listPosts = () => api<PostRecord[]>("/posts");

export const createPost = (input: NewPost) =>
  api<PostRecord>("/posts", { method: "POST", body: JSON.stringify(input) });

export const updatePost = (id: string, input: Partial<NewPost>) =>
  api<PostRecord>(`/posts/${id}`, { method: "PATCH", body: JSON.stringify(input) });

export const deletePost = (id: string) =>
  api<{ deleted: string }>(`/posts/${id}`, { method: "DELETE" });

/* ---------- record to card ---------- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* How the feed writes a timestamp. Anything inside a week is said in elapsed
   time, because that is how someone reads a feed; past that a date is more
   use than "13d ago". */
export function postTime(created: string, now: Date): string {
  const then = Date.parse(created);
  if (Number.isNaN(then)) return "";
  const ago = now.getTime() - then;
  if (ago < MINUTE) return "just now";
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h ago`;
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)}d ago`;
  return new Date(then).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/* Initials for an author who is no longer on the roster — the stored name is
   all that is left of them, so cut it the same way `initials` cuts a Person. */
export function initialsOfName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/* The live roster wins over the stored snapshot: a person who has changed
   their name should read as changed everywhere, including on posts written
   before it. The snapshot is what is left for an author who has since been
   removed from the portal.

   `online` is deliberately not set. There is no presence backend, and a dot
   that always says "away" is worse than no dot — AvatarWithPresence draws
   none when this is undefined. */
export function toCommunityPost(
  record: PostRecord,
  people: Record<string, Person>,
  labs: Lab[],
  now: Date
): CommunityPost {
  const person = people[record.author];
  return {
    id: record.id,
    who: fullName(person) || record.authorName || record.author,
    initials: person ? initials(person) : initialsOfName(record.authorName),
    lab: record.lab ? (labs.find((l) => l.id === record.lab)?.name ?? ALL_LABS) : ALL_LABS,
    time: postTime(record.created, now),
    kind: record.kind,
    likes: record.likes ?? 0,
    text: record.text,
    comments: record.comments ?? [],
  };
}

/* ---------- everything still without an API ---------- */

export const COMMUNITY_EVENTS: CommunityEvent[] = [];

/* One announcement pinned above the feed by an Admin. Null is the ordinary
   state, not a failure: most weeks there is nothing to pin. */
export const PINNED_ANNOUNCEMENT: Announcement | null = null;

export type RsvpChoice = "Going" | "Interested" | "Can't go";

export const RSVP_CHOICES: RsvpChoice[] = ["Going", "Interested", "Can't go"];

/* RSVPs already on record for the signed-in person, by event id. */
export const INITIAL_RSVPS: Record<string, RsvpChoice | null> = {};

/* The front page is edited, not sorted: an id listed here takes that position
   in the digest. Ids the feed no longer contains are skipped, and any post
   with a headline that is missing here falls in behind them, so a new post
   still reaches the digest without an edit to this list. */
export const DIGEST_ORDER: string[] = [];

export interface ChatMessage {
  fromMe: boolean;
  text: string;
  time: string;
}

export interface LeaderThread {
  messages: ChatMessage[];
  /* Per-person suggestions the design offers above the composer. Sending one
     is the same action as typing it. */
  quick: string[];
}

/* Direct messages with people who are on the network but not on the bench,
 * keyed by the name on the post (`who`).
 *
 * There is no messages backend yet, so this is empty and every conversation
 * in the drawer is one somebody started this session. The Directory artboard
 * owns messaging properly — when that lands, this becomes the fetch and the
 * drawer does not change.
 */
export const COMMUNITY_THREADS: Record<string, LeaderThread> = {};
