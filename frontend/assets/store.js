/* OL Portal · API-backed data layer (replaces the localStorage prototype).
   The Lambda enforces the PRD 3.3 permissions matrix server-side; the `can`
   object here only drives UI affordances — lists arrive pre-scoped to the role. */

async function api(path, opts = {}) {
  const res = await fetch(CONFIG.apiUrl + path, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", authorization: "Bearer " + await getToken() },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 401) { logout(); throw new Error("Signed out"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function loadPortalData() {
  const [boot, deals, proposals, invoices, files] = await Promise.all([
    api("/bootstrap"), api("/deals"), api("/proposals"), api("/invoices"), api("/files")
  ]);
  FILES.length = 0; FILES.push(...files);
  LABS = boot.labs;
  PEOPLE = boot.people;
  ROLE = boot.role;
  ME = boot.me;
  MY_LABS = PEOPLE[ME]?.labs || [];
  BENCH = Object.entries(PEOPLE).filter(([, p]) => p.bench)
    .map(([key, p]) => ({ key, ...p.bench }));
  DEALS.length = 0; DEALS.push(...deals);
  PROPOSALS.length = 0; PROPOSALS.push(...proposals);
  INVOICES.length = 0; INVOICES.push(...invoices);
}

/* every page calls this: auth guard → load data → build chrome → render */
async function initPage(title, render) {
  requireAuth();
  try {
    await loadPortalData();
  } catch (e) {
    document.body.innerHTML = `<div class="empty" style="padding:60px;text-align:center">
      Couldn't load portal data (${e.message}). <a href="login.html">Sign in again</a></div>`;
    return;
  }
  buildShell(title);
  render && render();
}

/* lists arrive already scoped by the server */
function visibleDeals() { return DEALS; }
function visibleProposals() { return PROPOSALS; }
function visibleInvoices() { return INVOICES; }

const can = {
  addDeal: () => ROLE === "Admin" || (ROLE === "Lab Leader" && MY_LABS.length > 0),
  editDeal: d => ROLE === "Admin" || (ROLE === "Lab Leader" && MY_LABS.includes(d.lab)),
  deleteDeal: () => ROLE === "Admin",
  changeLab: () => ROLE === "Admin",
  reviewInvoices: () => ROLE === "Admin",
  editProposal: p => ROLE === "Admin" || (ROLE === "Lab Leader" && MY_LABS.includes(p.lab)),
  approveProposal: () => ROLE === "Admin"
};

function assignableLabs() {
  return ROLE === "Admin" ? Object.keys(LABS) : MY_LABS;
}

/* ---------- mutations: local update after the server confirms ---------- */
async function addDeal(fields) {
  const d = await api("/deals", { method: "POST", body: fields });
  DEALS.unshift(d);
  return d;
}
async function updateDeal(id, patch) {
  const d = await api(`/deals/${id}`, { method: "PATCH", body: patch });
  const i = DEALS.findIndex(x => x.id === id);
  if (i > -1) DEALS[i] = d;
}
async function deleteDeal(id) {
  await api(`/deals/${id}`, { method: "DELETE" });
  const i = DEALS.findIndex(x => x.id === id);
  if (i > -1) DEALS.splice(i, 1);
}

async function requestInvoice(dealId, recurringInstance) {
  const inv = await api("/invoices", { method: "POST", body: { dealId, recurring: !!recurringInstance } });
  INVOICES.unshift(inv);
}
async function setInvoiceStatus(id, status) {
  await api(`/invoices/${id}`, { method: "PATCH", body: { status } });
  const inv = INVOICES.find(x => x.id === id);
  if (inv) inv.status = status;
}

const PROPOSAL_STATUSES = ["Draft", "In Review", "Internally Approved", "Sent",
  "Customer Approved", "Customer Rejected", "Revision Requested"];
const LL_PROPOSAL_STATUSES = ["Draft", "In Review", "Sent"];

async function setProposalStatus(id, status) {
  const p = await api(`/proposals/${id}`, { method: "PATCH", body: { status } });
  const i = PROPOSALS.findIndex(x => x.id === id);
  if (i > -1) PROPOSALS[i] = p;
}
/* ---------- files ---------- */
async function uploadFile(file, lab) {
  const { id, uploadUrl } = await api("/files", {
    method: "POST",
    body: { name: file.name, size: file.size, type: file.type || "application/octet-stream", ...(lab ? { lab } : {}) }
  });
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file
  });
  if (!putRes.ok) throw new Error("Upload to storage failed (" + putRes.status + ")");
  return id;
}
async function refreshFiles() {
  const files = await api("/files");
  FILES.length = 0; FILES.push(...files);
}
async function downloadFileUrl(id) {
  return (await api(`/files/${id}/download`)).url;
}
async function deleteFileApi(id) {
  await api(`/files/${id}`, { method: "DELETE" });
  const i = FILES.findIndex(x => x.id === id);
  if (i > -1) FILES.splice(i, 1);
}

async function toggleProposalFinal(id) {
  const cur = PROPOSALS.find(x => x.id === id);
  if (!cur) return;
  const p = await api(`/proposals/${id}`, { method: "PATCH", body: { final: !cur.final } });
  const i = PROPOSALS.findIndex(x => x.id === id);
  if (i > -1) PROPOSALS[i] = p;
}
