export type Role = "Admin" | "Lab Leader" | "Contributor";

export type Stage =
  | "Lead"
  | "Discovery"
  | "Proposal Sent"
  | "Negotiating"
  | "Closed Won"
  | "Closed Lost";

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

export type InvoiceStatus = "Requested" | "Sent to client" | "Paid";

export type ContractStatus = "Draft" | "Internal Review" | "Sent" | "Signed";

export type FileStatus =
  | "Uploading"
  | "Analyzing"
  | "Analyzed"
  | "Stored"
  | "Analysis failed";

export interface Person {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  labs: string[];
  onboarded?: boolean;
  photo?: string;
  blurb?: string;
  specialties?: string[];
  visible?: boolean;
}

export interface Lab {
  id: string;
  name: string;
}

export interface Deal {
  id: string;
  name: string;
  labId: string;
  ownerUsername: string;
  stage: Stage;
  value?: number;
  client?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
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
  createdAt?: string;
  updatedAt?: string;
}

export interface InvoiceRequest {
  id: string;
  dealId?: string;
  labId: string;
  client?: string;
  amount: number;
  cadence?: string;
  status: InvoiceStatus;
  createdAt: string;
}

export interface FileRecord {
  id: string;
  name: string;
  labId?: string;
  status: FileStatus;
  size?: number;
  summary?: string;
  keyPoints?: string[];
  createdAt: string;
}

export interface Contract {
  id: string;
  proposalId?: string;
  labId: string;
  client?: string;
  contributorUsername?: string;
  contributorName?: string;
  contributorEmail?: string;
  status: ContractStatus;
  createdAt: string;
}

export interface Recurrence {
  id: string;
  labId: string;
  cadence: string;
  nextRunAt?: string;
}

export interface Bootstrap {
  labs: Lab[];
  people: Record<string, Person>;
  role: Role;
  me: string;
  actingAs?: string | null;
}

export const SECTION_LABELS: Record<string, string> = {
  summary: "Summary",
  scope: "Scope",
  deliverables: "Deliverables",
  timeline: "Timeline",
  pricing: "Pricing",
  terms: "Terms",
};

export const STAGES: Stage[] = [
  "Lead",
  "Discovery",
  "Proposal Sent",
  "Negotiating",
  "Closed Won",
  "Closed Lost",
];
