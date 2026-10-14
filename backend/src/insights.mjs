/* OL Portal · Insights (admin-only reporting).

   Read-only analytics over deals and their Lab Leader assignments. Every route
   in this file is gated on the *effective* role being Admin, checked here on
   the server — the nav link and the page's no-access screen are courtesy, not
   the control. Because the check reads ctx.role, an Admin who is acting as a
   Lab Leader gets a 403 too, which is the point of acting as one.

   Lab Leaders and Contributors never reach the data. A Lab Leader version of
   this page is planned; it should be its own route with its own scoping rather
   than a relaxed copy of these, since these return every lab's payouts. */

import { listType, get, put, resp, writeAudit, fullName } from "./util.mjs";
import { assignmentMath, POOL_PCT, SOFT_RESERVE_PCT } from "./assignments.mjs";

const isAdmin = ctx => ctx.role === "Admin";
const forbidden = () => resp(403, { error: "Admin only" });

/* Stored values for the stages that are weighted. Lead and Discovery are
   always 0 and Contracted is already won, so Proposal & Negotiation (stored as
   "Proposal Sent") is the only stage with a probability to set. */
export const WEIGHT_DEFAULTS = { "Proposal Sent": 25 };
const SETTINGS_KEY = { pk: "SETTING", sk: "insights-weights" };

async function readWeights() {
  const row = await get(SETTINGS_KEY.pk, SETTINGS_KEY.sk);
  const w = row?.weights || {};
  const n = Number(w["Proposal Sent"]);
  return {
    weights: { "Proposal Sent": Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : WEIGHT_DEFAULTS["Proposal Sent"] },
    updatedBy: row?.updatedBy || null,
    updatedAt: row?.updatedAt || null
  };
}

const r2 = v => Math.round(v * 100) / 100;

/* One deal's money, in the shape the page draws. Won deals with a filed
   assignment use the numbers finance pays against (assignmentMath already ran
   server-side when it was filed). Everything else is *projected* from the deal
   amount with no hard or subcontractor costs, and says so — an estimate that
   looked like a fact would be worse than a gap.

   `unallocated` is the pool less what the named leaders are recorded as
   receiving. Each payout is rounded to a whole dollar, so a few cents of drift
   per leader is rounding and not a finding; the tolerance scales with the
   number of leaders for that reason. */
export function dealFinance(deal) {
  const a = deal.assignment;
  if (a && Number.isFinite(a.contractValue)) {
    const math = assignmentMath({
      contractValue: a.contractValue, hardCosts: a.hardCosts || 0,
      subcontractorCosts: a.subcontractorCosts || 0, leaders: a.leaders || []
    });
    const payouts = Array.isArray(a.payouts) && a.payouts.length ? a.payouts : math.payouts;
    const payout = payouts.reduce((t, p) => t + (p.payout || 0), 0);
    const tolerance = 0.5 * Math.max(1, payouts.length);
    const unallocated = r2(math.pool - payout);
    return {
      tcv: a.contractValue, hard: a.hardCosts || 0, sub: a.subcontractorCosts || 0,
      soft: math.softReserve, payout, ol: math.net - math.pool, unallocated,
      reconciles: Math.abs(unallocated) <= tolerance,
      source: a.approved ? "approved" : "filed"
    };
  }
  const math = assignmentMath({ contractValue: deal.amount || 0 });
  return {
    tcv: deal.amount || 0, hard: 0, sub: 0, soft: math.softReserve,
    payout: math.pool, ol: math.net - math.pool, unallocated: 0,
    reconciles: false, source: "projected"
  };
}

export async function getInsights(ctx) {
  if (!isAdmin(ctx)) return forbidden();
  const [deals, labs, people, companies, settings] = await Promise.all([
    listType("DEAL"), listType("LAB"), listType("PERSON"), listType("COMPANY"), readWeights()
  ]);
  const companyName = new Map(companies.map(c => [c.sk, c.name]));
  const byKey = new Map(people.map(p => [p.sk, p]));
  const leaderKey = d => d.dealOwner || d.owner;
  return resp(200, {
    today: new Date().toISOString().slice(0, 10),
    softPct: SOFT_RESERVE_PCT,
    leaderPct: POOL_PCT,
    ...settings,
    canEditWeights: true,
    labs: labs.map(l => ({ id: l.sk, name: l.name })),
    deals: deals.map(d => ({
      id: d.sk, client: d.client, lab: d.lab, stage: d.stage,
      leader: leaderKey(d), leaderName: fullName(byKey.get(leaderKey(d))) || leaderKey(d) || "",
      amount: d.amount || 0, created: d.created || null, updated: d.updated || null,
      close: d.close || null, stageDates: d.stageDates || null,
      companyId: d.companyId || null, billing: companyName.get(d.companyId) || null,
      hasAssignment: !!d.assignment, finance: dealFinance(d)
    }))
  });
}

export async function saveWeights(ctx, body) {
  if (!isAdmin(ctx)) return forbidden();
  const n = body?.weights?.["Proposal Sent"];
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) return resp(400, { error: "probability must be between 0 and 100" });
  const next = {
    ...SETTINGS_KEY,
    weights: { "Proposal Sent": Math.round(n * 100) / 100 },
    updatedBy: ctx.me.sk, updatedAt: new Date().toISOString()
  };
  await put(next);
  await writeAudit(ctx.me.sk, "insights.weights", `Proposal & Negotiation weighting set to ${next.weights["Proposal Sent"]}%`);
  return resp(200, { weights: next.weights, updatedBy: next.updatedBy, updatedAt: next.updatedAt });
}

/* Exports are generated in the browser, so this is the audit trail: the page
   reports each one before it hands over the file. The detail is built from
   fields the server controls and a clipped, single-line scope — the body is
   never stored verbatim. */
const EXPORT_KINDS = new Set(["deals", "labs"]);
export async function logExport(ctx, body) {
  if (!isAdmin(ctx)) return forbidden();
  const kind = String(body?.kind || "");
  if (!EXPORT_KINDS.has(kind)) return resp(400, { error: "unknown export" });
  const rows = Number.isFinite(body?.rows) ? Math.max(0, Math.floor(body.rows)) : 0;
  const clip = s => String(s ?? "").replace(/\s+/g, " ").slice(0, 120);
  await writeAudit(ctx.me.sk, "insights.export",
    `${kind} · ${rows} rows · scope: ${clip(body?.scope)} · range: ${clip(body?.range)}`);
  return resp(200, { logged: true, at: new Date().toISOString() });
}
