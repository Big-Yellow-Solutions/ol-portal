/* OL Portal · admin auth routes (PRD 2.2 invites, 2.5 2FA reset, 2.6 audit log).
   All routes here are admin-only. Lab-Leader-initiated Contributor invites stay
   locked until contract automation exists (PRD 2.2 open question). */

import {
  CognitoIdentityProviderClient, AdminCreateUserCommand, AdminDeleteUserCommand,
  AdminAddUserToGroupCommand, AdminGetUserCommand, AdminUpdateUserAttributesCommand,
  ListUsersCommand
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand
} from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.TABLE_NAME;
const POOL = process.env.USER_POOL_ID;
const idp = new CognitoIdentityProviderClient({});
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const resp = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

const GROUP_OF_ROLE = { "Admin": "Admin", "Lab Leader": "LabLeader", "Contributor": "Contributor" };
const AUDIT_TTL_DAYS = 90;

export async function writeAudit(actor, action, detail) {
  const now = new Date();
  await doc.send(new PutCommand({
    TableName: TABLE,
    Item: {
      pk: "AUDIT",
      sk: now.toISOString() + "#" + Math.random().toString(36).slice(2, 6),
      actor, action, detail,
      ttl: Math.floor(now.getTime() / 1000) + AUDIT_TTL_DAYS * 86400
    }
  }));
}

const isAdmin = ctx => ctx.role === "Admin";
const forbidden = () => resp(403, { error: "Admin only" });

/* ---------- users: Cognito accounts merged with PERSON records ---------- */
export async function listPortalUsers(ctx) {
  if (!isAdmin(ctx)) return forbidden();
  const { Users } = await idp.send(new ListUsersCommand({ UserPoolId: POOL, Limit: 60 }));
  const users = await Promise.all((Users || []).map(async u => {
    const attr = n => u.Attributes?.find(a => a.Name === n)?.Value;
    const person = (await doc.send(new GetCommand({
      TableName: TABLE, Key: { pk: "PERSON", sk: u.Username }
    }))).Item;
    let mfaEnrolled = false;
    try {
      const detail = await idp.send(new AdminGetUserCommand({ UserPoolId: POOL, Username: u.Username }));
      mfaEnrolled = (detail.UserMFASettingList || []).includes("SOFTWARE_TOKEN_MFA");
    } catch { /* user may be mid-delete; show as not enrolled */ }
    return {
      username: u.Username,
      email: attr("email") || "",
      status: u.UserStatus,
      created: (u.UserCreateDate || new Date(0)).toISOString().slice(0, 10),
      mfaEnrolled,
      name: person?.name || u.Username,
      role: person?.role || "",
      labs: person?.labs || []
    };
  }));
  users.sort((a, b) => a.username.localeCompare(b.username));
  return resp(200, users);
}

/* ---------- invites (PRD 2.2): Cognito emails the temp credentials ---------- */
export async function createInvite(ctx, body) {
  if (!isAdmin(ctx)) return forbidden();
  const { username, name, email, role, labs } = body || {};
  if (!/^[a-z][a-z0-9._-]{1,30}$/.test(username || ""))
    return resp(400, { error: "username must be lowercase letters/numbers, 2-31 chars" });
  if (typeof name !== "string" || !name.trim()) return resp(400, { error: "name is required" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) return resp(400, { error: "valid email is required" });
  if (!GROUP_OF_ROLE[role]) return resp(400, { error: "role must be Admin, Lab Leader, or Contributor" });
  const labList = Array.isArray(labs) ? labs : [];
  for (const lab of labList) {
    const known = (await doc.send(new GetCommand({ TableName: TABLE, Key: { pk: "LAB", sk: lab } }))).Item;
    if (!known) return resp(400, { error: `unknown lab: ${lab}` });
  }
  const existing = (await doc.send(new GetCommand({
    TableName: TABLE, Key: { pk: "PERSON", sk: username }
  }))).Item;
  if (existing) return resp(409, { error: "that username already has a portal profile" });

  try {
    await idp.send(new AdminCreateUserCommand({
      UserPoolId: POOL, Username: username,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" }
      ],
      DesiredDeliveryMediums: ["EMAIL"]
    }));
  } catch (err) {
    if (err.name === "UsernameExistsException")
      return resp(409, { error: "that username already exists in Cognito" });
    throw err;
  }
  await idp.send(new AdminAddUserToGroupCommand({
    UserPoolId: POOL, Username: username, GroupName: GROUP_OF_ROLE[role]
  }));
  await doc.send(new PutCommand({
    TableName: TABLE,
    Item: { pk: "PERSON", sk: username, name: name.trim(), role, labs: labList, email }
  }));
  await writeAudit(ctx.me.sk, "invite.created", `${username} (${role}) → ${email}`);
  return resp(201, { invited: username });
}

