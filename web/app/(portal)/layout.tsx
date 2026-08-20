"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { MessagesProvider } from "@/lib/messages";
import { PortalDataProvider } from "@/lib/portal-data";
import { PortalShell } from "@/components/shell/portal-shell";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signedOut") router.replace("/login");
  }, [status, router]);

  if (status !== "signedIn") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-ink-mute">
        Loading…
      </div>
    );
  }

  return (
    <PortalDataProvider>
      <MessagesProvider>
        <PortalShell>{children}</PortalShell>
      </MessagesProvider>
    </PortalDataProvider>
  );
}
