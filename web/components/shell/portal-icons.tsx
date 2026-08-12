// Sidebar icon set for The Portal, per the "Sidebar icons redesigned for
// clarity" handoff. Drawn as a set so no two nav items share a silhouette at
// 24px — before this, Proposals/Files/Contracts were all a page-with-lines and
// Pipeline's kanban columns read as a second Dashboard grid.
//
// Shared spec: 24x24 viewBox, no fill, currentColor stroke at 1.7, round caps
// and joins. Icons are decorative — the adjacent nav label is the accessible
// name — so every one is aria-hidden.

type IconProps = React.SVGProps<SVGSVGElement>;

function Base(props: IconProps) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

// Blocks are deliberately unequal (6/9/8/5) so this reads as a dashboard
// layout rather than a generic 2x2 grid.
export function DashboardIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="3" width="7" height="6" rx="1.5" />
      <rect x="14" y="3" width="7" height="9" rx="1.5" />
      <rect x="3" y="13" width="7" height="8" rx="1.5" />
      <rect x="14" y="16" width="7" height="5" rx="1.5" />
    </Base>
  );
}

export function PipelineIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 4.5h18l-6.6 7.6v7l-4.8 2.4v-9.4z" />
    </Base>
  );
}

export function ProposalsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M21 3 2.8 10.4l7.3 2.9 2.9 7.3z" />
      <path d="M21 3 10.1 13.3" />
    </Base>
  );
}

export function OptimistIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 2.6l2.1 5.1 5.3.6-4 3.6 1.2 5.2-4.6-2.8-4.6 2.8 1.2-5.2-4-3.6 5.3-.6z" />
      <path d="M19 18.5v4M17 20.5h4" />
    </Base>
  );
}

export function InvoiceRequestsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 2.6v18.8l2.3-1.5 2.4 1.5 2.3-1.5 2.4 1.5 2.3-1.5 2.3 1.5V2.6l-2.3 1.5-2.3-1.5-2.4 1.5-2.3-1.5-2.4 1.5z" />
      <path d="M14 8.6h-3.4a1.7 1.7 0 0 0 0 3.4h2.8a1.7 1.7 0 0 1 0 3.4H10M12 7.2v9.6" />
    </Base>
  );
}

export function FilesIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M2.8 19.4V5.2A1.4 1.4 0 0 1 4.2 3.8h4.4l2.1 2.6h9.1a1.4 1.4 0 0 1 1.4 1.4v11.6a1.4 1.4 0 0 1-1.4 1.4H4.2a1.4 1.4 0 0 1-1.4-1.4z" />
    </Base>
  );
}

export function BenchDirectoryIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="9" cy="7.6" r="3.3" />
      <path d="M2.6 20.4c0-3.5 2.9-5.8 6.4-5.8s6.4 2.3 6.4 5.8" />
      <path d="M16.4 5.2a3.3 3.3 0 0 1 .3 6.4M18.2 14.9c2.1.6 3.6 2.3 3.6 4.6" />
    </Base>
  );
}

// The signature stroke carries the meaning on its own if the pen is missed.
export function ContractsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4.6 21.2V4.4a1.6 1.6 0 0 1 1.6-1.6h7.1l4.5 4.5v5" />
      <path d="M13 2.8v4.6h4.6" />
      <path d="M7.8 17.6c1.4-1.6 2.6.9 4 -.6" />
      <path d="M21.4 13.4 15.9 19l-2.6.7.6-2.6 5.5-5.6z" />
    </Base>
  );
}

export function AdminIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="9.2" cy="9.4" r="4.2" />
      <path d="M12.4 12.3 20.6 20.4M17.4 15.6l-2.2 2.2M19.4 17.6l-2.2 2.2" />
    </Base>
  );
}

// The three below are not in the handoff — Deal Flow, Templates and Sign out
// weren't in the design's screenshot. Drawn to the same spec rather than left
// as library icons, per the handoff's note that a tenth icon pulled from a
// library stops the set reading as a set.

// Two sources converging on one board: where every deal sits across all labs.
// Kept off the funnel so it doesn't collide with Pipeline.
export function DealFlowIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="5" cy="5.6" r="2.4" />
      <circle cx="5" cy="18.4" r="2.4" />
      <circle cx="19" cy="12" r="2.4" />
      <path d="M7.4 5.6h5.2a2 2 0 0 1 2 2v2.4a2 2 0 0 0 2 2" />
      <path d="M7.4 18.4h5.2a2 2 0 0 0 2-2v-2.4a2 2 0 0 1 2-2" />
    </Base>
  );
}

// Sheet behind sheet — the reusable-copy mark. Offset rather than tiled so it
// doesn't collide with the Dashboard grid.
export function TemplatesIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8.4 8.4V5.2a2 2 0 0 1 2-2h8.4a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2h-3.2" />
      <rect x="3.2" y="8.4" width="12.4" height="12.4" rx="2" />
    </Base>
  );
}

export function SignOutIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14.6 3.4h4.2a2 2 0 0 1 2 2v13.2a2 2 0 0 1-2 2h-4.2" />
      <path d="M9.8 7.8 14 12l-4.2 4.2" />
      <path d="M14 12H3.2" />
    </Base>
  );
}
