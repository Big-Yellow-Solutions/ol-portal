import type {
  ContractStatus,
  DocKind,
  EnvelopeStatus,
  FileStatus,
  InvoiceStatus,
  Lab,
  Person,
  ProposalStatus,
  Stage,
} from "@/lib/types";
import type { PersonWithUsername } from "@/lib/portal-data";

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

/* Records written before offboarding existed carry no `active` field at all,
   so this asks whether the person was explicitly deactivated rather than
   whether they were explicitly activated. */
export const isActive = (person: { active?: boolean } | undefined | null): boolean =>
  person?.active !== false;

/* Who is on the roster — the Directory and Community's Members tab.

   A member is anyone still active who has finished the welcome screen. That
   screen is the only writer of `onboarded` (welcome/page.tsx → PATCH
   /profile), so the flag is the portal's own record of onboarding rather than
   something inferred from role, from having a sign-in, or from how full the
   profile is. Every role qualifies: an Admin is a colleague to find and
   message like anyone else. Offboarded people stay in `people` so an old
   owner reference still resolves to a name, but are never on the roster. */
export const isMember = (person: Person | undefined | null): boolean =>
  isActive(person) && person?.onboarded === true;

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

/* "Lab Leader · Faith Lab". The directory card, the picker row and the DM
   header all read this same line; an Admin outside every lab reads as
   "Admin". */
export function roleLine(person: Person, labs: Lab[]): string {
  const names = (person.labs ?? []).map(
    (id) => labs.find((l) => l.id === id)?.name ?? id
  );
  return [person.role, ...names].filter(Boolean).join(" · ");
}

/* A roster card's worth of a person — exactly what PersonCard draws, and
   nothing the viewer was not already sent. */
export interface BenchPerson {
  id: string;
  name: string;
  initials: string;
  role: string;
  /* Lab names, not ids — the lab filter on Community's Members tab and the
     "Message the group" roster both work in the names the design shows. */
  labs: string[];
  engage?: string;
  tags: string[];
  /* Email, or the phone number if that is all this person publishes. The
     server strips whichever they chose to hide, so anything here is public. */
  contact?: string;
  photo?: string;
}

/* The roster itself, card-shaped. The Directory and Community's Members tab
   are the same roster read twice, so the mapping lives here rather than in
   either screen, next to the rule that says who is on it.

   One card per person: `bench` comes off a map keyed by username, and a
   person in several labs is one record carrying several lab ids, never a
   row per lab — so nothing here has to dedupe. Order is kept as given, which
   is the table's own (by username). */
export function benchRoster(
  bench: PersonWithUsername[],
  labs: Lab[]
): BenchPerson[] {
  return bench.filter(isMember).map((p) => ({
    id: p.username,
    name: fullName(p),
    initials: initials(p),
    role: roleLine(p, labs),
    labs: (p.labs ?? []).map(
      (id) => labs.find((l) => l.id === id)?.name ?? id
    ),
    engage: p.bench?.blurb,
    tags: p.bench?.specialties ?? [],
    contact: p.bench?.email || p.bench?.phone,
    photo: p.photo,
  }));
}
