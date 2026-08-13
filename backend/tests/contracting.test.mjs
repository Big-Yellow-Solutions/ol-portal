/* Base Contract PRD · tests for the logic that has to be right rather than
   merely working: what a price means, whether a contract still matches the
   proposal the customer approved, whether the signed-document fingerprint is
   stable, and whether a customer who asked for changes can approve the
   revision afterwards.

   Deliberately covers pure functions only — the route handlers are thin
   wrappers over DynamoDB and are exercised end to end against the deployed
   stack instead.

   Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanPricing, pricingTotal, pricingLines, pricingText, samePricing, pricingDiffSummary
} from "../src/pricing.mjs";
import { deviationsOf, contributorVisible } from "../src/contracts.mjs";
import { hashOf, executionCopy, signingReadiness } from "../src/signing.mjs";
import { docKind, docMeta, isContributorDoc } from "../src/util.mjs";
import { decisionForCurrentVersion } from "../src/proposals.mjs";
import { mergeClauses, templateVars } from "../src/templates.mjs";

/* ---------------- pricing (FR3) ---------------- */

test("flat pricing validates and totals", () => {
  const { value, error } = cleanPricing({ kind: "flat", amount: 12000, label: "Engagement fee" });
  assert.equal(error, undefined);
  assert.equal(value.amount, 12000);
  assert.equal(pricingTotal(value), 12000);
});

test("flat pricing rejects a missing or negative amount", () => {
  assert.ok(cleanPricing({ kind: "flat" }).error);
  assert.ok(cleanPricing({ kind: "flat", amount: -5 }).error);
});

test("unpriced is a legitimate value, not an error", () => {
  assert.deepEqual(cleanPricing(null), { value: null });
  assert.deepEqual(cleanPricing(undefined), { value: null });
  assert.equal(pricingTotal(null), null);
});

test("tiered pricing has no total until a package is chosen", () => {
  const { value } = cleanPricing({
    kind: "tiered",
    tiers: [
      { name: "Foundations", amount: 12000, recommended: true },
      { name: "Momentum", amount: 24000 }
    ]
  });
  assert.equal(pricingTotal(value), null, "no selection yet");

  const chosen = cleanPricing({ ...value, selected: value.tiers[1].id }).value;
  assert.equal(pricingTotal(chosen), 24000);
});

test("tiered pricing keeps exactly one recommendation", () => {
  const { value } = cleanPricing({
    kind: "tiered",
    tiers: [
      { name: "A", amount: 1, recommended: true },
      { name: "B", amount: 2, recommended: true }
    ]
  });
  assert.equal(value.tiers.filter(t => t.recommended).length, 1);
});

test("tiered pricing rejects a selection that isn't on the list", () => {
  const bad = cleanPricing({ kind: "tiered", tiers: [{ name: "A", amount: 1 }], selected: "nope" });
  assert.ok(bad.error);
});

test("tier ids stay unique when two packages share a name", () => {
  const { value } = cleanPricing({
    kind: "tiered", tiers: [{ name: "Retainer", amount: 1 }, { name: "Retainer", amount: 2 }]
  });
  assert.equal(new Set(value.tiers.map(t => t.id)).size, 2);
});

test("itemized pricing totals quantity times rate, less discount", () => {
  const { value } = cleanPricing({
    kind: "itemized",
    items: [
      { description: "Discovery workshops", qty: 3, rate: 2500 },
      { description: "Playbook", qty: 1, rate: 4000 }
    ],
    discount: 1500
  });
  assert.equal(pricingTotal(value), 3 * 2500 + 4000 - 1500);
});

test("itemized pricing refuses a discount bigger than the subtotal", () => {
  const bad = cleanPricing({
    kind: "itemized", items: [{ description: "x", qty: 1, rate: 100 }], discount: 500
  });
  assert.ok(bad.error);
});

test("pricing rows render a discount as a negative line", () => {
  const { value } = cleanPricing({
    kind: "itemized", items: [{ description: "x", qty: 2, rate: 100 }], discount: 50
  });
  const rows = pricingLines(value);
  assert.equal(rows[0].amount, 200);
  assert.equal(rows[1].amount, -50);
  assert.match(pricingText(value), /Total: \$150/);
});

test("float noise from client-side arithmetic can't fake a price change", () => {
  const a = cleanPricing({ kind: "flat", amount: 12000 }).value;
  const b = cleanPricing({ kind: "flat", amount: 12000.000000001 }).value;
  assert.ok(samePricing(a, b));
});

/* ---------------- deviation detection (FR11) ---------------- */

