/* Community content.
 *
 * There is no community backend yet — backend/src has no posts, events, or
 * RSVP handlers — so this module holds the seed content exactly as the Claude
 * Design artboard specifies it, and the page drives everything from local
 * state the same way the design does. It is deliberately the only place the
 * content lives: when the API lands, these three loaders become fetches and
 * the page does not change.
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

export interface CommunityLab {
  name: string;
  count: string;
}

export const ALL_LABS = "All labs";

export const COMMUNITY_LABS: CommunityLab[] = [
  { name: ALL_LABS, count: "5 posts" },
  { name: "Faith Lab", count: "4 members" },
  { name: "Policy Lab", count: "3 members" },
  { name: "Philanthropy Lab", count: "4 members" },
  { name: "Sports Lab", count: "3 members" },
];

export const COMMUNITY_POSTS: CommunityPost[] = [
  {
    id: "p1",
    who: "Marcus Kelley",
    initials: "MK",
    online: true,
    lab: "Faith Lab",
    time: "2h",
    kind: "Contract signed",
    likes: 9,
    text: "Signed a 12-month community strategy engagement with Grace Network — 40,000 members across nine congregations.",
    headline: "Grace Network signs a 12-month strategy engagement",
    dek: "40,000 members across nine congregations.",
    comments: [
      {
        who: "Priya Raman",
        initials: "PR",
        online: true,
        time: "1h",
        text: "Congratulations. Nine congregations at once is real scale — how did you scope the onboarding?",
      },
      {
        who: "Marcus Kelley",
        initials: "MK",
        online: true,
        time: "52m",
        text: "Two pilot congregations first, then a rollout playbook the others run themselves.",
      },
      {
        who: "Liz Russell",
        initials: "LR",
        time: "20m",
        text: "Can you drop the scoping doc in Resources when you get a minute?",
      },
    ],
  },
  {
    id: "p2",
    who: "Priya Raman",
    initials: "PR",
    online: true,
    lab: "Philanthropy Lab",
    time: "Fri",
    kind: "Renewal",
    likes: 11,
    text: "The Hollings Foundation renewed for a second year, and asked for the donor-circle model we built in the spring.",
    headline: "Hollings Foundation renews for a second year",
    dek: "And asked for the donor-circle model we built in the spring.",
    comments: [
      {
        who: "Jordan Pike",
        initials: "JP",
        online: false,
        time: "Fri",
        text: "The donor-circle model would translate almost directly to two of my public-sector clients.",
      },
    ],
  },
  {
    id: "p3",
    who: "Jordan Pike",
    initials: "JP",
    online: false,
    lab: "Policy Lab",
    time: "5h",
    kind: "News",
    likes: 4,
    text: "Useful read for anyone scoping public-sector work this fall.",
    linkSource: "govtech.com",
    linkTitle:
      "Twelve states move on AI disclosure requirements for public engagement",
    headline: "Twelve states move on AI disclosure for public engagement",
    comments: [
      {
        who: "Liz Russell",
        initials: "LR",
        time: "4h",
        text: "Georgia is on that list. Worth a note in the Ridgeway proposal.",
      },
      {
        who: "Jordan Pike",
        initials: "JP",
        online: false,
        time: "3h",
        text: "Agreed — I will write up the disclosure language we used last quarter.",
      },
    ],
  },
  {
    id: "p4",
    who: "Optimistic Labs",
    initials: "OL",
    lab: ALL_LABS,
    time: "Yesterday",
    kind: "Event",
    likes: 7,
    photo: "community-quarterly",
    text: "All-lab quarterly, 3 September in Atlanta. Two days on what is working across every lab.",
    headline: "All-lab quarterly, 3 September in Atlanta",
    accent: "3 September",
    dek: "Two days on what is working across every lab. Nine of fourteen leaders are going.",
    comments: [
      {
        who: "Tomas Serrano",
        initials: "TS",
        online: false,
        time: "Yesterday",
        text: "Flying in the night before. Happy to help with the Sports Lab session.",
      },
    ],
  },
  {
    id: "p5",
    who: "Tomas Serrano",
    initials: "TS",
    online: false,
    lab: "Sports Lab",
    time: "Monday",
    kind: "New leader",
    likes: 6,
    text: "Joined the Sports Lab after fifteen years building supporter communities in professional soccer.",
    headline: "Tomas Serrano joins the Sports Lab",
    dek: "Fifteen years in professional soccer.",
    comments: [
      {
        who: "Marcus Kelley",
        initials: "MK",
        online: true,
        time: "Monday",
        text: "Welcome, Tomas. Supporter groups and congregations have more in common than you would think.",
      },
    ],
  },
];

export const COMMUNITY_EVENTS: CommunityEvent[] = [
  {
    id: "e1",
    mon: "Sep",
    day: "3",
    group: ALL_LABS,
    title: "All-lab quarterly",
    when: "Wed 3 September, 9:00 AM – Thu 4 September, 4:00 PM",
    place: "Atlanta, GA",
    host: "Optimistic Labs",
    base: 9,
    cap: 14,
    body: "Two days on what is working across every lab: pipeline review, three lab case studies, and a working session on the community playbook. Rooms are blocked at the Ponce; RSVP by 25 August.",
  },
  {
    id: "e2",
    mon: "Aug",
    day: "21",
    group: "Faith Lab",
    title: "Faith Lab office hours",
    when: "Thu 21 August, 1:00 – 2:00 PM ET",
    place: "Zoom",
    host: "Marcus Kelley",
    base: 4,
    cap: 6,
    body: "Open working session for anyone scoping congregational engagement. Bring a live question; we spend the hour on whatever people bring.",
  },
  {
    id: "e3",
    mon: "Aug",
    day: "28",
    group: "Policy Lab",
    title: "Briefing: AI disclosure rules and public engagement",
    when: "Thu 28 August, 11:00 AM ET",
    place: "Zoom",
    host: "Jordan Pike",
    base: 4,
    cap: 14,
    body: "Forty-five minutes on what the twelve new state disclosure requirements mean for public-sector scopes, and the language we are using in proposals now.",
  },
];

export const PINNED_ANNOUNCEMENT = {
  title: "All-lab quarterly, 3 September in Atlanta",
  body: "Two days on what is working across every lab. RSVP by 25 August so we can plan rooms and meals.",
  meta: "Optimistic Labs · Admin · Yesterday",
};

export type RsvpChoice = "Going" | "Interested" | "Can't go";

export const RSVP_CHOICES: RsvpChoice[] = ["Going", "Interested", "Can't go"];

/* The design ships e1 already answered so the "You are going" state is
   visible on arrival. */
