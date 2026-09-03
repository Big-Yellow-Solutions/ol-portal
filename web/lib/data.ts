import type {
  ContractStatus,
  DocKind,
  EnvelopeStatus,
  FileStatus,
  InvoiceStatus,
  Person,
  ProposalStatus,
  Stage,
} from "@/lib/types";

export type BadgeVariant =
  | "default"
  | "secondary"
  | "success"
  | "warning"
  | "destructive"
  | "outline";

export const STAGE_VARIANT: Record<Stage, BadgeVariant> = {
  Lead: "outline",
  Discovery: "secondary",
  "Proposal Sent": "warning",
  Negotiating: "warning",
  Closed: "success",
  "Closed Lost": "outline",
};

export const PROPOSAL_VARIANT: Record<ProposalStatus, BadgeVariant> = {
  Draft: "outline",
  "In Review": "secondary",
  "Internally Approved": "warning",
  Sent: "warning",
  "Customer Approved": "success",
  "Customer Rejected": "destructive",
  "Revision Requested": "destructive",
};

export const INVOICE_VARIANT: Record<InvoiceStatus, BadgeVariant> = {
  "Admin review": "outline",
  "Sent to client": "warning",
  Paid: "success",
  Overdue: "destructive",
};

export const CONTRACT_VARIANT: Record<ContractStatus, BadgeVariant> = {
  Draft: "outline",
  "Internal Review": "secondary",
  "Out for Signature": "warning",
  Signed: "success",
  // Legacy: contracts written before the signature flow existed.
  Sent: "warning",
};

/* Contributor MSA PRD 8: contributor paper has to read as visibly different
   from customer paper, because the terms and the relationship are different in
   kind. These are the labels that difference is made of. */
export const DOC_KIND_LABEL: Record<DocKind, string> = {
  client: "Contract",
  msa: "MSA",
  "task-order": "Task Order",
};

/* What the counterparty is called. One stored field on the record, two names
   depending on which side of the business the document is on. */
export const COUNTERPARTY_LABEL: Record<DocKind, string> = {
  client: "Client",
  msa: "Contributor",
  "task-order": "Contributor",
};

export const docKindOf = (c: { docKind?: DocKind }): DocKind => c.docKind ?? "client";
export const isContributorDoc = (c: { docKind?: DocKind }) => docKindOf(c) !== "client";

export const FILE_VARIANT: Record<FileStatus, BadgeVariant> = {
  Uploading: "secondary",
  Analyzing: "secondary",
  Analyzed: "success",
  Stored: "outline",
  "Analysis failed": "destructive",
};

export const QBO_STATUS_VARIANT: Record<string, BadgeVariant> = {
  Paid: "success",
  Open: "warning",
};

export const ENVELOPE_VARIANT: Record<EnvelopeStatus, BadgeVariant> = {
  sent: "warning",
  delivered: "warning",
  completed: "success",
  declined: "destructive",
  voided: "destructive",
};

export const ENVELOPE_STATUS_LABEL: Record<EnvelopeStatus, string> = {
  sent: "Sent",
  delivered: "Viewed",
  completed: "Completed",
  declined: "Declined",
  voided: "Voided",
};

/** DocuSign has no separate "expired" status — it's a voided envelope with an
 *  expiration reason. Surfacing it as its own label is more useful to a
 *  reader than "Voided" for something nobody actually voided. */
export function envelopeStatusLabel(status: EnvelopeStatus, voidReason?: string): string {
  if (status === "voided" && /expir/i.test(voidReason ?? "")) return "Expired";
  return ENVELOPE_STATUS_LABEL[status];
}

export function fmtDollars(n: number | undefined | null): string {
  if (n == null) return "$0";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function fmtK(n: number | undefined | null): string {
  if (n == null) return "$0";
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return fmtDollars(n);
}

/* Headline money, the way the design writes it: "$60k", "$64.5k", "$1.2M".
   Unlike fmtK it rolls over into millions and drops a trailing ".0", because
   a dashboard stat that reads "$1200.0k" is a number nobody says out loud. */
export function fmtCompact(n: number | undefined | null): string {
  if (n == null) return "$0";
  const abs = Math.abs(n);
  const scale = abs >= 1_000_000 ? [1_000_000, "M"] as const
    : abs >= 1_000 ? [1_000, "k"] as const
    : null;
  if (!scale) return fmtDollars(n);
  const [unit, suffix] = scale;
  return `$${Number((n / unit).toFixed(1))}${suffix}`;
}

export function fullName(person: Person | undefined | null): string {
  if (!person) return "";
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

export function initials(person: Person | undefined | null): string {
  if (!person) return "?";
  const first = person.firstName?.[0] ?? "";
  const last = person.lastName?.[0] ?? "";
  return (first + last).toUpperCase() || "?";
}
