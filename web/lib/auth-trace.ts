import { currentPath } from "@/lib/return-to";

/* A structured trace of the session's life, for working out why someone was
   signed out or bounced through AuthKit.

   The events that matter happen right before a full page navigation, which
   wipes the console, so they are also kept in localStorage and survive it:
   read them afterwards with

     localStorage.getItem("olportal.authLog")

   Events carry paths, statuses and error names — never a token, a code or a
   cookie. The console copy is as it was: on in development, and in a
   production build only when localStorage["olportal.authTrace"] is "1". */

const LOG_KEY = "olportal.authLog";
const LOG_CAP = 60;

export function trace(event: string, detail: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const entry = {
    t: new Date().toISOString(),
    event,
    path: currentPath(),
    hidden: document.hidden,
    ...detail,
  };

  try {
    const prior: unknown = JSON.parse(
      window.localStorage.getItem(LOG_KEY) ?? "[]"
    );
    const log = Array.isArray(prior) ? prior : [];
    log.push(entry);
    window.localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-LOG_CAP)));
  } catch {
    // Storage blocked or full: tracing must never break the session.
  }

  if (process.env.NODE_ENV === "production") {
    try {
      if (window.localStorage.getItem("olportal.authTrace") !== "1") return;
    } catch {
      return;
    }
  }
  console.debug("[auth]", JSON.stringify(entry));
}
