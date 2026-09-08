"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, ApiError } from "@/lib/api";
import { messageTime } from "@/lib/dashboard";
import { fullName, initials, isActive } from "@/lib/data";
import { notificationAge } from "@/lib/notifications";
import { usePortalData } from "@/lib/portal-data";
import type { Lab, Person } from "@/lib/types";

/* Messaging for the whole portal · the client half of backend/src/messages.mjs.
 *
 * The panel is mounted once by the shell rather than by a page, because every
 * "Message" affordance in the design opens the same surface: the top nav's
 * icon, the bench cards, the community member rows, and any `#messages` link.
 *
 * Everything on screen is the server's answer plus what this session has
 * written and not yet heard back about. Sending appends immediately — the
 * optimistic write — and the acknowledgement folds it into the server copy,
 * so a message never blinks out between "sent" and "confirmed". The server
 * copy is polled while the panel is open, so a message written on the other
 * side of a conversation arrives without a reload.
 */

/* The signed-in person's id inside a conversation. Real people are keyed by
   username (an email), which cannot collide with this. */
export const ME = "me";

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
  id: string;
  /* A person id, or ME. */
  from: string;
  text: string;
  time: string;
  /* Written here and not yet acknowledged by the server. */
  pending?: boolean;
}

export interface Conversation {
  id: string;
  /* Everyone but the signed-in person. One member is a DM. */
  members: string[];
  name?: string;
  time: string;
  msgs: ChatMsg[];
  /* ISO of the last activity; what the list sorts by. */
  updated: string;
  /* Opened here and not yet acknowledged by the server. */
  pending?: boolean;
}

export type PanelMode = "list" | "new" | "thread";

/* A mention run, or the plain text between them. */
export interface Segment {
  text: string;
  id: string | null;
}

/* What the API returns. Members include the signed-in person; `from` is a
   person key. The provider translates both into the ME-relative shape the
   components read. */
interface ServerMsg {
  id: string;
  from: string;
  text: string;
  created: string;
}

