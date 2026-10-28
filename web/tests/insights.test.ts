/* Insights math. The page is Admin-only and these are the numbers it shows
   Admins about payouts, so the rules are pinned here rather than trusted to
   the screen. Run with `npm test` in web/. */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baseDeals, bounds, defaultFilters, delta, dealsCsv, filtersFromHash, filtersToHash, funnel,
  metrics, monthly, niceMax, stageAt, toCsv, unpaidRows, wonDate, compact,
  type InsightsDeal,
} from "../lib/insights.ts";

const TODAY = "2026-10-01";
const fin = (tcv: number) => ({
  tcv, hard: 0, sub: 0, soft: tcv * 0.05, payout: tcv * 0.665, ol: tcv * 0.285,
  unallocated: 0, reconciles: true, source: "approved" as const,
});
let n = 0;
const deal = (over: Partial<InsightsDeal> = {}): InsightsDeal => ({
  id: `D-${++n}`, client: "Client", lab: "faith", stage: "Lead", leader: "marcus", leaderName: "Marcus",
  amount: 10000, created: "2026-03-01", updated: "2026-03-01", close: null, stageDates: null,
  companyId: null, billing: null, hasAssignment: true, finance: fin(10000), ...over,
});
const ctx = { basis: "closed" as const, today: TODAY, weights: { "Proposal Sent": 25 as number } };

test("won means a signed contract: Contracted and Closed both count, Closed Lost does not", () => {
  const ds = [
    deal({ stage: "Contracted", stageDates: { Contracted: "2026-06-01" } }),
    deal({ stage: "Closed", stageDates: { Closed: "2026-07-01" } }),
    deal({ stage: "Closed Lost", stageDates: { "Closed Lost": "2026-06-01" } }),
  ];
  const m = metrics(ds, "2026-01-01", "2026-10-02", ctx);
  assert.equal(m.wonN, 2);
  assert.equal(m.lostN, 1);
  assert.equal(m.winRate, 2 / 3);
});

test("weighted pipeline applies the Proposal & Negotiation probability and nothing else", () => {
  const ds = [
    deal({ stage: "Proposal Sent", amount: 100000, updated: "2026-09-01" }),
    deal({ stage: "Discovery", amount: 500000, updated: "2026-09-01" }),
  ];
  const m = metrics(ds, "2026-01-01", "2026-10-02", ctx);
  assert.equal(m.openV, 100000);
  assert.equal(m.weighted, 25000);
  assert.equal(metrics(ds, "2026-01-01", "2026-10-02", { ...ctx, weights: { "Proposal Sent": 60 } }).weighted, 60000);
});

test("date basis decides which date puts a won deal in the range", () => {
  const d = deal({ stage: "Contracted", created: "2025-11-01", stageDates: { Contracted: "2026-02-10" } });
  assert.equal(metrics([d], "2026-01-01", "2026-10-02", ctx).wonN, 1);
  assert.equal(metrics([d], "2026-01-01", "2026-10-02", { ...ctx, basis: "created" }).wonN, 0);
});

test("a deal with no history uses its close date when it is in the past, its last update when it is a forecast", () => {
  assert.equal(wonDate(deal({ stage: "Closed", close: "2026-05-05" }), TODAY), "2026-05-05");
  assert.equal(wonDate(deal({ stage: "Closed", close: "2027-01-01", updated: "2026-09-09" }), TODAY), "2026-09-09");
  assert.equal(wonDate(deal({ stage: "Lead" }), TODAY), null);
});

test("stageAt reads history when it exists and only trusts the current stage after the last edit when it doesn't", () => {
  const withHistory = deal({ stage: "Contracted", stageDates: { Lead: "2026-03-01", "Proposal Sent": "2026-04-01", Contracted: "2026-06-01" } });
  assert.equal(stageAt(withHistory, "2026-05-01"), "Proposal Sent");
  assert.equal(stageAt(withHistory, "2026-03-01"), null);
  const bare = deal({ stage: "Proposal Sent", updated: "2026-08-01" });
  assert.equal(stageAt(bare, "2026-09-01"), "Proposal Sent");
  assert.equal(stageAt(bare, "2026-07-01"), null);
});