export const INITIAL_RSVPS: Record<string, RsvpChoice | null> = {
  e1: "Going",
  e2: null,
  e3: null,
};

/* The front page is edited, not sorted: the digest leads on the all-lab
   quarterly, runs the outside news story beneath it, and stacks the three
   business items down the right. Ids the feed no longer contains are skipped,
   and any post with a headline that is missing here falls in behind them, so
   a new post still reaches the digest without an edit to this list. */
export const DIGEST_ORDER = ["p4", "p3", "p1", "p2", "p5"];

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

/* Direct messages between leaders, keyed by the name on the post (`who`).
 *
 * Same standing as the posts above: there is no messages backend yet, so a
 * thread is seed content plus whatever the session appends. The Directory
 * artboard owns messaging properly — when that lands, this becomes the fetch
 * and the drawer does not change.
 */
export const COMMUNITY_THREADS: Record<string, LeaderThread> = {
  "Priya Raman": {
    messages: [
      {
        fromMe: false,
        text: "Saw the Hollings renewal note — congrats. Did their board ask for the donor-circle deck?",
        time: "9:12 AM",
      },
      {
        fromMe: true,
        text: "They did. I can share the version we used in the spring if it helps.",
        time: "9:20 AM",
      },
      {
        fromMe: false,
        text: "That would be great. We have a similar conversation with a family foundation next week.",
        time: "9:22 AM",
      },
    ],
    quick: ["Sharing the deck now", "Free tomorrow?"],
  },
  "Marcus Kelley": {
    messages: [
      {
        fromMe: false,
        text: "Grace Network kickoff is confirmed for the 14th. Anything you want on the agenda?",
        time: "8:41 AM",
      },
      {
        fromMe: true,
        text: "Just the trust-mapping exercise. I will send the schedule today.",
        time: "8:55 AM",
      },
    ],
    quick: ["Sending the schedule", "Sounds good"],
  },
  "Tomas Serrano": {
    messages: [
      {
        fromMe: false,
        text: "Just joined the Sports Lab — happy to be here. Any resource you would start with?",
        time: "10:05 AM",
      },
    ],
    quick: ["Welcome aboard", "Start with the onboarding course"],
  },
  "Jordan Pike": {
    messages: [],
    quick: ["Thanks for the link", "Can we talk this week?"],
  },
};
