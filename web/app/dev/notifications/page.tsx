"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import NotificationsPage from "@/app/(portal)/notifications/page";
import { TopNav } from "@/components/shell/top-nav";
import { MessagesProvider } from "@/lib/messages";
import { NotificationsProvider } from "@/lib/notifications";
import { PortalDataProvider } from "@/lib/portal-data";
import { registerTokenSource } from "@/lib/session";

/*
 Click-test harness for Notifications — the page, the bell in the nav and the
 peek it opens — against the real handlers in backend/src/notifications.mjs.

 Same shape as /dev/pipeline, and the nav is mounted alongside the page here
 rather than left out: the bell is half of this feature, and the badge only
 tells the truth if it is reading the same provider the page is.

   Terminal 1:  cd backend && node scripts/dev-api.mjs
   Terminal 2:  cd web && NEXT_PUBLIC_API_URL=http://localhost:8788 \
                  NEXT_PUBLIC_AUTH_PROVIDER=cognito npm run dev

 Then open /dev/notifications. Nothing is seeded: notifications are written by
 the handler for the thing that happened, so the way to make one is to make
 the thing happen —

   curl -X POST localhost:8788/__dev/as/nora
   curl -X POST localhost:8788/posts -H 'content-type: application/json' \
        -d '{"text":"@Teddy Schwarz can you take Thursday?"}'
   curl -X POST localhost:8788/__dev/as/teddy

 — which is also the only way to prove the emitter and the reader agree.
*/

const HARNESS_TOKEN = {
  getToken: async () => "dev-harness",
  endSession: async () => {},
};

export default function DevNotificationsPage() {
  /* See /dev/pipeline for why this waits: <AuthProvider> is an ancestor, its
     effect runs last, and it would otherwise take this slot back. */
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
      <NotificationsProvider>
        <MessagesProvider>
          <div className="flex min-h-screen flex-col bg-paper">
            <TopNav />
            <div className="mx-auto flex w-full max-w-[1420px] flex-col gap-[22px] px-4 pt-[34px] pb-20 md:px-8">
              <NotificationsPage />
            </div>
          </div>
        </MessagesProvider>
      </NotificationsProvider>
    </PortalDataProvider>
  );
}
