"use client";

import { notFound } from "next/navigation";
import CommunityPage from "@/app/(portal)/community/page";
import { MessagesProvider } from "@/lib/messages";
import { PortalDataProvider } from "@/lib/portal-data";

/*
 Click-test harness for Community, and for the thing Community could not do
 until it had a backend: keep a post.

 The real page, the real providers, the real API client — everything except
 the two pieces that need AWS. It mounts outside app/(portal), so the layout's
 sign-in gate is not in the way, and it talks to backend/scripts/dev-api.mjs,
 which runs the real Lambda handler over an in-process table.

   Terminal 1:  cd backend && node scripts/dev-api.mjs
   Terminal 2:  cd web && NEXT_PUBLIC_API_URL=http://localhost:8788 \
                  NEXT_PUBLIC_AUTH_PROVIDER=cognito npm run dev

 Then open /dev/community. Write a post, reload, and it is still there. To see
 it from somebody else's account (which is what proves a lab post is scoped,
 not merely filtered), switch the identity the dev API injects and reload:

   fetch("http://localhost:8788/__dev/as/omar", { method: "POST" })

 Nothing here reaches a deployed build — the guard below is the same one
 /dev/deal-drawer-footer uses.
*/
export default function DevCommunityPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <PortalDataProvider>
      <MessagesProvider>
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-6 py-8">
          <CommunityPage />
        </div>
      </MessagesProvider>
    </PortalDataProvider>
  );
}
