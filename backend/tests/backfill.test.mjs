/* The backfill planner (src/backfill.mjs): what a set of CSV rows
   becomes, against a table that may already hold some of it. Pure — no AWS —
   so it runs against fixtures.

   Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseDate, plan, normName } from "../src/backfill.mjs";

const CTX = { actor: "admin@example.com", today: "2026-10-13" };

const existing = (over = {}) => ({
  labs: [
    { sk: "democracy", name: "Democracy Lab" },
    { sk: "impact", name: "Impact Lab" },
    { sk: "faith", name: "Faith Lab" }
  ],
  people: [
    { sk: "admin@example.com", email: "admin@example.com", role: "Admin" },
    { sk: "lead@example.com", email: "lead@example.com", role: "Lab Leader" },
    { sk: "helper@example.com", email: "helper@example.com", role: "Contributor" }
  ],
  companies: [], contacts: [], deals: [],
  ...over
});

const csv = (companies = [], contacts = [], deals = []) =>
  ({ companies: withLines(companies), contacts: withLines(contacts), deals: withLines(deals) });
const withLines = rows => rows.map((r, i) => ({ line: i + 2, ...r }));

const deal = (over = {}) => ({
  client: "Acme Retreat", lab: "Optimistic Democracy Lab", stage: "Lead", amount: "0", close: "",
  source: "Network", owner_email: "lead@example.com", deal_owner_email: "", company: "", contact_email: "", recurring: "",
  ...over
});

const run = (input, ex = existing()) => plan(input, undefined, ex, CTX);
const byPk = (res, pk) => res.writes.filter(w => w.pk === pk);

/* ---------- CSV and values ---------- */

test("parseCsv reads quoted commas, doubled quotes, CRLF and a BOM", () => {
  const out = parseCsv('﻿Name,Amount\r\n"Acme, Inc.","$35,000.00"\r\n"The ""Big"" One",5\r\n');
  assert.deepEqual(out.header, ["name", "amount"]);
  assert.equal(out.rows[0].name, "Acme, Inc.");
  assert.equal(out.rows[0].amount, "$35,000.00");
  assert.equal(out.rows[1].name, 'The "Big" One');
  assert.equal(out.rows[1].line, 3);
});

test("dates: ISO and US month/day/year are accepted, anything else is not", () => {
  assert.equal(parseDate("2026-04-22"), "2026-04-22");
  assert.equal(parseDate("4/22/2026"), "2026-04-22");
  assert.equal(parseDate("6/3/2026"), "2026-06-03", "month first, the spreadsheet default");
  assert.equal(parseDate(""), "");
  assert.equal(parseDate("2/30/2026"), null, "a day that does not exist");
  assert.equal(parseDate("22/4/2026"), null);
  assert.equal(parseDate("soon"), null);
});

test("company names match across 'The', case and punctuation", () => {
  assert.equal(normName("The Independent Center"), normName("independent center"));
  assert.equal(normName("SixDegrees.org"), normName("sixdegrees org"));
});

/* ---------- companies and contacts ---------- */

test("a person at two companies becomes two contacts, and each deal links to the right one", () => {
  const res = run(csv(
    [{ name: "Acme Org" }, { name: "Acme PAC" }],
    [
      { name: "Pat Lee", company: "Acme Org", email: "pat@acme.org" },
      { name: "Pat Lee", company: "Acme PAC", email: "PAT@acme.org" }
    ],
    [
      deal({ client: "Org deal", stage: "Proposal & Negotiation", company: "Acme Org", contact_email: "pat@acme.org" }),
      deal({ client: "PAC deal", stage: "Proposal & Negotiation", company: "Acme PAC", contact_email: "pat@acme.org" })
    ]
  ));
  assert.deepEqual(res.errors, []);
  const contacts = byPk(res, "CONTACT");
  assert.equal(contacts.length, 2);
  assert.notEqual(contacts[0].companyId, contacts[1].companyId);
  const [orgDeal, pacDeal] = byPk(res, "DEAL");
  assert.equal(orgDeal.contactId, contacts.find(c => c.companyId === orgDeal.companyId).sk);
  assert.equal(pacDeal.contactId, contacts.find(c => c.companyId === pacDeal.companyId).sk);
  assert.equal(contacts[1].email, "pat@acme.org", "emails are lowercased");
});

