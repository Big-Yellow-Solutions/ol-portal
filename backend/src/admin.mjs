/* OL Portal · admin auth routes (PRD 2.2 invites, 2.5 2FA reset, 2.6 audit log).
   All routes here are admin-only. Lab-Leader-initiated Contributor invites stay
   locked until contract automation exists (PRD 2.2 open question).

   The sign-in side of every account — the Cognito pool or the WorkOS
   directory, chosen by AUTH_PROVIDER — lives in directory.mjs. This module
   owns the portal side: the PERSON record, the audit row, and who may invite
   whom. The two are written together or not at all, because a sign-in with no
   PERSON record gets in and then 403s on everything. */

import { GetCommand, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { doc, TABLE, fullName, writeAudit } from "./util.mjs";
import { directory, PROVIDER } from "./directory.mjs";

/* Re-exported so the modules that have always imported writeAudit from here
   keep working; it now lives in util.mjs. */
export { writeAudit };

const resp = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

const ROLES = ["Admin", "Lab Leader", "Contributor"];

const isAdmin = ctx => ctx.role === "Admin";
const forbidden = () => resp(403, { error: "Admin only" });

const getPerson = async sk =>
  (await doc.send(new GetCommand({ TableName: TABLE, Key: { pk: "PERSON", sk } }))).Item;

/* ---------- users: sign-in accounts merged with PERSON records ----------
   Under WorkOS the merge runs both ways: a PERSON record with nothing to sign
   in with is listed too, as NO_ACCOUNT, because that is exactly the state the
   re-seeded roster sits in until each person is invited — and the only way an
   admin can see who still needs one. */
export async function listPortalUsers(ctx) {
  if (!isAdmin(ctx)) return forbidden();
  const accounts = await directory.listAccounts();
  const users = await Promise.all(accounts.map(async a => {
    const person = await getPerson(a.username);
    return withProfile(a, person);
  }));
  if (PROVIDER === "workos") {
    const seen = new Set(users.map(u => u.username));
    const people = await doc.send(new QueryCommand({
      TableName: TABLE, KeyConditionExpression: "pk = :p",
      ExpressionAttributeValues: { ":p": "PERSON" }
    }));
    for (const p of people.Items || []) {
      if (seen.has(p.sk)) continue;
      users.push(withProfile({
        username: p.sk, email: p.email || "", status: "NO_ACCOUNT", created: "", mfaEnrolled: false
      }, p));
    }
  }
  users.sort((a, b) => a.username.localeCompare(b.username));
  return resp(200, users);
}

const withProfile = (account, person) => ({
  ...account,
  firstName: person?.firstName || "",
  lastName: person?.lastName || "",
  name: fullName(person) || account.username,
  role: person?.role || "",
  labs: person?.labs || []
});

/* ---------- invites (PRD 2.2) ----------
   Admins invite anyone. Lab Leaders may invite a Contributor only when a
   Signed contract in one of their labs names that email (PRD 2.2 gate,
   unlocked by PRD 3.6 contract signing). */
async function signedContractUnlocks(labs, email) {
  const page = await doc.send(new QueryCommand({
    TableName: TABLE, KeyConditionExpression: "pk = :p",
    ExpressionAttributeValues: { ":p": "CONTRACT" }
  }));
  return (page.Items || []).some(c =>
    c.status === "Signed" && labs.includes(c.lab) &&
    (c.contributorEmail || "").toLowerCase() === (email || "").toLowerCase());
}

export async function createInvite(ctx, body) {
  const { firstName, lastName, email, role, labs } = body || {};
  if (!isAdmin(ctx)) {
    if (ctx.role !== "Lab Leader") return forbidden();
    if (role !== "Contributor")
      return resp(403, { error: "Lab Leaders can only invite Contributors" });
    if (!(await signedContractUnlocks(ctx.me.labs || [], email)))
      return resp(403, { error: "No signed contract names this Contributor's email in your lab yet" });
  }
  if (typeof firstName !== "string" || !firstName.trim()) return resp(400, { error: "first name is required" });
  if (typeof lastName !== "string" || !lastName.trim()) return resp(400, { error: "last name is required" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) return resp(400, { error: "valid email is required" });
  if (!ROLES.includes(role)) return resp(400, { error: "role must be Admin, Lab Leader, or Contributor" });
  const labList = Array.isArray(labs) ? labs : [];
  if (!isAdmin(ctx) && labList.some(l => !(ctx.me.labs || []).includes(l)))
    return resp(403, { error: "You can only assign labs you lead" });
  for (const lab of labList) {
    const known = (await doc.send(new GetCommand({ TableName: TABLE, Key: { pk: "LAB", sk: lab } }))).Item;
    if (!known) return resp(400, { error: `unknown lab: ${lab}` });
  }

  const result = await provisionAccount({
    actor: ctx.me.sk, email, firstName: firstName.trim(), lastName: lastName.trim(),
    role, labs: labList
  });
  if (result.existing)
    return resp(409, {
      error: result.existing === "account"
        ? "that email already has a sign-in account or a pending invite"
        : "that email already has a portal profile"
    });
  return resp(201, { invited: result.username });
}

/* The mechanics of provisioning an account, separated from the route's
   argument validation so that something other than a person clicking Invite
   can trigger one. Contract execution does exactly that (Contributor MSA PRD
   FR4) — see inviteContributor below.

   Returns a plain result rather than an HTTP response, because the two callers
   want different things from "this email already exists": the route reports it
   as a conflict, execution treats it as the expected case and moves on. */
async function provisionAccount({ actor, email, firstName, lastName, role, labs }) {
  // Username = email (lowercased) so people sign in with the address they
  // already know. It matches Cognito's case-insensitive Username config and is
  // the only key WorkOS has.
  const username = String(email).trim().toLowerCase();
  if (await getPerson(username)) return { username, existing: "person" };

  const account = await directory.createAccount({ username, email: String(email).trim(), role });
  if (account.existing) return { username, existing: "account" };

  await doc.send(new PutCommand({
    TableName: TABLE,
    Item: {
      pk: "PERSON", sk: username, firstName, lastName,
      role, labs, email: String(email).trim()
    }
  }));
  await writeAudit(actor, "invite.created", `${username} (${role})`);
  return { username, invited: true };
}

/* Contributor MSA PRD FR4: a Contributor who isn't already a Portal member is
   invited to create a profile off the back of their executed MSA, rather than
   waiting for someone to remember to invite them.

   "Already a member" has to be checked against both keys. Accounts created
   before invites existed are keyed by first name (liz, aliza), not by email,
   so a lookup on the email alone would miss them and try to provision a second
   account for someone who already has one. FR4's second half — an existing
   member sees no change — depends on getting this right. */
export async function inviteContributor({ actor, email, name, labs = [] }) {
  const addr = String(email || "").trim().toLowerCase();
  if (!addr) return { skipped: "no email" };

  const people = await doc.send(new QueryCommand({
    TableName: TABLE, KeyConditionExpression: "pk = :p",
    ExpressionAttributeValues: { ":p": "PERSON" }
  }));
  const member = (people.Items || []).find(p =>
    p.sk === addr || String(p.email || "").trim().toLowerCase() === addr);
  if (member) return { skipped: "already a member", username: member.sk };

  /* One free-text name splits into the two fields the profile carries. A
     single-word name (or a company) leaves the last name empty, which is fine:
     fullName() joins whatever is there. The route's own validation is stricter
     because a human typing an invite can be asked for both. */
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return await provisionAccount({
    actor, email: addr,
    firstName: parts[0] || addr,
    lastName: parts.slice(1).join(" "),
    role: "Contributor",
    labs
  });
}

export async function resendInvite(ctx, username) {
  if (!isAdmin(ctx)) return forbidden();
  const r = await directory.resendInvite(username);
  if (r.notFound) return resp(404, { error: "no such user" });
  if (r.accepted) return resp(409, { error: "invite already accepted; nothing to resend" });
  await writeAudit(ctx.me.sk, "invite.resent", `${username} → ${r.email}`);
  return resp(200, { resent: username });
}

export async function revokeInvite(ctx, username) {
  if (!isAdmin(ctx)) return forbidden();
  if (username === ctx.me.sk) return resp(400, { error: "you can't revoke yourself" });
  const r = await directory.revokeInvite(username);
  if (r.notFound) return resp(404, { error: "no such user" });
  if (r.accepted) return resp(409, { error: "invite already accepted; ask an admin to offboard instead" });
  await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: "PERSON", sk: username } }));
  await writeAudit(ctx.me.sk, "invite.revoked", username);
  return resp(200, { revoked: username });
}

