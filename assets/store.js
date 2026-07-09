/* OL Portal · client-side state + permissions
   Persists edits to localStorage on top of the sample data in data.js.
   Role scoping mirrors the PRD permissions matrix (3.3) — enforced server-side later;
   here it drives what each role sees and can do in the prototype. */

const STORE_KEY = "olportal.state.v1";
const ROLE_KEY = "olportal.role.v1";
const ROLE_USER = { "Admin": "liz", "Lab Leader": "aliza", "Subcontractor": "dana" };

const ROLE = localStorage.getItem(ROLE_KEY) || "Admin";
const ME = ROLE_USER[ROLE];
const MY_LABS = PEOPLE[ME].labs || [];

function setRole(role) {
  localStorage.setItem(ROLE_KEY, role);
  location.reload();
}

/* ---------- persistence: mutate the data.js arrays in place ---------- */
function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify({ deals: DEALS, proposals: PROPOSALS, invoices: INVOICES }));
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!s) return;
    DEALS.length = 0; DEALS.push(...s.deals);
    PROPOSALS.length = 0; PROPOSALS.push(...s.proposals);
    INVOICES.length = 0; INVOICES.push(...s.invoices);
  } catch (e) { /* corrupted state: fall back to sample data */ }
}
function resetState() {
  localStorage.removeItem(STORE_KEY);
  location.reload();
}
loadState();

/* ---------- role scoping (PRD 3.3 / 4.2) ---------- */
const inMyLabs = lab => MY_LABS.includes(lab);
function visibleDeals() {
  if (ROLE === "Admin") return DEALS;
  if (ROLE === "Lab Leader") return DEALS.filter(d => inMyLabs(d.lab));
  return []; // Subcontractor: no deal visibility (PRD open question: view-only when added as contributor)
}
function visibleProposals() {
  if (ROLE === "Admin") return PROPOSALS;
  if (ROLE === "Lab Leader") return PROPOSALS.filter(p => inMyLabs(p.lab));
  return [];
}
function visibleInvoices() {
  if (ROLE === "Admin") return INVOICES;
  if (ROLE === "Lab Leader") return INVOICES.filter(i => inMyLabs(i.lab));
  return [];
}

const can = {
  addDeal: () => ROLE === "Admin" || (ROLE === "Lab Leader" && MY_LABS.length > 0),
  editDeal: d => ROLE === "Admin" || (ROLE === "Lab Leader" && inMyLabs(d.lab)),
  deleteDeal: () => ROLE === "Admin",
  changeLab: () => ROLE === "Admin", // deal reassignment across labs is admin-only
  reviewInvoices: () => ROLE === "Admin",
  editProposal: p => ROLE === "Admin" || (ROLE === "Lab Leader" && inMyLabs(p.lab)),
  approveProposal: () => ROLE === "Admin"
};

/* which labs this role may create/edit deals in */
function assignableLabs() {
  return ROLE === "Admin" ? Object.keys(LABS) : MY_LABS;
}

/* ---------- mutations ---------- */
function nextId(list, prefix) {
  const max = list.reduce((m, x) => Math.max(m, parseInt(x.id.replace(/\D/g, ""), 10) || 0), 0);
  return prefix + String(max + 1).padStart(3, "0");
}

function addDeal(fields) {
  const d = { id: nextId(DEALS, "D-"), ...fields };
  DEALS.unshift(d);
  saveState();
  return d;
}
function updateDeal(id, patch) {
  const d = DEALS.find(x => x.id === id);
  if (!d) return;
  Object.assign(d, patch);
  if (d.stage !== "Closed") delete d.outcome;
  saveState();
}
function deleteDeal(id) {
  const i = DEALS.findIndex(x => x.id === id);
  if (i > -1) { DEALS.splice(i, 1); saveState(); }
}

function requestInvoice(dealId, recurringInstance) {
  const d = DEALS.find(x => x.id === dealId);
  if (!d) return;
  INVOICES.unshift({
    id: nextId(INVOICES, "INV-R-"), deal: d.id, client: d.client, lab: d.lab,
    amount: recurringInstance ? Math.round(d.amount / 12) : d.amount,
    requestedBy: ROLE === "Lab Leader" ? ME : d.owner,
    date: TODAY, recurring: !!recurringInstance, status: "Admin review"
  });
  saveState();
}
function setInvoiceStatus(id, status) {
  const inv = INVOICES.find(x => x.id === id);
  if (inv) { inv.status = status; saveState(); }
}

const PROPOSAL_STATUSES = ["Draft", "In Review", "Internally Approved", "Sent",
  "Customer Approved", "Customer Rejected", "Revision Requested"];
/* Lab Leaders draft, submit, and send the Final version; internal approval is admin's call */
const LL_PROPOSAL_STATUSES = ["Draft", "In Review", "Sent"];

function setProposalStatus(id, status) {
  const p = PROPOSALS.find(x => x.id === id);
  if (!p) return;
  p.status = status;
  p.version += 1;
  p.updated = TODAY;
  saveState();
}
function toggleProposalFinal(id) {
  const p = PROPOSALS.find(x => x.id === id);
  if (p) { p.final = !p.final; p.updated = TODAY; saveState(); }
}
