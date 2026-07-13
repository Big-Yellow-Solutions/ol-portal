/* OL Portal · UI constants + shared helpers.
   Data arrays are empty shells here — store.js fills them from the API at page load. */

let LABS = {}, PEOPLE = {}, BENCH = [];
const DEALS = [], PROPOSALS = [], INVOICES = [], FILES = [];
let ROLE = null, ME = null, MY_LABS = [];

const STAGES = ["Lead", "Discovery", "Proposal Sent", "Negotiating", "Closed"];
const STAGE_CLASS = {
  "Lead": "b-lead", "Discovery": "b-discovery", "Proposal Sent": "b-proposal",
  "Negotiating": "b-negotiating", "Closed Won": "b-won", "Closed Lost": "b-lost"
};
const PROPOSAL_CLASS = {
  "Draft": "b-draft", "In Review": "b-review", "Internally Approved": "b-approved",
  "Sent": "b-sent", "Customer Approved": "b-won", "Customer Rejected": "b-lost", "Revision Requested": "b-negotiating"
};
const INVOICE_CLASS = { "Admin review": "b-review", "Sent to client": "b-sent", "Paid": "b-won", "Overdue": "b-lost" };

const TODAY = new Date().toISOString().slice(0, 10);
const fmt$ = n => "$" + n.toLocaleString("en-US");
const fmtK = n => n >= 1000 ? "$" + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k" : "$" + n;
const stageLabel = d => d.stage === "Closed" ? "Closed " + d.outcome : d.stage;
const stageClass = d => STAGE_CLASS[stageLabel(d)] || "b-lead";
const initials = name => name.split(" ").map(w => w[0]).join("").slice(0, 2);
const faceHTML = p => p.photo
  ? `<img src="${p.photo}" alt="${p.name}">`
  : `<span class="face">${initials(p.name)}</span>`;
