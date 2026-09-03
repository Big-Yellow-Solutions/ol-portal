/* Admin routes under WorkOS · the rewire that finished the cutover.

   Sign-in moved to WorkOS on 9/3/26, but /admin kept calling Cognito, so the
   Invite form — the one place an account and its access get created together
   — failed. These pin the WorkOS half of directory.mjs and the portal half in
   admin.mjs against an in-memory table and an in-memory WorkOS: what gets
   sent, what gets written, and which of the two the caller hears about.

   Everything above the two fakes is real: the same handlers app.mjs routes
   to, the same validation, the same Lab Leader gate.

   Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_PROVIDER = "workos";
process.env.TABLE_NAME = "ol-portal-test";
process.env.AWS_REGION ??= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";
process.env.AWS_EC2_METADATA_DISABLED = "true";
process.env.AWS_ENDPOINT_URL_DYNAMODB = "http://127.0.0.1:1";

const workos = await import("../src/workos.mjs");
workos.sm.send = async () => ({ SecretString: JSON.stringify({ WorkOS: "sk_test_fake" }) });

const { doc } = await import("../src/util.mjs");
const admin = await import("../src/admin.mjs");

/* ---------- the table, in memory ---------- */
const rows = new Map();
const rowKey = (pk, sk) => `${pk} ${sk}`;
doc.send = async cmd => {
  const name = cmd.constructor.name;
  const i = cmd.input;
  if (name === "PutCommand") { rows.set(rowKey(i.Item.pk, i.Item.sk), structuredClone(i.Item)); return {}; }
  if (name === "GetCommand") {
    const hit = rows.get(rowKey(i.Key.pk, i.Key.sk));
    return { Item: hit ? structuredClone(hit) : undefined };
  }
  if (name === "DeleteCommand") { rows.delete(rowKey(i.Key.pk, i.Key.sk)); return {}; }
  if (name === "QueryCommand") {
    const pk = i.ExpressionAttributeValues[":p"];
    return { Items: [...rows.values()].filter(r => r.pk === pk).map(r => structuredClone(r)) };
  }
  throw new Error(`fake table cannot ${name}`);
};
const people = () => [...rows.values()].filter(r => r.pk === "PERSON");
const audit = () => [...rows.values()].filter(r => r.pk === "AUDIT").map(r => r.action);

/* ---------- WorkOS, in memory ---------- */
const wos = { users: [], invitations: [], factors: {}, calls: [] };
let seq = 0;
const page = data => ({ data, list_metadata: { after: null } });
const json = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status });

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const method = init.method || "GET";
  const body = init.body ? JSON.parse(init.body) : undefined;
  wos.calls.push({ method, path: u.pathname, body });
  assert.equal(init.headers?.authorization, "Bearer sk_test_fake");
  const email = u.searchParams.get("email");
  let m;
  if (method === "GET" && u.pathname === "/user_management/users")
    return json(200, page(wos.users.filter(x => !email || x.email === email)));
  if (method === "GET" && u.pathname === "/user_management/invitations")
    return json(200, page(wos.invitations.filter(x => !email || x.email === email)));
  if (method === "POST" && u.pathname === "/user_management/invitations") {
    const inv = { id: `invitation_${++seq}`, email: body.email, state: "pending", created_at: "2026-09-03T10:00:00Z" };
    wos.invitations.push(inv);
    return json(201, inv);
  }
  if ((m = u.pathname.match(/^\/user_management\/invitations\/(.+)\/(resend|revoke)$/))) {
    const inv = wos.invitations.find(x => x.id === m[1]);
    if (m[2] === "revoke") inv.state = "revoked";
    return json(200, inv);
  }
  if ((m = u.pathname.match(/^\/user_management\/users\/(.+)\/auth_factors$/)))
    return json(200, page(wos.factors[m[1]] || []));
  if (method === "PUT" && (m = u.pathname.match(/^\/user_management\/users\/(.+)$/))) {
    const user = wos.users.find(x => x.id === m[1]);
    Object.assign(user, body);
    return json(200, user);
  }
  if (method === "DELETE" && (m = u.pathname.match(/^\/auth\/factors\/(.+)$/))) {
    for (const id in wos.factors) wos.factors[id] = wos.factors[id].filter(f => f.id !== m[1]);
    return json(200);
  }
  return json(404, { message: `fake WorkOS has no ${method} ${u.pathname}` });
};

