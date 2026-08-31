"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { COMMUNITY_THREADS, initialsOfName } from "@/lib/community";
import { messageTime } from "@/lib/dashboard";
import { fullName, initials } from "@/lib/data";
import { usePortalData } from "@/lib/portal-data";
import type { Lab, Person } from "@/lib/types";

/* Messaging for the whole portal, from the Directory + Messages handoff.
 *
 * The panel is mounted once by the shell rather than by a page, because every
 * "Message" affordance in the design opens the same surface: the top nav's
 * icon, the bench cards, Home's presence rows, and any link to `#messages`.
 *
 * There is no messages API — backend/src has no route for one — so a
 * conversation is whatever the session appends to it, and every thread starts
 * empty: nobody is shown words a colleague never wrote. Two things follow,
 * both deliberate:
 *
 * 1. The roster is the real bench (who the directory lists) plus anyone a
 *    seeded thread names who is not on it. Posts are no longer such a source:
 *    every post has a portal author now (see lib/community.ts), so a post's
 *    author is already on the bench. COMMUNITY_THREADS is empty until a
 *    messages API lands, so today the roster is exactly the bench.
 * 2. Sending appends immediately. When the API lands, that append becomes the
 *    optimistic write and the reconcile follows it; nothing else here moves.
 */

/* The signed-in person's id inside a conversation. Real people are keyed by
   username, network people by name — neither can collide with this. */
export const ME = "me";

const NETWORK = "net:";

/* The id a community/network person is addressed by. Exported so Home can
   hand a presence row straight to openWith(). */
export function networkId(name: string): string {
  return NETWORK + name;
}

export interface MessagePerson {
  id: string;
  name: string;
  first: string;
  initials: string;
  /* "Lab Leader · Faith Lab" — the line under the name everywhere. */
  role: string;
  photo?: string;
}

export interface ChatMsg {
  /* A person id, or ME. */
  from: string;
  text: string;
  time: string;
}

export interface Conversation {
  id: string;
  /* Everyone but the signed-in person. One member is a DM. */
  members: string[];
  name?: string;
  time: string;
  msgs: ChatMsg[];
}

export type PanelMode = "list" | "new" | "thread";

/* A mention run, or the plain text between them. */
export interface Segment {
  text: string;
  id: string | null;
}

/* ---------- pure helpers ---------- */

/* "Lab Leader · Faith Lab". The directory card, the picker row and the DM
   header all read this same line. */
export function roleLine(person: Person, labs: Lab[]): string {
  const names = (person.labs ?? []).map(
    (id) => labs.find((l) => l.id === id)?.name ?? id
  );
  return [person.role, ...names].filter(Boolean).join(" · ");
}

/* "Marcus, Dana +1" — the name a group falls back to when nobody renames it. */
export function defaultName(firsts: string[]): string {
  return (
    firsts.slice(0, 2).join(", ") +
    (firsts.length > 2 ? ` +${firsts.length - 2}` : "")
  );
}

function convoKey(ids: string[]): string {
  return `c_${[...ids].sort().join("|")}`;
}

function sameMembers(a: string[], b: string[]): boolean {
  return a.length === b.length && b.every((id) => a.includes(id));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Longest name first so "@Marcus Kelley" wins over "@Marcus", and a
   negative lookahead so "@Sam" does not match inside "@Samuel". */
function mentionRe(people: MessagePerson[]): RegExp {
  const names: string[] = [];
  for (const p of people) {
    if (p.name) names.push(p.name);
    if (p.first && p.first !== p.name) names.push(p.first);
  }
  if (names.length === 0) return /(?!)/g;
  names.sort((a, b) => b.length - a.length);
  return new RegExp(`@(${names.map(escapeRe).join("|")})(?![A-Za-z])`, "g");
}

function byName(people: MessagePerson[], name: string): MessagePerson | undefined {
  const first = name.split(" ")[0];
  return (
    people.find((p) => p.name === name) ?? people.find((p) => p.first === first)
  );
}

/* Splits a message into plain runs and mention runs. An "@word" that matches
   nobody stays plain text — the design never highlights a name it cannot
   notify. */
export function segments(text: string, people: MessagePerson[]): Segment[] {
  const re = mentionRe(people);
  const out: Segment[] = [];
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > i) out.push({ text: text.slice(i, m.index), id: null });
    const hit = byName(people, m[1]);
    out.push({ text: `@${m[1]}`, id: hit ? hit.id : null });
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push({ text: text.slice(i), id: null });
  return out.length ? out : [{ text, id: null }];
}

