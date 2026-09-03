"use client";

import React from "react";
import { CONFIG } from "@/lib/config";
import { CognitoAuthProvider } from "@/lib/auth-cognito";
import { WorkosAuthProvider } from "@/lib/auth-workos";

/* Both backends publish the same context, so useAuth and everything that calls
   it are unchanged by the switch. Which one mounts is decided at build time —
   see CONFIG.authProvider. Cognito is still the default; the WorkOS half is
   reachable with NEXT_PUBLIC_AUTH_PROVIDER=workos and is being exercised
   against the staging AuthKit instance before it becomes the only path. */
export { useAuth } from "@/lib/auth-context";
export type { AuthContextValue, LoginStep, TotpSetup } from "@/lib/auth-context";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const Provider =
    CONFIG.authProvider === "workos" ? WorkosAuthProvider : CognitoAuthProvider;
  return <Provider>{children}</Provider>;
}
