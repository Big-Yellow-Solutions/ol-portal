"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useSessionVerified, verifyPath } from "@/lib/verify";
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

  useEffect(() => {
    if (status === "signedOut") router.replace("/login");
    else if (status === "signedIn" && verification === "needed") {
      const { pathname, search } = window.location;
      router.replace(verifyPath(`${pathname}${search}`));
    }
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
