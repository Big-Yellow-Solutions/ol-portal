export type Role = "Admin" | "Lab Leader" | "Contributor";

export type Stage =
  | "Lead"
  | "Discovery"
  | "Proposal Sent"
  | "Negotiating"
  | "Closed Won"
  | "Closed Lost";

export type ProposalStatus = "Draft" | "Internal Review" | "Final" | "Sent";

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

export interface Proposal {
  id: string;
  dealId?: string;
  title: string;
  client?: string;
  labId: string;
  status: ProposalStatus;
  contributorUsername?: string;
  sections: Record<string, string>;
  draftSections?: Record<string, string>;
  version: number;
  draftAhead?: boolean;
  createdAt: string;
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
