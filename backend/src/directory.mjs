/* OL Portal · the sign-in directory behind the admin routes.

   admin.mjs owns the portal side of an account — the PERSON record, the audit
   row, who may invite whom — and asks this module for the sign-in side. Which
   directory answers depends on AUTH_PROVIDER, the same switch identity.mjs
   reads: Cognito's user pool, or WorkOS invitations and users. The Cognito
   half is kept whole so the cutover can be reversed by flipping the parameter
   back; nothing about it changed.

   Every function takes and returns the portal's `username` — the PERSON sort
   key. Under Cognito that is the pool Username; under WorkOS it is the
   lowercased email, because WorkOS identifies people by email and the portal
   keys identity on it everywhere (identity.mjs).

   Statuses are reported in Cognito's vocabulary on purpose. The admin page
   branches on the literals CONFIRMED and FORCE_CHANGE_PASSWORD, and mapping a
   pending invitation onto the second keeps the page's diff on one side rather
   than renaming in both places at once:

     FORCE_CHANGE_PASSWORD   invited, has not signed in yet
     CONFIRMED               has an account and can sign in
     NO_ACCOUNT              a PERSON record with nothing to sign in with
                             (WorkOS only — Cognito's list was pool-driven)

   Results are plain objects, never HTTP responses: admin.mjs decides what
   "not found" or "already accepted" means to the caller. */

import {
  CognitoIdentityProviderClient, AdminCreateUserCommand, AdminDeleteUserCommand,
  AdminAddUserToGroupCommand, AdminGetUserCommand, AdminUpdateUserAttributesCommand,
  ListUsersCommand
} from "@aws-sdk/client-cognito-identity-provider";
import * as workos from "./workos.mjs";

export const PROVIDER = process.env.AUTH_PROVIDER === "workos" ? "workos" : "cognito";

const day = iso => (iso ? new Date(iso) : new Date(0)).toISOString().slice(0, 10);

/* ---------- Cognito ---------- */

const POOL = process.env.USER_POOL_ID;
const GROUP_OF_ROLE = { "Admin": "Admin", "Lab Leader": "LabLeader", "Contributor": "Contributor" };
const idp = new CognitoIdentityProviderClient({});

const cognitoAttrs = email => [
  { Name: "email", Value: email },
  { Name: "email_verified", Value: "true" }
];

async function cognitoUser(username) {
  return await idp.send(new AdminGetUserCommand({ UserPoolId: POOL, Username: username }))
    .catch(() => null);
}

const cognito = {
  async listAccounts() {
    const { Users } = await idp.send(new ListUsersCommand({ UserPoolId: POOL, Limit: 60 }));
    return await Promise.all((Users || []).map(async u => {
      const attr = n => u.Attributes?.find(a => a.Name === n)?.Value;
      let mfaEnrolled = false;
      try {
        const detail = await idp.send(new AdminGetUserCommand({ UserPoolId: POOL, Username: u.Username }));
        mfaEnrolled = (detail.UserMFASettingList || []).includes("SOFTWARE_TOKEN_MFA");
      } catch { /* user may be mid-delete; show as not enrolled */ }
      return {
        username: u.Username, email: attr("email") || "", status: u.UserStatus,
        created: day(u.UserCreateDate), mfaEnrolled
      };
    }));
  },

  /* Cognito emails the temporary password. The group is the only place the
     role lives on the sign-in side, so it is written here and nowhere else. */
  async createAccount({ username, email, role }) {
    try {
      await idp.send(new AdminCreateUserCommand({
        UserPoolId: POOL, Username: username,
        UserAttributes: cognitoAttrs(email), DesiredDeliveryMediums: ["EMAIL"]
      }));
    } catch (err) {
      if (err.name === "UsernameExistsException") return { existing: true };
      throw err;
    }
    await idp.send(new AdminAddUserToGroupCommand({
      UserPoolId: POOL, Username: username, GroupName: GROUP_OF_ROLE[role]
    }));
    return { created: true };
  },

  async resendInvite(username) {
    const user = await cognitoUser(username);
    if (!user) return { notFound: true };
    if (user.UserStatus !== "FORCE_CHANGE_PASSWORD") return { accepted: true };
    await idp.send(new AdminCreateUserCommand({
      UserPoolId: POOL, Username: username,
      MessageAction: "RESEND", DesiredDeliveryMediums: ["EMAIL"]
    }));
    return { email: user.UserAttributes?.find(a => a.Name === "email")?.Value };
  },

  async revokeInvite(username) {
    const user = await cognitoUser(username);
    if (!user) return { notFound: true };
    if (user.UserStatus !== "FORCE_CHANGE_PASSWORD") return { accepted: true };
    await idp.send(new AdminDeleteUserCommand({ UserPoolId: POOL, Username: username }));
    return { revoked: true };
  },

  /* Cognito usernames cannot be renamed, so the portal key stays put. */
  async updateEmail(username, email) {
    await idp.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: POOL, Username: username, UserAttributes: cognitoAttrs(email)
    }));
    return { username };
  },

  /* Offboarding removes the way in, not the person: admin.mjs keeps the PERSON
     record so deals they own still resolve to a name. A missing account is not
     an error — a profile that was never invited is offboarded just the same. */
  async deleteAccount(username) {
    if (!(await cognitoUser(username))) return { deleted: false };
    await idp.send(new AdminDeleteUserCommand({ UserPoolId: POOL, Username: username }));
    return { deleted: true };
  },

  /* PRD 2.5: Cognito has no admin API to detach a verified software token
     while pool MFA is ON (AdminSetUserMFAPreference leaves the old token
     challenging), so the reliable reset is delete + recreate: a fresh emailed
     temp password and a TOTP re-enrolment. */
  async resetMfa(username, role) {
    const user = await cognitoUser(username);
    if (!user) return { notFound: true };
    const email = user.UserAttributes?.find(a => a.Name === "email")?.Value;
    if (!email) return { noEmail: true };
    await idp.send(new AdminDeleteUserCommand({ UserPoolId: POOL, Username: username }));
    await idp.send(new AdminCreateUserCommand({
      UserPoolId: POOL, Username: username,
      UserAttributes: cognitoAttrs(email), DesiredDeliveryMediums: ["EMAIL"]
    }));
    await idp.send(new AdminAddUserToGroupCommand({
      UserPoolId: POOL, Username: username, GroupName: GROUP_OF_ROLE[role] || "Contributor"
    }));
    return { detail: "new temp password + 2FA re-enrollment" };
  }
};

