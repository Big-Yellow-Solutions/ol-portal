"use client";

/* The emailed sign-in code, from the browser's side.

   WorkOS AuthKit's only second factor is an authenticator app, and the
   portal's rule is a code emailed on every sign-in. So the API runs the step:
   a fresh WorkOS session is admitted to /auth/verify and nothing else until
   its code is entered (backend/src/authz.mjs). This module asks where the
   session stands, and the portal layout sends anyone unconfirmed to /verify
   before a single data request goes out — which matters, because the API's
   refusal is a bare 403 that would otherwise read as "you have no access". */

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { CONFIG } from "@/lib/config";

export interface VerifyStatus {
  email: string;
  verified: boolean;
  sentAt: string | null;
  expiresAt: string | null;
}

/* Every call skips the act-as header: these routes run before the portal
   context exists, and api()'s "retry without impersonation" branch would
   otherwise read a wrong-code 400 as a stale act-as target and clear it. */
const opts = { skipActAs: true } as const;

export const verifyStatus = () => api<VerifyStatus>("/auth/verify", opts);
export const sendVerifyCode = () =>
  api<VerifyStatus>("/auth/verify/send", { ...opts, method: "POST" });
export const submitVerifyCode = (code: string) =>
  api<{ verified: boolean }>("/auth/verify", {
    ...opts,
    method: "POST",
    body: JSON.stringify({ code }),
  });

/* A session cannot become unconfirmed again, so one "yes" is good for the
   life of the page; a full reload asks once more, which is one small request.
   The verify page sets it on success so the return trip does not re-ask. */
let confirmedThisLoad = false;
export function markVerified() {
  confirmedThisLoad = true;
}

export async function sessionVerified(): Promise<boolean> {
  if (CONFIG.authProvider !== "workos") return true;
  if (confirmedThisLoad) return true;
  let verified: boolean;
  try {
    ({ verified } = await verifyStatus());
  } catch (err) {
    /* A 404 is an API that does not have the routes yet — the frontend
       deploys on push while the backend is a separate sam deploy, so this
       is the window between the two. The API is not gating sessions in
       that window either, so letting the page through is honest, not
       lenient; the gate lives on the server and cannot be talked out of
       from here. Ship the frontend first for this reason. */
    if (err instanceof ApiError && err.status === 404) return true;
    throw err;
  }
  if (verified) confirmedThisLoad = true;
  return verified;
}

export type Verification = "checking" | "ok" | "needed";

/** Where the signed-in session stands with its emailed code. Stays
 *  "checking" until auth has settled and the API has answered. A request that
 *  fails for any reason other than a dead session lands on "needed": the
 *  verify page can show the failure and offer a retry, where the portal
 *  shell would only show a load error with no way to the code. */
export function useSessionVerified(authStatus: string): Verification {
  const [state, setState] = useState<Verification>("checking");
  useEffect(() => {
    if (authStatus !== "signedIn") return;
    let live = true;
    sessionVerified()
      .then((ok) => live && setState(ok ? "ok" : "needed"))
      .catch(() => live && setState("needed"));
    return () => {
      live = false;
    };
  }, [authStatus]);
  return state;
}

/** The verify page, carrying where to go afterwards. */
export function verifyPath(returnTo: string) {
  return `/verify?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Resolve a `returnTo` query value to a path on this origin, or "/". It
 *  arrives through the URL, so it is treated the way the OAuth `state` is. */
export function safeReturnTo(raw: string | null | undefined) {
  if (!raw) return "/";
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return "/";
  }
  if (url.origin !== window.location.origin) return "/";
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!path.startsWith("/") || path.startsWith("//")) return "/";
  // Never bounce back into the verify page itself.
  return path.startsWith("/verify") ? "/" : path;
}
