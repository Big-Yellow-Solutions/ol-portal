"use client";

/* One notification, in the two densities the design draws it: the page's row
   and the bell peek's shorter one.
 *
 * The whole row is a single <button>. An earlier shape had a clickable <div>
 * with a "Reply →" <button> inside it, which is two bugs wearing one coat:
 * the row was unreachable by keyboard, and clicking the inner control fired
 * the outer handler as well. The verb on the right is a <span> — an
 * affordance, not a second target.
 */

import Image from "next/image";
import {
  notificationAction,
  notificationAge,
  notificationChip,
  notificationTone,
  type NotificationTone,
  type PortalNotification,
} from "@/lib/notifications";
import { usePortalData } from "@/lib/portal-data";
import type { Person } from "@/lib/types";
import { fullName, initials } from "@/lib/data";
import { cn } from "@/lib/utils";

/* The tinted disc a system notification wears instead of a face. Amber is
   reserved for the two kinds that are blocked on you; green for an outcome
   that landed. */
const TONE: Record<NotificationTone, string> = {
  violet: "bg-violet-pale text-violet-deep",
  amber: "bg-amber-pale text-amber",
  green: "bg-green-pale text-green",
};

function Glyph({ kind, size = 18 }: { kind: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "signature" || kind === "executed" || kind === "proposal")
    return (
      <svg {...common}>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M8.5 16.5h7" />
      </svg>
    );
  if (kind === "assignment" || kind === "approval")
    return (
      <svg {...common}>
        <path d="M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
        <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      </svg>
    );
  if (kind === "invoice")
    return (
      <svg {...common}>
        <path d="M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
        <path d="M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6" />
      </svg>
    );
  if (kind === "event")
    return (
      <svg {...common}>
        <path d="M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
        <path d="M8 3v4M16 3v4M3 11h18" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.2-.5L3 21l1.6-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
    </svg>
  );
}

/* Who it came from. A person gets their face or their initials — resolved
   from the live roster so a rename reads as renamed — and anything the system
   did gets the tinted glyph instead. `actorName` is the write-time snapshot,
   used only when the roster no longer has that person. */
function Who({
  n,
  size,
}: {
  n: PortalNotification;
  size: number;
}) {
  const { people } = usePortalData();
  const person = n.actor ? people[n.actor] : undefined;
  const tone = TONE[notificationTone(n.kind)];

  if (!n.actor)
    return (
      <span
        style={{ width: size, height: size }}
        className={cn("flex flex-none items-center justify-center rounded-full", tone)}
      >
        <Glyph kind={n.kind} size={size > 32 ? 18 : 15} />
      </span>
    );

  if (person?.photo)
    return (
      <Image
        src={person.photo}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="flex-none rounded-full object-cover"
      />
    );

  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "flex flex-none items-center justify-center rounded-full font-semibold",
        size >= 36 ? "text-[13px]" : "text-[11px]",
        "bg-violet-pale text-violet-deep"
      )}
    >
      {initials(person) || (n.actorName || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function actorLabel(
  n: PortalNotification,
  people: Record<string, Person>
) {
  const person = n.actor ? people[n.actor] : undefined;
  return fullName(person) || n.actorName || "The portal";
}

export function NotificationRow({
  n,
  now,
  onOpen,
  compact = false,
}: {
  n: PortalNotification;
  now: Date;
  onOpen: (n: PortalNotification) => void;
  compact?: boolean;
}) {
  const { people } = usePortalData();
  const who = actorLabel(n, people);
  const tone = notificationTone(n.kind);

  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      /* min-h-11 is the 44px floor, which matters on the phone where the row
         is the only way to open anything. */
      className={cn(
        "nrow flex w-full min-h-11 cursor-pointer items-start gap-3 text-left transition-shadow",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        compact ? "px-4 py-3" : "py-4 pr-5 pl-4",
        /* Unread is a wash plus the same 7px dot the nav and presence use —
           never a left-border accent bar, which the portal draws nowhere. */
        n.read ? "bg-white" : "bg-wash"
      )}
    >
      <span className="flex w-2 flex-none justify-center pt-3.5">
        {!n.read && (
          <span
            aria-hidden="true"
            className="size-[7px] rounded-full bg-violet-deep"
          />
        )}
      </span>

      <Who n={n} size={compact ? 30 : 36} />

      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span
          className={cn(
            "leading-[1.45] text-pretty",
            compact ? "text-[13px]" : "text-sm",
            n.read ? "text-ink-soft" : "text-ink"
          )}
        >
          <strong className="font-semibold text-ink">{who}</strong> {n.verb}
        </span>

        {n.snippet && !compact && (
          <span className="block rounded-[10px] bg-paper px-3 py-2.5 text-[13px] leading-[1.5] text-pretty text-ink-soft">
            {n.snippet}
          </span>
        )}

        <span className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] uppercase",
              TONE[tone]
            )}
          >
            {notificationChip(n.kind)}
          </span>
          {n.meta && (
            <span className="text-xs text-warm-gray">{n.meta}</span>
          )}
          {compact && (
            <span className="text-[11px] text-warm-gray">
              {notificationAge(n.created, now)}
            </span>
          )}
        </span>
      </span>

      {!compact && (
        <span className="flex flex-none flex-col items-end gap-2 pt-px">
          <span className="text-[11px] whitespace-nowrap text-warm-gray">
            {notificationAge(n.created, now)}
          </span>
          {/* An affordance, not a control: the row is the button. Dropped on a
              phone, where the whole row is the tap target anyway and this
              column was taking width the snippet needed more. */}
          <span
            aria-hidden="true"
            className="hidden text-[13px] font-semibold whitespace-nowrap text-violet-deep sm:block"
          >
            {notificationAction(n.kind)} &rarr;
          </span>
        </span>
      )}
    </button>
  );
}

export function NotificationsEmpty({ line }: { line: string }) {
  return (
    <div className="rounded-[16px] border border-dashed border-hair-strong bg-white p-14 text-center">
      <p className="m-0 text-base font-semibold text-ink">Nothing here.</p>
      <p className="mt-1.5 text-sm text-warm-gray">{line}</p>
    </div>
  );
}
