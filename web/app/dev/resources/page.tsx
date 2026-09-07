"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import ResourcesPage from "@/app/(portal)/resources/page";
import { PortalDataProvider } from "@/lib/portal-data";
import { registerTokenSource } from "@/lib/session";

/*
 Click-test harness for Resources — the library, the type filters and the
 authoring dialogs — against real handlers.

 Same shape as /dev/pipeline: the real page and the real providers, mounted
 outside app/(portal) so the layout's sign-in gate is not in the way, talking
 to backend/scripts/dev-api.mjs.

   Terminal 1:  cd backend && node scripts/dev-api.mjs
   Terminal 2:  cd web && NEXT_PUBLIC_API_URL=http://localhost:8788 \
                  NEXT_PUBLIC_AUTH_PROVIDER=cognito npm run dev

 Then open /dev/resources as Teddy, who is an Admin, so the intake buttons are
 there. Write a post, publish it, and it comes back on a reload with whatever
 cover image was attached. Uploads are the one thing this cannot exercise: a
 file or an uploaded video needs a real presigned S3 PUT.
*/

/* Same stand-in as /dev/pipeline: api() reads a null token as a dead session
   and bounces to /login before the request is made, and dev-api.mjs ignores
   the header anyway — it injects the identity the authorizer would supply. */
const HARNESS_TOKEN = {
  getToken: async () => "dev-harness",
  endSession: async () => {},
};

export default function DevResourcesPage() {
  /* Claim the token slot after <AuthProvider> has claimed it — see the long
     note in /dev/pipeline for why this is a microtask rather than a plain
     effect or module scope. */
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
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-6 py-8">
        <ResourcesPage />
      </div>
    </PortalDataProvider>
  );
}