const reset = () => {
  rows.clear();
  rows.set(rowKey("LAB", "sports"), { pk: "LAB", sk: "sports", name: "Sports Lab" });
  rows.set(rowKey("PERSON", "teddy@optimisticlabs.com"), {
    pk: "PERSON", sk: "teddy@optimisticlabs.com", firstName: "Teddy", lastName: "Schwarz",
    role: "Admin", labs: [], email: "teddy@optimisticlabs.com"
  });
  wos.users = [{ id: "user_teddy", email: "teddy@optimisticlabs.com", created_at: "2026-09-01T00:00:00Z" }];
  wos.invitations = [];
  wos.factors = { user_teddy: [{ id: "auth_factor_1", type: "totp" }] };
  wos.calls = [];
};

const me = rows.get.bind(rows);
const asAdmin = () => ({ role: "Admin", realRole: "Admin", me: me(rowKey("PERSON", "teddy@optimisticlabs.com")) });
const asLeader = (labs = ["sports"]) => ({
  role: "Lab Leader", realRole: "Lab Leader", me: { sk: "nora@optimisticlabs.com", labs }
});
const body = r => JSON.parse(r.body);
const sent = (method, path) => wos.calls.filter(c => c.method === method && c.path === path);

/* ---------- invites ---------- */

test("an admin invite sends a WorkOS invitation and writes the profile with it", async () => {
  reset();
  const r = await admin.createInvite(asAdmin(), {
    firstName: "Liz", lastName: "Russell", email: "Liz@OptimisticLabs.com", role: "Admin", labs: []
  });
  assert.equal(r.statusCode, 201);
  assert.deepEqual(body(r), { invited: "liz@optimisticlabs.com" });

  const [inv] = sent("POST", "/user_management/invitations");
  assert.deepEqual(inv.body, { email: "liz@optimisticlabs.com", expires_in_days: 7 });
  assert.equal(inv.body.role_slug, undefined, "role lives on the PERSON record, not in WorkOS");

  const person = rows.get(rowKey("PERSON", "liz@optimisticlabs.com"));
  assert.equal(person.role, "Admin");
  assert.equal(person.firstName, "Liz");
  assert.deepEqual(audit(), ["invite.created"]);
});

test("a second invite for a pending address is a conflict and writes nothing", async () => {
  reset();
  await admin.createInvite(asAdmin(), { firstName: "A", lastName: "B", email: "a@b.co", role: "Contributor", labs: ["sports"] });
  rows.delete(rowKey("PERSON", "a@b.co")); // the profile went missing; the invitation did not
  const r = await admin.createInvite(asAdmin(), { firstName: "A", lastName: "B", email: "a@b.co", role: "Contributor", labs: [] });
  assert.equal(r.statusCode, 409);
  assert.match(body(r).error, /pending invite/);
  assert.equal(sent("POST", "/user_management/invitations").length, 1);
});

test("an existing profile is a conflict before WorkOS is asked anything", async () => {
  reset();
  const r = await admin.createInvite(asAdmin(), {
    firstName: "T", lastName: "S", email: "teddy@optimisticlabs.com", role: "Admin", labs: []
  });
  assert.equal(r.statusCode, 409);
  assert.match(body(r).error, /portal profile/);
  assert.equal(wos.calls.length, 0);
});

test("the Lab Leader gate still holds: no signed contract, no invite", async () => {
  reset();
  const r = await admin.createInvite(asLeader(), {
    firstName: "C", lastName: "D", email: "c@d.co", role: "Contributor", labs: ["sports"]
  });
  assert.equal(r.statusCode, 403);
  rows.set(rowKey("CONTRACT", "C-1"), { pk: "CONTRACT", sk: "C-1", status: "Signed", lab: "sports", contributorEmail: "C@d.co" });
  const ok = await admin.createInvite(asLeader(), {
    firstName: "C", lastName: "D", email: "c@d.co", role: "Contributor", labs: ["sports"]
  });
  assert.equal(ok.statusCode, 201);
});

