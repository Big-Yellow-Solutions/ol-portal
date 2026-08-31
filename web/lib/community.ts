/* Community content.
 *
 * There is no community backend yet — backend/src has no posts, events, or
 * RSVP handlers — so this module is the one place the content would live, and
 * it is empty: a portal that ships invented posts, events and conversations
 * teaches people to distrust everything else on the screen. What the design's
 * seed content was for is the shapes below; the surfaces draw themselves from
 * these lists and each has an empty state for the state they are in now.
 *
 * When the API lands, these become fetches and no page changes.
 */

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

export const COMMUNITY_POSTS: CommunityPost[] = [];

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
 * Same standing as the posts above: there is no messages backend yet, so this
 * is empty and every conversation in the drawer is one somebody started this
 * session. The Directory artboard owns messaging properly — when that lands,
 * this becomes the fetch and the drawer does not change.
 */
export const COMMUNITY_THREADS: Record<string, LeaderThread> = {};
