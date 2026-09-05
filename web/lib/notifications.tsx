"use client";

/* Notifications · the client half of backend/src/notifications.mjs.
 *
 * Two surfaces read the same list — the bell in the top nav and the
 * /notifications page — so it is held once, here, rather than fetched twice.
 * That is also what makes "mark all as read" in the page's header empty the
 * badge in the nav without a reload: they are the same array.
 *
 * Nothing here derives notifications from other portal data. An earlier shape
 * of this did (scan the feed for @you, scan contracts for unsigned paper), and
 * it could not answer the only question that matters — have I already seen
 * this? — because there was nothing to write "seen" onto. The server keeps a
 * row per person per event; this reads it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, ApiError } from "@/lib/api";

export const NOTIFICATION_TABS = [
  "mentions",
  "messages",
  "community",
  "work",
] as const;
export type NotificationTab = (typeof NOTIFICATION_TABS)[number];

/* Mirrors the record notifications.mjs returns. `kind` is finer-grained than
   `tab` (a mention and a comment are both "community" work to the page, but
   only one of them wears the Mention chip), and the server owns both — the
   browser never re-derives the tab from the kind. */
export interface PortalNotification {
  id: string;
  kind: string;
  tab: NotificationTab;
  actor?: string;
  actorName?: string;
  verb: string;
  snippet?: string;
  meta?: string;
  href?: string;
  read: boolean;
  created: string;
}

interface NotificationsValue {
  items: PortalNotification[];
  unread: number;
  /* When the list on screen was fetched. Rows measure their age against this
     rather than against a clock read at render, so every "3h" in the list
     agrees with every other one and none of them drift while a tab sits
     open. Same device community/page.tsx uses for the feed. */
  loadedAt: Date;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markOneRead: (id: string) => Promise<void>;
  countFor: (tab: NotificationTab | "all") => number;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

/* How often to look again while the tab is open. A minute is slow enough to
   be invisible on the API's bill and fast enough that someone waiting on a
   countersignature sees it land without reloading. The window-focus listener
   is what actually carries most of it: the common case is coming back to a
   tab that has been open since this morning. */
const POLL_MS = 60_000;

export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [items, setItems] = useState<PortalNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loadedAt, setLoadedAt] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* A poll that lands while a mark-read request is in flight would put the
     pre-read list back on screen for a second. This drops any response that
     started before the most recent local change. */
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const data = await api<{
        items: PortalNotification[];
        unread: number;
      }>("/notifications");
      if (mine !== generation.current) return;
      setItems(data.items ?? []);
      setUnread(data.unread ?? 0);
      setLoadedAt(new Date());
      setError(null);
    } catch (err) {
      if (mine !== generation.current) return;
      /* A 401 has already ended the session and navigated; saying so on the
         way out would flash an error over the sign-in redirect. */
      if (err instanceof ApiError && err.status === 401) return;
      setError(
        err instanceof ApiError ? err.message : "Could not load notifications."
      );
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    /* The API is the external system this effect exists to reach, and the
       state it sets is that system's answer — the case the rule's own docs
       carve out. eslint cannot see through the promise to tell the two
       apart, so it is silenced here rather than at the config. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  /* Both mark paths write locally first and reconcile from the response. The
     server returns the authoritative unread count, so a row someone else's
     session already read cannot leave the badge stuck one above zero. */
  const markAllRead = useCallback(async () => {
    generation.current++;
    setItems((xs) => xs.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      const out = await api<{ unread: number }>("/notifications/read", {
        method: "POST",
        body: JSON.stringify({ all: true }),
      });
      setUnread(out.unread ?? 0);
    } catch {
      // Put the truth back rather than leaving a badge that lies.
      await refresh();
    }
  }, [refresh]);

  const markOneRead = useCallback(
    async (id: string) => {
      const already = items.find((n) => n.id === id)?.read;
      if (already) return;
      generation.current++;
      setItems((xs) => xs.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnread((n) => Math.max(0, n - 1));
      try {
        const out = await api<{ unread: number }>("/notifications/read", {
          method: "POST",
          body: JSON.stringify({ ids: [id] }),
        });
        setUnread(out.unread ?? 0);
      } catch {
        await refresh();
      }
    },
    [items, refresh]
  );

  /* Tab chips show UNREAD, not totals: a total tells you nothing you did not
     already know, and the chip is meant to disappear once a tab is clear. */
  const countFor = useCallback(
    (tab: NotificationTab | "all") =>
      items.filter((n) => !n.read && (tab === "all" || n.tab === tab)).length,
    [items]
  );

  const value = useMemo<NotificationsValue>(
    () => ({
      items,
      unread,
      loadedAt,
      loading,
      error,
      refresh,
      markAllRead,
      markOneRead,
      countFor,
    }),
    [items, unread, loadedAt, loading, error, refresh, markAllRead, markOneRead, countFor]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx)
    throw new Error("useNotifications must be used inside NotificationsProvider");
  return ctx;
}

/* ---------- presentation helpers ---------- */

/* "22m", "3h", "Tue", "4 Mar". Deliberately not a live clock: the whole list
   is stamped against one `now` by the caller, so every row on screen agrees
   about what "3h" means even if the tab has been open for an hour. */
export function notificationAge(created: string, now: Date): string {
  const then = new Date(created);
  const ms = now.getTime() - then.getTime();
  if (!Number.isFinite(ms)) return "";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return then.toLocaleDateString([], { weekday: "short" });
  return then.toLocaleDateString([], { day: "numeric", month: "short" });
}

/* Today / Yesterday / Earlier — the three headings the list groups under.
   Anything older than yesterday shares one bucket rather than sprouting a
   heading per day: past a certain point "when" stops being the useful
   grouping and "still unread" takes over. */
export type NotificationDay = "Today" | "Yesterday" | "Earlier";

export function notificationDay(created: string, now: Date): NotificationDay {
  const then = new Date(created);
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (then >= midnight) return "Today";
  const yesterday = new Date(midnight);
  yesterday.setDate(yesterday.getDate() - 1);
  if (then >= yesterday) return "Yesterday";
  return "Earlier";
}

/* The chip on a row. `kind` is the server's vocabulary; this is the one place
   it becomes a word a reader sees, so a new kind that lands here unmapped
   shows its own name rather than nothing. */
const CHIP: Record<string, string> = {
  mention: "Mention",
  comment: "Reply",
  post: "Post",
  event: "Event",
  join: "Bench",
  message: "Direct",
  signature: "Signature",
  executed: "Executed",
  assignment: "Assignment",
  approval: "Approval",
  proposal: "Proposal",
  invoice: "Invoice",
};

export const notificationChip = (kind: string) => CHIP[kind] ?? kind;

/* One verb per row, never two. Which one depends on what the row is about,
   not on how it was delivered. */
const ACTION: Record<string, string> = {
  mention: "Reply",
  comment: "Reply",
  message: "Reply",
  event: "RSVP",
  signature: "Review",
  executed: "Open",
  assignment: "Open",
  approval: "Review",
};

export const notificationAction = (kind: string) => ACTION[kind] ?? "Open";

/* Three tones, and they mean something: amber is the only one that says
   "this is blocked on you", green is an outcome that landed, violet is
   everything else. */
export type NotificationTone = "violet" | "amber" | "green";

export function notificationTone(kind: string): NotificationTone {
  if (kind === "signature" || kind === "approval") return "amber";
  if (kind === "executed") return "green";
  return "violet";
}
