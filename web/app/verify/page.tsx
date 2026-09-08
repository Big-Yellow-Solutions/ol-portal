"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { VerifyCard } from "@/components/verify-card";
import { useAuth } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { safeReturnTo } from "@/lib/verify";

/* Where a fresh sign-in lands before the portal: AuthKit has signed the
   person in, and the API will serve nothing until the code it emailed them
   is entered here (lib/verify.ts). Outside app/(portal) on purpose — that
   layout is what sends people here, and it holds every data provider back
   until this page has done its job. */
export default function VerifyPage() {
  const { status, username, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (CONFIG.authProvider !== "workos") router.replace("/");
    else if (status === "signedOut") router.replace("/login");
  }, [status, router]);

  const done = useCallback(() => {
    /* Read straight off the URL rather than through useSearchParams, which
       forces a Suspense boundary under `output: "export"`. */
    const params = new URLSearchParams(window.location.search);
    router.replace(safeReturnTo(params.get("returnTo")));
  }, [router]);

  const signOut = useCallback(() => {
    void logout();
  }, [logout]);

  if (status !== "signedIn") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-violet-deep text-white">
        Loading…
      </div>
    );
  }

  return <VerifyCard email={username} onDone={done} onSignOut={signOut} />;
}
