export type Role = "Admin" | "Lab Leader" | "Contributor";

// Mirrors backend/src/app.mjs's STAGES exactly. "Closed" deals carry a
// separate `outcome` field ("Won" | "Lost") rather than being split into
// two stages.
export type Stage = "Lead" | "Discovery" | "Proposal Sent" | "Negotiating" | "Closed";
export type Outcome = "Won" | "Lost";
export type Source = "Referral" | "Inbound" | "Outbound";

// Mirrors backend/src/proposals.mjs's PROPOSAL_STATUSES exactly — Lab Leaders
// are restricted server-side to a subset (Draft/In Review/Sent) but the type
// covers every status a proposal can carry once an Admin (or the customer
// decision flow) moves it further.
export type ProposalStatus =
  | "Draft"
  | "In Review"
  | "Internally Approved"
  | "Sent"
  | "Customer Approved"
  | "Customer Rejected"
  | "Revision Requested";

// Mirrors backend/src/app.mjs's INVOICE_STATUSES exactly.
export type InvoiceStatus = "Admin review" | "Sent to client" | "Paid" | "Overdue";

// Mirrors backend/src/contracts.mjs's CONTRACT_STATUSES exactly. "Sent" is
// legacy: contracts written before the signature flow existed still carry it,
// but nothing sets it any more — "Out for Signature" replaced it.
export type ContractStatus =
  | "Draft"
  | "Internal Review"
  | "Out for Signature"
  | "Signed"
  | "Sent";

export type FileStatus =
  | "Uploading"
  | "Analyzing"
  | "Analyzed"
  | "Stored"
  | "Analysis failed";

// Nested `bench` matches backend/src/profile.mjs exactly — bench-directory
// fields (blurb, specialties, contact-visibility toggles) live under
// `person.bench`, not flat on the person record. `bootstrap`'s `people` map
// strips `email`/`onboarded` and filters `bench.email`/`bench.phone` for any
// viewer who isn't an Admin or the person themselves (server-side privacy
// filtering — see profile.mjs's publicView).
export interface PersonBench {
  specialties?: string[];
  blurb?: string;
  linkedin?: string;
  email?: string;
  phone?: string;
  showEmail?: boolean;
  showPhone?: boolean;
}

export interface Person {
  firstName: string;
  lastName: string;
  role: Role;
  labs: string[];
  email?: string;
  onboarded?: boolean;
  photo?: string;
  bench?: PersonBench;
}

// bootstrap's `labs` is a map keyed by lab id (pk/sk stripped), not an
// array — lib/portal-data.tsx converts it to this array shape for
// convenience everywhere else in the app.
export interface LabInfo {
  name: string;
  color?: string;
}

/* ---------- structured pricing (Base Contract PRD FR3) ----------
   Mirrors backend/src/pricing.mjs. `null` means "not priced yet", which is a
   real state a draft proposal sits in, not a missing value. */
export type PricingKind = "flat" | "tiered" | "itemized";

export interface FlatPricing {
  kind: "flat";
  amount: number;
  label?: string;
  notes?: string;
}

export interface PricingTier {
  id: string;
  name: string;
  amount: number;
  summary?: string;
  recommended?: boolean;
}

export interface TieredPricing {
  kind: "tiered";
  tiers: PricingTier[];
  /** Tier id the customer picked; until then the proposal has no single total. */
  selected?: string;
}

export interface PricingItem {
  description: string;
  qty: number;
  rate: number;
}

export interface ItemizedPricing {
  kind: "itemized";
  items: PricingItem[];
  discount?: number;
  notes?: string;
}

export type Pricing = FlatPricing | TieredPricing | ItemizedPricing;

/* ---------- e-signature (Base Contract PRD 5.5) ----------
   Mirrors the records signing.mjs writes. `ip`/`userAgent` are kept on the
   server for the audit certificate and are never returned to a browser. */
export interface SignatureRecord {
  name: string;
  title?: string | null;
  at: string;
  signatureType: "typed" | "drawn";
  signatureImage?: string | null;
  /** Set only for the OL side, which signs from an authenticated session. */
  verifiedAccount?: string | null;
}

export interface ContractSignatures {
  client?: SignatureRecord | null;
  ol?: SignatureRecord | null;
}

