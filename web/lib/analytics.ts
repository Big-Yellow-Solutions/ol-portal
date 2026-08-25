import { api } from "@/lib/api";

/* First-party, zero-dependency event log: POST /events writes into the same
   AUDIT table admin.mjs's writeAudit already uses (visible on /admin, 90-day
   TTL). No analytics vendor exists in this app yet — if one is added later,
   swap the body of `track` for that SDK call; every call site stays the same. */
export function track(event: string, props?: Record<string, unknown>): void {
  void api("/events", {
    method: "POST",
    body: JSON.stringify({ name: event, props: props ?? {} }),
  }).catch(() => {
    // Analytics must never break the feature it's measuring.
  });
}