test("funnel is a created-in-range cohort counted at the furthest stage reached", () => {
  const ds = [
    deal({ created: "2026-02-01", stage: "Closed", stageDates: { Lead: "2026-02-01", Discovery: "2026-02-10", "Proposal Sent": "2026-03-01", Contracted: "2026-04-01", Closed: "2026-05-01" } }),
    deal({ created: "2026-02-01", stage: "Proposal Sent", stageDates: { Lead: "2026-02-01", Discovery: "2026-02-10", "Proposal Sent": "2026-03-01" } }),
    deal({ created: "2026-02-01", stage: "Lead" }),
    deal({ created: "2025-01-01", stage: "Closed" }),
  ];
  const f = funnel(ds, "2026-01-01", "2026-10-02", TODAY);
  assert.deepEqual(f.rows.map((r) => r.n), [3, 2, 2, 1, 1]);
  assert.equal(f.rows[0].movedOn, 2 / 3);
});

test("anything waiting more than 30 days is flagged, exactly 30 is not", () => {
  const ds = [
    deal({ stage: "Proposal Sent", stageDates: { "Proposal Sent": "2026-08-31" } }),
    deal({ stage: "Proposal Sent", stageDates: { "Proposal Sent": "2026-09-01" } }),
  ];
  const rows = unpaidRows(ds, TODAY);
  assert.deepEqual(rows.map((r) => [r.waiting, r.aging]), [[31, true], [30, false]]);
});

test("the unpaid table is Proposal & Negotiation plus signed-but-unpaid; paid and lost drop out", () => {
  const ds = ["Lead", "Discovery", "Proposal Sent", "Contracted", "Closed", "Closed Lost"].map((stage) => deal({ stage: stage as InsightsDeal["stage"] }));
  assert.deepEqual(unpaidRows(ds, TODAY).map((r) => r.deal.stage), ["Proposal Sent", "Contracted"]);
});

test("a signed deal with no assignment, or with unallocated payout, doesn't reconcile", () => {
  const rows = unpaidRows([
    deal({ stage: "Contracted", hasAssignment: false }),
    deal({ stage: "Contracted", finance: { ...fin(1000), unallocated: 250, reconciles: false } }),
    deal({ stage: "Contracted" }),
    deal({ stage: "Proposal Sent", hasAssignment: false }),
  ], TODAY);
  assert.deepEqual(rows.map((r) => r.reason), ["no-assignment", "unallocated", null, null]);
});

test("filters: status, lab, leader and stage narrow the set", () => {
  const ds = [
    deal({ lab: "faith", stage: "Contracted" }), deal({ lab: "policy", stage: "Closed Lost" }),
    deal({ lab: "policy", leader: "aliza", stage: "Proposal Sent" }),
  ];
  const f = defaultFilters(TODAY);
  assert.equal(baseDeals(ds, { ...f, status: "Won" }).length, 1);
  assert.equal(baseDeals(ds, { ...f, status: "Open" }).length, 1);
  assert.equal(baseDeals(ds, { ...f, labs: ["policy"] }).length, 2);
  assert.equal(baseDeals(ds, { ...f, leader: "aliza" }).length, 1);
  assert.equal(baseDeals(ds, { ...f, stages: ["Closed Lost"] }).length, 1);
});

test("range bounds: end is exclusive, quarter and year roll over correctly", () => {
  const f = defaultFilters("2026-12-15");
  assert.deepEqual(bounds({ ...f, range: "month" }, "2026-12-15"), ["2026-12-01", "2027-01-01"]);
  assert.deepEqual(bounds({ ...f, range: "quarter" }, "2026-12-15"), ["2026-10-01", "2027-01-01"]);
  assert.deepEqual(bounds({ ...f, range: "ytd" }, "2026-12-15"), ["2026-01-01", "2026-12-16"]);
  assert.deepEqual(bounds({ ...f, range: "custom", from: "2026-02-01", to: "2026-02-28" }, "2026-12-15"), ["2026-02-01", "2026-03-01"]);
});