/* ---------- account upkeep ----------
   Under Cognito the username survives an email change; under WorkOS the email
   is the username, so the PERSON record moves to the new key. Records that
   point at the old key by value (deal owners, audit actors) are left as they
   are — the same history-stays-put rule the rest of the portal follows. */
export async function updateUserEmail(ctx, username, body) {
  if (!isAdmin(ctx)) return forbidden();
  const { email } = body || {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) return resp(400, { error: "valid email is required" });
  const r = await directory.updateEmail(username, email);
  if (r.notFound) return resp(404, { error: "no such user" });
  const person = await getPerson(username);
  if (person) {
    await doc.send(new PutCommand({ TableName: TABLE, Item: { ...person, sk: r.username, email } }));
    if (r.username !== username)
      await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: "PERSON", sk: username } }));
  }
  await writeAudit(ctx.me.sk, "user.email-changed", `${username} → ${email}`);
  return resp(200, { username: r.username, email });
}

/* PRD 2.5 lost-device recovery: admin resets access after an out-of-band
   identity check. What "reset" does is the directory's business (see
   directory.mjs); the portal profile is untouched either way. */
export async function resetUserMfa(ctx, username) {
  if (!isAdmin(ctx)) return forbidden();
  if (username === ctx.me.sk) return resp(400, { error: "you can't reset your own access" });
  const person = await getPerson(username);
  const r = await directory.resetMfa(username, person?.role);
  if (r.notFound) return resp(404, { error: "no such user" });
  if (r.noEmail) return resp(409, { error: "user has no email on file; set one first" });
  if (r.nothingToReset) return resp(409, { error: "no authenticator is enrolled; nothing to reset" });
  await writeAudit(ctx.me.sk, "user.access-reset", `${username} → ${r.detail}`);
  return resp(200, { mfaReset: username });
}

