"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";

/* Animated state icons, from 21st.dev's "Animated State Icons" set
   (@dev.yadhakim). Two things changed on the way in, and both matter:

   1. The source drives every icon from its own setInterval so the catalog
      preview loops forever. That is a demo device, not a UI: a heart that
      fills itself on a timer says a post is liked when it isn't. Every icon
      here is controlled — it animates because app state changed, and it is
      the same state the surrounding component already tracked.

   2. The source draws on a 40x40 grid at stroke 2-2.5 and hard-codes #EF4444.
      The portal's icons are 24x24 at 1.9-2.4 taking their color from
      currentColor (see components/community/icons.tsx). These are redrawn on
      that grid, on the portal's own path data, so an animated icon sits next
      to a still one in the same row without looking imported.

   Motion is the only thing new here; the silhouettes are unchanged. Every
   icon honours prefers-reduced-motion — the state still reads, it just
   arrives without travel. All are decorative: the control that holds them
   owns the accessible name. */

type IconProps = { size?: number; className?: string };

/* Variants live at module scope so their object identity is stable. Inline
   objects would hand framer a new target on every parent render, and a
   keyframe array restarts when its target changes — the heart would re-pop
   every time the feed re-rendered. */

const HEART = {
  off: { fillOpacity: 0, scale: 1 },
  on: { fillOpacity: 1, scale: [1, 1.28, 1] },
  offStill: { fillOpacity: 0, scale: 1 },
  onStill: { fillOpacity: 1, scale: 1 },
};

/* The like toggle. Fill and stroke are both currentColor, as the design's
   note on the still version requires ("swaps fill while keeping the stroke
   violet either way") — so the pill's own color still owns this icon. The
   fill is animated as opacity rather than swapping fill="none", which is not
   an interpolable value. */
export function AnimatedHeartIcon({
  filled = false,
  size = 15,
  className,
}: IconProps & { filled?: boolean }) {
  const still = useReducedMotion();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <motion.path
        d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1z"
        fill="currentColor"
        variants={HEART}
        /* initial={false} so a feed that loads with posts already liked
           doesn't pop every heart on mount. */
        initial={false}
        animate={still ? (filled ? "onStill" : "offStill") : filled ? "on" : "off"}
        transition={{ duration: still ? 0.15 : 0.4, ease: [0.32, 0.72, 0, 1] }}
      />
    </svg>
  );
}

/* Copy -> Copied. Replaces a hard swap between two separate icons: the
   clipboard's fill lines leave and the tick draws itself in over the same
   frame, so the two states read as one control changing rather than two
   icons trading places. */
export function AnimatedCopiedIcon({
  copied = false,
  size = 12,
  className,
}: IconProps & { copied?: boolean }) {
  const still = useReducedMotion();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* Both states stay mounted and cross-fade in place. An AnimatePresence
          swap was the first shape of this and it stalled: the tick entered
          mid-exit and stopped at a fifth of its length, leaving a clipped
          check on screen for as long as "Copied" showed. Nothing here waits
          on anything else, so there is no interrupted handoff to stall. */}
      <motion.path
        d="M5 15V5a2 2 0 0 1 2-2h10"
        initial={false}
        animate={{ opacity: copied ? 0.35 : 1 }}
        transition={{ duration: still ? 0.12 : 0.24 }}
      />
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <motion.g
        initial={false}
        animate={{ opacity: copied ? 0 : 0.45 }}
        transition={{ duration: still ? 0.12 : 0.18 }}
      >
        <path d="M12 13.2h6" />
        <path d="M12 17.2h3.6" />
      </motion.g>
      <motion.path
        d="m11.6 15.2 2.4 2.4 4.6-5"
        strokeWidth={2.2}
        initial={false}
        animate={{ pathLength: copied ? 1 : 0, opacity: copied ? 1 : 0 }}
        transition={{ duration: still ? 0.12 : 0.3, ease: [0.32, 0.72, 0, 1] }}
      />
    </svg>
  );
}

const SEND = {
  idle: { y: 0, opacity: 1 },
  /* One shot: the arrow leaves the top of the button, then returns dimmed and
     sits there for as long as the turn is still running. The button is
     disabled while busy, so the dimmed arrow is the honest resting state —
     an exit with nothing behind it would leave an empty circle. */
  sending: { y: [0, -16, 0], opacity: [1, 0, 0.5] },
  idleStill: { y: 0, opacity: 1 },
  sendingStill: { y: 0, opacity: 0.5 },
};

