import type {
  ContractStatus,
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
  Sent: "warning",
  Signed: "success",
};

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

export function fmtDollars(n: number | undefined | null): string {
  if (n == null) return "$0";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function fmtK(n: number | undefined | null): string {
  if (n == null) return "$0";
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return fmtDollars(n);
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
