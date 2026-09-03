"use client";

import { notFound } from "next/navigation";
import ProfilePage from "@/app/(portal)/profile/page";
import { PortalShell } from "@/components/shell/portal-shell";
import { useAuth } from "@/lib/auth";
import { MessagesProvider } from "@/lib/messages";
import { PortalDataProvider } from "@/lib/portal-data";

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
export default function DevProfilePage() {
  const { status } = useAuth();
  if (process.env.NODE_ENV === "production") notFound();

  /* Mirrors app/(portal)/layout.tsx, and it is load-bearing rather than
     cosmetic: AuthProvider registers api()'s token source in its own effect,
     and effects run child-first, so a PortalDataProvider mounted in the same
     commit fetches before that source exists and the whole harness dies with
     "No auth token source registered". The real portal never hits this
     because its layout holds children until auth has settled. */
  if (status === "loading") {
    return <p className="p-8 text-sm text-ink-mute">Starting…</p>;
  }

  return (
    <PortalDataProvider>
      <MessagesProvider>
        {/* The real shell, so the states above the page — the bootstrap
            failure screens, the welcome redirect — are exercised here too and
            not only in production. */}
        <PortalShell>
          <ProfilePage />
        </PortalShell>
      </MessagesProvider>
    </PortalDataProvider>
  );
}
