/* OL Portal · API Gateway Lambda authorizer for WorkOS access tokens.

   Replaces the HTTP API's built-in JWT authorizer, which cannot be pointed at
   WorkOS: it resolves keys through OIDC discovery and WorkOS serves no
   discovery document (see authz.mjs). This runs in front of every API route
   instead, verifies the token itself, and hands the claims downstream as
   authorizer context.

   Returns the "simple response" shape (EnableSimpleResponses in template.yaml),
   so the answer is a boolean plus a flat string map — which is why the
   namespaced `urn:olportal:email` claim is flattened to `email` here.
   identity.mjs reads either spelling. */

import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { decodeJwt } from "jose";
import { verifyWorkosToken } from "./authz.mjs";
import { doc, TABLE, writeAudit, AUDIT_TTL_DAYS } from "./util.mjs";

const DENY = { isAuthorized: false };

const log = (message, detail, extra = {}) =>
  console.error(JSON.stringify({ level: "error", message, detail, ...extra }));

/* Sessions this container has already audited.

   WorkOS has no equivalent of Cognito's PostAuthentication trigger, so PRD
   2.6's sign-in row is written the first time a session's token is seen here.
   The conditional put is what actually makes it once-per-session — concurrent
   containers race and exactly one wins — and this Set only keeps warm
   containers from attempting the write on every subsequent request. */
const seenSessions = new Set();
const SEEN_CAP = 500;

async function recordSignIn(actor, sid) {
  if (!sid || seenSessions.has(sid)) return;
  seenSessions.add(sid);
  // Unbounded growth in a long-lived container would be a slow leak; the cap
  // costs at most one redundant conditional put after a reset.
  if (seenSessions.size > SEEN_CAP) seenSessions.clear();

  try {
    await doc.send(new PutCommand({
      TableName: TABLE,
      Item: {
        pk: "SESSION",
        sk: sid,
        actor,
        ttl: Math.floor(Date.now() / 1000) + AUDIT_TTL_DAYS * 86400
      },
      ConditionExpression: "attribute_not_exists(pk)"
    }));
  } catch (err) {
    // Another container already claimed this session — nothing to write. A
    // session still alive after the marker's TTL logs a second sign-in, which
    // is a better failure than dropping the row.
    if (err.name === "ConditionalCheckFailedException") return;
    throw err;
  }

  await writeAudit(actor, "auth.signin", "successful sign-in");
}

export const handler = async event => {
  // HTTP API v2 lowercases header names; the fallback is for direct invokes.
  const header = event.headers?.authorization || event.headers?.Authorization || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return DENY;

  let claims;
  try {
    claims = await verifyWorkosToken(token);
  } catch (err) {
    /* Expired, forged, wrong environment and wrong key all land here and all
       mean the same thing to the caller. Logged with the reason because the
       difference matters a great deal from this side — an issuer mismatch
       after a config change looks exactly like a bad signature otherwise. */
    /* The issuer the token actually carries, alongside the one we expected.
       Both are public URLs, never a secret, and without them an `iss`
       mismatch is indistinguishable from a bad key — which is exactly the
       config error that took the portal down on 9/3. Decoded without
       verifying, so a forged token can only put a string in a log line. */
    let sawIssuer;
    try { sawIssuer = decodeJwt(token).iss; } catch { sawIssuer = "undecodable"; }
    log("token rejected", err.message, {
      issuerSeen: sawIssuer,
      issuerExpected: process.env.WORKOS_TOKEN_ISSUER || "(default)"
    });
    return DENY;
  }

  const email = String(claims["urn:olportal:email"] || claims.email || "").toLowerCase();
  if (!email) {
    // The JWT template that adds this claim is missing from the environment.
    // Nothing downstream can identify the caller, so this is a real failure
    // rather than something to pass along.
    log("token carries no urn:olportal:email claim", `sub ${claims.sub}`);
    return DENY;
  }

  /* A token with no `role` is authorized on purpose. It means the user has no
     organization membership yet, and buildContext answers that with a plain
     403 "No portal role on this account". Denying here would surface as a 401,
     which the client reads as an expired session and answers by signing the
     user out — a confusing loop for a problem that is really "you have not
     been added to the org yet". */
  const role = typeof claims.role === "string" ? claims.role : "";

  try {
    await recordSignIn(email, claims.sid);
  } catch (err) {
    // Never fail a request because the audit write failed — same stance the
    // Cognito PostAuthentication trigger took.
    log("sign-in audit write failed", err.message);
  }

  return {
    isAuthorized: true,
    context: { email, role, sid: claims.sid || "", sub: claims.sub || "" }
  };
};
