/* Documents tab rules. The server enforces them; these pin the copy of the
   rules the tab uses to decide what to show. Run with `npm test` in web/. */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consequence, declinedNote, docsOf, openRequirements, protectedDeleteReason, requirementRows,
  requirementSummary, suggestKind,
} from "../lib/documents.ts";
import type { FileRecord, Waiver } from "../lib/types.ts";

let n = 0;
const file = (kind: FileRecord["kind"], over: Partial<FileRecord> = {}): FileRecord =>
  ({ id: `F-${++n}`, name: "x.pdf", deal: "D-1", kind, status: "Ready", version: kind === "invoice" ? undefined : 1, ...over }) as FileRecord;
const waiver = (requirement: Waiver["requirement"], status: Waiver["status"], over: Partial<Waiver> = {}): Waiver =>
  ({ id: `W-${++n}`, deal: "D-1", requirement, reason: "r", attachments: [], requestedBy: "m", requestedAt: "2026-10-01", status, ...over });
const deal = (stage: string, contractSigned = false) => ({ id: "D-1", stage, contractSigned }) as never;
const label = (s: string) => (s === "Contracted" ? "Contracted (Signed)" : s === "Proposal Sent" ? "Proposal & Negotiation" : s);

test("each stage asks for its own documents: nothing early, proposal, then proposal and contract", () => {
  const kinds = (stage: string) => requirementRows({ deal: deal(stage), files: [], waivers: [] }).map((r) => r.kind);
  assert.deepEqual(kinds("Discovery"), []);
  assert.deepEqual(kinds("Proposal Sent"), ["proposal"]);
  assert.deepEqual(kinds("Contracted"), ["proposal", "contract"]);
  assert.deepEqual(kinds("Closed"), ["proposal", "contract", "invoice"]);
  assert.deepEqual(kinds("Closed Lost"), []);
});

test("a requirement is met by a document, or by an approved waiver — never a pending one", () => {
  const state = (files: FileRecord[], waivers: Waiver[]) =>
    requirementRows({ deal: deal("Contracted"), files, waivers }).map((r) => r.state);
  assert.deepEqual(state([], []), ["missing", "missing"]);
  assert.deepEqual(state([file("proposal")], [waiver("contract", "pending")]), ["met", "pending"]);
  assert.deepEqual(state([file("proposal")], [waiver("contract", "approved")]), ["met", "waived"]);
  assert.deepEqual(state([], [waiver("proposal", "declined"), waiver("contract", "withdrawn")]), ["missing", "missing"]);
  assert.deepEqual(state([file("proposal"), file("contract")], [waiver("contract", "approved")]), ["met", "met"], "a document beats a waiver");
  const closed = (files: FileRecord[], waivers: Waiver[]) =>
    requirementRows({ deal: deal("Closed"), files, waivers }).map((r) => r.state);
  assert.deepEqual(closed([file("proposal"), file("contract")], []), ["met", "met", "missing"]);
  assert.deepEqual(closed([file("proposal"), file("contract")], [waiver("invoice" as never, "approved")]), ["met", "met", "missing"], "an invoice cannot be waived");
});

test("a DocuSign-signed contract and a proposal marked sent in the old flow still count", () => {
  const rows = requirementRows({ deal: deal("Contracted", true), files: [], waivers: [], legacyProposalSent: true });
  assert.deepEqual(rows.map((r) => r.state), ["met", "met"]);
});

test("the summary and the open list", () => {
  const rows = (files: FileRecord[], waivers: Waiver[]) => requirementRows({ deal: deal("Contracted"), files, waivers });
  assert.equal(requirementSummary(rows([], [])).text, "0 of 2 met");
  assert.equal(requirementSummary(rows([file("proposal"), file("contract")], [])).text, "All met");
  const mixed = rows([file("proposal")], [waiver("contract", "approved")]);
  assert.deepEqual(requirementSummary(mixed), { text: "1 met · 1 waived", tone: "ok" });
  assert.equal(openRequirements(mixed).length, 0);
  assert.equal(openRequirements(rows([], [waiver("contract", "pending")])).length, 2, "pending is still open");
});

test("versions sort highest first, and invoices by date", () => {
  const files = [file("contract", { version: 1 }), file("contract", { version: 3 }), file("contract", { version: 2 }),
    file("invoice", { date: "2026-01-01" }), file("invoice", { date: "2026-03-01" })];
  assert.deepEqual(docsOf(files, "D-1", "contract").map((f) => f.version), [3, 2, 1]);
  assert.deepEqual(docsOf(files, "D-1", "invoice").map((f) => f.date), ["2026-03-01", "2026-01-01"]);
});

test("a type is suggested from the file name only when the name is unambiguous", () => {
  assert.equal(suggestKind("JFSNJ Exhibit A Proposal_October.pdf"), "proposal");
  assert.equal(suggestKind("Master Services Agreement.pdf"), "contract");
  assert.equal(suggestKind("INVOICE-0042.pdf"), "invoice");
  assert.equal(suggestKind("scan0001.pdf"), null);
  assert.equal(suggestKind("Signed proposal.pdf"), null);
});

test("the picker says what will happen from the real version count", () => {
  assert.equal(consequence("proposal", 3, 3), "Becomes v4, the current proposal. v3 and earlier stay on record.");
  assert.equal(consequence("contract", 0, 0), "First signed contract on this deal.");
  assert.match(consequence("invoice", 5, 0), /Doesn't replace earlier invoices/);
});

test("the last version of a required document is protected; any other may go", () => {
  const args = (files: FileRecord[], waivers: Waiver[] = [], d = deal("Contracted")) => (f: FileRecord) =>
    protectedDeleteReason({ file: f, deal: d, files, waivers, stageLabel: label });
  const [v1, v2] = [file("contract", { version: 1 }), file("contract", { version: 2 })];
  assert.equal(args([v1, v2])(v1), null);
  assert.match(args([v1])(v1)!, /only signed contract.*Contracted \(Signed\).*Upload a new version first/);
  assert.equal(args([v1], [waiver("contract", "approved")])(v1), null);
  assert.ok(args([v1], [waiver("contract", "pending")])(v1));
  assert.equal(args([v1], [], deal("Contracted", true))(v1), null, "DocuSign already meets it");
  const inv = file("invoice");
  assert.equal(args([inv], [], deal("Closed"))(inv), null, "invoices are never protected");
  const early = file("proposal");
  assert.equal(args([early], [], deal("Discovery"))(early), null, "not yet required");
});

test("a declined waiver's note shows until dismissed, and not once something newer exists", () => {
  const declined = waiver("contract", "declined", { adminNote: "Get the paper" });
  assert.equal(declinedNote([declined], "D-1", "contract")?.adminNote, "Get the paper");
  assert.equal(declinedNote([{ ...declined, dismissed: true }], "D-1", "contract"), undefined);
  assert.equal(declinedNote([declined, waiver("contract", "pending", { requestedAt: "2026-10-05" })], "D-1", "contract"), undefined);
});
