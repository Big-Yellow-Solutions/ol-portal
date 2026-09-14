"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AuthKitProvider,
  LoginRequiredError,
  useAuth as useAuthKit,
} from "@workos-inc/authkit-react";
import {
  AuthContext,
  type AuthContextValue,
  type LoginStep,
} from "@/lib/auth-context";
import { CONFIG, WORKOS_CALLBACK_PATH } from "@/lib/config";
import { currentPath, safeReturnTo } from "@/lib/return-to";
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

/* A structured trace of the session's life, for following a redirect chain
   in a real browser. On in development; in a production build only when
   localStorage["olportal.authTrace"] is "1". One JSON line per event so it
   survives copy-paste and log capture; events carry paths, statuses and
   error names — never a token, a code or a cookie. */
function trace(event: string, detail: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV === "production") {
    try {
      if (window.localStorage.getItem("olportal.authTrace") !== "1") return;
    } catch {
      return;
    }
  }
  console.debug(
    "[auth]",
    JSON.stringify({
      t: new Date().toISOString(),
      event,
      path: currentPath(),
      hidden: document.hidden,
      ...detail,
    })
  );
}

/* One re-entry into AuthKit per page, however many callers notice that the
   session has died.

   authkit-js reports a dead refresh token twice over: once through
   onRefreshFailure, and once as the LoginRequiredError thrown by whichever
   getAccessToken() call tripped the refresh. Before this, both answers
   navigated — onRefreshFailure towards AuthKit with the current path in
   `state`, and api()'s "no token" branch (endSession → signOut, which throws
   NoSessionError once the session is gone) to the origin — in the same tick.
   Whichever the browser committed decided whether the user came back to the
   page they were on or to "/". Now there is one navigation, and it carries
   the page. The flag never resets on success because the document is about
   to be replaced; it resets on failure so a later caller can try again. */
type SignIn = (opts: { state: { returnTo: string } }) => Promise<void>;
let reauthInFlight = false;

