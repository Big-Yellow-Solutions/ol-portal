/* A failed token check must only end a session when it is a verdict on the
   token. The browser reads any 401 as "signed out", so a JWKS fetch timing out
   or a container without config must not be answered with a deny.

   Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";
import { errors } from "jose";

process.env.TABLE_NAME = "ol-portal-test";
process.env.AWS_REGION ??= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";

const { isTransientTokenError } = await import("../src/authz.mjs");

test("verdicts on the token are not transient", () => {
  assert.equal(isTransientTokenError(new errors.JWTExpired("expired", {})), false);
  assert.equal(isTransientTokenError(new errors.JWSSignatureVerificationFailed()), false);
  assert.equal(isTransientTokenError(new errors.JWTClaimValidationFailed("iss", {}, "iss", "check_failed")), false);
  assert.equal(isTransientTokenError(new errors.JWKSNoMatchingKey()), false);
});

test("a JWKS timeout, a failed fetch or missing config is transient", () => {
  assert.equal(isTransientTokenError(new errors.JWKSTimeout()), true);
  assert.equal(isTransientTokenError(new TypeError("fetch failed")), true);
  assert.equal(isTransientTokenError(new Error("WORKOS_CLIENT_ID is not set")), true);
});
