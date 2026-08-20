"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TopNav } from "@/components/shell/top-nav";
import { ActAsBanner } from "@/components/shell/act-as-banner";
import { HelpWidget } from "@/components/shell/help-widget";
import { Button } from "@/components/ui/button";
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

  /* The design puts the chrome on top rather than down the side, so the shell
     is a plain column now: banner, sticky nav, then a 1420px measure with the
     34/32/80 padding every artboard uses. */
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <ActAsBanner />
      <TopNav />
      {/* Positioned so a route can paint a full-bleed overlay over the content
          area (the Optimist's document view does). Under the old sidebar shell
          that containing block was SidebarInset; the overlay stops below the
          nav now rather than covering it, because the top nav is the constant
          chrome in this design. */}
      <div className="relative flex-1">
        <div className="mx-auto flex max-w-[1420px] flex-col gap-[22px] px-4 pt-[34px] pb-20 md:px-8">
          {children}
        </div>
      </div>
      <HelpWidget />
    </div>
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
