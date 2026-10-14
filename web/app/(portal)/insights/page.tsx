"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { can } from "@/lib/can";
import { usePortalData } from "@/lib/portal-data";
import { InsightsView } from "@/components/insights/insights-view";

/* Admin-only, and invisible to everyone else: the nav link is Admin-only, and
   anyone else who reaches this URL is sent home without seeing a page or
   making a request. That redirect is a courtesy; the control is the API
   (backend/src/insights.mjs), which answers 403 to anyone but an Admin. */
export default function InsightsPage() {
  const { role } = usePortalData();
  const router = useRouter();
  const allowed = role !== null && can.viewInsights(role);
  useEffect(() => {
    if (role !== null && !allowed) router.replace("/");
  }, [role, allowed, router]);
  if (!allowed) return null;
  return <InsightsView />;
}