interface ServerConvo {
  id: string;
  members: string[];
  name?: string;
  updated: string;
  msgs: ServerMsg[];
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

/* The list row's clock: a time for today, a day for anything older. */
function convoTime(updated: string, now: Date): string {
  const then = new Date(updated);
  if (Number.isNaN(then.getTime())) return "";
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return then >= midnight ? messageTime(then) : notificationAge(updated, now);
}

/* Poll cadence. Open, a reply should land while the reader is still looking
   at the thread; closed, the list only needs to be roughly right by the time
   it is opened, and the open itself refreshes. */
const POLL_OPEN_MS = 5_000;
const POLL_CLOSED_MS = 45_000;

const PENDING = "pending:";
const pendingKey = (ids: string[]) => PENDING + [...ids].sort().join("|");

/* ---------- context ---------- */

interface MessagesValue {
  mode: PanelMode | null;
  active: Conversation | null;
  /* Newest activity first. */
  conversations: Conversation[];
  /* Everyone addressable — the bench, plus anyone offboarded who is still in
     a conversation, so an old thread keeps its name. */
  roster: MessagePerson[];
  /* Just the bench — who a new chat can be started with. */
  directory: MessagePerson[];
  me: MessagePerson;
  loading: boolean;
  error: string | null;
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
  refresh: () => Promise<void>;
}

const MessagesContext = createContext<MessagesValue | undefined>(undefined);

export function MessagesProvider({ children }: { children: React.ReactNode }) {
  const { bench, labs, people, me } = usePortalData();
  const meRecord = me ? people[me] : undefined;
  const meName = fullName(meRecord);

  const [mode, setMode] = useState<PanelMode | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [server, setServer] = useState<Record<string, ServerConvo>>({});
  const [pendingConvos, setPendingConvos] = useState<
    Record<string, { members: string[]; name?: string }>
  >({});
  const [pendingMsgs, setPendingMsgs] = useState<
    Record<string, { id: string; text: string; created: string }[]>
  >({});
  const [loadedAt, setLoadedAt] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* A conversation this session opened and is still waiting on. send() on
     one of these waits for the id before writing. */
  const creating = useRef<Map<string, Promise<string | null>>>(new Map());
  const generation = useRef(0);

  /* ---------- people ---------- */

  const toCard = useCallback(
    (username: string, p: Person): MessagePerson => ({
      id: username,
      name: fullName(p),
      first: p.firstName,
      initials: initials(p),
      role: roleLine(p, labs),
      photo: p.photo,
    }),
    [labs]
  );

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
     cannot start a conversation with yourself. Every role is on it: an Admin
     is as messageable as a Contributor. */
  const directory = useMemo<MessagePerson[]>(
    () =>
      bench
        .filter((p) => p.username !== me)
        .map((p) => toCard(p.username, p))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [bench, me, toCard]
  );

  const roster = useMemo<MessagePerson[]>(() => {
    const onBench = new Set(directory.map((p) => p.id));
    const gone = Object.entries(people)
      .filter(([u, p]) => u !== me && !onBench.has(u) && !isActive(p))
      .map(([u, p]) => toCard(u, p));
    return [...directory, ...gone];
  }, [directory, people, me, toCard]);

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

  /* ---------- reading ---------- */

  const refresh = useCallback(async () => {
    if (!me) return;
    const mine = ++generation.current;
    try {
      const data = await api<{ items: ServerConvo[] }>("/messages");
      if (mine !== generation.current) return;
      const next: Record<string, ServerConvo> = {};
      for (const c of data.items ?? []) next[c.id] = c;
      setServer(next);
      setLoadedAt(new Date());
      setError(null);
    } catch (err) {
      if (mine !== generation.current) return;
      if (err instanceof ApiError && err.status === 401) return;
      setError(
        err instanceof ApiError ? err.message : "Could not load messages."
      );
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [me]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = window.setInterval(
      () => void refresh(),
      mode ? POLL_OPEN_MS : POLL_CLOSED_MS
    );
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, mode]);

  /* ---------- the merged view ---------- */

  const convos = useMemo<Record<string, Conversation>>(() => {
    const out: Record<string, Conversation> = {};
    const toMsg = (m: ServerMsg): ChatMsg => ({
      id: m.id,
      from: m.from === me ? ME : m.from,
      text: m.text,
      time: messageTime(new Date(m.created)),
    });
    const unsent = (key: string): ChatMsg[] =>
      (pendingMsgs[key] ?? []).map((m) => ({
        id: m.id,
        from: ME,
        text: m.text,
        time: messageTime(new Date(m.created)),
        pending: true,
      }));

    for (const c of Object.values(server)) {
      const extra = unsent(c.id);
      const updated = extra.length
        ? pendingMsgs[c.id][pendingMsgs[c.id].length - 1].created
        : c.updated;
      out[c.id] = {
        id: c.id,
        members: c.members.filter((k) => k !== me),
        name: c.name || undefined,
        updated,
        time: convoTime(updated, loadedAt),
        msgs: [...c.msgs.map(toMsg), ...extra],
      };
    }
    for (const [key, p] of Object.entries(pendingConvos)) {
      const extra = unsent(key);
      const updated = extra.length
        ? pendingMsgs[key][pendingMsgs[key].length - 1].created
        : new Date().toISOString();
      out[key] = {
        id: key,
        members: p.members,
        name: p.name || undefined,
        updated,
        time: "Now",
        msgs: extra,
        pending: true,
      };
    }
    return out;
  }, [server, pendingConvos, pendingMsgs, me, loadedAt]);

  /* Never list a conversation whose members cannot be named: a row of
     "Someone" is worse than no row. The roster carries offboarded people, so
     this only bites on a key the portal has never heard of. */
  const conversations = useMemo(
    () =>
      Object.values(convos)
        .filter((c) => c.members.every((id) => byId.has(id)))
        .sort((a, b) => b.updated.localeCompare(a.updated)),
    [convos, byId]
  );

  const active = activeId ? (convos[activeId] ?? null) : null;

  /* A thread opened by id (a notification's link, a stale hash) that the
     list does not hold falls back to the list rather than an empty header. */
  useEffect(() => {
    if (mode === "thread" && activeId && !loading && !convos[activeId]) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode("list");
      setActiveId(null);
    }
  }, [mode, activeId, loading, convos]);

  /* ---------- navigation ---------- */

  const openList = useCallback(() => {
    setMode("list");
    setActiveId(null);
    void refresh();
  }, [refresh]);

  const openNew = useCallback(() => setMode("new"), []);

  const openConversation = useCallback(
    (id: string) => {
      setActiveId(id);
      setMode("thread");
      void refresh();
    },
    [refresh]
  );

  const close = useCallback(() => {
    setMode(null);
    setActiveId(null);
  }, []);

  /* ---------- writing ---------- */

  /* Fold an acknowledged conversation into the server copy right away, so it
     does not depend on the next poll to exist. */
  const absorbConvo = useCallback((c: ServerConvo) => {
    setServer((prev) => ({ ...prev, [c.id]: c }));
  }, []);

  /* Open the conversation these people already have, whoever created it and
     in whatever order it stored them; otherwise ask the server for one. The
     panel opens on it at once, and the id is swapped for the real one when
     the answer lands. */
  const openWith = useCallback(
    (ids: string[], name?: string) => {
      const others = [...new Set(ids.filter((id) => id && id !== me && id !== ME))];
      if (others.length === 0) return;
      const existing = Object.keys(convos).find((k) =>
        sameMembers(convos[k].members, others)
      );
      if (existing) {
        openConversation(existing);
        return;
      }

      const key = pendingKey(others);
      const nm = (name ?? "").trim();
      setPendingConvos((prev) => ({
        ...prev,
        [key]: { members: others, name: nm || undefined },
      }));
      setActiveId(key);
      setMode("thread");

      const job = (async () => {
        try {
          const c = await api<ServerConvo>("/messages", {
            method: "POST",
            body: JSON.stringify({ members: others, name: nm || undefined }),
          });
          absorbConvo(c);
          setPendingConvos((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          setPendingMsgs((prev) => {
            if (!prev[key]) return prev;
            const next = { ...prev, [c.id]: [...(prev[c.id] ?? []), ...prev[key]] };
            delete next[key];
            return next;
          });
          setActiveId((cur) => (cur === key ? c.id : cur));
          setError(null);
          return c.id;
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) return null;
          setError(
            err instanceof ApiError ? err.message : "Could not start the conversation."
          );
          setPendingConvos((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          setPendingMsgs((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          setActiveId((cur) => (cur === key ? null : cur));
          setMode((m) => (m === "thread" ? "list" : m));
          return null;
        } finally {
          creating.current.delete(key);
        }
      })();
      creating.current.set(key, job);
    },
    [convos, me, openConversation, absorbConvo]
  );

  const send = useCallback(
    (text: string) => {
      const body = text.trim();
      if (!body || !activeId) return;
      const key = activeId;
      const temp = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const created = new Date().toISOString();
      setPendingMsgs((prev) => ({
        ...prev,
        [key]: [...(prev[key] ?? []), { id: temp, text: body, created }],
      }));

      void (async () => {
        /* A message typed into a conversation the server has not yet named
           waits for the name; the pending row it sits under is moved to the
           real id by openWith's own reconcile. */
        let id: string | null = key;
        if (key.startsWith(PENDING)) {
          id = (await creating.current.get(key)) ?? null;
        }
        const dropTemp = (from: string) =>
          setPendingMsgs((prev) => {
            if (!prev[from]) return prev;
            const rest = prev[from].filter((m) => m.id !== temp);
            const next = { ...prev };
            if (rest.length) next[from] = rest;
            else delete next[from];
            return next;
          });
        if (!id) {
          dropTemp(key);
          return;
        }
        try {
          const m = await api<ServerMsg>(`/messages/${id}/send`, {
            method: "POST",
            body: JSON.stringify({ text: body }),
          });
          setServer((prev) => {
            const c = prev[id];
            if (!c || c.msgs.some((x) => x.id === m.id)) return prev;
            return {
              ...prev,
              [id]: { ...c, updated: m.created, msgs: [...c.msgs, m] },
            };
          });
          dropTemp(id);
          setError(null);
        } catch (err) {
          dropTemp(id);
          if (err instanceof ApiError && err.status === 401) return;
          setError(
            err instanceof ApiError ? err.message : "Could not send the message."
          );
        }
      })();
    },
    [activeId]
  );

  /* A blank name is not a name — it reverts the group to the members' own. */
  const rename = useCallback(
    (name: string) => {
      if (!activeId || activeId.startsWith(PENDING)) return;
      const id = activeId;
      const nm = name.trim();
      setServer((prev) => {
        const c = prev[id];
        if (!c) return prev;
        return { ...prev, [id]: { ...c, name: nm || undefined } };
      });
      void api<ServerConvo>(`/messages/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: nm }),
      })
        .then(absorbConvo)
        .catch((err) => {
          if (err instanceof ApiError && err.status === 401) return;
          setError(
            err instanceof ApiError ? err.message : "Could not rename the group."
          );
          void refresh();
        });
    },
    [activeId, absorbConvo, refresh]
  );

  const value = useMemo<MessagesValue>(
    () => ({
      mode,
      active,
      conversations,
      roster,
      directory,
      me: meCard,
      loading,
      error,
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
      refresh,
    }),
    [
      mode,
      active,
      conversations,
      roster,
      directory,
      meCard,
      loading,
      error,
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
      refresh,
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