function reauthenticate(signIn: SignIn, reason: string) {
  if (reauthInFlight) {
    trace("reauth.already", { reason });
    return;
  }
  reauthInFlight = true;
  const returnTo = currentPath();
  trace("reauth.start", { reason, returnTo });
  signIn({ state: { returnTo } }).catch((err) => {
    reauthInFlight = false;
    trace("reauth.failed", { reason, error: String(err) });
  });
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
      /* authkit-js's own default off localhost is devMode={false}, which
         keeps the refresh token in an HttpOnly cookie on api.workos.com —
         cross-site from this origin, so Safari's ITP and any browser with
         third-party cookies blocked (a default in several) refuse to send it
         on the silent background refresh authkit-js attempts every time the
         tab regains focus after being hidden long enough for the access
         token to need renewing. That refresh then fails for real, which
         onRefreshFailure below correctly reads as "the session is dead" and
         answers with a full re-authentication redirect — a real page
         navigation, discarding whatever was mid-typing. This was the actual
         cause of "the portal keeps refreshing and I lose my work": not
         random, but tied to switching away from the tab and back.

         WorkOS's own docs say devMode={true} is what to set until a custom
         AuthKit domain is configured — it moves the refresh token to
         localStorage instead, same-origin and untouched by any browser
         cookie policy. The trade: an HttpOnly cookie can't be read by
         JavaScript at all; localStorage can, so an XSS bug elsewhere in the
         app could exfiltrate the token until a custom domain replaces this.

         This was briefly swapped for a custom AuthKit domain
         (login.optimisticlabs.com, apiHostname) instead, on the reasoning
         that it would restore the HttpOnly-cookie property while still
         being first-party. That broke sign-in outright in production:
         authkit-js builds the interactive authorize redirect as
         `${apiHostname}/user_management/authorize`, and the custom AuthKit
         domain apparently doesn't serve that path — 404. Reverted. Do not
         retry apiHostname without first confirming directly with WorkOS
         (support, or a working example from their own SDKs) that a custom
         AuthKit domain is meant to receive the full user_management API
         surface from a client-side app, not just something their own
         backend redirects through internally. */
      devMode={true}
      onRedirectCallback={({ state }) => {
        /* `state` round-trips as plaintext in the URL and WorkOS does not
           integrity-protect it, so it is treated as attacker-controlled:
           anything but a path on this origin lands on the root.

           This is the only navigation off /callback, and it waits a tick.
           The moment this callback returns, authkit-js strips ?code and
           ?state from the URL with window.history.replaceState — which
           Next's router picks up as a navigation of its own, and a
           navigation discards whatever navigation is still pending. Issued
           synchronously, this replace() was that pending one: the router
           dropped it, and the callback page's own replace("/") — since
           removed — then took everyone to the home page. A macrotask later
           the rewrite is behind us and this one stands. */
        const raw = state?.returnTo;
        const to = safeReturnTo(typeof raw === "string" ? raw : undefined);
        trace("callback.return", { returnTo: to });
        window.setTimeout(() => routerRef.current.replace(to), 0);
      }}
      onRefreshFailure={({ signIn }) => {
        /* The refresh token is dead — or, off localhost, the browser would
           not send the cookie it lives in, which WorkOS answers with the same
           400. Either way getAccessToken() will now throw and every request
           would leave without a token. Re-enter AuthKit carrying the page:
           if the hosted session is still alive this is an invisible round
           trip back to the same URL, and if it is not the user lands on
           sign-in and comes back here afterwards. */
        trace("refresh.failed");
        reauthenticate(signIn, "refresh-failure");
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

  /* Recovering the session across a document load.

     authkit-js keeps the session in memory and, off localhost, the refresh
     token in an HttpOnly cookie on api.workos.com. On a fresh load it only
     asks that cookie when it can see a `workos-has-session` marker in
     document.cookie — which it never can from here: the marker is set on
     api.workos.com too, and this origin cannot read another site's cookies.
     So every reload came up with no user, the portal layout sent it to
     /login, and AuthKit's hosted page bounced it straight back: a visible
     round trip for a session that was alive the whole time. One
     getAccessToken() call is the SDK's own way to ask the cookie anyway — it
     refreshes and reports the user through onRefresh when the cookie is
     sent, and throws LoginRequiredError when it is not (which is also what
     Safari, and any Chrome that blocks third-party cookies, produce). Until
     it has answered the status stays "loading", so nothing redirects on a
     session that is still being checked. */
  const probed = useRef(false);
  const [probeDone, setProbeDone] = useState(false);
  useEffect(() => {
    if (isLoading || user || probed.current) return;
    probed.current = true;
    trace("boot.probe");
    getAccessToken()
      .then(() => trace("boot.recovered"))
      .catch((err: unknown) =>
        trace("boot.none", {
          error: err instanceof Error ? err.constructor.name : String(err),
        })
      )
      .finally(() => setProbeDone(true));
  }, [isLoading, user, getAccessToken]);

  const status: AuthContextValue["status"] = isLoading
    ? "loading"
    : user
      ? "signedIn"
      : probeDone
        ? "signedOut"
        : "loading";

  useEffect(() => trace("status", { status }), [status]);

  /* The bearer token for the API, and what its absence means. Three answers:

       a token        the session is live (refreshed on the way if it was due);
       null           the session is conclusively gone — the SDK has dropped
                      it and a sign-in is already on its way, so api() should
                      stop without a round trip and without ending anything;
       a throw        the refresh may well succeed next time: WorkOS answered
                      429 or 5xx, the request never got out, or another tab
                      held the refresh lock too long. The SDK keeps the
                      session through these. Signing the user out over one —
                      which is what null used to mean for every failure — is
                      the one thing not to do. */
  const token = useCallback(async () => {
    try {
      return await getAccessToken();
    } catch (err: unknown) {
      if (err instanceof LoginRequiredError) {
        trace("token.login-required");
        if (!isLoading) reauthenticate(signIn, "login-required");
        return null;
      }
      trace("token.transient", {
        error: err instanceof Error ? err.constructor.name : String(err),
      });
      throw new Error(
        "Your session could not be renewed just now. Check your connection and try again.",
        { cause: err }
      );
    }
  }, [getAccessToken, signIn, isLoading]);

  /* Get the user to a signed-out surface whatever state AuthKit is in.

     signOut() reads the access token out of authkit-js's in-memory store and
     throws NoSessionError when it is not there, which is the case once a
     refresh has failed. Nothing about the WorkOS session needs ending then; it
     is already gone, and a sign-in carrying the page is already navigating
     (reauthenticate above). Starting a second navigation would race it. */
  const leave = useCallback(() => {
    if (reauthInFlight) {
      trace("leave.deferred-to-reauth");
      return;
    }
    trace("leave");
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
      trace("hosted-sign-in", { returnTo: returnTo ?? "/" });
      await signIn(returnTo ? { state: { returnTo } } : undefined);
    },
    [signIn]
  );

  const logout = useCallback(async () => {
    leave();
  }, [leave]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
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
    [status, user, hostedSignIn, logout, token]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
