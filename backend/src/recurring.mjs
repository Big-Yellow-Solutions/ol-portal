/* OL Portal · recurring deal engine (PRD 3.9-3.10). Runs daily on a schedule.
   For each Closed-Won recurring deal that isn't paused, generates one RECUR
   instance per month (linked to the parent deal, amount = deal.amount / 12 —
   the portal's convention is that deal.amount is annual) and, when the deal
   opted in, an invoice request in Admin review. Idempotent per deal+month. */

import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { TABLE, doc, resp, today, listType, nextId } from "./util.mjs";

const monthKey = () => new Date().toISOString().slice(0, 7); // YYYY-MM

async function generateForMonth(month) {
  const deals = await listType("DEAL");
  const due = deals.filter(d =>
    d.recurring && d.stage === "Closed" && d.outcome === "Won" && !d.recurPaused &&
    (!d.recurEnd || d.recurEnd.slice(0, 7) >= month));

  const created = [];
  for (const d of due) {
    const sk = `R-${d.sk}-${month}`;
    const amount = Math.round((d.amount || 0) / 12);
    try {
      await doc.send(new PutCommand({
        TableName: TABLE,
        Item: {
          pk: "RECUR", sk, deal: d.sk, client: d.client, lab: d.lab,
          owner: d.owner, amount, month, date: today()
        },
        ConditionExpression: "attribute_not_exists(sk)"
      }));
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") continue; // already generated
      throw err;
    }
    created.push(sk);

    if (d.autoInvoice) {
      const id = await nextId("INVOICE", "INV-R-");
      await doc.send(new PutCommand({
        TableName: TABLE,
        Item: {
          pk: "INVOICE", sk: id, deal: d.sk, client: d.client, lab: d.lab,
          amount, requestedBy: d.owner, date: today(),
          recurring: true, month, auto: true, status: "Admin review"
        }
      }));
    }
  }
  return created;
}

/* EventBridge daily schedule */
export const handler = async () => {
  const created = await generateForMonth(monthKey());
  if (created.length)
    console.log(JSON.stringify({ level: "info", message: "recurring instances generated", created }));
  return { created: created.length };
};

/* ---------- API routes (via app.mjs) ---------- */
export async function listRecurrences(ctx) {
  if (ctx.role === "Contributor") return resp(200, []);
  const items = await listType("RECUR");
  const visible = items.filter(r => ctx.can.seesLab(r.lab));
  visible.sort((a, b) => (b.month || "").localeCompare(a.month || ""));
  return resp(200, visible.map(({ pk, sk, ...rest }) => ({ id: sk, ...rest })));
}

/* Admin convenience: generate this month's instances on demand instead of
   waiting for the daily schedule (also what the E2E test exercises). */
export async function runNow(ctx) {
  if (ctx.role !== "Admin") return resp(403, { error: "Admin only" });
  const created = await generateForMonth(monthKey());
  return resp(200, { created });
}