test("a company's primary contact is the one named, else the first added", () => {
  const res = run(csv(
    [
      { name: "Named Co", primary_contact_email: "second@named.co" },
      { name: "Unnamed Co" }
    ],
    [
      { name: "First One", company: "Named Co", email: "first@named.co" },
      { name: "Second One", company: "Named Co", email: "second@named.co" },
      { name: "Only One", company: "Unnamed Co", email: "only@unnamed.co" }
    ]
  ));
  const [named, unnamed] = byPk(res, "COMPANY");
  const contacts = byPk(res, "CONTACT");
  assert.equal(named.contactId, contacts.find(c => c.email === "second@named.co").sk);
  assert.equal(unnamed.contactId, contacts.find(c => c.email === "only@unnamed.co").sk);
});

test("a primary_contact_email that matches nobody warns and falls back to the first contact", () => {
  const res = run(csv([{ name: "Co", primary_contact_email: "ghost@co.com" }], [{ name: "Real Person", company: "Co", email: "real@co.com" }]));
  assert.deepEqual(res.errors, []);
  assert.match(res.warnings.join("\n"), /ghost@co.com matches no contact/);
  assert.equal(byPk(res, "COMPANY")[0].contactId, byPk(res, "CONTACT")[0].sk);
});

test("records are shaped like the portal's own, created by the actor", () => {
  const res = run(csv([{ name: "Acme", kind: "Non-profit", website: "https://acme.org" }], [{ name: "Pat Lee", company: "Acme", title: "Director" }]));
  const [co] = byPk(res, "COMPANY"), [ct] = byPk(res, "CONTACT");
  assert.equal(co.sk, "CO-001");
  assert.equal(ct.sk, "CT-001");
  assert.deepEqual(
    { createdBy: co.createdBy, created: co.created, kind: co.kind, website: co.website },
    { createdBy: "admin@example.com", created: "2026-10-13", kind: "Non-profit", website: "https://acme.org" }
  );
  assert.equal(ct.companyId, "CO-001");
  assert.equal(ct.title, "Director");
});

test("ids carry on from what the table already holds", () => {
  const res = run(csv([{ name: "New Co" }]), existing({ companies: [{ sk: "CO-007", name: "Old Co" }] }));
  assert.equal(byPk(res, "COMPANY")[0].sk, "CO-008");
});

test("bad values are errors with the line and the reason", () => {
  const res = run(csv(
    [{ name: "Co", website: "not a url" }, { name: "Co Two", email: "nope" }],
    [{ name: "Pat", phone: "123" }]
  ));
  assert.equal(res.errors.length, 3);
  assert.match(res.errors[0], /company line 2 \(Co\): invalid website/);
  assert.match(res.errors[1], /invalid email/);
  assert.match(res.errors[2], /needs 10–15 digits/);
});

test("a contact whose company is unknown is an error, not a silent orphan", () => {
  const res = run(csv([], [{ name: "Pat Lee", company: "Nowhere Inc", email: "pat@x.com" }]));
  assert.match(res.errors[0], /company "Nowhere Inc" is not in companies.csv or the portal/);
});

test("a contact with a single name is imported but flagged", () => {
  const res = run(csv([{ name: "Co" }], [{ name: "Alice", company: "Co", email: "alice@co.com" }]));
  assert.deepEqual(res.errors, []);
  assert.match(res.warnings.join("\n"), /"Alice" has no last name/);
});

/* ---------- deals ---------- */

