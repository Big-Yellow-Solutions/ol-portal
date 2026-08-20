"use client";

import { cn } from "@/lib/utils";

/* Shared surfaces and controls for Community. Radii are written as explicit
   pixel values because the design system's scale (12 / 16 / 20px) does not
   line up with the shadcn --radius ramp the rest of the app inherits, and
   rounding them to the nearest Tailwind step visibly changes the cards. */

/* `ref` is dropped from the prop type deliberately: the tag is a union, so a
   single ref type cannot describe all three elements, and nothing needs one. */
type PanelProps = Omit<React.ComponentProps<"div">, "ref"> & {
  as?: "section" | "article" | "div";
};

export function Panel({ as: Tag = "section", className, ...props }: PanelProps) {
  return (
    <Tag
      className={cn(
        "rounded-[16px] border border-hair bg-white shadow-card",
        className
      )}
      {...props}
    />
  );
}

/* The like and RSVP controls share one shape: a pill that reads as chosen by
   filling violet-pale and hardening its border, never by changing size. */
export function TogglePill({
  on = false,
  className,
  ...props
}: React.ComponentProps<"button"> & { on?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn(
        "flex cursor-pointer items-center gap-[7px] rounded-full border px-[13px] py-[7px] text-[13px] font-semibold text-violet-deep transition-colors",
        on
          ? "border-violet-deep bg-violet-pale"
          : "border-hair-strong bg-transparent hover:bg-violet-pale",
        className
      )}
      {...props}
    />
  );
}

/* Initials bubble. `tone` picks the two treatments the design uses: solid
   violet for the signed-in person, violet-pale for everyone else. */
export function Initials({
  children,
  size = 36,
  tone = "pale",
  className,
}: {
  children: React.ReactNode;
  size?: number;
  tone?: "solid" | "pale" | "paper";
  className?: string;
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "flex flex-none items-center justify-center rounded-full font-semibold",
        size >= 36 ? "text-[13px]" : "text-[11px]",
        tone === "solid" && "bg-violet-deep text-white",
        tone === "pale" && "bg-violet-pale text-violet-deep",
        tone === "paper" && "border border-hair-strong bg-paper text-violet-deep",
        className
      )}
    >
      {children}
    </span>
  );
}

/* Presence is a dot on the avatar rather than a separate row, so it costs no
   vertical space in a dense feed. Organisation accounts have no presence, so
   the caller omits `online` entirely to hide the dot. */
export function AvatarWithPresence({
  initials,
  who,
  online,
  size = 36,
  tone = "pale",
}: {
  initials: string;
  who: string;
  online?: boolean;
  size?: number;
  tone?: "solid" | "pale" | "paper";
}) {
  const first = who.split(" ")[0];
  return (
    <span className="relative flex flex-none">
      <Initials size={size} tone={tone}>
        {initials}
      </Initials>
      {online !== undefined && (
        <span
          title={online ? `${first} is online` : `${first} is away`}
          className={cn(
            "absolute -right-px -bottom-px size-[11px] rounded-full border-2 border-white",
            online ? "bg-violet-deep" : "bg-presence-away"
          )}
        />
      )}
    </span>
  );
}

/* Every text control in the artboard shares one focus treatment: the border
   goes solid violet and a soft violet halo appears. Kept here so the composer,
   the lab select and the comment box cannot drift apart. */
export const FIELD =
  "border border-hair-strong bg-white text-ink outline-none transition-shadow focus:border-violet-deep focus:shadow-[0_0_0_3px_rgba(124,109,245,0.18)]";

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold tracking-[0.16em] text-violet-deep uppercase">
      {children}
    </span>
  );
}

/* The uppercase meta line under a heading, and the kind chip on a post. */
export function KindChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex-none rounded-full bg-violet-pale px-3 py-[5px] text-[10px] font-semibold tracking-[0.12em] text-violet-deep uppercase">
      {children}
    </span>
  );
}