const approved = {
  sections: { summary: "s", scope: "Two workshops", deliverables: "d", timeline: "t", pricing: "p", terms: "x" },
  pricing: cleanPricing({ kind: "flat", amount: 20000 }).value
};
const contractFrom = over => ({
  inherited: { version: 3, ...approved },
  sections: { ...approved.sections },
  pricing: approved.pricing,
  ...over
});

test("a contract matching the approved proposal has no deviations", () => {
  assert.deepEqual(deviationsOf(contractFrom({})), []);
});

test("editing inherited scope is flagged", () => {
  const c = contractFrom({ sections: { ...approved.sections, scope: "Three workshops" } });
  const d = deviationsOf(c);
  assert.equal(d.length, 1);
  assert.equal(d[0].field, "scope");
});

test("changing the price is flagged with the amounts named", () => {
  const c = contractFrom({ pricing: cleanPricing({ kind: "flat", amount: 25000 }).value });
  const d = deviationsOf(c);
  assert.equal(d.length, 1);
  assert.equal(d[0].field, "pricing");
  assert.match(d[0].summary, /\$20,000 to \$25,000/);
});

test("reverting an edit clears the flag rather than leaving a stale warning", () => {
  const edited = contractFrom({ sections: { ...approved.sections, scope: "Three workshops" } });
  assert.equal(deviationsOf(edited).length, 1);
  const reverted = { ...edited, sections: { ...approved.sections } };
  assert.deepEqual(deviationsOf(reverted), []);
});

test("whitespace-only edits are not deviations", () => {
  const c = contractFrom({ sections: { ...approved.sections, scope: "  Two workshops  " } });
  assert.deepEqual(deviationsOf(c), []);
});

test("a contract with no inherited snapshot reports nothing rather than throwing", () => {
  assert.deepEqual(deviationsOf({ sections: { scope: "x" } }), []);
  assert.deepEqual(deviationsOf(null), []);
});

test("pricing diff summary handles going from unpriced to priced", () => {
  assert.match(pricingDiffSummary(null, cleanPricing({ kind: "flat", amount: 500 }).value), /set to \$500/);
});

/* ---------------- document fingerprint (FR14) ---------------- */

test("the fingerprint ignores key order", () => {
  const a = { contractId: "C-001", client: "Acme", pricing: { kind: "flat", amount: 1000 } };
  const b = { pricing: { amount: 1000, kind: "flat" }, client: "Acme", contractId: "C-001" };
  assert.equal(hashOf(a), hashOf(b));
});

test("the fingerprint changes when the price changes", () => {
  const a = { client: "Acme", pricing: { kind: "flat", amount: 1000 } };
  const b = { client: "Acme", pricing: { kind: "flat", amount: 1001 } };
  assert.notEqual(hashOf(a), hashOf(b));
});

test("the fingerprint changes when a clause changes", () => {
  const base = { client: "Acme", clauses: [{ heading: "Term", text: "Twelve months." }] };
  const edited = { client: "Acme", clauses: [{ heading: "Term", text: "Twenty-four months." }] };
  assert.notEqual(hashOf(base), hashOf(edited));
});

test("undefined and null hash identically, so a DynamoDB round trip is safe", () => {
  assert.equal(hashOf({ a: 1, b: undefined }), hashOf({ a: 1, b: null }));
});

/* ---------------- the revision loop (PRD 5.3) ---------------- */

test("a customer can respond once per version they were sent", () => {
  // Sent v2, customer asked for changes.
  const afterRevisionRequest = {
    sentVersion: 2,
    decisions: [{ action: "revision", version: 2, comment: "trim the scope" }]
  };
  assert.ok(decisionForCurrentVersion(afterRevisionRequest), "v2 is spoken for");

  // Lab Leader revises and re-sends as v3. This is the case the old single
  // terminal `decision` field made impossible.
  const afterResend = { ...afterRevisionRequest, sentVersion: 3 };
  assert.equal(decisionForCurrentVersion(afterResend), null, "v3 is open for a decision");

  const afterApproval = {
    ...afterResend,
    decisions: [...afterRevisionRequest.decisions, { action: "approve", version: 3 }]
  };
  assert.ok(decisionForCurrentVersion(afterApproval), "v3 now decided");
});

test("a fresh proposal has no decision recorded", () => {
  assert.equal(decisionForCurrentVersion({ sentVersion: 1 }), null);
  assert.equal(decisionForCurrentVersion({ sentVersion: 1, decisions: [] }), null);
});

/* ---------------- contract template merge (FR12) ---------------- */

