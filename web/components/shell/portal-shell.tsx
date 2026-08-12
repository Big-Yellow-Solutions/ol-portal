"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { Topbar } from "@/components/shell/topbar";
import { ActAsBanner } from "@/components/shell/act-as-banner";
import { usePortalData } from "@/lib/portal-data";

export function PortalShell({ children }: { children: React.ReactNode }) {
  const { loading, error, needsWelcome } = usePortalData();
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-red">
        {error}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <ActAsBanner />
      <div className="flex flex-1 flex-col md:flex-row">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 bg-paper p-4 md:p-8">
            <div className="mx-auto max-w-[1280px]">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