export async function resendInvite(ctx, username) {
  if (!isAdmin(ctx)) return forbidden();
  const user = await idp.send(new AdminGetUserCommand({ UserPoolId: POOL, Username: username }))
    .catch(() => null);
  if (!user) return resp(404, { error: "no such user" });
  if (user.UserStatus !== "FORCE_CHANGE_PASSWORD")
    return resp(409, { error: "invite already accepted; nothing to resend" });
  const email = user.UserAttributes?.find(a => a.Name === "email")?.Value;
  await idp.send(new AdminCreateUserCommand({
    UserPoolId: POOL, Username: username,
    MessageAction: "RESEND", DesiredDeliveryMediums: ["EMAIL"]
  }));
  await writeAudit(ctx.me.sk, "invite.resent", `${username} → ${email}`);
  return resp(200, { resent: username });
}

export async function revokeInvite(ctx, username) {
  if (!isAdmin(ctx)) return forbidden();
  if (username === ctx.me.sk) return resp(400, { error: "you can't revoke yourself" });
  const user = await idp.send(new AdminGetUserCommand({ UserPoolId: POOL, Username: username }))
    .catch(() => null);
  if (!user) return resp(404, { error: "no such user" });
  if (user.UserStatus !== "FORCE_CHANGE_PASSWORD")
    return resp(409, { error: "invite already accepted; ask an admin to offboard instead" });
  await idp.send(new AdminDeleteUserCommand({ UserPoolId: POOL, Username: username }));
  await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: "PERSON", sk: username } }));
  await writeAudit(ctx.me.sk, "invite.revoked", username);
  return resp(200, { revoked: username });
}

/* ---------- account upkeep ---------- */
export async function updateUserEmail(ctx, username, body) {
  if (!isAdmin(ctx)) return forbidden();
  const { email } = body || {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) return resp(400, { error: "valid email is required" });
  await idp.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: POOL, Username: username,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "email_verified", Value: "true" }
    ]
  }));
  const person = (await doc.send(new GetCommand({
    TableName: TABLE, Key: { pk: "PERSON", sk: username }
  }))).Item;
  if (person) await doc.send(new PutCommand({ TableName: TABLE, Item: { ...person, email } }));
  await writeAudit(ctx.me.sk, "user.email-changed", `${username} → ${email}`);
  return resp(200, { username, email });
}

/* PRD 2.5 lost-device recovery: admin resets access after out-of-band identity
   check. Cognito has no admin API to detach a verified software token while
   pool MFA is ON (AdminSetUserMFAPreference leaves the old token challenging),
   so the reliable reset is delete + recreate: the user gets a fresh emailed
   temp password and re-enrolls TOTP. The portal profile (PERSON record) is
   keyed by username and survives untouched. */
export async function resetUserMfa(ctx, username) {
  if (!isAdmin(ctx)) return forbidden();
  if (username === ctx.me.sk) return resp(400, { error: "you can't reset your own access" });
  const user = await idp.send(new AdminGetUserCommand({ UserPoolId: POOL, Username: username }))
    .catch(() => null);
  if (!user) return resp(404, { error: "no such user" });
  const email = user.UserAttributes?.find(a => a.Name === "email")?.Value;
  if (!email) return resp(409, { error: "user has no email on file; set one first" });
  const person = (await doc.send(new GetCommand({
    TableName: TABLE, Key: { pk: "PERSON", sk: username }
  }))).Item;
  const group = GROUP_OF_ROLE[person?.role] || "Contributor";

  await idp.send(new AdminDeleteUserCommand({ UserPoolId: POOL, Username: username }));
  await idp.send(new AdminCreateUserCommand({
    UserPoolId: POOL, Username: username,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "email_verified", Value: "true" }
    ],
    DesiredDeliveryMediums: ["EMAIL"]
  }));
  await idp.send(new AdminAddUserToGroupCommand({
    UserPoolId: POOL, Username: username, GroupName: group
  }));
  await writeAudit(ctx.me.sk, "user.access-reset", `${username} → new temp password + 2FA re-enrollment`);
  return resp(200, { mfaReset: username });
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