test("the MSA auto-invite goes through the same path and skips existing members", async () => {
  reset();
  rows.set(rowKey("PERSON", "aliza"), { pk: "PERSON", sk: "aliza", name: "Aliza Goodman", role: "Lab Leader", email: "aliza@optimisticlabs.com" });
  const skipped = await admin.inviteContributor({ actor: "system", email: "Aliza@optimisticlabs.com", name: "Aliza Goodman" });
  assert.deepEqual(skipped, { skipped: "already a member", username: "aliza" });

  const r = await admin.inviteContributor({ actor: "system", email: "new@vendor.co", name: "New Vendor", labs: ["sports"] });
  assert.equal(r.invited, true);
  assert.equal(rows.get(rowKey("PERSON", "new@vendor.co")).role, "Contributor");
  assert.equal(sent("POST", "/user_management/invitations").length, 1);
});

/* ---------- the accounts list ---------- */

test("the list merges users, pending invitations, and profiles with no account", async () => {
  reset();
  wos.invitations.push(
    { id: "invitation_p", email: "liz@optimisticlabs.com", state: "pending", created_at: "2026-09-02T00:00:00Z" },
    { id: "invitation_x", email: "gone@optimisticlabs.com", state: "revoked", created_at: "2026-09-02T00:00:00Z" }
  );
  rows.set(rowKey("PERSON", "liz@optimisticlabs.com"), { pk: "PERSON", sk: "liz@optimisticlabs.com", firstName: "Liz", lastName: "Russell", role: "Admin", labs: [] });
  rows.set(rowKey("PERSON", "marcus"), { pk: "PERSON", sk: "marcus", name: "Marcus Webb", role: "Lab Leader", labs: ["sports"] });

  const r = await admin.listPortalUsers(asAdmin());
  assert.equal(r.statusCode, 200);
  const byUser = Object.fromEntries(body(r).map(u => [u.username, u]));
  assert.deepEqual(Object.keys(byUser).sort(), ["liz@optimisticlabs.com", "marcus", "teddy@optimisticlabs.com"]);

  assert.equal(byUser["teddy@optimisticlabs.com"].status, "CONFIRMED");
  assert.equal(byUser["teddy@optimisticlabs.com"].mfaEnrolled, true);
  assert.equal(byUser["teddy@optimisticlabs.com"].created, "2026-09-01");
  assert.equal(byUser["teddy@optimisticlabs.com"].name, "Teddy Schwarz");

  assert.equal(byUser["liz@optimisticlabs.com"].status, "FORCE_CHANGE_PASSWORD");
  assert.equal(byUser["liz@optimisticlabs.com"].role, "Admin");

  assert.equal(byUser.marcus.status, "NO_ACCOUNT");
  assert.equal(byUser.marcus.role, "Lab Leader");
  assert.equal(byUser["gone@optimisticlabs.com"], undefined, "a revoked invitation is not an account");
});

test("the list is admin-only", async () => {
  reset();
  assert.equal((await admin.listPortalUsers(asLeader())).statusCode, 403);
});

/* ---------- resend / revoke ---------- */

test("resend re-sends the pending invitation; an accepted one is a conflict", async () => {
  reset();
  wos.invitations.push({ id: "invitation_p", email: "liz@optimisticlabs.com", state: "pending" });
  const r = await admin.resendInvite(asAdmin(), "liz@optimisticlabs.com");
  assert.equal(r.statusCode, 200);
  assert.equal(sent("POST", "/user_management/invitations/invitation_p/resend").length, 1);
  assert.deepEqual(audit(), ["invite.resent"]);

  assert.equal((await admin.resendInvite(asAdmin(), "teddy@optimisticlabs.com")).statusCode, 409);
  assert.equal((await admin.resendInvite(asAdmin(), "nobody@x.co")).statusCode, 404);
});

test("revoke revokes the invitation and removes the profile", async () => {
  reset();
  wos.invitations.push({ id: "invitation_p", email: "liz@optimisticlabs.com", state: "pending" });
  rows.set(rowKey("PERSON", "liz@optimisticlabs.com"), { pk: "PERSON", sk: "liz@optimisticlabs.com", role: "Admin" });
  const r = await admin.revokeInvite(asAdmin(), "liz@optimisticlabs.com");
  assert.equal(r.statusCode, 200);
  assert.equal(sent("POST", "/user_management/invitations/invitation_p/revoke").length, 1);
  assert.equal(rows.has(rowKey("PERSON", "liz@optimisticlabs.com")), false);

  const accepted = await admin.revokeInvite(asAdmin(), "teddy@optimisticlabs.com");
  assert.equal(accepted.statusCode, 400, "an admin cannot revoke themselves");
});

