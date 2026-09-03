"use client";

import { notFound } from "next/navigation";
import ProfilePage from "@/app/(portal)/profile/page";
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
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <PortalDataProvider>
      <MessagesProvider>
        <div className="mx-auto flex w-full max-w-[1420px] flex-col gap-[22px] px-8 pt-[34px] pb-20">
          <ProfilePage />
        </div>
      </MessagesProvider>
    </PortalDataProvider>
  );
}