test("stages, amounts and dates are normalised; outcome follows the stage", () => {
  const res = run(csv([{ name: "Co" }], [], [
    deal({ client: "A", stage: "Closed Won", amount: "$35,000.00", close: "4/22/2026", company: "Co" }),
    deal({ client: "B", stage: "Contracted Won", amount: "10000", company: "Co" }),
    deal({ client: "C", stage: "Contracted", company: "Co" }),
    deal({ client: "D", stage: "Proposal & Negotiation", company: "Co" }),
    deal({ client: "E", stage: "Closed Lost" }),
    deal({ client: "F", stage: "Lead" })
  ]));
  assert.deepEqual(res.errors, []);
  const d = Object.fromEntries(byPk(res, "DEAL").map(x => [x.client, x]));
  assert.equal(d.A.stage, "Closed");
  assert.equal(d.A.outcome, "Won");
  assert.equal(d.A.amount, 35000);
  assert.equal(d.A.close, "2026-04-22");
  assert.equal(d.B.stage, "Contracted");
  assert.equal(d.B.outcome, undefined, "signed is not won until paid");
  assert.equal(d.C.stage, "Contracted");
  assert.equal(d.D.stage, "Proposal Sent");
  assert.equal(d.E.stage, "Closed Lost");
  assert.equal(d.E.outcome, "Lost");
  assert.equal(d.F.stage, "Lead");
  assert.equal(d.F.recurring, false);
  assert.equal(d.F.sk, "D-006");
});

test("owner, deal owner and lab resolve to the keys the portal uses", () => {
  const res = run(csv([], [], [
    deal({ client: "A", lab: "Optimistic Impact Lab", owner_email: "LEAD@example.com", deal_owner_email: "admin@example.com" }),
    deal({ client: "B", lab: "faith" }),
    deal({ client: "C", lab: "Democracy" })
  ]));
  assert.deepEqual(res.errors, []);
  const [a, b, c] = byPk(res, "DEAL");
  assert.deepEqual([a.lab, a.owner, a.dealOwner], ["impact", "lead@example.com", "admin@example.com"]);
  assert.deepEqual([b.lab, b.dealOwner], ["faith", "lead@example.com"], "deal owner defaults to the owner");
  assert.equal(c.lab, "democracy");
});

test("a deal that cannot be written is an error that says why", () => {
  const res = run(csv([], [], [
    deal({ client: "Bad lab", lab: "Optimistic Space Lab" }),
    deal({ client: "Ice", stage: "Ice Box" }),
    deal({ client: "No source", source: "" }),
    deal({ client: "Bad amount", amount: "lots" }),
    deal({ client: "Bad date", close: "31/12/2026" }),
    deal({ client: "Ghost owner", owner_email: "who@example.com" }),
    deal({ client: "Name as owner", deal_owner_email: "Seth Cohen" }),
    deal({ client: "Contributor owner", deal_owner_email: "helper@example.com" }),
    deal({ client: "Unknown company", company: "Nowhere" })
  ]));
  assert.equal(byPk(res, "DEAL").length, 0);
  const text = res.errors.join("\n");
  assert.match(text, /lab "Optimistic Space Lab" matches no lab\. The portal's labs: Democracy Lab \(democracy\)/);
  assert.match(text, /stage "Ice Box" is not one of/);
  assert.match(text, /source "" is not one of/);
  assert.match(text, /amount "lots" is not a number/);
  assert.match(text, /close "31\/12\/2026" is not a date/);
  assert.match(text, /owner_email "who@example.com" is not a portal user/);
  assert.match(text, /deal_owner_email "Seth Cohen" is not a portal user \(an email is needed, not a name\)/);
  assert.match(text, /is a Contributor; it must be an Admin or Lab Leader/);
  assert.match(text, /company "Nowhere" is not in companies.csv or the portal/);
});

test("the billing rule: Proposal & Negotiation and later need a company or contact, Lead and Closed Lost do not", () => {
  const res = run(csv([], [], [
    deal({ client: "Early", stage: "Lead" }),
    deal({ client: "Lost", stage: "Closed Lost" }),
    deal({ client: "Late", stage: "Contracted (Signed)" })
  ]));
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /\(Late\): a deal at Contracted needs a company or a contact/);
});