/* ---------- email change ---------- */

test("changing an email updates the WorkOS user and re-keys the profile", async () => {
  reset();
  wos.users.push({ id: "user_liz", email: "liz@optimisticlabs.com" });
  rows.set(rowKey("PERSON", "liz@optimisticlabs.com"), {
    pk: "PERSON", sk: "liz@optimisticlabs.com", firstName: "Liz", lastName: "Russell", role: "Admin", labs: [], email: "liz@optimisticlabs.com"
  });
  const r = await admin.updateUserEmail(asAdmin(), "liz@optimisticlabs.com", { email: "liz@newdomain.org" });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(body(r), { username: "liz@newdomain.org", email: "liz@newdomain.org" });

  const [put] = sent("PUT", "/user_management/users/user_liz");
  assert.deepEqual(put.body, { email: "liz@newdomain.org", email_verified: true });

  assert.equal(rows.has(rowKey("PERSON", "liz@optimisticlabs.com")), false);
  const moved = rows.get(rowKey("PERSON", "liz@newdomain.org"));
  assert.equal(moved.firstName, "Liz");
  assert.equal(moved.role, "Admin");
  assert.equal(moved.email, "liz@newdomain.org");
});

test("changing the email of someone only invited re-issues the invitation", async () => {
  reset();
  wos.invitations.push({ id: "invitation_p", email: "liz@optimisticlabs.com", state: "pending" });
  rows.set(rowKey("PERSON", "liz@optimisticlabs.com"), { pk: "PERSON", sk: "liz@optimisticlabs.com", role: "Admin" });
  const r = await admin.updateUserEmail(asAdmin(), "liz@optimisticlabs.com", { email: "liz@newdomain.org" });
  assert.equal(r.statusCode, 200);
  assert.equal(sent("POST", "/user_management/invitations/invitation_p/revoke").length, 1);
  assert.deepEqual(sent("POST", "/user_management/invitations")[0].body.email, "liz@newdomain.org");
  assert.equal(rows.get(rowKey("PERSON", "liz@newdomain.org")).role, "Admin");
});

/* ---------- 2FA reset ---------- */

test("reset removes every authenticator and nothing else", async () => {
  reset();
  wos.users.push({ id: "user_liz", email: "liz@optimisticlabs.com" });
  wos.factors.user_liz = [{ id: "auth_factor_a" }, { id: "auth_factor_b" }];
  rows.set(rowKey("PERSON", "liz@optimisticlabs.com"), { pk: "PERSON", sk: "liz@optimisticlabs.com", role: "Admin" });

  const r = await admin.resetUserMfa(asAdmin(), "liz@optimisticlabs.com");
  assert.equal(r.statusCode, 200);
  assert.deepEqual(sent("DELETE", "/auth/factors/auth_factor_a").length, 1);
  assert.deepEqual(sent("DELETE", "/auth/factors/auth_factor_b").length, 1);
  assert.deepEqual(wos.factors.user_liz, []);
  assert.equal(wos.users.length, 2, "no user was deleted or recreated");
  assert.ok(rows.has(rowKey("PERSON", "liz@optimisticlabs.com")));
  assert.deepEqual(audit(), ["user.access-reset"]);

  assert.equal((await admin.resetUserMfa(asAdmin(), "liz@optimisticlabs.com")).statusCode, 409, "nothing left to reset");
  assert.equal((await admin.resetUserMfa(asAdmin(), "teddy@optimisticlabs.com")).statusCode, 400, "not yourself");
});

test("every route is admin-only", async () => {
  reset();
  for (const call of [
    () => admin.resendInvite(asLeader(), "x@y.z"),
    () => admin.revokeInvite(asLeader(), "x@y.z"),
    () => admin.updateUserEmail(asLeader(), "x@y.z", { email: "a@b.co" }),
    () => admin.resetUserMfa(asLeader(), "x@y.z")
  ]) assert.equal((await call()).statusCode, 403);
  assert.equal(wos.calls.length, 0);
});
