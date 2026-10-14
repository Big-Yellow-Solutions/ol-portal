"use client";

import { can } from "@/lib/can";
import { usePortalData } from "@/lib/portal-data";
import { InsightsView, NoAccess } from "@/components/insights/insights-view";

/* Admin-only. The role check here decides what to *draw*; the data itself is
   guarded by the API (backend/src/insights.mjs), which answers 403 to anyone
   else, so a Lab Leader who types /insights gets this screen and nothing more.
   InsightsView is not mounted for them, so it never even asks. */
export default function InsightsPage() {
  const { role } = usePortalData();
  if (role === null) return <p className="text-sm text-ink-mute">Loading…</p>;
  if (!can.viewInsights(role)) return <NoAccess />;
  return <InsightsView />;
}
