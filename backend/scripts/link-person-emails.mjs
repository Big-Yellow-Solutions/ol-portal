/* One-time backfill: give every pre-WorkOS PERSON record the email address it
   signs in with, so identity.mjs can link an account to its profile.

   Why this exists. Sign-in moved to WorkOS on 9/3/26, and with it the identity
   the portal keys on: Cognito's pool Username (`liz`, `aliza`) became the
   lowercased email. Records written since carry both — the email IS the sort
   key. The seven written before carry neither, so `get("PERSON", <email>)`
   misses and their owners are told they have no portal profile even though
   they authenticated. identity.mjs falls back to matching the verified email
   claim against this `email` attribute; this script is what puts it there.

   What it does NOT do, deliberately: it does not touch the sort key. Renaming
   `liz` to `liz@optimisticlabs.com` would mean rewriting every deal owner,
   proposal author, invoice requester and audit actor that names her — that is
   scripts/migrate-users.mjs, it forces a Cognito password reset and a
   two-factor re-enrolment on everyone it touches, and none of it is needed to
   get people back into the portal. This adds one attribute and changes nothing
   else, so it is reversible by removing that attribute.

   Emails come from the Cognito pool, which is still the record of who was
   invited as whom. A record that already has an email is left alone, so this
   is safe to re-run, and it is safe to run before or after the identity.mjs
   deploy: an unread attribute does nothing on its own.

   Usage:
     node scripts/link-person-emails.mjs             # dry run — prints the plan
     node scripts/link-person-emails.mjs --confirm   # writes the attribute

   Env: TABLE_NAME (defaults "ol-portal"), USER_POOL_ID (required). */

import {
  CognitoIdentityProviderClient, AdminGetUserCommand
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, QueryCommand, UpdateCommand
} from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.TABLE_NAME || "ol-portal";
const POOL = process.env.USER_POOL_ID;
const CONFIRM = process.argv.includes("--confirm");

if (!POOL) {
  console.error("USER_POOL_ID is required — it is where the addresses live.");
  process.exit(1);
}

const idp = new CognitoIdentityProviderClient({});
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function people() {
  const out = [];
  let ExclusiveStartKey;
  do {
    const page = await doc.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :p",
      ExpressionAttributeValues: { ":p": "PERSON" },
      ExclusiveStartKey
    }));
    out.push(...page.Items);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

async function cognitoEmail(username) {
  try {
    const user = await idp.send(
      new AdminGetUserCommand({ UserPoolId: POOL, Username: username })
    );
    return user.UserAttributes?.find(a => a.Name === "email")?.Value || null;
  } catch (err) {
    if (err.name === "UserNotFoundException") return null;
    throw err;
  }
}

const rows = await people();
console.log(
  `Found ${rows.length} PERSON record(s). Mode: ${CONFIRM ? "CONFIRM (writing)" : "DRY RUN (no writes)"}\n`
);

/* Two records resolving to one address would make the sign-in ambiguous, and
   identity.mjs fails closed on that rather than picking one. Catch it here,
   where it is a report instead of a lockout. */
const claimed = new Map();
for (const person of rows) {
  const existing = String(person.email || "").trim().toLowerCase();
  if (existing) claimed.set(existing, [...(claimed.get(existing) || []), person.sk]);
}

let written = 0;
let skipped = 0;
let missing = 0;

for (const person of rows) {
  if (String(person.email || "").trim()) {
    console.log(`skip ${person.sk}: already has an email`);
    skipped++;
    continue;
  }

  const email = await cognitoEmail(person.sk);
  if (!email) {
    console.log(`MISSING ${person.sk}: no Cognito account, so no address to link`);
    missing++;
    continue;
  }

  const key = email.trim().toLowerCase();
  const owners = claimed.get(key) || [];
  if (owners.length) {
    console.log(
      `CONFLICT ${person.sk}: ${key} already belongs to ${owners.join(", ")} — resolve by hand, not linked`
    );
    missing++;
    continue;
  }
  claimed.set(key, [person.sk]);

  if (CONFIRM) {
    /* Conditional so a record that gained an email between the read and this
       write is never overwritten. */
    await doc.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk: "PERSON", sk: person.sk },
      UpdateExpression: "SET email = :e",
      ConditionExpression: "attribute_not_exists(email) OR email = :empty",
      ExpressionAttributeValues: { ":e": email.trim(), ":empty": "" }
    }));
  }
  console.log(`${CONFIRM ? "linked" : "would link"} ${person.sk} → ${key}`);
  written++;
}

console.log(
  `\n${CONFIRM ? "Linked" : "Would link"} ${written}, skipped ${skipped}, needs attention ${missing}.`
);
if (!CONFIRM && written) console.log("Re-run with --confirm to write.");
