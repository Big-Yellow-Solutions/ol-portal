/* Deal View migration check (read-only, no writes).

   The new Deal View surfaces a deal's Proposal and Invoice records by
   filtering on their `deal` field. Turns out no backfill is needed for
   those: every PROPOSAL is created with a required dealId
   (backend/src/proposals.mjs createProposal), and every INVOICE is created
   with a required dealId (backend/src/app.mjs createInvoice) — both have
   always been 100% deal-scoped, so every existing record already shows up
   under its deal.

   The one gap is CONTRACT records of docKind "client" (a standalone
   contract created directly, not generated from a proposal) — `dealId` is
   optional there (backend/src/contracts-create.mjs createStandalone), so a
   client contract can legitimately have no `deal` and won't appear in that
   deal's Deal View. This script only lists them; it never writes anything,
   because guessing which deal a contract belongs to from its client name
   risks linking it to the wrong one. Review the list and link any of these
   manually (PATCH /contracts/{id} { deal: "D-..." }) if they should show up
   in a Deal View.

   Usage: AWS_PROFILE=ol-portal node scripts/report-orphan-client-contracts.mjs
   Always pass AWS_PROFILE=ol-portal explicitly — this table lives in OL's
   own AWS account, a different account than your shell's default profile. */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = "ol-portal";
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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

const contracts = await listType("CONTRACT");
const orphans = contracts.filter(c => !c.docKind && !c.deal);

if (!orphans.length) {
  console.log("No orphaned client contracts — every one already links to a deal.");
} else {
  console.log(`${orphans.length} client contract(s) with no linked deal (won't appear in any Deal View):\n`);
  for (const c of orphans) {
    console.log(`  ${c.sk}  ${c.client}  ${c.status}  created ${c.created ?? "?"}`);
  }
  console.log("\nLink one manually if it belongs to a deal:");
  console.log('  PATCH /contracts/{id}  { "deal": "D-..." }');
}
