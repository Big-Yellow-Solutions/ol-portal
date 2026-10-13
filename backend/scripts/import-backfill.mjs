/* Backfills companies, contacts and deals from three CSVs, in one run, so a
   contact can find its company and a deal can find both.

   The templates are docs/backfill-templates/{companies,contacts,deals}.csv.
   All the decisions — matching, validation, what gets written — are in
   scripts/backfill-lib.mjs; this file only reads the table and writes the
   plan. Read that file's header for how records are matched and linked.

   Safe by construction:
     - A dry run (the default) prints the whole plan and writes nothing.
     - --confirm refuses to write anything at all if a single row has an
       error, so a half-loaded backfill cannot happen from bad data.
     - Re-runs skip what already exists: companies by name, contacts by
       company + email, deals by client + lab. Nothing is ever overwritten.
     - Every write is conditional on the key not existing yet.
     - The only existing record it changes is a company with no primary
       contact yet, which takes the first contact added to it — the same rule
       the portal applies when you add a contact by hand.

   Imported deals skip the stage gates on purpose (no proposal, contract or
   invoice file needed), and nothing here sends email or starts billing.
   `recurring` is off unless the CSV says yes — a recurring deal at Contracted
   or later makes the daily engine generate monthly invoice instances.

   Usage:
     node scripts/import-backfill.mjs --companies c.csv --contacts p.csv --deals d.csv --as admin@optimisticlabs.com
     ... add --confirm to write

   Any of the three files may be left out. --as must be an existing Admin; the
   records are created under that person (see labScope in src/contacts.mjs).

   Env: TABLE_NAME (default "ol-portal"), AWS_REGION (us-east-1). */

import { readFile } from "node:fs/promises";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { parseCsv, plan } from "./backfill-lib.mjs";

const TABLE = process.env.TABLE_NAME || "ol-portal";
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const CONFIRM = args.includes("--confirm");
const files = { companies: flag("--companies"), contacts: flag("--contacts"), deals: flag("--deals") };
const actor = flag("--as");

if (!actor || !Object.values(files).some(Boolean)) {
  console.error("usage: node scripts/import-backfill.mjs [--companies f] [--contacts f] [--deals f] --as <admin email> [--confirm]");
  process.exit(2);
}

async function rows(pk) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const page = await doc.send(new QueryCommand({
      TableName: TABLE, KeyConditionExpression: "pk = :p", ExpressionAttributeValues: { ":p": pk }, ExclusiveStartKey
    }));
    out.push(...page.Items);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

const csv = { companies: [], contacts: [], deals: [] };
const headers = {};
for (const [kind, path] of Object.entries(files)) {
  if (!path) continue;
  const parsed = parseCsv(await readFile(path, "utf8"));
  csv[kind] = parsed.rows;
  headers[kind] = parsed.header;
}

const [labs, people, companies, contacts, deals] = await Promise.all(
  ["LAB", "PERSON", "COMPANY", "CONTACT", "DEAL"].map(rows)
);
const result = plan(csv, headers, { labs, people, companies, contacts, deals },
  { actor, today: new Date().toISOString().slice(0, 10) });

const show = (title, list) => { if (list.length) { console.log(`\n${title} (${list.length})`); for (const l of list) console.log(`  ${l}`); } };
console.log(`Table ${TABLE}. Mode: ${CONFIRM ? "CONFIRM (writing)" : "DRY RUN (no writes)"}. Created by ${actor}.`);
show("Errors", result.errors);
show("Warnings", result.warnings);
show("Skipped — already in the portal", result.skipped);

const byType = pk => result.writes.filter(w => w.pk === pk);
console.log("\nPlan");
for (const [pk, label] of [["COMPANY", "companies"], ["CONTACT", "contacts"], ["DEAL", "deals"]]) {
  const list = byType(pk);
  console.log(`  ${String(list.length).padStart(3)} new ${label}`);
  if (!CONFIRM) for (const r of list)
    console.log(`        ${r.sk}  ${r.name || r.client}${r.stage ? `  [${r.stage}${r.amount ? `, $${r.amount.toLocaleString()}` : ""}]` : ""}`);
}
if (result.updates.length) console.log(`  ${String(result.updates.length).padStart(3)} existing compan${result.updates.length === 1 ? "y" : "ies"} get a primary contact`);

if (result.errors.length) {
  console.log(`\nNot writing anything: fix the ${result.errors.length} error(s) above and run again.`);
  process.exit(1);
}
if (!CONFIRM) {
  console.log("\nDry run only. Add --confirm to write.");
  process.exit(0);
}

let wrote = 0;
try {
  for (const pk of ["COMPANY", "CONTACT", "DEAL"]) {
    for (const item of byType(pk)) {
      await doc.send(new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: "attribute_not_exists(pk)" }));
      wrote++;
    }
  }
  for (const u of result.updates) {
    const sets = Object.keys(u.set);
    await doc.send(new UpdateCommand({
      TableName: TABLE, Key: { pk: u.pk, sk: u.sk },
      UpdateExpression: "SET " + sets.map((k, i) => `#f${i} = :v${i}`).join(", "),
      ExpressionAttributeNames: Object.fromEntries(sets.map((k, i) => [`#f${i}`, k])),
      ExpressionAttributeValues: Object.fromEntries(sets.map((k, i) => [`:v${i}`, u.set[k]]))
    }));
  }
} catch (err) {
  console.error(`\nStopped after writing ${wrote} record(s): ${err.name}: ${err.message}`);
  if (err.name === "ConditionalCheckFailedException")
    console.error("Someone created a record with the same id in the meantime. Re-run: what was written is skipped, and the rest gets fresh ids.");
  process.exit(1);
}
console.log(`\nWrote ${wrote} new record(s) and updated ${result.updates.length}.`);
