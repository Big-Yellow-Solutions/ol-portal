/* Renames the stored deal stages to the collapsed pipeline.

     Proposal Sent, Negotiating → Proposal & Negotiation
     Contracted                 → Contracted (Signed)
     Closed                     → Closed Won (Paid)

   Lead, Discovery and Closed Lost are unchanged. The mapping is
   LEGACY_STAGE_MAP in src/stages.mjs. Only `stage` is rewritten: `outcome`
   already means Won at Closed and stays Won at Closed Won (Paid), and
   nothing else on a deal moves.

   Run it as part of the same release as the code that reads the new names —
   until then the old backend does not know them. It is safe to re-run: a
   deal already on a new name matches nothing, and each write is conditional
   on the stage still being what the scan saw, so a deal someone moves
   between the scan and the write is skipped rather than overwritten.

   Usage:
     node scripts/migrate-stages.mjs             # dry run: prints the plan
     node scripts/migrate-stages.mjs --confirm   # writes

   Env: TABLE_NAME (default "ol-portal"), AWS_PROFILE (use ol-portal). */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { STAGES, LEGACY_STAGE_MAP } from "../src/stages.mjs";

const TABLE = process.env.TABLE_NAME || "ol-portal";
const CONFIRM = process.argv.includes("--confirm");
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const deals = [];
let ExclusiveStartKey;
do {
  const page = await doc.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "pk = :p",
    ExpressionAttributeValues: { ":p": "DEAL" },
    ExclusiveStartKey
  }));
  deals.push(...page.Items);
  ExclusiveStartKey = page.LastEvaluatedKey;
} while (ExclusiveStartKey);

console.log(`Table ${TABLE}. Mode: ${CONFIRM ? "CONFIRM (writing)" : "DRY RUN (no writes)"}`);
console.log(`${deals.length} deals.\n`);

const tally = {};
const unknown = [];
let moved = 0, skipped = 0;
for (const d of deals) {
  const to = LEGACY_STAGE_MAP[d.stage];
  if (!to) {
    if (!STAGES.includes(d.stage)) unknown.push(d);
    continue;
  }
  const key = `${d.stage} → ${to}`;
  tally[key] = (tally[key] || 0) + 1;
  if (!CONFIRM) { moved++; continue; }
  try {
    await doc.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk: "DEAL", sk: d.sk },
      UpdateExpression: "SET stage = :to",
      ConditionExpression: "stage = :from",
      ExpressionAttributeValues: { ":to": to, ":from": d.stage }
    }));
    moved++;
  } catch (err) {
    if (err.name !== "ConditionalCheckFailedException") throw err;
    skipped++;
    console.log(`skipped ${d.sk}: its stage changed during the run`);
  }
}

for (const [k, n] of Object.entries(tally)) console.log(`${String(n).padStart(4)}  ${k}`);
console.log(`\n${CONFIRM ? "Updated" : "Would update"} ${moved} deal${moved === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}.`);
if (unknown.length) {
  console.log(`\n${unknown.length} deal(s) have a stage this script does not recognise and were left alone:`);
  for (const d of unknown) console.log(`  ${d.sk}  stage=${JSON.stringify(d.stage)}`);
}
