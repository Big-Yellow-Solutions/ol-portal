/* Lift an address off the suppression list once it has been corrected or the
   person has asked to receive mail again.

   Usage: node scripts/clear-suppression.mjs <email> [--dry-run]
   Reads and deletes SUPPRESSION/<email> in the ol-portal table. SES keeps its
   own account-level list as well; if the address is on that too, remove it
   there as well:  aws sesv2 delete-suppressed-destination --email-address <email> */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = "ol-portal";
const email = (process.argv[2] || "").trim().toLowerCase();
if (!email || email.startsWith("--")) { console.error("Usage: node scripts/clear-suppression.mjs <email> [--dry-run]"); process.exit(1); }

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const { Item } = await doc.send(new GetCommand({ TableName: TABLE, Key: { pk: "SUPPRESSION", sk: email } }));
if (!Item) { console.log(`${email} is not on the suppression list.`); process.exit(0); }
console.log(`${email}: ${Item.reason} on ${Item.at}${Item.detail ? ` (${Item.detail})` : ""}`);
if (process.argv.includes("--dry-run")) { console.log("Dry run: not removed."); process.exit(0); }
await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: "SUPPRESSION", sk: email } }));
console.log("Removed.");
