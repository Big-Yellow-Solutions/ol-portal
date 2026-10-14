"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import InsightsPage from "@/app/(portal)/insights/page";
import { MessagesProvider } from "@/lib/messages";
import { PortalDataProvider } from "@/lib/portal-data";
import { registerTokenSource } from "@/lib/session";

/*
 Click-test harness for Insights against real handlers. Same shape as
 /dev/pipeline: the real page and providers, mounted outside app/(portal) so
 the sign-in gate is not in the way, talking to backend/scripts/dev-api.mjs.

   Terminal 1:  cd backend && node scripts/dev-api.mjs
   Terminal 2:  cd web && NEXT_PUBLIC_API_URL=http://localhost:8788 \
                  NEXT_PUBLIC_AUTH_PROVIDER=cognito npm run dev

 Open /dev/insights. `POST /__dev/as/<key>` on the dev API switches identity —
 the way to confirm a Lab Leader gets the no-access screen and no data.
*/

/* The WorkOS cutover put api() behind a registered token source, and this page
   mounts outside <AuthProvider>, so it has to supply one.

   The value is a stand-in rather than null. dev-api.mjs ignores the header
   entirely — it injects the identity the authorizer would have supplied — but
   api() no longer reads a null token as "send it without one": it reads it as
   a dead session and bounces the browser to /login before the request is made
   (commit 9bbe38a). A harness handing back null now reaches no handler at all. */
const HARNESS_TOKEN = {
  getToken: async () => "dev-harness",
  endSession: async () => {},
};

export default function DevInsightsPage() {
  /* Two things claim this one slot: this harness, and the Cognito provider
     <AuthProvider> mounts from the root layout. Effects run child-first, so
     the provider — an ancestor — always registers last and would win.

     So the providers below do not mount until the slot is ours: the effect
     flush is synchronous, a microtask queued from here lands after every
     effect in the commit that mounted <AuthProvider>, and PortalDataProvider
     then fires its first request in a later commit with no one left to race.
     Registering at module scope instead only wins the first burst — the
     second pass of Strict Mode's double-invoked effects loses it again. */
  const [ready, setReady] = useState(false);
  useEffect(() => {
    queueMicrotask(() => {
      registerTokenSource(HARNESS_TOKEN);
      setReady(true);
    });
  }, []);

  if (process.env.NODE_ENV === "production") notFound();
  if (!ready) return null;

  return (
    <PortalDataProvider>
      <MessagesProvider>
        <div className="mx-auto flex w-full max-w-[1420px] flex-col gap-6 px-6 py-8">
          <InsightsPage />
        </div>
      </MessagesProvider>
    </PortalDataProvider>
  );
}
