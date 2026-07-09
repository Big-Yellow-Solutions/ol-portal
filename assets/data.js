/* OL Portal · sample data (placeholder — real data arrives with the backend)
   Objects mirror the PRD: Deals (3.1), Proposals (3.4–3.5), Invoice Requests (3.10), Bench (4). */

const LABS = {
  faith:    { name: "Faith Lab",            color: "#7C6DF5", status: "live" },
  impact:   { name: "Impact Lab",           color: "#3D2FD4", status: "forming" },
  policy:   { name: "Policy Lab",           color: "#1FA97C", status: "forming" },
  sports:   { name: "Sports Lab",           color: "#C98A1B", status: "forming" },
  philanthropy: { name: "Philanthropy Lab", color: "#B0A6FA", status: "forming" },
  cs:       { name: "Customer Success Lab", color: "#D94F4F", status: "forming" }
};

const STAGES = ["Lead", "Discovery", "Proposal Sent", "Negotiating", "Closed"];
const STAGE_CLASS = {
  "Lead": "b-lead", "Discovery": "b-discovery", "Proposal Sent": "b-proposal",
  "Negotiating": "b-negotiating", "Closed Won": "b-won", "Closed Lost": "b-lost"
};

const PEOPLE = {
  liz:    { name: "Liz Russell",   role: "Admin",      photo: "assets/liz-russell.jpg" },
  seth:   { name: "Seth Cohen",    role: "Admin",      photo: "assets/seth-cohen.jpg" },
  aliza:  { name: "Aliza Goodman", role: "Lab Leader", photo: "assets/aliza-goodman.jpg", labs: ["faith"] },
  lauren: { name: "Lauren Hall",   role: "Lab Leader", photo: "assets/lauren-hall.jpg",   labs: ["impact"] },
  marcus: { name: "Marcus Webb",   role: "Lab Leader", photo: null, labs: ["policy"] },
  dana:   { name: "Dana Ortiz",    role: "Subcontractor", photo: null },
  jonah:  { name: "Jonah Price",   role: "Subcontractor", photo: null }
};

/* stage: one of STAGES; "Closed" carries outcome "Won"/"Lost". amount in USD. */
const DEALS = [
  { id: "D-014", client: "Beth Shalom Foundation",   lab: "faith",  owner: "aliza",  stage: "Negotiating",   amount: 24000, close: "2026-07-24", source: "Referral", recurring: false },
  { id: "D-013", client: "Hillel International",     lab: "faith",  owner: "aliza",  stage: "Proposal Sent", amount: 38000, close: "2026-08-05", source: "Outbound", recurring: false },
  { id: "D-012", client: "The iCenter",              lab: "faith",  owner: "aliza",  stage: "Discovery",     amount: 18500, close: "2026-08-19", source: "Referral", recurring: false },
  { id: "D-011", client: "Jewish Federations NA",    lab: "faith",  owner: "aliza",  stage: "Lead",          amount: 45000, close: "2026-09-10", source: "Inbound",  recurring: false },
  { id: "D-010", client: "Moishe House",             lab: "faith",  owner: "aliza",  stage: "Closed", outcome: "Won", amount: 12000, close: "2026-06-18", source: "Referral", recurring: true },
  { id: "D-009", client: "Repair the World",         lab: "impact", owner: "lauren", stage: "Proposal Sent", amount: 22000, close: "2026-07-30", source: "Inbound",  recurring: false },
  { id: "D-008", client: "City Year Chicago",        lab: "impact", owner: "lauren", stage: "Discovery",     amount: 16000, close: "2026-08-12", source: "Outbound", recurring: false },
  { id: "D-007", client: "Civic Nation",             lab: "policy", owner: "marcus", stage: "Lead",          amount: 30000, close: "2026-09-01", source: "Referral", recurring: false },
  { id: "D-006", client: "StateWorks Coalition",     lab: "policy", owner: "marcus", stage: "Negotiating",   amount: 27500, close: "2026-07-18", source: "Outbound", recurring: false },
  { id: "D-005", client: "Midwest Athletics Assn",   lab: "sports", owner: "lauren", stage: "Lead",          amount: 15000, close: "2026-09-22", source: "Inbound",  recurring: false },
  { id: "D-004", client: "Grantmakers Alliance",     lab: "philanthropy", owner: "lauren", stage: "Discovery", amount: 20000, close: "2026-08-28", source: "Referral", recurring: false },
  { id: "D-003", client: "Northstar Camps",          lab: "faith",  owner: "aliza",  stage: "Closed", outcome: "Won",  amount: 9500,  close: "2026-05-30", source: "Referral", recurring: true },
  { id: "D-002", client: "Lakeside Church Network",  lab: "faith",  owner: "aliza",  stage: "Closed", outcome: "Lost", amount: 14000, close: "2026-05-12", source: "Outbound", recurring: false },
  { id: "D-001", client: "Bright Futures Fund",      lab: "impact", owner: "lauren", stage: "Closed", outcome: "Won",  amount: 11000, close: "2026-04-22", source: "Inbound",  recurring: false }
];

