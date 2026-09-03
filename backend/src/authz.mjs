/* OL Portal · WorkOS access-token verification.

   Shared by the two entry points that have to check a token themselves: the
   API Gateway Lambda authorizer (authorizer.mjs) and The Optimist's Function
   URL (optimist-stream.mjs), which has no authorizer at all.

   Why a Lambda authorizer rather than API Gateway's built-in JWT authorizer:
   the built-in one discovers keys through OIDC discovery, and WorkOS does not
   serve it — https://api.workos.com/.well-known/openid-configuration is a 404.
   The JWKS lives at a client-scoped path instead, so the URL has to be built
   by hand and the verification done in code. */

import { createRemoteJWKSet, jwtVerify } from "jose";

/* WorkOS documents the issuer as "https://api.workos.com/" and warns that it
   changes if the environment uses a custom auth domain — so it is read from
   configuration, not hardcoded. (The portal deliberately skipped the $99/mo
   custom domain, so the default is what production will use.)

   Both spellings of the default are accepted because the trailing slash is
   inconsistent between WorkOS's own docs and reference code, and a mismatch
   there fails every request with an error that reads like a bad key. This is
   not a relaxation: both name the same host, and the real binding to *this*
   application is the JWKS path below. */
const DEFAULT_ISSUERS = ["https://api.workos.com/", "https://api.workos.com"];

const issuers = () => {
  const configured = (process.env.WORKOS_TOKEN_ISSUER || "").trim();
  return configured ? [configured] : DEFAULT_ISSUERS;
};

/* Cached across invocations: jose fetches the keys on demand and holds them
   for the life of the process, refetching only when it sees an unknown kid, so
   a warm container verifies without a round trip. */
let jwks;
function keys() {
  if (!jwks) {
    const clientId = process.env.WORKOS_CLIENT_ID;
    if (!clientId) throw new Error("WORKOS_CLIENT_ID is not set");
    jwks = createRemoteJWKSet(
      new URL(`https://api.workos.com/sso/jwks/${clientId}`)
    );
  }
  return jwks;
}

/* Resolves to the token's claims, or throws.

   There is no audience check because WorkOS access tokens carry no `aud`
   unless a JWT template adds one. The equivalent guarantee comes from the
   JWKS path being scoped to our client id: a token minted for a different
   WorkOS application is signed by a different key pair and fails here. */
export async function verifyWorkosToken(token) {
  const { payload } = await jwtVerify(token, keys(), {
    issuer: issuers(),
    // Small allowance for clock skew between Lambda and WorkOS.
    clockTolerance: 5
  });
  return payload;
}

/* Reset point for tests, and for the "the key rotated while the container was
   warm" case jose already handles internally — kept explicit so a future
   caller does not reach into module state. */
export function resetJwksCache() {
  jwks = undefined;
}
