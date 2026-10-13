/* Admin-only bulk import of companies, contacts and deals from CSV text — the
   Admin page's "Import data" tab. POST /admin/backfill.

   The body carries the CSVs as strings (`companies`, `contacts`, `deals`; any
   may be left out) and `confirm`. Without `confirm` it only checks: it
   answers with the plan, any errors and warnings, and writes nothing. With
   `confirm: true` it re-runs the same plan against the table as it is now and
   writes it — unless a single row has an error, in which case it writes
   nothing at all. All the decisions are in backfill.mjs, which has no AWS in
   it; this file reads the table and writes what that plan says.

   Every write is conditional on the key not existing, so an import never
   overwrites a record, and running the same files twice adds nothing the
   second time. The one existing record it touches is a company with no
   primary contact yet, which takes the first contact imported for it.

   Imported deals skip the stage gates on purpose, and nothing here sends
   email or starts billing. */

import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { resp, today, doc, TABLE, listType, writeAudit } from "./util.mjs";
import { parseCsv, plan } from "./backfill.mjs";

const KINDS = ["companies", "contacts", "deals"];
const MAX_CSV = 1_000_000;

export async function importBackfill(ctx, body) {
  if (ctx.role !== "Admin") return resp(403, { error: "Admin only" });
  const b = body || {};

  const csv = { companies: [], contacts: [], deals: [] };
  const headers = {};
  let attached = 0;
  for (const kind of KINDS) {
    const text = b[kind];
    if (text === undefined || text === null || text === "") continue;
    if (typeof text !== "string") return resp(400, { error: `${kind} must be CSV text` });
    if (text.length > MAX_CSV) return resp(400, { error: `${kind}.csv is too large` });
    const parsed = parseCsv(text);
    csv[kind] = parsed.rows;
    headers[kind] = parsed.header;
    attached++;
  }
  if (!attached) return resp(400, { error: "Attach at least one CSV file" });

  const [labs, people, companies, contacts, deals] = await Promise.all(
    ["LAB", "PERSON", "COMPANY", "CONTACT", "DEAL"].map(listType)
  );
  const result = plan(csv, headers, { labs, people, companies, contacts, deals },
    { actor: ctx.me.sk, today: today() });

  const pick = pk => result.writes.filter(w => w.pk === pk);
  const companyName = Object.fromEntries([...companies, ...pick("COMPANY")].map(c => [c.sk, c.name]));
  const labName = Object.fromEntries(labs.map(l => [l.sk, l.name]));
  const payload = {
    ok: result.errors.length === 0,
    errors: result.errors,
    warnings: result.warnings,
    skipped: result.skipped,
    summary: {
      companies: pick("COMPANY").length,
      contacts: pick("CONTACT").length,
      deals: pick("DEAL").length,
      companiesUpdated: result.updates.length
    },
    preview: {
      companies: pick("COMPANY").map(c => ({ id: c.sk, name: c.name, kind: c.kind, website: c.website })),
      contacts: pick("CONTACT").map(c => ({ id: c.sk, name: c.name, email: c.email, company: companyName[c.companyId] || "" })),
      deals: pick("DEAL").map(d => ({
        id: d.sk, client: d.client, lab: labName[d.lab] || d.lab, stage: d.stage, amount: d.amount,
        close: d.close, company: companyName[d.companyId] || ""
      }))
    },
    imported: false
  };

  if (b.confirm !== true) return resp(200, payload);
  if (!payload.ok) return resp(200, { ...payload, error: "Fix the errors above first — nothing was imported" });

  let wrote = 0;
  try {
    for (const pk of ["COMPANY", "CONTACT", "DEAL"]) {
      for (const item of pick(pk)) {
        await doc.send(new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: "attribute_not_exists(pk)" }));
        wrote++;
      }
    }
    for (const u of result.updates) {
      const keys = Object.keys(u.set);
      await doc.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: u.pk, sk: u.sk },
        UpdateExpression: "SET " + keys.map((_, i) => `#f${i} = :v${i}`).join(", "),
        ExpressionAttributeNames: Object.fromEntries(keys.map((k, i) => [`#f${i}`, k])),
        ExpressionAttributeValues: Object.fromEntries(keys.map((k, i) => [`:v${i}`, u.set[k]]))
      }));
    }
  } catch (err) {
    return resp(409, {
      ...payload,
      error: err.name === "ConditionalCheckFailedException"
        ? `Someone created a record at the same moment, so the import stopped after ${wrote} record(s). Run it again: what was imported is skipped, and the rest is added.`
        : `The import stopped after ${wrote} record(s): ${err.message}. Run it again: what was imported is skipped.`,
      wrote
    });
  }

  try {
    await writeAudit(ctx.me.sk, "backfill.import",
      `${payload.summary.companies} companies, ${payload.summary.contacts} contacts, ${payload.summary.deals} deals`);
  } catch { /* the import already happened; an audit failure must not report it as failed */ }

  return resp(200, { ...payload, imported: true, wrote });
}