/* The composer's send arrow, driven by the Optimist's existing `busy`. */
export function AnimatedSendIcon({
  sending = false,
  size = 17,
  className,
}: IconProps & { sending?: boolean }) {
  const still = useReducedMotion();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <motion.g
        variants={SEND}
        initial={false}
        animate={
          still
            ? sending
              ? "sendingStill"
              : "idleStill"
            : sending
              ? "sending"
              : "idle"
        }
        transition={{ duration: still ? 0.15 : 0.55, ease: [0.32, 0.72, 0, 1] }}
      >
        <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
      </motion.g>
    </svg>
  );
}

/* The selection tick. Always rendered now rather than mounted on select, so
   the stroke can draw itself on and unwind on deselect. Off, it is a
   zero-length path — nothing is painted either way. */
export function AnimatedCheckIcon({
  on = false,
  size = 11,
  width = 3.4,
  className,
}: IconProps & { on?: boolean; width?: number }) {
  const still = useReducedMotion();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <motion.path
        d="M4 12.5 9.5 18 20 6.5"
        initial={false}
        animate={
          still
            ? { opacity: on ? 1 : 0, pathLength: on ? 1 : 0 }
            : { pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }
        }
        transition={{ duration: still ? 0.1 : 0.25, ease: [0.32, 0.72, 0, 1] }}
      />
    </svg>
  );
}

/* ---------- the notification bell ----------

   From AnimateIcons / Hugeicons — "notification" by Avijit Dey (@avijit07x),
   MIT, https://github.com/Avijit07x/animateicons. Adapted on the way in the
   same way the icons above were:

   1. The source ships its own LazyMotion, forwardRef handle, hover handlers
      and useAnimation controls so it can animate itself in a catalog page.
      None of that survives here: variants live at module scope like every
      other icon in this file, and the surrounding control drives them by
      declaring `whileHover="animate"` on a motion parent — framer propagates
      the variant name down. One less imperative controller, and the shake
      fires from anywhere on the 36px button rather than only from the 19px
      glyph.
   2. The source imports from "motion/react"; the portal is on framer-motion,
      which is the same API under its older name.

   The silhouette and the timing are the author's, unchanged: eight rotate
   stops over 1.3s on the same `times` curve, with the clapper trailing the
   body by 0.08s. */

const BELL: Variants = {
  normal: { rotate: 0 },
  animate: {
    rotate: [0, 7, -18, 14, -9, 5, -2, 0],
    transition: {
      duration: 1.3,
      ease: "easeInOut",
      times: [0, 0.09, 0.26, 0.45, 0.62, 0.78, 0.9, 1],
    },
  },
};

const BELL_CLAPPER: Variants = {
  normal: { x: 0 },
  animate: {
    x: [0, 1.5, -5, 4, -2.5, 1.5, -1, 0],
    transition: {
      duration: 1.3,
      ease: "easeInOut",
      times: [0, 0.09, 0.26, 0.45, 0.62, 0.78, 0.9, 1],
      delay: 0.08,
    },
  },
};

/* Decorative, like the rest of this file: the button that holds it owns the
   accessible name, and that name carries the unread count.

   Under prefers-reduced-motion the variants are simply not attached, so the
   parent's whileHover finds nothing to propagate to and the bell holds still
   — the same "the state still reads, it just arrives without travel" rule the
   other icons here follow. */
export function AnimatedBellIcon({ size = 19, className }: IconProps) {
  const still = useReducedMotion();
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      variants={still ? undefined : BELL}
      style={{ originX: 0.5, originY: 0.12 }}
    >
      <motion.path
        d="M15.5 18C15.5 19.933 13.933 21.5 12 21.5C10.067 21.5 8.5 19.933 8.5 18"
        variants={still ? undefined : BELL_CLAPPER}
      />
      <path d="M19.2311 18H4.76887C3.79195 18 3 17.208 3 16.2311C3 15.762 3.18636 15.3121 3.51809 14.9803L4.12132 14.3771C4.68393 13.8145 5 13.0514 5 12.2558V9.5C5 5.63401 8.13401 2.5 12 2.5C15.866 2.5 19 5.634 19 9.5V12.2558C19 13.0514 19.3161 13.8145 19.8787 14.3771L20.4819 14.9803C20.8136 15.3121 21 15.762 21 16.2311C21 17.208 20.208 18 19.2311 18Z" />
    </motion.svg>
  );
}
