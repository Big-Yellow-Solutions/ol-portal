// The Optimist's identity mark, inlined from public/ol-mark-white.svg so it can
// take `fill: currentColor` at arbitrary sizes (13-34px per the redesign
// handoff). This is the assistant's face throughout the redesign — panel
// headers, assistant turns, the sent screen, the contributor screen — never
// substitute a generic sparkle or robot icon.

export function RippleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="80 90 470 470" fill="currentColor" className={className} aria-hidden="true">
      <path d="M312.294 210.462C376.495 210.462 428.54 262.507 428.54 326.708C428.54 390.909 376.495 442.954 312.294 442.954C248.093 442.954 196.048 390.909 196.048 326.708C196.048 262.507 248.093 210.462 312.294 210.462Z" />
      <path d="M104.993 431.679C47.4041 317.922 93.5569 177.017 207.359 119.406C255.002 95.2867 309.491 88.3392 361.646 99.6833L359.455 109.756C355.527 127.814 337.655 138.95 319.187 138.27C287.466 137.102 255.77 143.956 227.127 158.456C134.898 205.146 97.3697 319.715 144.043 411.91C190.719 504.111 305.234 541.701 397.458 495.014C479.567 453.447 518.334 358.116 492.912 272.616C487.644 254.902 493.909 234.794 510.397 226.447L519.593 221.791C577.202 335.59 531.026 476.455 417.227 534.065C303.42 591.678 162.579 545.431 104.993 431.679Z" />
    </svg>
  );
}

// The eyebrow glyph, 9-12px, paired with uppercase tracked labels.
export function StarMark({ className }: { className?: string }) {
  return (
    <svg viewBox="326 26 256 256" fill="currentColor" className={className} aria-hidden="true">
      <path d="M453.663 26.2242L456.258 96.9932C457.336 126.411 481.035 149.965 510.458 150.862L581.222 153.031L510.453 155.626C481.035 156.704 457.481 180.403 456.584 209.826L454.415 280.59L451.82 209.821C450.742 180.403 427.043 156.849 397.62 155.952L326.856 153.783L397.625 151.188C427.043 150.11 450.597 126.411 451.494 96.9876L453.663 26.2242Z" />
    </svg>
  );
}

export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-[9px] ${className}`}>
      <StarMark className="size-[11px] text-violet" />
      <span className="font-sans text-[10.5px] font-semibold uppercase tracking-[.18em] text-violet-deep">
        {children}
      </span>
    </div>
  );
}
