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

/* AuthKit access tokens are issued by a CLIENT-SCOPED url:

     https://api.workos.com/user_management/<client id>

   not by "https://api.workos.com/" (what WorkOS's prose says) and not by the
   AuthKit domain the browser is redirected to (what its discovery document
   advertises). Expecting either of those rejects every token in the
   environment with `unexpected "iss" claim value`, which reads exactly like a
   bad signing key. That took the portal down on 9/3/26; authorizer.mjs now
   logs the issuer it actually saw so the next mismatch names itself.

   Deriving it from the client id means no environment has to configure this
   to work, and it is strictly tighter than the old default: a token minted
   for another WorkOS application no longer matches the expected issuer, on
   top of already failing the client-scoped JWKS below.

   WORKOS_TOKEN_ISSUER still overrides, for a custom auth domain. */
const issuerFor = clientId => `https://api.workos.com/user_management/${clientId}`;

const issuers = () => {
  const configured = (process.env.WORKOS_TOKEN_ISSUER || "").trim();
  if (configured) return [configured];
  const clientId = (process.env.WORKOS_CLIENT_ID || "").trim();
  if (!clientId) throw new Error("WORKOS_CLIENT_ID is not set");
  return [issuerFor(clientId)];
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
