"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { Topbar } from "@/components/shell/topbar";
import { ActAsBanner } from "@/components/shell/act-as-banner";
import { HelpWidget } from "@/components/shell/help-widget";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { usePortalData } from "@/lib/portal-data";
import { useAuth } from "@/lib/auth";

export function PortalShell({ children }: { children: React.ReactNode }) {
  const { loading, error, needsWelcome, refresh } = usePortalData();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !error && needsWelcome()) {
      router.replace("/welcome");
    }
  }, [loading, error, needsWelcome, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-ink-mute">
        Loading…
      </div>
    );
  }

  if (error) {
    return <PortalLoadError message={error} onRetry={refresh} />;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="bg-paper">
        <ActAsBanner />
        <Topbar />
        <div className="flex-1 p-4 md:p-8">
          <div className="mx-auto max-w-[1280px]">{children}</div>
        </div>
        <HelpWidget />
      </SidebarInset>
    </SidebarProvider>
  );
}

/*
 * Bootstrap loads seven endpoints in one Promise.all, so a single failing
 * request used to replace the whole portal with a raw exception string and no
 * way out but a manual reload. Keep the recovery paths on screen.
 */
function PortalLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}) {
  const { logout } = useAuth();
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div
        role="alert"
        className="flex w-full max-w-md flex-col gap-4 rounded-2xl bg-white p-8 shadow-xl"
      >
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-xl italic text-ink">
            Unable to load the portal
          </h1>
          <p className="text-sm text-ink-mute">
            Check your connection and try again. If it keeps failing, sign out
            and back in.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={retry} disabled={retrying}>
            {retrying ? "Retrying…" : "Try again"}
          </Button>
          <Button variant="outline" onClick={() => logout()} disabled={retrying}>
            Sign out
          </Button>
        </div>

        <details className="text-xs text-ink-mute">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-2 break-words">{message}</p>
        </details>
      </div>
    </div>
  );
}
