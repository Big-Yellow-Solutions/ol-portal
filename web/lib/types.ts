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

// Mirrors backend/src/contracts.mjs's CONTRACT_STATUSES exactly.
export type ContractStatus = "Draft" | "Internal Review" | "Sent" | "Signed";

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
}

export interface Lab {
  id: string;
  name: string;
}

export interface AssignmentNotice {
  clientContactName: string;
  scopeSummary: string;
  [key: string]: unknown;
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
  clientEmail?: string;
  shareToken?: string;
  updated?: string;
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
