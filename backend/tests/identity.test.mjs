/* Identity · tests for reading a caller out of either provider's claims.

   This is the seam the WorkOS cutover turns on. Cognito puts the person key in
   `cognito:username` and the role in `cognito:groups`; WorkOS carries neither
   and has to be read from a JWT-template claim plus a role slug. Getting the
   mapping wrong does not fail loudly — it produces a caller with no role, or
   worse, the wrong one — so the mapping is pinned here.

   identityFromClaims picks its branch from AUTH_PROVIDER at module load, so
   each provider is imported under its own cache key.

   Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";

async function loadIdentity(provider, cacheKey) {
  process.env.AUTH_PROVIDER = provider;
  return await import(`../src/identity.mjs?${cacheKey}`);
}

const cognito = await loadIdentity("cognito", "p=cognito");
const workos = await loadIdentity("workos", "p=workos");

test("cognito: username and group become person key and role", () => {
  assert.deepEqual(
    cognito.identityFromClaims({ "cognito:username": "Liz", "cognito:groups": ["LabLeader"] }),
    { username: "liz", role: "Lab Leader" }
  );
});

test("cognito: groups also arrive as a bracketed string from the JWT authorizer", () => {
  assert.deepEqual(
    cognito.identityFromClaims({ "cognito:username": "aliza", "cognito:groups": "[Admin]" }),
    { username: "aliza", role: "Admin" }
  );
});

test("workos: the JWT-template email claim is the person key", () => {
  assert.deepEqual(
    workos.identityFromClaims({ "urn:olportal:email": "Liz@optimisticlabs.com", role: "lab-leader" }),
    { username: "liz@optimisticlabs.com", role: "Lab Leader" }
  );
});

test("workos: the authorizer's flattened `email` key is read too", () => {
  // The Lambda authorizer cannot pass `urn:olportal:email` through API
  // Gateway's flat context map, so it hands over `email` instead.
  assert.deepEqual(
    workos.identityFromClaims({ email: "aliza@optimisticlabs.com", role: "admin" }),
    { username: "aliza@optimisticlabs.com", role: "Admin" }
  );
});

test("workos: every role slug maps to its portal role", () => {
  const of = slug => workos.identityFromClaims({ email: "x@y.z", role: slug }).role;
  assert.equal(of("admin"), "Admin");
  assert.equal(of("lab-leader"), "Lab Leader");
  assert.equal(of("contributor"), "Contributor");
});

test("workos: a role-less token yields no role rather than a default one", () => {
  // No `role` claim means no organization membership. buildContext turns that
  // into "No portal role on this account"; silently defaulting would hand a
  // stranger a Contributor's view of the portal.
  assert.equal(workos.identityFromClaims({ email: "x@y.z" }).role, undefined);
});

test("workos: the seeded `member` role is not a portal role", () => {
  assert.equal(workos.identityFromClaims({ email: "x@y.z", role: "member" }).role, undefined);
});

test("workos: a roles array is honoured when role is absent", () => {
  assert.equal(
    workos.identityFromClaims({ email: "x@y.z", roles: ["member", "admin"] }).role,
    "Admin"
  );
});

test("neither provider invents an identity from empty claims", () => {
  assert.deepEqual(cognito.identityFromClaims({}), { username: "", role: undefined });
  assert.deepEqual(workos.identityFromClaims({}), { username: "", role: undefined });
});

test("cognito claims do not authenticate against the workos reader", () => {
  // The two shapes are disjoint on purpose: a token from the wrong provider
  // produces no caller at all rather than a partial one.
  assert.deepEqual(
    workos.identityFromClaims({ "cognito:username": "liz", "cognito:groups": ["Admin"] }),
    { username: "", role: undefined }
  );
});