test("placeholders fill from the contract and report what's missing", () => {
  const vars = templateVars({
    contract: {
      sk: "C-004", client: "Acme Foundation", paymentSchedule: "50% up front",
      pricing: cleanPricing({ kind: "flat", amount: 20000 }).value
    },
    lab: { name: "Faith Lab" },
    owner: { firstName: "Aliza", lastName: "Goodman" },
    signatory: { firstName: "Liz", lastName: "Russell" }
  });
  const { clauses, unresolved } = mergeClauses([
    { heading: "Fees", text: "{{client}} will pay {{total}} to Optimistic Labs, {{paymentSchedule}}." },
    { heading: "Term", text: "Beginning {{startDate}}." }
  ], vars);

  assert.match(clauses[0].text, /Acme Foundation will pay \$20,000 to Optimistic Labs, 50% up front\./);
  assert.deepEqual(unresolved, ["startDate"], "an unfilled date is reported");
  assert.match(clauses[1].text, /\{\{startDate\}\}/, "and stays visible rather than vanishing");
});

test("merging leaves unknown placeholders alone instead of blanking the clause", () => {
  const { clauses, unresolved } = mergeClauses([{ heading: "", text: "See {{nonsense}}." }], {});
  assert.equal(clauses[0].text, "See {{nonsense}}.");
  assert.deepEqual(unresolved, ["nonsense"]);
});

/* ---------------- document kinds (Contributor MSA PRD) ----------------

   MSAs and task orders are CONTRACT records with a `docKind`, so the risk in
   this design isn't that a new kind won't work — it's that an old record
   without the field stops working, or that one kind's rules leak into
   another's. These pin down both. */

test("a record with no docKind is a client contract, not an error", () => {
  assert.equal(docKind({ sk: "C-001" }), "client");
  assert.equal(docMeta({ sk: "C-001" }).title, "Services Agreement");
  assert.equal(isContributorDoc({ sk: "C-001" }), false);
});

test("an unrecognized docKind falls back rather than rendering undefined", () => {
  // A record written by a newer deploy and read by an older one, or a typo in
  // a hand-edited item. Labelling it as a contract is wrong but survivable;
  // crashing the whole list is not.
  assert.equal(docKind({ docKind: "change-order" }), "client");
  assert.equal(docMeta({ docKind: "" }).label, "Contract");
});

test("MSAs and task orders are contributor paper, client contracts aren't", () => {
  assert.equal(isContributorDoc({ docKind: "msa" }), true);
  assert.equal(isContributorDoc({ docKind: "task-order" }), true);
  assert.equal(isContributorDoc({ docKind: "client" }), false);
});

/* ---------------- signing readiness per kind ---------------- */

const READY_MSA = {
  docKind: "msa", client: "Dana Weiss",
  clientSignerName: "Dana Weiss", clientSignerEmail: "dana@example.com",
  clauses: [{ heading: "Confidentiality", text: "..." }]
};

test("an MSA is ready to send without a payment schedule or a price", () => {
  // PRD 5.1.2: an MSA sets the terms of a relationship. Money is agreed per
  // task order, so requiring a figure here would mean inventing one.
  const { ready, missing } = signingReadiness(READY_MSA);
  assert.equal(ready, true, missing.join(", "));
});

test("a client contract still needs its payment schedule", () => {
  const { ready, missing } = signingReadiness({ ...READY_MSA, docKind: "client" });
  assert.equal(ready, false);
  assert.deepEqual(missing, ["Payment schedule"]);
});

test("a task order can't go out without compensation and a timeline", () => {
  const { missing } = signingReadiness({ ...READY_MSA, docKind: "task-order" });
  assert.deepEqual(missing, ["Compensation", "Timeline"]);

  const complete = {
    ...READY_MSA, docKind: "task-order",
    pricing: cleanPricing({ kind: "flat", amount: 8000 }).value,
    sections: { timeline: "Six weeks from kickoff" }
  };
  assert.equal(signingReadiness(complete).ready, true);
});

test("a tiered price with nothing selected doesn't count as compensation", () => {
  // pricingTotal() is null until a package is chosen, which is exactly the
  // state a task order must not be signed in.
  const tiered = cleanPricing({
    kind: "tiered",
    tiers: [{ name: "Foundations", amount: 8000 }, { name: "Deep", amount: 20000 }]
  }).value;
  const { missing } = signingReadiness({
    ...READY_MSA, docKind: "task-order", pricing: tiered,
    sections: { timeline: "Six weeks" }
  });
  assert.deepEqual(missing, ["Compensation"]);
});

test("unresolved template fields block every kind alike", () => {
  const { ready, missing } = signingReadiness({ ...READY_MSA, unresolvedVars: ["msaDate"] });
  assert.equal(ready, false);
  assert.match(missing.join(" "), /msaDate/);
});

/* ---------------- the frozen copy ---------------- */

