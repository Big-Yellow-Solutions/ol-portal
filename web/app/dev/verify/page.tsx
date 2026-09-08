"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { VerifyCard } from "@/components/verify-card";
import { registerTokenSource } from "@/lib/session";

/*
 Click-test harness for the emailed sign-in code, against the real
 /auth/verify handlers in backend/scripts/dev-api.mjs, which prints the code
 to its terminal instead of mailing it.

   Terminal 1:  cd backend && node scripts/dev-api.mjs
   Terminal 2:  cd web && NEXT_PUBLIC_API_URL=http://localhost:8788 \
                  NEXT_PUBLIC_AUTH_PROVIDER=workos npm run dev

 Then open /dev/verify. "Done" and "Sign out" only print to the console here.
 See /dev/pipeline for why the token is a string and why it registers from a
 microtask.
*/
const HARNESS_TOKEN = {
  getToken: async () => "dev-harness",
  endSession: async () => {},
};

export default function DevVerifyPage() {
  const [ready, setReady] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  useEffect(() => {
    queueMicrotask(() => {
      registerTokenSource(HARNESS_TOKEN);
      setReady(true);
    });
  }, []);

  if (process.env.NODE_ENV === "production") notFound();
  if (!ready) return null;
  if (outcome) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-ink">
        <p data-testid="outcome">{outcome}</p>
      </div>
    );
  }

  return (
    <VerifyCard
      email="teddy@optimisticlabs.com"
      onDone={() => setOutcome("done: session confirmed")}
      onSignOut={() => setOutcome("signed out")}
    />
  );
}
