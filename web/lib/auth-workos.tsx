"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AuthKitProvider,
  useAuth as useAuthKit,
} from "@workos-inc/authkit-react";
import {
  AuthContext,
  type AuthContextValue,
  type LoginStep,
} from "@/lib/auth-context";
import { CONFIG, WORKOS_CALLBACK_PATH } from "@/lib/config";
import { registerTokenSource } from "@/lib/session";

/* AuthKit hosts the credential screens, so everything the Cognito provider
   renders itself — password entry, the forced password change, TOTP enrolment,
   forgot-password — happens on WorkOS's domain instead. The login page checks
   `hostedSignIn` and redirects rather than calling any of these, so reaching
   one means a caller still assumes the Cognito flow. Say so plainly rather
   than resolving into a state machine that will never advance. */
function hostedInstead<A extends unknown[], R>(what: string) {
  return (..._args: A): Promise<R> =>
    Promise.reject(
      new Error(`${what} is handled by AuthKit's hosted pages, not the portal.`)
    );
}

/** Resolve a `returnTo` carried through the OAuth redirect to a safe path.
 *
 *  `state` round-trips as plaintext in the URL and WorkOS does not integrity
 *  protect it, so treat it as attacker-controlled. Anything that does not
 *  resolve to this exact origin — an absolute URL elsewhere, a `javascript:`
 *  URI, a protocol-relative `//evil.com` — falls back to the portal root. */
function safeReturnPath(state: Record<string, unknown> | null | undefined) {
  const raw = state?.returnTo;
  if (typeof raw !== "string" || raw === "") return "/";
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return "/";
  }
  if (url.origin !== window.location.origin) return "/";
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Belt and braces: a lone "/" prefix is a path, "//" is another origin.
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export function WorkosAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  /* onRedirectCallback is captured when the AuthKit client is constructed, so
     it must not close over a stale router. */
  const routerRef = useRef(router);
  routerRef.current = router;

  /* redirectUri has to be the real origin, and the origin differs across
     localhost, the Amplify branch URL and portal.optimisticlabs.com. Deferring
     the mount by one tick keeps it honest instead of baking a guess in at
     export time — `output: "export"` prerenders this component with no window.
     Consumers already render a loading state, which is what this first pass
     produces. */
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);

  if (!origin) {
    return (
      <AuthContext.Provider value={BOOTING}>{children}</AuthContext.Provider>
    );
  }

  return (
    <AuthKitProvider
      clientId={CONFIG.workosClientId}
      redirectUri={`${origin}${WORKOS_CALLBACK_PATH}`}
      onRedirectCallback={({ state }) => {
        routerRef.current.replace(safeReturnPath(state));
      }}
      onRefreshFailure={({ signIn }) => {
        /* The refresh token is dead, so getAccessToken() now resolves to null
           and every later request leaves without an Authorization header —
           which the API answers with a 401 before the authorizer even runs.
           Re-establish the session here instead of waiting for that: if the
           hosted AuthKit session is still alive this is an invisible round
           trip back to the same page, and if it is not the user lands on
           sign-in. Either way nobody is left on a page whose every request
           can only fail. */
        const { pathname, search } = window.location;
        void signIn({ state: { returnTo: `${pathname}${search}` } });
      }}
    >
      <WorkosAuthBridge>{children}</WorkosAuthBridge>
    </AuthKitProvider>
  );
}

/** The pre-mount value: indistinguishable from "still checking the session",
 *  which is exactly what it is. */
const BOOTING: AuthContextValue = {
  status: "loading",
  username: null,
  totpSetup: null,
  hostedSignIn: null,
  startLogin: hostedInstead("Password sign-in"),
  submitNewPassword: hostedInstead("Setting a password"),
  submitMfaSetupCode: hostedInstead("Two-factor enrolment"),
  submitMfaCode: hostedInstead("Two-factor verification"),
  forgotPassword: hostedInstead("Password reset"),
  confirmForgotPassword: hostedInstead("Password reset"),
  logout: () => Promise.resolve(),
  getIdToken: () => Promise.resolve(null),
  refreshAuthState: () => Promise.resolve(),
};

function WorkosAuthBridge({ children }: { children: React.ReactNode }) {
  const { isLoading, user, getAccessToken, signIn, signOut } = useAuthKit();

  const token = useCallback(
    () => getAccessToken().catch(() => null),
    [getAccessToken]
  );

  /* Get the user to a signed-out surface whatever state AuthKit is in.

     signOut() reads the access token out of authkit-js's in-memory store and
     throws NoSessionError when it is not there — which is exactly the case
     after a failed refresh, the most common reason anything wants to end a
     session at all. Uncaught, it escapes api()'s 401 branch in place of the
     ApiError, so the caller reports "SignOut() called without an active
     session" and the user is stranded on a page that can no longer load
     anything. Nothing about the WorkOS session needs ending in that case; it
     is already gone. Only the navigation is still owed. */
  const leave = useCallback(() => {
    try {
      /* signOut navigates on its own. returnTo must be a Sign-out URI
         registered in the WorkOS dashboard; the origin lands on "/", which
         bounces to /login for a signed-out visitor. */
      signOut({ returnTo: window.location.origin });
    } catch {
      window.location.assign(window.location.origin);
    }
  }, [signOut]);

  useEffect(() => {
    registerTokenSource({ getToken: token, endSession: async () => leave() });
  }, [token, leave]);

  const hostedSignIn = useCallback(
    async (returnTo?: string) => {
      await signIn(returnTo ? { state: { returnTo } } : undefined);
    },
    [signIn]
  );

  const logout = useCallback(async () => {
    leave();
  }, [leave]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: isLoading ? "loading" : user ? "signedIn" : "signedOut",
      /* The portal keys identity on lowercased email everywhere — PERSON keys,
         audit rows, deal owner — so normalise here rather than at each use. */
      username: user?.email.toLowerCase() ?? null,
      totpSetup: null,
      hostedSignIn,
      startLogin: hostedInstead<[string, string], LoginStep>("Password sign-in"),
      submitNewPassword: hostedInstead<[string], LoginStep>("Setting a password"),
      submitMfaSetupCode: hostedInstead<[string], LoginStep>(
        "Two-factor enrolment"
      ),
      submitMfaCode: hostedInstead<[string], LoginStep>(
        "Two-factor verification"
      ),
      forgotPassword: hostedInstead<[string], void>("Password reset"),
      confirmForgotPassword: hostedInstead<[string, string, string], void>(
        "Password reset"
      ),
      logout,
      getIdToken: token,
      /* AuthKit keeps the session current itself — it refreshes ahead of
         expiry and re-renders this bridge — so there is nothing to re-pull. */
      refreshAuthState: () => Promise.resolve(),
    }),
    [isLoading, user, hostedSignIn, logout, token]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
