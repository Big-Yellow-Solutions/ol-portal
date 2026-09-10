"use client";

import RealPage from "@/app/(portal)/contracts/page";
import { DevHarness } from "@/app/dev/_harness";

/*
 Click-test harness for contracts — the real page and the real providers,
 mounted outside app/(portal) so the layout's sign-in gate is not in the
 way, talking to backend/scripts/dev-api.mjs. See /dev/_harness.tsx.

 Then open /dev/contracts. Switch identity with
 fetch("http://localhost:8788/__dev/as/<person>", { method: "POST" }).
*/
export default function DevContractsPage() {
  return (
    <DevHarness>
      <RealPage />
    </DevHarness>
  );
}