test("a won deal with no close date is allowed, with a warning", () => {
  const res = run(csv([{ name: "Co" }], [], [deal({ stage: "Closed Won (Paid)", company: "Co", close: "" })]));
  assert.deepEqual(res.errors, []);
  assert.equal(byPk(res, "DEAL")[0].close, "");
  assert.match(res.warnings.join("\n"), /no close date/);
});

test("a contact_email that is not at the deal's company links the company only, with a warning", () => {
  const res = run(csv([{ name: "Co" }], [], [deal({ stage: "Contracted", company: "Co", contact_email: "x@y.com" })]));
  assert.deepEqual(res.errors, []);
  assert.equal(byPk(res, "DEAL")[0].contactId, null);
  assert.match(res.warnings.join("\n"), /x@y.com is not a contact at Co/);
});

test("recurring is off unless asked for, and asking at Contracted or later is called out", () => {
  const quiet = run(csv([{ name: "Co" }], [], [deal({ stage: "Contracted", company: "Co" })]));
  assert.equal(byPk(quiet, "DEAL")[0].recurring, false);
  assert.equal(quiet.warnings.length, 0);

  const loud = run(csv([{ name: "Co" }], [], [deal({ stage: "Contracted", company: "Co", recurring: "yes" })]));
  assert.equal(byPk(loud, "DEAL")[0].recurring, true);
  assert.match(loud.warnings.join("\n"), /recurring engine will start generating/);
});

/* ---------- re-runs and the existing table ---------- */

test("running the same files twice writes nothing the second time", () => {
  const input = csv(
    [{ name: "Acme Org", primary_contact_email: "pat@acme.org" }],
    [{ name: "Pat Lee", company: "Acme Org", email: "pat@acme.org" }],
    [deal({ client: "Retreat", stage: "Contracted", company: "Acme Org", contact_email: "pat@acme.org" })]
  );
  const first = run(input);
  assert.equal(first.writes.length, 3);

  const loaded = existing({
    companies: byPk(first, "COMPANY"), contacts: byPk(first, "CONTACT"), deals: byPk(first, "DEAL")
  });
  const second = run(input, loaded);
  assert.equal(second.writes.length, 0);
  assert.equal(second.updates.length, 0);
  assert.deepEqual(second.errors, []);
  assert.equal(second.skipped.length, 3);
});

test("a deal links to a company that is already in the portal", () => {
  const ex = existing({ companies: [{ sk: "CO-004", name: "The Old Client", contactId: null }] });
  const res = run(csv([], [], [deal({ stage: "Contracted", company: "Old Client" })]), ex);
  assert.deepEqual(res.errors, []);
  assert.equal(byPk(res, "DEAL")[0].companyId, "CO-004");
});

test("a new contact becomes the primary of an existing company that has none, and only then", () => {
  const ex = existing({ companies: [
    { sk: "CO-001", name: "Bare Co", contactId: null },
    { sk: "CO-002", name: "Covered Co", contactId: "CT-009" }
  ] });
  const res = run(csv([], [
    { name: "New One", company: "Bare Co", email: "a@bare.co" },
    { name: "New Two", company: "Covered Co", email: "b@covered.co" }
  ]), ex);
  assert.equal(res.updates.length, 1);
  assert.equal(res.updates[0].sk, "CO-001");
  assert.equal(res.updates[0].set.contactId, byPk(res, "CONTACT").find(c => c.email === "a@bare.co").sk);
});

test("a file with a missing required column is refused up front", () => {
  const res = plan(csv(), { deals: ["client", "lab"] }, existing(), CTX);
  assert.match(res.errors.join("\n"), /deals.csv has no "stage" column/);
  assert.equal(res.writes.length, 0);
});

test("--as must be a portal user", () => {
  const res = plan(csv([{ name: "Co" }]), undefined, existing(), { ...CTX, actor: "nobody@example.com" });
  assert.match(res.errors.join("\n"), /--as nobody@example.com is not a portal user/);
});
