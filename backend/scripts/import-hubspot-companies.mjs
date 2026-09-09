/* Loads a HubSpot "Companies" export into the portal's COMPANY records — the
   Pipeline's Companies tab, and the billing entities a deal can point at.

   HubSpot's export carries no individuals (that is its separate "Contacts"
   export), so nothing here touches CONTACT. Run the Contacts export through a
   sibling importer later and link each person to their company by domain.

   Column mapping (HubSpot → COMPANY):
     Company name   → name      blank names fall back to the website's domain,
                                 the way HubSpot itself displays them
     Industry       → kind      the subtitle under a company in the table
     Phone Number   → phone     formatted "+1 (856) 751-9500" for US numbers
     Website URL    → website   kept for a future UI field; not shown yet
     City, Country  → city, country
     Record ID      → hubspotId what makes a re-run skip rows already loaded
     Company owner  → hubspotOwner, Type → hubspotType

   Skipped, and reported: Optimistic Labs itself (HubSpot auto-creates a
   company for your own domain), any row whose HubSpot id is already in the
   table, and any row whose name matches an existing company once "The" and
   punctuation are ignored — so "The Independent Center" does not duplicate
   the hand-entered "Independent Center".

   The record shape mirrors createCompany in src/contacts.mjs exactly, plus
   the extra columns above. `createdBy` is the Admin running the import, which
   is what keeps the rows in a Lab Leader's scope until a deal points at them
   (see labScope there).

   Usage:
     node scripts/import-hubspot-companies.mjs --csv path.csv             # dry run
     node scripts/import-hubspot-companies.mjs --csv path.csv --confirm   # writes
     node scripts/import-hubspot-companies.mjs --csv path.csv --as liz@optimisticlabs.com

   Env: TABLE_NAME (default "ol-portal"), AWS_PROFILE (use ol-portal). */

import { readFile } from "node:fs/promises";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.TABLE_NAME || "ol-portal";
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const confirm = args.includes("--confirm");
const csvPath = flag("--csv");
const actor = flag("--as") || "teddy@optimisticlabs.com";
if (!csvPath) {
  console.error("usage: node scripts/import-hubspot-companies.mjs --csv <file> [--confirm] [--as <person email>]");
  process.exit(2);
}

/* ---------- CSV (RFC 4180: quoted fields, doubled quotes, commas in quotes) ---------- */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter(r => r.some(c => c.trim()));
  return body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/* ---------- normalizers ---------- */
const domainOf = url => (url || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").toLowerCase();
const cleanName = s => (s || "").replace(/[,\s]+$/, "").trim();
// "The Independent Center" and "Independent Center" are the same company.
const nameKey = s => (s || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");

function formatPhone(raw) {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1"))
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `+${digits}`;
}

/* ---------- table ---------- */
const query = async pk => {
  const out = [];
  let ExclusiveStartKey;
  do {
    const page = await doc.send(new QueryCommand({
      TableName: TABLE, KeyConditionExpression: "pk = :p",
      ExpressionAttributeValues: { ":p": pk }, ExclusiveStartKey
    }));
    out.push(...(page.Items || []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
};

const today = () => new Date().toISOString().slice(0, 10);

/* ---------- plan ---------- */
const rows = parseCsv(await readFile(csvPath, "utf8"));
const existing = await query("COMPANY");
const people = await query("PERSON");
if (!people.some(p => p.sk === actor)) {
  console.error(`no PERSON record for ${actor} — pass --as with a portal Admin's email`);
  process.exit(2);
}

const seenIds = new Set(existing.map(c => c.hubspotId).filter(Boolean));
const seenNames = new Set(existing.map(c => nameKey(c.name)));
const seenDomains = new Set(existing.map(c => domainOf(c.website)).filter(Boolean));
let max = existing.reduce((m, c) => Math.max(m, parseInt(c.sk.replace(/\D/g, ""), 10) || 0), 0);

const creates = [], skips = [];
const stamp = today();
for (const r of rows) {
  const website = domainOf(r["Website URL"]);
  const name = cleanName(r["Company name"]) || website;
  const why =
    !name ? "no name and no website" :
    website === "optimisticlabs.com" ? "Optimistic Labs itself" :
    seenIds.has(r["Record ID"]) ? "already imported (HubSpot id)" :
    seenNames.has(nameKey(name)) ? "a company with this name already exists" :
    website && seenDomains.has(website) ? "a company with this website already exists" :
    null;
  if (why) { skips.push({ name: name || r["Record ID"], why }); continue; }

  seenIds.add(r["Record ID"]);
  seenNames.add(nameKey(name));
  if (website) seenDomains.add(website);
  const id = "CO-" + String(++max).padStart(3, "0");
  creates.push({
    pk: "COMPANY", sk: id, name,
    kind: (r["Industry"] || "").slice(0, 200),
    phone: formatPhone(r["Phone Number"]),
    email: "",
    contactId: null,
    createdBy: actor,
    created: stamp, updated: stamp,
    // Not part of the app's shape yet; carried so nothing from the export is lost.
    website, city: r["City"] || "", country: r["Country/Region"] || "",
    hubspotId: r["Record ID"], hubspotOwner: r["Company owner"] || "", hubspotType: r["Type"] || "",
    source: "hubspot"
  });
}

console.log(`${rows.length} rows in ${csvPath}; ${existing.length} companies already in ${TABLE}\n`);
for (const c of creates)
  console.log(`  + ${c.sk}  ${c.name}${c.kind ? `  · ${c.kind}` : ""}${c.phone ? `  · ${c.phone}` : ""}${c.website ? `  · ${c.website}` : ""}`);
for (const s of skips) console.log(`  - skip  ${s.name}  (${s.why})`);
console.log(`\n${creates.length} to create, ${skips.length} skipped`);

if (!confirm) { console.log("\nDry run. Re-run with --confirm to write."); process.exit(0); }

for (const item of creates) await doc.send(new PutCommand({ TableName: TABLE, Item: item }));
console.log(`\nWrote ${creates.length} companies to ${TABLE} as ${actor}.`);