/* Proposal status per PRD 3.5: Draft → Internally Approved → Sent → Customer Approved / Rejected / Revision Requested */
const PROPOSALS = [
  { id: "P-108", deal: "D-013", title: "Hillel International · Campus Cohort Program", lab: "faith",  author: "aliza",  status: "Sent",                version: 4, final: true,  updated: "2026-07-06" },
  { id: "P-107", deal: "D-014", title: "Beth Shalom · Leadership Intensive",           lab: "faith",  author: "aliza",  status: "Customer Approved",   version: 3, final: true,  updated: "2026-07-02" },
  { id: "P-106", deal: "D-009", title: "Repair the World · Service Design Sprint",     lab: "impact", author: "lauren", status: "In Review",           version: 2, final: false, updated: "2026-07-05" },
  { id: "P-105", deal: "D-006", title: "StateWorks · Policy Roadmap Engagement",       lab: "policy", author: "marcus", status: "Internally Approved", version: 5, final: true,  updated: "2026-07-01" },
  { id: "P-104", deal: "D-012", title: "The iCenter · Educator Fellowship Concept",    lab: "faith",  author: "aliza",  status: "Draft",               version: 1, final: false, updated: "2026-07-07" },
  { id: "P-103", deal: "D-008", title: "City Year · Volunteer Pipeline Audit",         lab: "impact", author: "lauren", status: "Revision Requested",  version: 2, final: false, updated: "2026-06-28" }
];
const PROPOSAL_CLASS = {
  "Draft": "b-draft", "In Review": "b-review", "Internally Approved": "b-approved",
  "Sent": "b-sent", "Customer Approved": "b-won", "Customer Rejected": "b-lost", "Revision Requested": "b-negotiating"
};

/* Invoice requests per PRD 3.10 — routes to Admin (Liz) for review; QuickBooks vs email TBD */
const INVOICES = [
  { id: "INV-R-032", deal: "D-010", client: "Moishe House",       lab: "faith",  amount: 1000,  requestedBy: "aliza",  date: "2026-07-01", recurring: true,  status: "Sent to client" },
  { id: "INV-R-031", deal: "D-003", client: "Northstar Camps",    lab: "faith",  amount: 950,   requestedBy: "aliza",  date: "2026-07-01", recurring: true,  status: "Admin review" },
  { id: "INV-R-030", deal: "D-014", client: "Beth Shalom Foundation", lab: "faith", amount: 12000, requestedBy: "aliza", date: "2026-06-30", recurring: false, status: "Admin review" },
  { id: "INV-R-029", deal: "D-001", client: "Bright Futures Fund", lab: "impact", amount: 5500,  requestedBy: "lauren", date: "2026-06-24", recurring: false, status: "Sent to client" },
  { id: "INV-R-028", deal: "D-010", client: "Moishe House",       lab: "faith",  amount: 1000,  requestedBy: "aliza",  date: "2026-06-01", recurring: true,  status: "Paid" }
];
const INVOICE_CLASS = { "Admin review": "b-review", "Sent to client": "b-sent", "Paid": "b-won", "Overdue": "b-lost" };

/* Bench directory per PRD 4 — visible org-wide */
const BENCH = [
  { key: "aliza",  labKeys: ["faith"], specialties: ["Jewish education", "Fellowship design", "Israel education"],
    blurb: "designing faith-rooted leadership programs and educator fellowships from concept to launch.",
    linkedin: "#", email: "hello@optimisticlabs.com", phone: "—" },
  { key: "lauren", labKeys: ["impact"], specialties: ["Program strategy", "Volunteer ops", "Partnerships"],
    blurb: "standing up service programs and community partnerships that outlast the pilot.",
    linkedin: "#", email: "hello@optimisticlabs.com", phone: "—" },
  { key: "marcus", labKeys: ["policy"], specialties: ["Policy research", "Coalition building", "Gov relations"],
    blurb: "turning policy goals into roadmaps with the coalitions to carry them.",
    linkedin: "#", email: "hello@optimisticlabs.com", phone: "—" },
  { key: "dana",   labKeys: [], specialties: ["Grant writing", "Faith-based orgs"],
    blurb: "grant narratives and funder decks, especially for faith-based organizations.",
    linkedin: "#", email: "hello@optimisticlabs.com", phone: "—" },
  { key: "jonah",  labKeys: [], specialties: ["Campaign infrastructure", "Data & CRM"],
    blurb: "CRM setup, data hygiene, and the campaign plumbing nobody sees until it breaks.",
    linkedin: "#", email: "hello@optimisticlabs.com", phone: "—" }
];

const TODAY = new Date().toISOString().slice(0, 10);
const fmt$ = n => "$" + n.toLocaleString("en-US");
const fmtK = n => n >= 1000 ? "$" + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k" : "$" + n;
const stageLabel = d => d.stage === "Closed" ? "Closed " + d.outcome : d.stage;
const stageClass = d => STAGE_CLASS[stageLabel(d)] || "b-lead";
const initials = name => name.split(" ").map(w => w[0]).join("").slice(0, 2);
const faceHTML = p => p.photo
  ? `<img src="${p.photo}" alt="${p.name}">`
  : `<span class="face">${initials(p.name)}</span>`;
