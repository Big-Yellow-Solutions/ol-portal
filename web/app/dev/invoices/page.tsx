"use client";

import RealPage from "@/app/(portal)/invoices/page";
import { DevHarness } from "@/app/dev/_harness";

/*
 Click-test harness for invoices — the real page and the real providers,
 mounted outside app/(portal) so the layout's sign-in gate is not in the
 way, talking to backend/scripts/dev-api.mjs. See /dev/_harness.tsx.

 Then open /dev/invoices. Switch identity with
 fetch("http://localhost:8788/__dev/as/<person>", { method: "POST" }).
*/
export default function DevInvoicesPage() {
  return (
    <DevHarness>
      <RealPage />
    </DevHarness>
  );
}
