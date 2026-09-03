/* Replaces the portal's PERSON records with the real roster, keyed by email.

   Why this exists rather than a migration: the seven records in the table are
   fictional demo personas (stock blurbs, "—" phones, "#" LinkedIn) keyed by
   first name, and their Cognito accounts share two placeholder addresses
   between them — five people on hello@optimisticlabs.com and two on a personal
   gmail. There are no real per-person emails in the system to migrate onto, so
   nothing here tries to derive one.

   Three things are wrong with the current records and all three are fixed by
   writing them fresh:
     1. The key is a first name. WorkOS identifies people by email, so
        get("PERSON", "liz@optimisticlabs.com") misses and every request fails
        with "No portal profile for this user".
     2. They carry a legacy `name` field, but fullName() reads firstName and
        lastName — so every name in the portal currently renders empty.
     3. The bench profiles are invented.

   Deliberately not carried over: photo, bench, blurb, specialties. They belong
   to personas who do not exist. Real people fill their own in through
   /welcome.

   Usage:
     node scripts/seed-roster.mjs                        # dry run, prints the plan
     node scripts/seed-roster.mjs --confirm              # writes it
     node scripts/seed-roster.mjs --roster path.json     # non-default roster

   The roster is a JSON array:
     [{ "email": "liz@optimisticlabs.com", "firstName": "Liz",
        "lastName": "Russell", "role": "Admin", "labs": [] }]

   Safe to re-run: writing a PERSON is idempotent, and a record already
   matching the roster is left exactly as it is.

   Env: TABLE_NAME (default "ol-portal"), AWS_PROFILE (use ol-portal). */

import { readFile } from "node:fs/promises";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand
} from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.TABLE_NAME || "ol-portal";
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const ROLES = ["Admin", "Lab Leader", "Contributor"];

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const rosterPath = args[args.indexOf("--roster") + 1] || "scripts/roster.json";

const query = async pk => {
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
};

/* Every problem with the roster is reported at once. Finding out about the
   third bad row only after fixing the first two is a miserable way to edit a
   file by hand. */
function validate(roster, labIds) {
  const problems = [];
  const seen = new Set();

  if (!Array.isArray(roster)) return ["roster must be a JSON array"];

  roster.forEach((p, i) => {
    const at = `roster[${i}]`;
    const email = String(p?.email ?? "").trim().toLowerCase();

    if (!email) problems.push(`${at}: missing email`);
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push(`${at}: "${email}" is not an email`);
    else if (seen.has(email)) problems.push(`${at}: duplicate email ${email}`);
    else seen.add(email);

    if (!String(p?.firstName ?? "").trim()) problems.push(`${at}: missing firstName`);
    if (!String(p?.lastName ?? "").trim()) problems.push(`${at}: missing lastName`);
    if (!ROLES.includes(p?.role)) problems.push(`${at}: role must be one of ${ROLES.join(", ")} (got ${JSON.stringify(p?.role)})`);

    const labs = p?.labs ?? [];
    if (!Array.isArray(labs)) problems.push(`${at}: labs must be an array`);
    else for (const lab of labs) {
      if (!labIds.has(lab)) problems.push(`${at}: no such lab "${lab}" (have: ${[...labIds].join(", ")})`);
    }

    /* A Lab Leader with no labs can lead nothing: perms().addDeal is gated on
       myLabs.length, so they would sign in to a portal that refuses every
       action without explaining why. */
    if (p?.role === "Lab Leader" && Array.isArray(labs) && labs.length === 0) {
      problems.push(`${at}: a Lab Leader needs at least one lab`);
    }
  });

  return problems;
}

const personFor = p => ({
  pk: "PERSON",
  sk: String(p.email).trim().toLowerCase(),
  firstName: String(p.firstName).trim(),
  lastName: String(p.lastName).trim(),
  email: String(p.email).trim().toLowerCase(),
  role: p.role,
  labs: p.labs ?? []
});

const same = (a, b) =>
  a.firstName === b.firstName && a.lastName === b.lastName &&
  a.email === b.email && a.role === b.role &&
  JSON.stringify(a.labs ?? []) === JSON.stringify(b.labs ?? []);

async function main() {
  let roster;
  try {
    roster = JSON.parse(await readFile(rosterPath, "utf8"));
  } catch (err) {
    console.error(`Could not read roster at ${rosterPath}: ${err.message}`);
    console.error("Write one first — see the usage note at the top of this file.");
    process.exit(1);
  }

  const [labs, existing] = await Promise.all([query("LAB"), query("PERSON")]);
  const labIds = new Set(labs.map(l => l.sk));

  const problems = validate(roster, labIds);
  if (problems.length) {
    console.error(`Roster is not valid (${problems.length} problem${problems.length > 1 ? "s" : ""}):`);
    for (const p of problems) console.error(`  · ${p}`);
    process.exit(1);
  }

  const wanted = roster.map(personFor);
  const byKey = new Map(existing.map(p => [p.sk, p]));
  const keep = new Set(wanted.map(p => p.sk));

  const writes = wanted.filter(p => !byKey.has(p.sk) || !same(p, byKey.get(p.sk)));
  const deletes = existing.filter(p => !keep.has(p.sk));

  console.log(`Table ${TABLE} · ${existing.length} PERSON record(s) now, ${wanted.length} in the roster\n`);

  for (const p of writes) {
    const verb = byKey.has(p.sk) ? "update" : "create";
    console.log(`  ${verb.padEnd(6)} ${p.sk}  ${p.firstName} ${p.lastName} · ${p.role}${p.labs.length ? " · " + p.labs.join(", ") : ""}`);
  }
  for (const p of deletes) {
    console.log(`  delete ${p.sk}  ${p.name || [p.firstName, p.lastName].filter(Boolean).join(" ")} · ${p.role}`);
  }
  if (!writes.length && !deletes.length) console.log("  (nothing to do — the table already matches the roster)");

  if (!confirm) {
    console.log("\nDry run. Re-run with --confirm to apply.");
    return;
  }

  /* Writes before deletes: if this stops halfway, the roster is already
     present and the stale personas are merely still there — which is
     recoverable by re-running. The reverse order could leave nobody able to
     sign in. */
  for (const p of writes) await doc.send(new PutCommand({ TableName: TABLE, Item: p }));
  for (const p of deletes) {
    await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: "PERSON", sk: p.sk } }));
  }
  console.log(`\nApplied: ${writes.length} written, ${deletes.length} removed.`);
}

await main();