/* ---------- the network seed ---------- */

/* The people a seeded thread is with who are not on the bench — without them
   a seeded conversation would list a row nobody can be identified in. Name is
   all such a record has, so that is all this makes a card out of. */
function networkPeople(meName: string): MessagePerson[] {
  return Object.keys(COMMUNITY_THREADS)
    .filter((who) => who !== meName)
    .map((who) => ({
      id: networkId(who),
      name: who,
      first: who.split(" ")[0],
      initials: initialsOfName(who),
      role: "",
    }));
}

/* Per-person suggestions above the composer, carried over from the dashboard
   drawer. Only the seeded network threads have them; a bench conversation has
   nothing to suggest, so the row is absent there. */
const NETWORK_QUICK: Record<string, string[]> = Object.fromEntries(
  Object.entries(COMMUNITY_THREADS).map(([who, t]) => [networkId(who), t.quick])
);

export function quickReplies(convo: Conversation | null): string[] {
  if (!convo || convo.members.length !== 1) return [];
  return NETWORK_QUICK[convo.members[0]] ?? [];
}

/* Conversations that already have something in them. An empty seeded thread
   would show up in the list as a row nobody has ever written in, so those are
   created on demand by openWith() instead. */
function seedConversations(): Record<string, Conversation> {
  const out: Record<string, Conversation> = {};
  for (const [who, thread] of Object.entries(COMMUNITY_THREADS)) {
    if (thread.messages.length === 0) continue;
    const id = networkId(who);
    const key = convoKey([id]);
    out[key] = {
      id: key,
      members: [id],
      time: thread.messages[thread.messages.length - 1].time,
      msgs: thread.messages.map((m) => ({
        from: m.fromMe ? ME : id,
        text: m.text,
        time: m.time,
      })),
    };
  }
  return out;
}

/* ---------- context ---------- */

interface MessagesValue {
  mode: PanelMode | null;
  active: Conversation | null;
  /* Most-said-in first, the way the design orders the list. */
  conversations: Conversation[];
  /* Everyone addressable: the bench plus the network. */
  roster: MessagePerson[];
  /* Just the bench — who a new chat can be started with. */
  directory: MessagePerson[];
  me: MessagePerson;
  person: (id: string) => MessagePerson;
  title: (convo: Conversation) => string;
  groupPlaceholder: (ids: string[]) => string;
  mentionIds: (text: string) => string[];
  openList: () => void;
  openNew: () => void;
  openWith: (ids: string[], name?: string) => void;
  openConversation: (id: string) => void;
  close: () => void;
  send: (text: string) => void;
  rename: (name: string) => void;
}

const MessagesContext = createContext<MessagesValue | undefined>(undefined);

