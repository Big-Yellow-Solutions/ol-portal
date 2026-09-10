"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import ProfilePage from "@/app/(portal)/profile/page";
import { PortalShell } from "@/components/shell/portal-shell";
import { MessagesProvider } from "@/lib/messages";
import { NotificationsProvider } from "@/lib/notifications";
import { PortalDataProvider } from "@/lib/portal-data";
import { registerTokenSource } from "@/lib/session";

/*
 Click-test harness for the profile page — the same shape as /dev/community.
 The real page, the real providers, the real API client, talking to
 backend/scripts/dev-api.mjs so a photo change or a visibility toggle runs
 the real PATCH /profile handler over the in-process table.

   Terminal 1:  cd backend && node scripts/dev-api.mjs
   Terminal 2:  cd web && NEXT_PUBLIC_API_URL=http://localhost:8788 \
                  NEXT_PUBLIC_AUTH_PROVIDER=cognito npm run dev

 Then open /dev/profile, or /dev/profile?u=<username> for the admin view of
 someone else. Switch who is signed in with
 fetch("http://localhost:8788/__dev/as/<person>", { method: "POST" }).

 Nothing here reaches a deployed build — the guard below is the same one the
 other harnesses use.
*/
/* Same stand-in as /dev/pipeline: api() reads a null token as a dead session
   and bounces to /login before the request is made. This harness previously
   relied on CognitoAuthProvider's own token source, which resolves to null
   when there's no real Cognito session — so it hit that redirect too. */
const HARNESS_TOKEN = {
  getToken: async () => "dev-harness",
  endSession: async () => {},
};

export default function DevProfilePage() {
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
          {/* The real shell, so the states above the page — the bootstrap
              failure screens, the welcome redirect — are exercised here too and
              not only in production. TopNav's bell needs NotificationsProvider,
              same as /dev/notifications. */}
          <PortalShell>
            <ProfilePage />
          </PortalShell>
        </MessagesProvider>
      </NotificationsProvider>
    </PortalDataProvider>
  );
}