test("the execution copy names its kind and its parent", () => {
  const copy = executionCopy({ sk: "TO-001", docKind: "task-order", parentId: "MSA-002", client: "Dana Weiss" });
  assert.equal(copy.docKind, "task-order");
  assert.equal(copy.parentId, "MSA-002");
});

test("a task order can't be re-pointed at another MSA after signature", () => {
  // The parent is inside the hash, so changing it invalidates the signature
  // rather than silently moving the work under different terms.
  const before = executionCopy({ sk: "TO-001", docKind: "task-order", parentId: "MSA-002", client: "Dana Weiss" });
  const after = executionCopy({ sk: "TO-001", docKind: "task-order", parentId: "MSA-009", client: "Dana Weiss" });
  assert.notEqual(hashOf(before), hashOf(after));
});

test("a client contract's copy carries no parent key at all", () => {
  // Absent rather than null: the key would otherwise appear in the canonical
  // JSON of every contract and change nothing but the hash.
  const copy = executionCopy({ sk: "C-004", client: "Acme Foundation" });
  assert.equal("parentId" in copy, false);
  assert.equal(copy.docKind, "client");
});

/* ---------------- what a Contributor can see (FR10) ---------------- */

const DOCS = [
  { sk: "MSA-001", docKind: "msa", status: "Signed", clientSignerEmail: "dana@example.com" },
  { sk: "TO-001", docKind: "task-order", parentId: "MSA-001", status: "Signed", clientSignerEmail: "dana@example.com" },
  { sk: "TO-002", docKind: "task-order", parentId: "MSA-001", status: "Signed", clientSignerEmail: "" },
  { sk: "TO-003", docKind: "task-order", parentId: "MSA-001", status: "Draft", clientSignerEmail: "dana@example.com" },
  { sk: "MSA-002", docKind: "msa", status: "Signed", clientSignerEmail: "sam@example.com" },
  { sk: "TO-004", docKind: "task-order", parentId: "MSA-002", status: "Signed", clientSignerEmail: "sam@example.com" },
  { sk: "C-010", status: "Signed", client: "Acme", contributorEmail: "dana@example.com" }
];
const idsFor = email => contributorVisible(DOCS, email).map(d => d.sk).sort();

test("a Contributor sees their MSA, its task orders, and contracts naming them", () => {
  assert.deepEqual(idsFor("dana@example.com"), ["C-010", "MSA-001", "TO-001", "TO-002"]);
});

test("a task order is visible through its parent even with no email of its own", () => {
  // TO-002 inherits its signer from the MSA and carries a blank email; it is
  // still Dana's work and still hers to read.
  assert.ok(idsFor("dana@example.com").includes("TO-002"));
});

test("one Contributor never sees another's agreements", () => {
  assert.deepEqual(idsFor("sam@example.com"), ["MSA-002", "TO-004"]);
});

test("drafts stay private until they're executed", () => {
  // Before signature the Contributor's access is the tokenized signing link,
  // not the portal list.
  assert.ok(!idsFor("dana@example.com").includes("TO-003"));
});

test("an address that matches nothing sees nothing, and neither does a blank one", () => {
  assert.deepEqual(idsFor("nobody@example.com"), []);
  assert.deepEqual(contributorVisible(DOCS, ""), []);
  assert.deepEqual(contributorVisible(DOCS, undefined), []);
});

test("matching is case-insensitive, so a capitalised invite still resolves", () => {
  assert.deepEqual(idsFor("Dana@Example.com"), ["C-010", "MSA-001", "TO-001", "TO-002"]);
});

/* ---------------- terms by reference (FR7) ---------------- */

test("a task order names the MSA it's governed by instead of restating it", () => {
  const parent = { sk: "MSA-001", executedAt: "2026-08-01T10:00:00.000Z" };
  const vars = templateVars({
    contract: { sk: "TO-001", client: "Dana Weiss", docKind: "task-order", parentId: "MSA-001" },
    lab: { name: "Faith Lab" }, parent
  });
  const { clauses, unresolved } = mergeClauses([{
    heading: "Governing Agreement",
    text: "Issued under the Master Services Agreement {{msaId}} between Optimistic Labs and " +
      "{{contributor}}, executed {{msaDate}}."
  }], vars);

  assert.match(clauses[0].text, /MSA-001 between Optimistic Labs and Dana Weiss, executed 2026-08-01\./);
  assert.deepEqual(unresolved, []);
});

test("contributor paper and client paper read the same counterparty field", () => {
  const vars = templateVars({ contract: { sk: "MSA-001", client: "Dana Weiss", clientSignerName: "Dana Weiss" } });
  assert.equal(vars.contributor, "Dana Weiss");
  assert.equal(vars.client, "Dana Weiss");
  assert.equal(vars.contributorSigner, "Dana Weiss");
});
