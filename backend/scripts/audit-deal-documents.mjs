/* Before the Documents tab redesign ships: show how every document already in
   the portal will be read, and number the ones that cannot be told apart.

   The redesign changes how deal documents are drawn and deleted, not what is
   stored: it reads the same FILE records (kind proposal / contract / invoice
   on a deal) and adds fields only to new ones. This reports, from the live
   table, exactly what that means for the data that is there today:

     - how many documents each deal holds, by type, and which are unversioned
     - groups whose unversioned uploads would all read "v1" (fixed below)
     - documents whose deal no longer exists, or that never finished uploading
     - deals already past a gate with nothing on file (the tab shows its
       missing-requirements banner for them; nothing is moved or changed)

   The ONE thing it can write is a `version` number onto older proposal and
   contract uploads that have none, in groups with two or more of them (see
   planVersionFixes in src/documents.mjs). It never deletes, never renames and
   never touches S3. Re-running it is safe: a fixed group plans no change.

   Usage:
     node scripts/audit-deal-documents.mjs             # report only
     node scripts/audit-deal-documents.mjs --confirm   # also writes the version numbers

   Env: TABLE_NAME (defaults "ol-portal"). */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

process.env.TABLE_NAME ||= "ol-portal";
const TABLE = process.env.TABLE_NAME;
const CONFIRM = process.argv.includes("--confirm");
const { planVersionFixes, requiredAt } = await import("../src/documents.mjs");

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function all(pk) {
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

const [files, deals, proposals] = await Promise.all([all("FILE"), all("DEAL"), all("PROPOSAL")]);
const dealIds = new Set(deals.map(d => d.sk));
const KINDS = ["proposal", "contract", "invoice"];

const onDeals = files.filter(f => f.deal && KINDS.includes(f.kind));
console.log(`FILE records: ${files.length}`);
console.log(`  on a deal as proposal / contract / invoice: ${onDeals.length}  <- these appear on the Documents tab`);
console.log(`  everything else (Files page uploads, portal-generated PDFs): ${files.length - onDeals.length}  <- untouched by the redesign`);
for (const kind of KINDS) {
  const mine = onDeals.filter(f => f.kind === kind);
  const unversioned = kind === "invoice" ? 0 : mine.filter(f => !f.version).length;
  console.log(`  ${kind.padEnd(9)} ${String(mine.length).padStart(4)}${kind === "invoice" ? "  (not versioned)" : `   of which unversioned: ${unversioned}`}`);
}

const orphans = onDeals.filter(f => !dealIds.has(f.deal));
console.log(`\nDocuments whose deal no longer exists: ${orphans.length}`);
for (const f of orphans.slice(0, 20)) console.log(`  ${f.sk}  ${f.kind}  deal ${f.deal}  ${f.name}`);

const stale = onDeals.filter(f => f.status === "Uploading" && Date.now() - Date.parse(f.date) > 3600e3);
console.log(`\nStill marked "Uploading" after an hour (the bytes may never have landed): ${stale.length}`);
console.log("  Left as they are. They already count as documents today and still will.");
for (const f of stale.slice(0, 20)) console.log(`  ${f.sk}  ${f.kind}  deal ${f.deal}  ${f.name}  ${f.date}`);

const fixes = planVersionFixes(files);
const byId = new Map(files.map(f => [f.sk, f]));
console.log(`\nUploads that need a version number: ${fixes.length}`);
for (const x of fixes) {
  const f = byId.get(x.id);
  console.log(`  ${f.sk}  ${f.kind}  deal ${f.deal}  ${x.from == null ? "unnumbered" : `v${x.from}`} -> v${x.to}  ${f.name}`);
}

/* The requirement as the server's gate reads it: a document, a contract signed
   through the portal, or (proposals only) one marked sent in the older flow. */
const sentProposal = new Set(proposals.filter(p => p.sentAt).map(p => p.deal));
const has = (d, kind) => onDeals.some(f => f.deal === d.sk && f.kind === kind && !f.deletedAt);
const gaps = [];
for (const d of deals) {
  const missing = [];
  if (requiredAt("proposal", d.stage) && !has(d, "proposal") && !sentProposal.has(d.sk)) missing.push("proposal");
  if (requiredAt("contract", d.stage) && !has(d, "contract") && !d.contractSigned) missing.push("signed contract");
  if (requiredAt("invoice", d.stage) && !has(d, "invoice")) missing.push("invoice");
  if (missing.length) gaps.push({ d, missing });
}
console.log(`\nDeals past a gate with nothing on file: ${gaps.length}`);
console.log("  They keep their stage. The tab shows the missing-requirements banner and the Waive option.");
for (const { d, missing } of gaps) console.log(`  ${d.sk}  ${d.stage.padEnd(13)} ${d.client}  missing: ${missing.join(", ")}`);

if (!fixes.length) {
  console.log("\nNothing to write.");
} else if (!CONFIRM) {
  console.log("\nDry run — nothing written. Re-run with --confirm to number the uploads above.");
} else {
  for (const x of fixes) {
    await doc.send(new UpdateCommand({
      TableName: TABLE, Key: { pk: "FILE", sk: x.id },
      UpdateExpression: "SET version = :v", ExpressionAttributeValues: { ":v": x.to }
    }));
  }
  console.log(`\nNumbered ${fixes.length} upload${fixes.length === 1 ? "" : "s"}.`);
}
