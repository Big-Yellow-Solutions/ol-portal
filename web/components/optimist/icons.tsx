/* The Optimist's icons, traced from the design handoff rather than pulled from
   a library: the handoff ships exact path data at specific stroke weights
   (1.9 to 2.2, round caps), and lucide's equivalents are drawn on a different
   grid. Same approach as components/community/icons.tsx.

   Every icon takes its color from `currentColor`, so the button owns the
   color and its hover state. */

interface IconProps {
  size?: number;
  className?: string;
}

function Icon({
  size,
  className,
  width,
  children,
}: IconProps & { width: number; children: React.ReactNode }) {
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
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function PaperclipIcon({ size = 15, className }: IconProps) {
  return (
    <Icon size={size} width={1.9} className={className}>
      <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.2a3.67 3.67 0 0 1 5.18 5.19l-9.19 9.19a1.83 1.83 0 0 1-2.6-2.6l8.5-8.48" />
    </Icon>
  );
}

export function PlusIcon({ size = 14, className }: IconProps) {
  return (
    <Icon size={size} width={2.1} className={className}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function ArrowUpIcon({ size = 17, className }: IconProps) {
  return (
    <Icon size={size} width={2.2} className={className}>
      <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
    </Icon>
  );
}

export function CopyIcon({ size = 12, className }: IconProps) {
  return (
    <Icon size={size} width={2} className={className}>
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </Icon>
  );
}

export function RetryIcon({ size = 12, className }: IconProps) {
  return (
    <Icon size={size} width={2} className={className}>
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
    </Icon>
  );
}

export function ChatIcon({ size = 12, className }: IconProps) {
  return (
    <Icon size={size} width={2} className={className}>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.2-.5L3 21l1.6-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
    </Icon>
  );
}

export function CheckIcon({ size = 12, className }: IconProps) {
  return (
    <Icon size={size} width={2} className={className}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Icon>
  );
}

/* The quick-start chips each carry one path in the same 24x24 grid, supplied
   as data by lib/optimist.ts so the chip list stays one flat array. */
export function GlyphIcon({ d, size = 13 }: { d: string; size?: number }) {
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
    >
      <path d={d} />
    </svg>
  );
}