/* ---------- act as (god-mode view/edit as another user) ----------
   Gated on ctx.realRole, not ctx.role: by the time a request reaches here,
   ctx.role may already be the impersonated target's (see app.mjs), so the
   exit route (stopActingAs) must check the *real* caller's role or an admin
   could get locked out of their own "stop" button. */
export async function startActingAs(ctx, body) {
  if (ctx.realRole !== "Admin") return forbidden();
  const { target } = body || {};
  if (target === ctx.realMe.sk) return resp(400, { error: "You're already you" });
  const person = target && await getPerson(target);
  if (!person) return resp(404, { error: "no such user" });
  if (person.role === "Admin") return resp(403, { error: "Can't act as another Admin" });
  await writeAudit(ctx.realMe.sk, "admin.act-as-start", `${target} (${person.role})`);
  return resp(200, { username: target, name: fullName(person), role: person.role });
}

export async function stopActingAs(ctx) {
  if (ctx.realRole !== "Admin") return forbidden();
  if (ctx.actingAs) await writeAudit(ctx.realMe.sk, "admin.act-as-stop", ctx.me.sk);
  return resp(200, { stopped: true });
}

/* ---------- audit log (PRD 2.6) ---------- */
export async function listAudit(ctx) {
  if (!isAdmin(ctx)) return forbidden();
  const page = await doc.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "pk = :p",
    ExpressionAttributeValues: { ":p": "AUDIT" },
    ScanIndexForward: false,
    Limit: 100
  }));
  return resp(200, (page.Items || []).map(({ sk, actor, action, detail }) => ({
    at: sk.slice(0, 19).replace("T", " "), actor, action, detail
  })));
}
