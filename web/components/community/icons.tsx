/* The Community artboard draws every icon inline as a stroke SVG rather than
   pulling from a library — the design system's iconography rule. These are
   those exact paths, at the sizes the design uses. All are decorative; the
   adjacent label is the accessible name. */

type IconProps = { size?: number; className?: string };

function Stroke({
  size = 15,
  className,
  width = 2,
  round = true,
  children,
}: IconProps & {
  width?: number;
  round?: boolean;
  children: React.ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin={round ? "round" : undefined}
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

/* Filled when the signed-in person has liked the post, hollow otherwise —
   the design swaps `fill` while keeping the stroke violet either way. */
export function HeartIcon({
  size = 15,
  filled = false,
  className,
}: IconProps & { filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1z" />
    </svg>
  );
}

export function CommentIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.2-.5L3 21l1.6-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
    </Stroke>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M12 17v5" />
      <path d="M9 10.8V3h6v7.8a4 4 0 0 0 1.2 2.9l.8.8v2.5H7v-2.5l.8-.8A4 4 0 0 0 9 10.8z" />
    </Stroke>
  );
}

export function ColumnsIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <rect x="3" y="4" width="7" height="16" />
      <rect x="14" y="4" width="7" height="16" />
    </Stroke>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Stroke {...props} width={2.4} round={false}>
      <path d="M12 5v14M5 12h14" />
    </Stroke>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Stroke {...props} round={false}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </Stroke>
  );
}

export function PlaceIcon(props: IconProps) {
  return (
    <Stroke {...props} round={false}>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.6" />
    </Stroke>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Stroke {...props} size={props.size ?? 18} round={false}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Stroke>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Stroke {...props} width={2.1}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Stroke>
  );
}

/* Added by the Directory + Messages handoff, which draws its icons the same
   way. Kept here so the portal has one inline-icon set rather than a second
   copy of the same paths under components/messages. */

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Stroke {...props} width={2.2}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </Stroke>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Stroke {...props} round={false}>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5 21 21" />
    </Stroke>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </Stroke>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Stroke {...props} width={1.9}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Stroke>
  );
}

export function CheckIcon({ width = 2.4, ...props }: IconProps & { width?: number }) {
  return (
    <Stroke {...props} width={width}>
      <path d="M4 12.5 9.5 18 20 6.5" />
    </Stroke>
  );
}
