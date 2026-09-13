/* Where to send someone after a detour, and how to say it safely.

   Three detours carry a `returnTo`: the sign-in page (/login?returnTo=),
   the emailed-code page (/verify?returnTo=), and the OAuth `state` that
   rides through AuthKit's hosted sign-in. All three arrive through a URL,
   so all three are attacker-controlled: an absolute URL elsewhere, a
   `javascript:` URI, a protocol-relative `//evil.com`. Anything that does
   not resolve to a path on this origin falls back to the portal root.

   No imports on purpose — this is the one piece of the auth flow that a
   plain `node --test` can exercise without a DOM (tests/return-to.test.ts). */

/** Pages that only exist to send people elsewhere. Returning "to" one of
 *  them would loop, so they resolve to the root instead. /verify is not on
 *  the list: it carries its own returnTo and is a fine place to come back
 *  to after sign-in — the verify page guards itself (lib/verify.ts). */
const LOOPS = ["/login", "/callback"];

function loops(path: string) {
  return LOOPS.some(
    (p) => path === p || path.startsWith(`${p}?`) || path.startsWith(`${p}/`)
  );
}

function here() {
  return typeof window === "undefined" ? "" : window.location.origin;
}

/** Resolve a `returnTo` value to a path on `origin`, or "/". */
export function safeReturnTo(
  raw: string | null | undefined,
  origin: string = here()
): string {
  if (!raw) return "/";
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return "/";
  }
  if (url.origin !== origin) return "/";
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Belt and braces: a lone "/" prefix is a path, "//" is another origin.
  if (!path.startsWith("/") || path.startsWith("//")) return "/";
  return loops(path) ? "/" : path;
}

/** The sign-in page, carrying where to go afterwards. A root destination is
 *  the default anyway, so it stays off the URL. */
export function loginPath(returnTo: string, origin: string = here()) {
  const to = safeReturnTo(returnTo, origin);
  return to === "/" ? "/login" : `/login?returnTo=${encodeURIComponent(to)}`;
}

/** The emailed-code page, carrying where to go afterwards. */
export function verifyPath(returnTo: string) {
  return `/verify?returnTo=${encodeURIComponent(returnTo)}`;
}

/** The page the user is on right now, as a `returnTo`: path plus query, the
 *  parts of a page that survive a document load. Nothing else about it does. */
export function currentPath() {
  const { pathname, search } = window.location;
  return `${pathname}${search}`;
}