export interface ContractClause {
  heading: string;
  text: string;
}

export interface Deviation {
  field: string;
  summary: string;
}

export interface DeviationLogEntry extends Deviation {
  note?: string;
  by?: string;
  at?: string;
}

/* Admin-maintained reusable content and contract terms (FR1, FR12). */
export type TemplateKind = "proposal" | "block" | "contract";

export interface ContentTemplate {
  id: string;
  kind: TemplateKind;
  name: string;
  lab?: string;
  active?: boolean;
  /** kind: "proposal" */
  sections?: Record<string, string>;
  pricing?: Pricing | null;
  /** kind: "block" */
  section?: string;
  text?: string;
  /** kind: "contract" */
  clauses?: ContractClause[];
  updated?: string;
  updatedBy?: string;
}

export interface Lab {
  id: string;
  name: string;
  // Per-lab accent, used to brand customer-facing proposal and signing pages.
  color?: string;
}

// Mirrors backend/src/app.mjs's sanitizeAssignmentNotice/isValidAssignmentNotice
// exactly. `labLeaders` fee shares must sum to 100; each named Lab Leader (plus
// the Admin-only "ol" / Optimistic Labs line) signs in-portal by typing their
// name while authenticated — that's what lands in `signatures`.
export interface AssignmentNoticeSignature {
  by: string;
  verifiedName?: string;
  name: string;
  at: string;
}

export interface AssignmentNoticeLabLeader {
  key: string;
  feeSharePct: number;
}

export interface AssignmentNotice {
  labLeaders: AssignmentNoticeLabLeader[];
  subcontractorCosts: number;
  hardCosts: number;
  signatures: Record<string, AssignmentNoticeSignature>;
}

// Field names match backend/src/app.mjs's raw DEAL record shape.
export interface Deal {
  id: string;
  client: string;
  lab: string;
  owner: string;
  dealOwner: string;
  stage: Stage;
  amount: number;
  close: string;
  source: Source;
  recurring: boolean;
  outcome?: Outcome;
  assignmentNotice?: AssignmentNotice;
  recurPaused?: boolean;
  autoInvoice?: boolean;
  recurEnd?: string;
  /* Set when a contract is fully executed (FR18). The pipeline still refuses
     to close a deal without an Assignment Notice, so a signed contract without
     one lands here as `readyToClose` rather than silently closing. */
  contract?: string;
  contractSigned?: boolean;
  contractSignedAt?: string;
  readyToClose?: boolean;
}

// Field names match backend/src/proposals.mjs's raw record shape (`lab`,
// `deal`, `contributorName`/`contributorEmail`, etc.) rather than the
// `...Id`/`...Username` naming used elsewhere in this file — the proposals
// endpoints pass the DynamoDB item through almost unchanged, and a
// Contributor is identified by name+email text, not a Person username.
export interface ProposalVersionSnapshot {
  v: number;
  author?: string;
  date?: string;
  status?: ProposalStatus;
  sections: Record<string, string>;
  /** Absent on snapshots taken before pricing became structured. */
  pricing?: Pricing | null;
}

export type DecisionAction = "approve" | "reject" | "revision";

/** One customer response, scoped to the version they were looking at. */
export interface ProposalDecision {
  action: DecisionAction;
  comment?: string;
  name?: string;
  at: string;
  version: number;
}

export interface ProposalView {
  at: string;
  ip?: string;
  ua?: string;
  version?: number;
}

export interface Proposal {
  id: string;
  deal?: string;
  title: string;
  client?: string;
  lab: string;
  owner?: string;
  author?: string;
  status: ProposalStatus;
  contributorName?: string;
  contributorEmail?: string;
  sections: Record<string, string>;
  version: number;
  dirty?: boolean;
  final?: boolean;
  finalVersion?: number;
  versions?: ProposalVersionSnapshot[];
  sentAt?: string;
  sentVersion?: number;
  sentSections?: Record<string, string>;
  sentPricing?: Pricing | null;
  sendCount?: number;
  clientEmail?: string;
  shareToken?: string;
  updated?: string;
  /** Structured pricing on the live draft (FR3). */
  pricing?: Pricing | null;
  fromTemplate?: string;
  /** Latest customer response; `decisions` is the full per-version log. */
  decision?: ProposalDecision | null;
  decisions?: ProposalDecision[];
  /** Set when a customer approves — this is what unlocks Generate Contract. */
  approvedVersion?: number;
  approvedAt?: string;
  /** Open tracking (FR7). */
  views?: ProposalView[];
  viewCount?: number;
  firstViewedAt?: string;
  lastViewedAt?: string;
}

