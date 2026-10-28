/* Documents tab · the rules, as plain functions.

   No React and no value imports from the rest of the app, so `npm test` can
   run this directly under node. Mirrors backend/src/documents.mjs: the server
   is the control, this is what lets the tab say the same thing before it asks.

   A requirement is MET by a live document of that kind or an APPROVED waiver.
   A pending, declined or withdrawn waiver never counts, and invoices (which
   gate Closed Won) cannot be waived. */

import type { Deal, FileKind, FileRecord, Waiver, WaiverRequirement } from "@/lib/types";

/** What a stage can require. Only the first two can be waived. */
export const REQUIREMENTS: FileKind[] = ["proposal", "contract", "invoice"];

export const KIND_NAME: Record<FileKind, string> = {
  proposal: "Proposal",
  contract: "Signed contract",
  invoice: "Invoices",
};

/* The stored stages each document is required from. "Closed Lost" is left out
   on purpose: a lost deal needs nothing. */
const REQUIRED_FROM: Record<FileKind, string[]> = {
  proposal: ["Proposal Sent", "Contracted", "Closed"],
  contract: ["Contracted", "Closed"],
  invoice: ["Closed"],
};
/** The stage whose gate introduces each requirement ("for Proposal Sent"). */
export const GATE_STAGE: Record<FileKind, string> = {
  proposal: "Proposal Sent",
  contract: "Contracted",
  invoice: "Closed",
};

export const requiredAt = (kind: FileKind, stage: string): boolean => REQUIRED_FROM[kind].includes(stage);

export const isWaivable = (k: FileKind): k is WaiverRequirement => k === "proposal" || k === "contract";

/** Files stored before versioning existed carry no number and read as v1. */
export const versionOf = (f: Pick<FileRecord, "version">) => f.version ?? 1;

/** A deal's documents of one kind, newest first: highest version for the
 *  versioned kinds, upload date otherwise. */
export function docsOf(files: FileRecord[], dealId: string, kind: FileKind): FileRecord[] {
  return files
    .filter((f) => f.deal === dealId && f.kind === kind)
    .sort(
      (a, b) =>
        (kind === "invoice" ? 0 : versionOf(b) - versionOf(a)) ||
        (b.date ?? "").localeCompare(a.date ?? "")
    );
}

/** The highest version number ever issued for this kind on the deal. Numbers
 *  are never reused, so after deleting the top version it is still the one
 *  the next upload follows. 0 when there has never been one. */
export function highestVersion(files: FileRecord[], dealId: string, kind: FileKind): number {
  return docsOf(files, dealId, kind).reduce((m, f) => Math.max(m, f.maxVersion ?? versionOf(f)), 0);
}

/* ---------- requirements ---------- */

export type RequirementState = "met" | "missing" | "pending" | "waived";

export interface RequirementRow {
  kind: FileKind;
  state: RequirementState;
  /** The pending or approved waiver behind a `pending` / `waived` state. */
  waiver?: Waiver;
}

/** One row per requirement the deal's current stage has. `legacyProposalSent`
 *  is the old flow's "a proposal record was marked sent", which still counts. */
export function requirementRows(args: {
  deal: Pick<Deal, "id" | "stage" | "contractSigned">;
  files: FileRecord[];
  waivers: Waiver[];
  legacyProposalSent?: boolean;
}): RequirementRow[] {
  const { deal, files, waivers } = args;
  return REQUIREMENTS.filter((kind) => requiredAt(kind, deal.stage)).map((kind) => {
    const onFile =
      docsOf(files, deal.id, kind).length > 0 ||
      (kind === "contract" && !!deal.contractSigned) ||
      (kind === "proposal" && !!args.legacyProposalSent);
    if (onFile) return { kind, state: "met" as const };
    if (!isWaivable(kind)) return { kind, state: "missing" as const };
    const mine = waivers.filter((w) => w.deal === deal.id && w.requirement === kind);
    const approved = mine.find((w) => w.status === "approved");
    if (approved) return { kind, state: "waived" as const, waiver: approved };
    const pending = mine.find((w) => w.status === "pending");
    if (pending) return { kind, state: "pending" as const, waiver: pending };
    return { kind, state: "missing" as const };
  });
}

