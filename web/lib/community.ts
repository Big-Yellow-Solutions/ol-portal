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
