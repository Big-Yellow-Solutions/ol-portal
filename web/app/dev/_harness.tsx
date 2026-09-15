"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { PortalShell } from "@/components/shell/portal-shell";
import { MessagesProvider } from "@/lib/messages";
import { NotificationsProvider } from "@/lib/notifications";
import { PortalDataProvider } from "@/lib/portal-data";
import { registerTokenSource } from "@/lib/session";

/*
 Shared shell for the /dev/* click-test harnesses, factored out of the
 identical boilerplate repeated across /dev/pipeline, /dev/resources, and
 /dev/notifications (see those files for why each piece exists — this is
 not a new mechanism, just one copy of it).

 Renders the real PortalShell (top nav, help widget, messages panel) around
 whatever page is passed in, against backend/scripts/dev-api.mjs:

   Terminal 1:  cd backend && node scripts/dev-api.mjs
   Terminal 2:  cd web && NEXT_PUBLIC_API_URL=http://localhost:8788 \
                  NEXT_PUBLIC_AUTH_PROVIDER=cognito npm run dev

 Switch identity with fetch("http://localhost:8788/__dev/as/<person>", {method:"POST"}).
 Nothing here reaches a deployed build.
*/
const HARNESS_TOKEN = {
  getToken: async () => "dev-harness",
  endSession: async () => {},
};

export function DevHarness({ children }: { children: React.ReactNode }) {
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
          <PortalShell>{children}</PortalShell>
        </MessagesProvider>
      </NotificationsProvider>
    </PortalDataProvider>
  );
}
