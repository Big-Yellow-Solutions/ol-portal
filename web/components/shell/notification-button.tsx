"use client";

/* The bell in the top nav.
 *
 * It used to be a <span> with a permanent violet dot and no handler: it said
 * "something happened" forever and there was nowhere to click to find out
 * what. It is a real control now, and it does two things in one gesture —
 * opens a short peek, and offers the page. The peek is deliberately shallow
 * (five rows, no filters, no thread): anything more and the bell becomes a
 * second inbox you have to keep closing, which is exactly what /notifications
 * exists so it does not have to be.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AnimatedBellIcon } from "@/components/ui/animated-state-icons";
import { NotificationRow } from "@/components/notifications/row";
import {
  useNotifications,
  type PortalNotification,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";

/* Past nine the exact number stops changing the decision — you are going to
   open it either way — and a three-digit badge would push the avatar along
   the bar every time someone posts. */
const badgeLabel = (n: number) => (n > 9 ? "9+" : String(n));

const PEEK_ROWS = 5;

export function NotificationButton({ current = false }: { current?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { items, unread, loadedAt, loading, error, markAllRead, markOneRead } =
    useNotifications();

  const peek = items.slice(0, PEEK_ROWS);

  const go = (n: PortalNotification) => {
    setOpen(false);
    void markOneRead(n.id);
    if (n.href) router.push(n.href);
  };

  const seeAll = () => {
    setOpen(false);
    router.push("/notifications");
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger asChild>
        {/* whileHover names the variant; framer propagates it down to the
            bell's own variants, so the shake fires from anywhere on the 36px
            target rather than only from the 19px glyph. */}
        <motion.button
          type="button"
          initial="normal"
          whileHover="animate"
          aria-label={
            unread > 0
              ? `Notifications, ${unread} unread`
              : "Notifications, none unread"
          }
          className={cn(
            "relative flex size-9 flex-none cursor-pointer items-center justify-center rounded-full transition-colors",
            "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            current || open
              ? "bg-violet-pale text-violet-deep"
              : "text-ink hover:text-violet-deep"
          )}
        >
          <AnimatedBellIcon />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-[3px] -right-[5px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-paper bg-violet-deep px-[5px] text-[10px] leading-none font-bold text-white"
            >
              {badgeLabel(unread)}
            </span>
          )}
        </motion.button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={10}
        className="w-[380px] overflow-hidden rounded-[16px] border-hair bg-white p-0 shadow-pop"
      >
        <div className="flex items-baseline justify-between gap-3 border-b border-hair-soft px-4 py-3.5">
          <span className="text-[15px] font-semibold tracking-[-0.01em]">
            Notifications
          </span>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="cursor-pointer text-xs font-semibold text-violet-deep transition-colors hover:text-violet"
            >
              Mark all read
            </button>
          )}
        </div>

        {loading && peek.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-warm-gray">
            Loading…
          </p>
        )}

        {error && (
          <p className="px-4 py-8 text-center text-[13px] text-warm-gray">
            {error}
          </p>
        )}

        {!loading && !error && peek.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-warm-gray">
            Nothing yet. You are all caught up.
          </p>
        )}

        <div className="[&>button+button]:border-t [&>button+button]:border-hair-soft">
          {peek.map((n) => (
            <NotificationRow key={n.id} n={n} now={loadedAt} onOpen={go} compact />
          ))}
        </div>

        <button
          type="button"
          onClick={seeAll}
          className="block w-full cursor-pointer border-t border-hair-soft px-4 py-3.5 text-center text-[13px] font-semibold text-violet-deep transition-colors hover:bg-wash"
        >
          See all notifications &rarr;
        </button>
      </PopoverContent>
    </Popover>
  );
}