export function MessagesProvider({ children }: { children: React.ReactNode }) {
  const { bench, labs, people, me } = usePortalData();
  const meRecord = me ? people[me] : undefined;
  const meName = fullName(meRecord);

  const [mode, setMode] = useState<PanelMode | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [convos, setConvos] =
    useState<Record<string, Conversation>>(seedConversations);

  const meCard = useMemo<MessagePerson>(
    () => ({
      id: ME,
      name: meName || "You",
      first: meRecord?.firstName || "You",
      initials: initials(meRecord),
      role: "You · Optimistic Labs",
      photo: meRecord?.photo,
    }),
    [meName, meRecord]
  );

  /* The directory is exactly what the bench lists, minus yourself — you
     cannot start a conversation with yourself. */
  const directory = useMemo<MessagePerson[]>(
    () =>
      bench
        .filter((p) => p.role === "Lab Leader" || p.role === "Contributor")
        .filter((p) => p.username !== me)
        .map((p) => ({
          id: p.username,
          name: fullName(p),
          first: p.firstName,
          initials: initials(p),
          role: roleLine(p, labs),
          photo: p.photo,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [bench, labs, me]
  );

  /* The network is only there to keep the seeded threads legible. If a real
     colleague ever shares a name with one of those records, the real person
     wins outright — two rows reading "Marcus Kelley" would make every mention
     of that name a coin flip. */
  const roster = useMemo<MessagePerson[]>(() => {
    const taken = new Set(directory.map((p) => p.name));
    return [
      ...directory,
      ...networkPeople(meName).filter((p) => !taken.has(p.name)),
    ];
  }, [directory, meName]);

  const byId = useMemo(() => {
    const map = new Map<string, MessagePerson>([[ME, meCard]]);
    for (const p of roster) map.set(p.id, p);
    return map;
  }, [roster, meCard]);

  const person = useCallback(
    (id: string): MessagePerson =>
      byId.get(id) ?? {
        id,
        name: "Someone",
        first: "Someone",
        initials: "?",
        role: "",
      },
    [byId]
  );

  const groupPlaceholder = useCallback(
    (ids: string[]) => defaultName(ids.map((id) => person(id).first)),
    [person]
  );

  const title = useCallback(
    (convo: Conversation) =>
      convo.name ||
      (convo.members.length === 1
        ? person(convo.members[0]).name
        : groupPlaceholder(convo.members)),
    [person, groupPlaceholder]
  );

  /* Who a message notifies, deduped in the order they appear. */
  const mentionIds = useCallback(
    (text: string) => {
      const ids = segments(text, [meCard, ...roster])
        .map((s) => s.id)
        .filter((id): id is string => !!id);
      return [...new Set(ids)];
    },
    [meCard, roster]
  );

  /* Never list a conversation whose members cannot be named — that only
     happens when a seeded record was displaced by a real person of the same
     name, and a row of "Someone" is worse than no row. */
  const conversations = useMemo(
    () =>
      Object.values(convos)
        .filter((c) => c.members.every((id) => byId.has(id)))
        .sort((a, b) => b.msgs.length - a.msgs.length),
    [convos, byId]
  );

  const active = activeId ? (convos[activeId] ?? null) : null;

  const openList = useCallback(() => {
    setMode("list");
    setActiveId(null);
  }, []);

  const openNew = useCallback(() => setMode("new"), []);

  const openConversation = useCallback((id: string) => {
    setActiveId(id);
    setMode("thread");
  }, []);

  const close = useCallback(() => {
    setMode(null);
    setActiveId(null);
  }, []);

  /* Open the conversation these people already have, whoever created it and
     in whatever order it stored them; otherwise start an empty one. */
  const openWith = useCallback(
    (ids: string[], name?: string) => {
      if (ids.length === 0) return;
      const existing = Object.keys(convos).find((k) =>
        sameMembers(convos[k].members, ids)
      );
      if (existing) {
        openConversation(existing);
        return;
      }
      const key = convoKey(ids);
      const nm = (name ?? "").trim();
      setConvos((prev) => ({
        ...prev,
        [key]: {
          id: key,
          members: ids,
          time: "Now",
          msgs: [],
          name: nm || undefined,
        },
      }));
      openConversation(key);
    },
    [convos, openConversation]
  );

  const send = useCallback(
    (text: string) => {
      const body = text.trim();
      if (!body || !activeId) return;
      const time = messageTime(new Date());
      setConvos((prev) => {
        const convo = prev[activeId];
        if (!convo) return prev;
        return {
          ...prev,
          [activeId]: {
            ...convo,
            time,
            msgs: [...convo.msgs, { from: ME, text: body, time }],
          },
        };
      });
    },
    [activeId]
  );

  /* A blank name is not a name — it reverts the group to the members' own. */
  const rename = useCallback(
    (name: string) => {
      if (!activeId) return;
      const nm = name.trim();
      setConvos((prev) => {
        const convo = prev[activeId];
        if (!convo) return prev;
        const next: Conversation = { ...convo, name: nm || undefined };
        return { ...prev, [activeId]: next };
      });
    },
    [activeId]
  );

  const value = useMemo<MessagesValue>(
    () => ({
      mode,
      active,
      conversations,
      roster,
      directory,
      me: meCard,
      person,
      title,
      groupPlaceholder,
      mentionIds,
      openList,
      openNew,
      openWith,
      openConversation,
      close,
      send,
      rename,
    }),
    [
      mode,
      active,
      conversations,
      roster,
      directory,
      meCard,
      person,
      title,
      groupPlaceholder,
      mentionIds,
      openList,
      openNew,
      openWith,
      openConversation,
      close,
      send,
      rename,
    ]
  );

  return (
    <MessagesContext.Provider value={value}>
      {children}
    </MessagesContext.Provider>
  );
}

export function useMessages(): MessagesValue {
  const value = useContext(MessagesContext);
  if (!value) {
    throw new Error("useMessages must be used inside MessagesProvider");
  }
  return value;
}