/* ---------- WorkOS ---------- */

const addr = s => String(s || "").trim().toLowerCase();

const wos = {
  /* Users and still-pending invitations, side by side. An invited person is
     not a user until they accept — WorkOS holds the invitation and the users
     list stays empty — so listing only users would make every fresh invite
     vanish from the Accounts table the moment it was sent. */
  async listAccounts() {
    const [users, invitations] = await Promise.all([workos.listUsers(), workos.listInvitations()]);
    const accounts = await Promise.all(users.map(async u => {
      let mfaEnrolled = false;
      try {
        mfaEnrolled = (await workos.listAuthFactors(u.id)).length > 0;
      } catch { /* a factor list that cannot be read shows as not enrolled */ }
      return {
        username: addr(u.email), email: u.email, status: "CONFIRMED",
        created: day(u.created_at), mfaEnrolled
      };
    }));
    const known = new Set(accounts.map(a => a.username));
    for (const i of invitations) {
      if (i.state !== "pending" || known.has(addr(i.email))) continue;
      known.add(addr(i.email));
      accounts.push({
        username: addr(i.email), email: i.email, status: "FORCE_CHANGE_PASSWORD",
        created: day(i.created_at), mfaEnrolled: false
      });
    }
    return accounts;
  },

  /* An invitation rather than a user with a password: WorkOS emails the link
     and the person sets their own password, which mirrors Cognito's temp
     credential email and keeps passwords out of everyone's hands. Role and
     labs are not sent — they live on the PERSON record. */
  async createAccount({ email }) {
    if (await workos.findUserByEmail(email)) return { existing: true };
    if (await workos.findPendingInvitation(email)) return { existing: true };
    await workos.sendInvitation(email);
    return { created: true };
  },

  async resendInvite(username) {
    const pending = await workos.findPendingInvitation(username);
    if (pending) {
      await workos.resendInvitation(pending.id);
      return { email: pending.email };
    }
    return (await workos.findUserByEmail(username)) ? { accepted: true } : { notFound: true };
  },

  async revokeInvite(username) {
    const pending = await workos.findPendingInvitation(username);
    if (pending) {
      await workos.revokeInvitation(pending.id);
      return { revoked: true };
    }
    return (await workos.findUserByEmail(username)) ? { accepted: true } : { notFound: true };
  },

  /* The email IS the portal key here, so a change is a re-key: the caller
     moves the PERSON record to the username returned. A person who has only
     been invited has no user to update — the invitation is re-issued to the
     new address instead, since WorkOS cannot edit one in flight. */
  async updateEmail(username, email) {
    const user = await workos.findUserByEmail(username);
    if (user) {
      await workos.updateUser(user.id, { email });
      return { username: addr(email) };
    }
    const pending = await workos.findPendingInvitation(username);
    if (!pending) return { notFound: true };
    await workos.revokeInvitation(pending.id);
    await workos.sendInvitation(email);
    return { username: addr(email), reinvited: true };
  },

  /* Both halves of a way in, because either one alone is still a way in: the
     user if they accepted, and the invitation if they never did. An address
     with neither is not an error — the PERSON record is offboarded regardless
     (see admin.mjs), which is exactly the NO_ACCOUNT case. */
  async deleteAccount(username) {
    const user = await workos.findUserByEmail(username);
    if (user) await workos.deleteUser(user.id);
    const pending = await workos.findPendingInvitation(username);
    if (pending) await workos.revokeInvitation(pending.id);
    return { deleted: !!user, invitationRevoked: !!pending };
  },

  /* Deleting every factor is the whole reset. Nothing is recreated and no
     email goes out: the person signs in as before and is asked to enrol a new
     authenticator on the way in. */
  async resetMfa(username) {
    const user = await workos.findUserByEmail(username);
    if (!user) return { notFound: true };
    const factors = await workos.listAuthFactors(user.id);
    if (!factors.length) return { nothingToReset: true };
    for (const f of factors) await workos.deleteAuthFactor(f.id);
    return { detail: `${factors.length} authenticator(s) removed; re-enrols at next sign-in` };
  }
};

export const directory = PROVIDER === "workos" ? wos : cognito;
