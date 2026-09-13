"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { currentPath, loginPath, verifyPath } from "@/lib/return-to";
import { useSessionVerified } from "@/lib/verify";
import { MessagesProvider } from "@/lib/messages";
import { NotificationsProvider } from "@/lib/notifications";
import { PortalDataProvider } from "@/lib/portal-data";
import { PortalShell } from "@/components/shell/portal-shell";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useAuth();
  const router = useRouter();
  /* The emailed sign-in code (lib/verify.ts). Nothing below mounts — and so
     nothing asks the API for data — until the session has entered it. */
  const verification = useSessionVerified(status);

  /* Both detours carry the page (path and query) so it can be restored
     afterwards. "signedOut" is only ever conclusive here: the provider
     reports "loading" until it has finished checking the session, including
     the one it can recover from a cookie after a document load. */
  useEffect(() => {
    if (status === "signedOut") router.replace(loginPath(currentPath()));
    else if (status === "signedIn" && verification === "needed")
      router.replace(verifyPath(currentPath()));
  }, [status, verification, router]);

  if (status !== "signedIn" || verification !== "ok") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-ink-mute">
        Loading…
      </div>
    );
  }

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
