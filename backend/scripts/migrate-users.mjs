/* One-time migration, run after deploying the username=email / first+last name
   change: brings every existing account in line with the new PERSON shape.

   For each PERSON record this does two independent things:
     1. Splits a legacy `name` field into `firstName`/`lastName` (first word /
        remainder — hand-correct afterwards for anyone that doesn't fit).
     2. Makes the Cognito `Username` (and the PERSON item's `sk`, and every
        foreign-key field that points at it) equal to the person's email.

   Cognito Usernames are immutable — there is no admin API to rename one in
   place — so renaming means delete + recreate, exactly like admin.mjs's
   resetUserMfa. That means every account whose current username isn't
   already its email:
     - gets a brand-new emailed temporary password (their old one stops working)
     - has to re-enroll two-factor at next sign-in
     - keeps all of their portal data — only the login identity changes

   Warn the affected people before running this for real. DynamoDB's
   partition key can't be renamed in place either, so PERSON items are
   likewise recreated under the new key, and every other item that names a
   person (deals, proposals, invoices, files, KB entries, audit rows,
   contracts, recurring instances) gets that reference rewritten in the same
   pass so nothing is left pointing at a deleted key.

   Safe to re-run: anyone already keyed by their email and already split
   into firstName/lastName is left untouched.

   Usage:
     node scripts/migrate-users.mjs              # dry run — prints the plan only
     node scripts/migrate-users.mjs --confirm     # actually writes/renames

   Env: TABLE_NAME (defaults "ol-portal"), USER_POOL_ID (required to --confirm;
   optional for a dry run of the DynamoDB-only parts). */

import {
  CognitoIdentityProviderClient, AdminCreateUserCommand,
  AdminDeleteUserCommand, AdminAddUserToGroupCommand, AdminListGroupsForUserCommand
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand
} from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.TABLE_NAME || "ol-portal";
const POOL = process.env.USER_POOL_ID;
const CONFIRM = process.argv.includes("--confirm");

const idp = new CognitoIdentityProviderClient({});
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const GROUP_OF_ROLE = { "Admin": "Admin", "Lab Leader": "LabLeader", "Contributor": "Contributor" };

// Every item type that carries a username-shaped foreign key, and which
// field(s) on it need to follow the rename.
const FK_FIELDS = {
  DEAL: ["owner", "dealOwner"],
  PROPOSAL: ["author"],
  INVOICE: ["requestedBy"],
  FILE: ["uploader"],
  KB: ["updatedBy"],
  AUDIT: ["actor"],
  CONTRACT: ["owner"],
  RECUR: ["owner", "requestedBy"]
};

async function listType(pk) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const page = await doc.send(new QueryCommand({
      TableName: TABLE, KeyConditionExpression: "pk = :p",
      ExpressionAttributeValues: { ":p": pk }, ExclusiveStartKey
    }));
    out.push(...page.Items);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

async function renameForeignKeys(oldUsername, newUsername) {
  let touched = 0;
  for (const [pk, fields] of Object.entries(FK_FIELDS)) {
    const items = await listType(pk);
    for (const item of items) {
      let changed = false;
      const next = { ...item };
      for (const f of fields) {
        if (next[f] === oldUsername) { next[f] = newUsername; changed = true; }
      }
      if (changed) {
        touched++;
        if (CONFIRM) await doc.send(new PutCommand({ TableName: TABLE, Item: next }));
        console.log(`  ${CONFIRM ? "rewrote" : "would rewrite"} ${pk} ${item.sk}: ${fields.filter(f => item[f] === oldUsername).join(", ")} → ${newUsername}`);
      }
    }
  }
  return touched;
}

async function migratePerson(person) {
  const oldUsername = person.sk;
  const needsNameSplit = !person.firstName && !person.lastName && person.name;
  const { firstName, lastName } = needsNameSplit
    ? splitName(person.name)
    : { firstName: person.firstName || "", lastName: person.lastName || "" };

  const newUsername = (person.email || oldUsername).trim().toLowerCase();
  const needsRename = newUsername !== oldUsername;

  if (!needsNameSplit && !needsRename) {
    console.log(`skip ${oldUsername}: already migrated`);
    return;
  }

  console.log(`${CONFIRM ? "migrating" : "would migrate"} ${oldUsername}` +
    (needsRename ? ` → ${newUsername} (Cognito rename: new temp password + MFA reset)` : "") +
    (needsNameSplit ? ` · name split: "${person.name}" → firstName="${firstName}" lastName="${lastName}"` : ""));

  const { pk, sk, name, ...rest } = person;
  const nextPerson = { pk: "PERSON", sk: newUsername, firstName, lastName, ...rest };

  if (!CONFIRM) {
    if (needsRename) await renameForeignKeys(oldUsername, newUsername); // dry-run preview only
    return;
  }

  if (needsRename) {
    if (!POOL) throw new Error("USER_POOL_ID is required to --confirm a username rename");
    const groups = await idp.send(new AdminListGroupsForUserCommand({ UserPoolId: POOL, Username: oldUsername }))
      .then(r => (r.Groups || []).map(g => g.GroupName)).catch(() => []);
    const group = groups.find(g => Object.values(GROUP_OF_ROLE).includes(g)) || GROUP_OF_ROLE[person.role] || "Contributor";

    await idp.send(new AdminDeleteUserCommand({ UserPoolId: POOL, Username: oldUsername }));
    await idp.send(new AdminCreateUserCommand({
      UserPoolId: POOL, Username: newUsername,
      UserAttributes: [
        { Name: "email", Value: person.email || newUsername },
        { Name: "email_verified", Value: "true" }
      ],
      DesiredDeliveryMediums: ["EMAIL"]
    }));
    await idp.send(new AdminAddUserToGroupCommand({ UserPoolId: POOL, Username: newUsername, GroupName: group }));

    await doc.send(new PutCommand({ TableName: TABLE, Item: nextPerson }));
    await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: "PERSON", sk: oldUsername } }));
    await renameForeignKeys(oldUsername, newUsername);
  } else {
    await doc.send(new PutCommand({ TableName: TABLE, Item: nextPerson }));
  }
}

const people = await listType("PERSON");
console.log(`Found ${people.length} PERSON record(s). Mode: ${CONFIRM ? "CONFIRM (writing)" : "DRY RUN (no writes)"}`);
for (const person of people) {
  await migratePerson(person);
}
console.log(CONFIRM ? "Migration complete." : "Dry run complete — re-run with --confirm to apply.");