/** "All met", "0 of 2 met", "1 met · 1 waived". */
export function requirementSummary(rows: RequirementRow[]): { text: string; tone: "ok" | "warn" } {
  const met = rows.filter((r) => r.state === "met").length;
  const waived = rows.filter((r) => r.state === "waived").length;
  if (met + waived === rows.length) {
    return { text: waived ? `${met} met · ${waived} waived` : "All met", tone: "ok" };
  }
  if (waived) return { text: `${met} met · ${waived} waived`, tone: "warn" };
  return { text: `${met} of ${rows.length} met`, tone: "warn" };
}

/** Anything still open: missing, or waiting on an admin. Drives the banner and
 *  the tab's amber dot. */
export const openRequirements = (rows: RequirementRow[]) =>
  rows.filter((r) => r.state === "missing" || r.state === "pending");

/** A declined waiver's note, shown once on its group until dismissed — and only
 *  while nothing has superseded it. */
export function declinedNote(waivers: Waiver[], dealId: string, kind: FileKind): Waiver | undefined {
  const mine = waivers
    .filter((w) => w.deal === dealId && w.requirement === kind)
    .sort((a, b) => (b.requestedAt ?? "").localeCompare(a.requestedAt ?? ""));
  const latest = mine[0];
  return latest && latest.status === "declined" && !latest.dismissed ? latest : undefined;
}

/* ---------- the type picker ---------- */

/** A document type to preselect from the filename, or null when the name says
 *  nothing, or says two things ("Signed proposal"). */
export function suggestKind(filename: string): FileKind | null {
  const n = filename.toLowerCase();
  const hits = new Set<FileKind>();
  if (/proposal/.test(n)) hits.add("proposal");
  if (/contract|agreement|signed/.test(n)) hits.add("contract");
  if (/invoice/.test(n)) hits.add("invoice");
  return hits.size === 1 ? [...hits][0] : null;
}

/** What choosing this type will do, from the deal's real version count. */
export function consequence(kind: FileKind, existing: number, highestVersion: number): string {
  const name = KIND_NAME[kind].toLowerCase();
  if (kind === "invoice") return "Added to the invoice list. Doesn't replace earlier invoices.";
  if (!existing) return `First ${name} on this deal.`;
  const next = highestVersion + 1;
  return `Becomes v${next}, the current ${name}. v${highestVersion} and earlier stay on record.`;
}

export const nextVersionName = (kind: FileKind, highestVersion: number) =>
  `${KIND_NAME[kind]} v${highestVersion + 1}`;

/* ---------- deleting ---------- */

/** The warning to show instead of deleting, or null when the delete may go
 *  ahead. Blocks only the last live version of a document the current stage
 *  requires, with no approved waiver covering it. */
export function protectedDeleteReason(args: {
  file: Pick<FileRecord, "id" | "kind">;
  deal: Pick<Deal, "id" | "stage" | "contractSigned">;
  files: FileRecord[];
  waivers: Waiver[];
  stageLabel: (stage: string) => string;
}): string | null {
  const { file, deal } = args;
  if (!file.kind || !isWaivable(file.kind)) return null;
  if (!requiredAt(file.kind, deal.stage)) return null;
  if (docsOf(args.files, deal.id, file.kind).some((f) => f.id !== file.id)) return null;
  if (args.waivers.some((w) => w.deal === deal.id && w.requirement === file.kind && w.status === "approved"))
    return null;
  if (file.kind === "contract" && deal.contractSigned) return null;
  const name = KIND_NAME[file.kind].toLowerCase();
  return (
    `This is the only ${name}, and a ${args.stageLabel(deal.stage)} deal needs one. ` +
    "Upload a new version first, or move the deal back a stage."
  );
}
