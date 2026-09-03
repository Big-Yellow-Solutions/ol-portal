/* The one place that knows how to get a bearer token and how to end a session.

   lib/api.ts and lib/optimist.ts are plain modules, not components, so they
   cannot reach the auth provider through a hook. They used to import Amplify
   directly, which hard-wired both of them to Cognito. They call through here
   instead, and the active provider supplies the implementation.

   Note the two backends do not hand over the same token. Cognito's ID token is
   the one carrying `email` and `cognito:groups`; WorkOS puts identity on the
   *access* token (`urn:olportal:email` via the JWT template, plus `role`).
   Callers only ever want "the token that goes in the Authorization header",
   which is exactly what getAuthToken returns. */

import { CONFIG } from "@/lib/config";

export interface TokenSource {
  /** The bearer token for the API, or null when there is no live session. */
  getToken: () => Promise<string | null>;
  /** Ends the session and gets the user back to a signed-out surface. */
  endSession: () => Promise<void>;
}

let source: TokenSource | null = null;

export function registerTokenSource(next: TokenSource) {
  source = next;
}

function required(): TokenSource {
  if (!source) {
    /* Reachable only if something calls the API from outside the provider
       tree. Failing loudly beats returning null, which the 401 branch would
       read as an expired session and answer with a spurious sign-out. */
    throw new Error(
      `No auth token source registered (provider: ${CONFIG.authProvider}). ` +
        "api() must be called from inside <AuthProvider>."
    );
  }
  return source;
}

export function getAuthToken(): Promise<string | null> {
  return required().getToken();
}

export function endSession(): Promise<void> {
  return required().endSession();
}