// Field names match backend/src/app.mjs's raw INVOICE record shape.
export interface InvoiceRequest {
  id: string;
  deal: string;
  client: string;
  lab: string;
  amount: number;
  requestedBy: string;
  date: string;
  recurring: boolean;
  status: InvoiceStatus;
}

export interface FileRecord {
  id: string;
  name: string;
  lab?: string;
  deal?: string;
  proposal?: string;
  contract?: string;
  contributorEmail?: string;
  status: FileStatus;
  size?: number;
  type?: string;
  uploader?: string;
  date?: string;
  analysis?: {
    docType?: string;
    summary?: string;
    keyPoints?: string[];
  };
}

// Field names match backend/src/contracts.mjs's raw record shape.
export interface Contract {
  id: string;
  proposal?: string;
  deal?: string;
  client: string;
  lab: string;
  owner?: string;
  amount?: number;
  status: ContractStatus;
  created?: string;
  updated?: string;
  sections?: Record<string, string>;
  contributorName?: string;
  contributorEmail?: string;
  signedAt?: string;
  pdfFileId?: string;
  pdfGeneratedAt?: string;

  /* ---- Base Contract PRD 5.4 ---- */
  /** Frozen copy of what the customer approved. Never edited. */
  inherited?: {
    version: number;
    approvedAt?: string;
    sections: Record<string, string>;
    pricing: Pricing | null;
  };
  pricing?: Pricing | null;
  /** Standard terms, merged from the lab's contract template at generation. */
  clauses?: ContractClause[];
  templateId?: string;
  templateName?: string;
  /** Template placeholders still unfilled — sending is blocked until empty. */
  unresolvedVars?: string[];
  /** Computed server-side on every read: how the contract departs from the
   *  approved proposal (FR11). `deviationLog` is the append-only audit trail. */
  deviations?: Deviation[];
  hasDeviations?: boolean;
  deviationLog?: DeviationLogEntry[];

  /* ---- contract-only fields ---- */
  paymentSchedule?: string;
  startDate?: string;
  endDate?: string;
  clientSignerName?: string;
  clientSignerTitle?: string;
  clientSignerEmail?: string;
  /** Username of the Admin who countersigns (FR13). */
  olSignatory?: string;
  olSignatoryName?: string;

  /* ---- signature (FR14-FR16) ---- */
  signToken?: string;
  documentHash?: string;
  signatures?: ContractSignatures;
  sentForSignatureAt?: string;
  sentForSignatureBy?: string;
  executedAt?: string;
  executedFileId?: string;
  /** True when an Admin recorded a wet-ink signature instead of e-signing. */
  signedManually?: boolean;
}

export interface Recurrence {
  id: string;
  labId: string;
  cadence: string;
  nextRunAt?: string;
}

// Present on /bootstrap only while an Admin is impersonating someone via
// "act as" — `by`/`byName` identify the real admin driving the session, not
// the impersonated user (`me` in the bootstrap response is the target).
export interface ActingAs {
  by: string;
  byName?: string;
}

export interface Bootstrap {
  labs: Record<string, LabInfo>;
  people: Record<string, Person>;
  role: Role;
  me: string;
  actingAs?: ActingAs | null;
}

// Mirrors backend/src/proposals.mjs's SECTION_KEYS/labels.
export const SECTION_LABELS: Record<string, string> = {
  summary: "Client & problem summary",
  scope: "Scope",
  deliverables: "Deliverables",
  timeline: "Timeline",
  pricing: "Pricing",
  terms: "Terms",
};

export const SECTION_KEYS = Object.keys(SECTION_LABELS);

export const STAGES: Stage[] = [
  "Lead",
  "Discovery",
  "Proposal Sent",
  "Negotiating",
  "Closed",
];

export const SOURCES: Source[] = ["Referral", "Inbound", "Outbound"];
