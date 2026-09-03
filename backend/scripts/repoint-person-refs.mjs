/* Repoint the records that name a person, after that person's PERSON key
   changed.

   The WorkOS cutover made the PERSON sort key the lowercased email, and the
   roster was rebuilt around it. Content written before that still names the
   old key — a deal's owner, a file's uploader, a post's author — so it
   resolves to nobody: the deal shows no owner, and any permission that reads
   the owner stops matching the person who actually owns it.

   This rewrites those references and nothing else. It does not create,
   delete or re-key any PERSON record; the target must already exist, and the
   script refuses the mapping if it does not.

   AUDIT rows are deliberately left alone. They are the record of what
   happened under the identity that did it, and rewriting an actor would make
   the log claim something that was never true. Pass --include-audit only if
   you have decided otherwise.

   POST carries `authorName`, a display-name snapshot taken at write time. It
   is refreshed to the target's real name where it currently holds the old key
   — which is what it falls back to when the name was not yet known.

   Usage:
     node scripts/repoint-person-refs.mjs --map liz=liz@example.com
     node scripts/repoint-person-refs.mjs --map liz=liz@example.com --confirm

   Repeat --map for more than one person. Dry run prints the plan and writes
   nothing.

   Env: TABLE_NAME (defaults "ol-portal"). */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, QueryCommand, UpdateCommand, GetCommand
} from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.TABLE_NAME || "ol-portal";
const CONFIRM = process.argv.includes("--confirm");
const INCLUDE_AUDIT = process.argv.includes("--include-audit");

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/* Every record type that carries a person key, and the fields on it that do.
   Kept in step with scripts/migrate-users.mjs, plus the surfaces added since
   (community posts, the resource library, courses). */
const FK_FIELDS = {
  DEAL: ["owner", "dealOwner"],
  PROPOSAL: ["author"],
  INVOICE: ["requestedBy"],
  FILE: ["uploader"],
  KB: ["updatedBy"],
  CONTRACT: ["owner"],
  RECUR: ["owner", "requestedBy"],
  POST: ["author"],
  RESOURCE: ["author"],
  COURSE: ["author"],
  ...(INCLUDE_AUDIT ? { AUDIT: ["actor"] } : {})
};

const mapping = new Map();
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] !== "--map") continue;
  const [from, to] = String(process.argv[i + 1] || "").split("=");
  if (!from || !to) {
    console.error(`--map needs old=new, got "${process.argv[i + 1]}"`);
    process.exit(1);
  }
  mapping.set(from, to);
}
if (!mapping.size) {
  console.error("Nothing to do: pass at least one --map old=new.");
  process.exit(1);
}

const fullName = p => [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim();

/* A reference pointing at a key that does not exist is the bug being fixed;
   pointing it at a second key that does not exist would just move it. */
const targets = new Map();
for (const [from, to] of mapping) {
  const { Item } = await doc.send(new GetCommand({
    TableName: TABLE, Key: { pk: "PERSON", sk: to }
  }));
  if (!Item) {
    console.error(`No PERSON record "${to}" — refusing to point ${from} at it.`);
    process.exit(1);
  }
  targets.set(from, Item);
  console.log(`${from} → ${to} (${fullName(Item) || to}, ${Item.role})`);
}
console.log(`\nTable ${TABLE}. Mode: ${CONFIRM ? "CONFIRM (writing)" : "DRY RUN (no writes)"}`);
if (!INCLUDE_AUDIT) console.log("AUDIT rows are being left as they are.\n");

async function rows(pk) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const page = await doc.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :p",
      ExpressionAttributeValues: { ":p": pk },
      ExclusiveStartKey
    }));
    out.push(...page.Items);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

let changed = 0;
for (const [pk, fields] of Object.entries(FK_FIELDS)) {
  for (const item of await rows(pk)) {
    const sets = {};
    for (const field of fields) {
      const to = mapping.get(item[field]);
      if (to) sets[field] = to;
    }
    // The display snapshot only gets refreshed where it held the key itself.
    if (pk === "POST" && mapping.has(item.authorName)) {
      const name = fullName(targets.get(item.authorName));
      if (name) sets.authorName = name;
    }
    if (!Object.keys(sets).length) continue;

    const plan = Object.entries(sets).map(([f, v]) => `${f}=${v}`).join(", ");
    console.log(`${CONFIRM ? "wrote" : "would write"} ${pk} ${item.sk}: ${plan}`);
    changed++;

    if (CONFIRM) {
      const names = {};
      const values = {};
      const expr = Object.keys(sets).map((f, i) => {
        names[`#f${i}`] = f;
        values[`:v${i}`] = sets[f];
        return `#f${i} = :v${i}`;
      }).join(", ");
      await doc.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: item.pk, sk: item.sk },
        UpdateExpression: `SET ${expr}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        // Someone else re-keying the same row between the read and this write
        // would be silently overwritten otherwise.
        ConditionExpression: "attribute_exists(pk)"
      }));
    }
  }
}

console.log(`\n${CONFIRM ? "Rewrote" : "Would rewrite"} ${changed} reference set(s).`);
if (!CONFIRM && changed) console.log("Re-run with --confirm to write.");