test("filters round-trip through the URL hash, writing only non-defaults and ignoring junk", () => {
  const def = defaultFilters(TODAY);
  assert.equal(filtersToHash(def, def), "");
  const f = { ...def, labs: ["faith", "policy"], range: "custom" as const, from: "2026-02-01", to: "2026-03-01", status: "Won" as const };
  const back = filtersFromHash(filtersToHash(f, def), def, ["faith", "policy"]);
  assert.deepEqual(back, f);
  const junk = filtersFromHash("#labs=nope&range=forever&basis=x&status=bogus&from=not-a-date", def, ["faith"]);
  assert.deepEqual(junk, def);
});

test("monthly bars are keyed by month and split by lab", () => {
  const ds = [
    deal({ stage: "Contracted", lab: "faith", stageDates: { Contracted: "2026-02-03" }, finance: fin(1000) }),
    deal({ stage: "Contracted", lab: "policy", stageDates: { Contracted: "2026-02-20" }, finance: fin(2000) }),
  ];
  const f = defaultFilters(TODAY);
  const bars = monthly(ds, f, "2026-01-01", "2026-10-02", TODAY);
  assert.equal(bars.length, 10);
  assert.deepEqual(bars[1].perLab, { faith: 1000, policy: 2000 });
  assert.equal(bars[1].total, 3000);
  assert.equal(bars[0].label, "Jan '26");
});

test("deltas: points for rates, percent for money, and the edge cases read honestly", () => {
  assert.equal(delta(0.6, 0.5, "pts").text, "+10 pts vs. prior period");
  assert.equal(delta(110, 100).text, "▲ 10% vs. prior period");
  assert.equal(delta(90, 100).tone, "down");
  assert.equal(delta(5, 0).text, "New vs. prior period");
  assert.equal(delta(0, 0).text, "Flat vs. prior period");
  assert.equal(delta(null, 3).text, "No prior-period data");
});

test("formatting: compact currency and nice axis maxima", () => {
  assert.equal(compact(1_234_567), "$1.23M");
  assert.equal(compact(340_000), "$340K");
  assert.equal(compact(1_500), "$1.5K");
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(183_000), 200_000);
});

test("CSV: quotes, and a typed deal name can't open as a spreadsheet formula", () => {
  assert.equal(toCsv([["a,b", 'say "hi"', "=HYPERLINK(1)", "-5", "plain"]]), `"a,b","say ""hi""",'=HYPERLINK(1),-5,plain`);
  const rows = unpaidRows([deal({ stage: "Contracted", client: "=cmd|' /C calc'!A0" })], TODAY);
  const csv = dealsCsv({
    generated: "now by Liz", scope: "All labs", range: "YTD", m: metrics([], "2026-01-01", "2026-10-02", ctx),
    rows, labName: (x) => x, stageName: (x) => x,
  });
  assert.ok(csv.includes("'=cmd"), "the formula is neutralised");
  assert.ok(csv.startsWith("Summary\nGenerated,now by Liz"));
});

test("a founder-run deal's remainder after hard and contractor costs is all OL share", () => {
  const f = { ...fin(60000), hard: 4000, sub: 6000, soft: 0, payout: 0, ol: 50000, founderRun: true };
  const m = metrics([deal({ stage: "Contracted", stageDates: { Contracted: "2026-06-01" }, finance: f })],
    "2026-01-01", "2026-10-02", ctx);
  assert.equal(m.costs.hard, 4000);
  assert.equal(m.costs.sub, 6000);
  assert.equal(m.costs.payout, 0);
  assert.equal(m.ol, 50000);
});
