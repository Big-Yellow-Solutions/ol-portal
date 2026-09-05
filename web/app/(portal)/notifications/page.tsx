"use client";

/* /notifications — everything in the portal that is addressed at you.
 *
 * The bell's peek answers "is there anything?"; this answers "what, and what
 * do I do about it?". The two read one list (lib/notifications.tsx), so
 * clearing it here empties the badge up there without a reload.
 *
 * Tabs are rendered from what is actually in the list rather than from a
 * fixed set. Messages, comments, likes and events have no server behind them
 * yet — community.mjs says so about its own comments and likes, and the
 * messages drawer is still React state — so those tabs would sit permanently
 * empty and permanently misleading. When those APIs land and start calling
 * notify(), their tab appears here on its own.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StarGlyph } from "@/components/shell/top-nav";
import { CheckIcon } from "@/components/community/icons";
import {
  actorLabel,
  NotificationRow,
  NotificationsEmpty,
} from "@/components/notifications/row";
import {
  NOTIFICATION_TABS,
  notificationDay,
  useNotifications,
  type NotificationDay,
  type NotificationTab,
  type PortalNotification,
} from "@/lib/notifications";
import { usePortalData } from "@/lib/portal-data";
import { cn } from "@/lib/utils";

type Tab = NotificationTab | "all";

const TAB_NAME: Record<Tab, string> = {
  all: "All",
  mentions: "Mentions",
  messages: "Messages",
  community: "Community",
  work: "Work",
};

const DAYS: NotificationDay[] = ["Today", "Yesterday", "Earlier"];

export default function NotificationsPage() {
  const router = useRouter();
  const { items, unread, loadedAt, loading, error, markAllRead, markOneRead, countFor } =
    useNotifications();
  const { people } = usePortalData();
  const [tab, setTab] = useState<Tab>("all");

  /* "All", plus any tab that has something in it. A tab with nothing behind
     it is a promise the portal cannot keep yet. */
  const tabs = useMemo<Tab[]>(
    () => [
      "all",
      ...NOTIFICATION_TABS.filter((t) => items.some((n) => n.tab === t)),
    ],
    [items]
  );

  const shown = items.filter((n) => tab === "all" || n.tab === tab);

  const groups = useMemo(
    () =>
      DAYS.map((label) => ({
        label,
        rows: shown.filter((n) => notificationDay(n.created, loadedAt) === label),
      })).filter((g) => g.rows.length > 0),
    [shown, loadedAt]
  );

  /* The rail is derived, not curated: the unread things that are literally
     blocked on this person signing or approving something. No such rows, no
     rail — the list goes full width rather than holding a column open for an
     empty card. */
  const blocking = items.filter(
    (n) => !n.read && (n.kind === "signature" || n.kind === "approval")
  );

  const open = (n: PortalNotification) => {
    void markOneRead(n.id);
    if (n.href) router.push(n.href);
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-warm-gray uppercase">
            <StarGlyph className="text-violet-deep" />
            Notifications
          </span>
          <h1 className="mt-1.5 mb-0 text-[34px] leading-[1.1] font-bold tracking-[-0.015em]">
            Everything waiting{" "}
            <span className="font-serif font-normal text-violet-deep italic">
              on you
            </span>
          </h1>
        </div>

        {unread > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="flex min-h-11 flex-none cursor-pointer items-center gap-2 rounded-full border border-hair-strong px-3.5 text-[13px] font-semibold text-violet-deep transition-colors hover:bg-violet-pale"
          >
            <CheckIcon size={14} />
            Mark all as read
          </button>
        )}
      </div>

      {tabs.length > 1 && (
        <div className="flex items-center gap-[26px] overflow-x-auto border-b border-hair">
          {tabs.map((t) => {
            const on = tab === t;
            const count = countFor(t);
            return (
              <button
                key={t}
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => setTab(t)}
                className={cn(
                  "-mb-px flex min-h-11 cursor-pointer items-center gap-2 border-b-2 pb-3 text-[15px] whitespace-nowrap transition-colors",
                  on
                    ? "border-violet-deep font-bold text-ink"
                    : "border-transparent font-medium text-warm-gray hover:text-ink"
                )}
              >
                {TAB_NAME[t]}
                {count > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      on
                        ? "bg-violet-pale text-violet-deep"
                        : "bg-[rgba(124,109,245,0.10)] text-warm-gray"
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div
        className={cn(
          "grid items-start gap-[26px]",
          blocking.length > 0 && "lg:grid-cols-[minmax(0,1fr)_340px]"
        )}
      >
        <main className="flex min-w-0 flex-col gap-[26px]">
          {loading && items.length === 0 && (
            <p className="text-sm text-ink-mute">Loading…</p>
          )}

          {error && (
            <div className="rounded-[16px] border border-hair bg-white p-6 text-sm text-ink-soft shadow-card">
              {error}
            </div>
          )}

          {!loading && !error && groups.length === 0 && (
            <NotificationsEmpty
              line={
                tab === "all"
                  ? "Nothing has been addressed at you yet."
                  : "You are caught up on this one."
              }
            />
          )}

          {groups.map((g) => (
            <section key={g.label} className="flex flex-col gap-2.5">
              <span className="text-[11px] font-semibold tracking-[0.14em] text-warm-gray uppercase">
                {g.label}
              </span>
              <div className="overflow-hidden rounded-[16px] border border-hair bg-white shadow-card [&>button+button]:border-t [&>button+button]:border-hair-soft">
                {g.rows.map((n) => (
                  <NotificationRow key={n.id} n={n} now={loadedAt} onOpen={open} />
                ))}
              </div>
            </section>
          ))}
        </main>

        {blocking.length > 0 && (
          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24">
            <section className="rounded-[16px] border border-hair bg-white p-5 shadow-card">
              <h2 className="m-0 text-base font-bold tracking-[-0.01em]">
                Blocked on you
              </h2>
              <p className="mt-1.5 text-[13px] leading-[1.5] text-pretty text-warm-gray">
                Nothing else moves until these are signed or approved.
              </p>
              <div className="mt-3 flex flex-col gap-0.5">
                {blocking.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => open(n)}
                    className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-wash"
                  >
                    <span
                      aria-hidden="true"
                      className="size-[7px] flex-none rounded-full bg-amber"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      {/* The verb is the tail of a sentence, so it needs its
                          subject or it reads as truncated prose. Wrapped to
                          two lines rather than clipped: which contract is
                          usually the last few words. */}
                      <span className="line-clamp-2 text-[13px] leading-[1.4] font-semibold text-pretty text-ink">
                        {actorLabel(n, people)} {n.verb}
                      </span>
                      {n.meta && (
                        <span className="text-xs text-warm-gray">{n.meta}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </aside>
        )}
      </div>
    </>
  );
}
