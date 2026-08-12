import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

// A media query is external state, so subscribe to it rather than mirroring it
// into an effect. The shadcn generator ships the useState/useEffect version,
// which trips react-hooks/set-state-in-effect and renders one frame at the
// wrong breakpoint before correcting itself.
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    // The server has no viewport; assume desktop so the sidebar renders as the
    // rail rather than flashing the mobile sheet during hydration.
    () => false
  )
}
