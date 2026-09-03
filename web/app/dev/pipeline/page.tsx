"use client";

import { notFound } from "next/navigation";
import PipelinePage from "@/app/(portal)/pipeline/page";
import { MessagesProvider } from "@/lib/messages";
import { PortalDataProvider } from "@/lib/portal-data";

/*
 Click-test harness for Pipeline — the board, the Companies/People tables and
 the record drawer — against real handlers.

 Same shape as /dev/community: the real page and the real providers, mounted
 outside app/(portal) so the layout's sign-in gate is not in the way, talking
 to backend/scripts/dev-api.mjs.

   Terminal 1:  cd backend && node scripts/dev-api.mjs
   Terminal 2:  cd web && NEXT_PUBLIC_API_URL=http://localhost:8788 \
                  NEXT_PUBLIC_AUTH_PROVIDER=cognito npm run dev

 Then open /dev/pipeline?view=people. Query params the page reads (`view`,
 `deal`) work here the same way they do behind auth.
*/
export default function DevPipelinePage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <PortalDataProvider>
      <MessagesProvider>
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-6 py-8">
          <PipelinePage />
        </div>
      </MessagesProvider>
    </PortalDataProvider>
  );
}
