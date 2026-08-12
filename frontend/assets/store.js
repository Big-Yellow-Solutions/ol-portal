/* OL Portal · API-backed data layer (replaces the localStorage prototype).
   The Lambda enforces the PRD 3.3 permissions matrix server-side; the `can`
   object here only drives UI affordances — lists arrive pre-scoped to the role. */

/* ---------- act as (god-mode view/edit as another user) ----------
   Session-scoped only (sessionStorage, not localStorage): gone the moment the
   tab/browser closes, never silently follows the admin into a new session. */
const ACT_AS_KEY = "olportal.actingAs";
const actingAsTarget = () => { try { return JSON.parse(sessionStorage.getItem(ACT_AS_KEY) || "null"); } catch { return null; } };
const setActingAs = target => sessionStorage.setItem(ACT_AS_KEY, JSON.stringify(target));
const clearActingAs = () => sessionStorage.removeItem(ACT_AS_KEY);

async function api(path, opts = {}) {
  const actingAs = actingAsTarget();
  const res = await fetch(CONFIG.apiUrl + path, {
    method: opts.method || "GET",
    headers: {
      "content-type": "application/json", authorization: "Bearer " + await getToken(),
      ...(actingAs ? { "x-act-as": actingAs.username } : {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 401) { logout(); throw new Error("Signed out"); }
  const data = await res.json().catch(() => ({}));
  // res.statusText is empty for HTTP/2 responses (what API Gateway serves) in
  // Chrome, so a gateway-level failure (e.g. a Lambda timeout) with no JSON
  // body used to surface as a blank alert() — always fall back to something legible.
  if (!res.ok) throw new Error(data.error || res.statusText || `Request failed (${res.status})`);
  return data;
}

async function loadPortalData() {
  try {
    await loadPortalDataOnce();
  } catch (e) {
    // A stale/invalid "acting as" target (e.g. removed after the session
    // started) would otherwise 403/404 on every request and brick the app —
    // drop back to the real admin's own identity and retry once.
    if (actingAsTarget()) { clearActingAs(); await loadPortalDataOnce(); }
    else throw e;
  }
}

async function loadPortalDataOnce() {
  const [boot, deals, proposals, invoices, files, contracts, recurs] = await Promise.all([
    api("/bootstrap"), api("/deals"), api("/proposals"), api("/invoices"), api("/files"),
    api("/contracts"), api("/recurrences")
  ]);
  FILES.length = 0; FILES.push(...files);
  CONTRACTS.length = 0; CONTRACTS.push(...contracts);
  RECURS.length = 0; RECURS.push(...recurs);
  LABS = boot.labs;
  PEOPLE = boot.people;
  ROLE = boot.role;
  ME = boot.me;
  ACTING_AS_BY = boot.actingAs || null;
  if (!ACTING_AS_BY) clearActingAs(); // stale local state the server no longer recognizes
  MY_LABS = PEOPLE[ME]?.labs || [];
  // PRD 4: the full bench — every Lab Leader and Contributor, profile or not.
  BENCH = Object.entries(PEOPLE)
    .filter(([, p]) => p.role === "Lab Leader" || p.role === "Contributor" || p.bench)
    .map(([key, p]) => ({ key, specialties: [], blurb: "", ...(p.bench || {}) }));
  DEALS.length = 0; DEALS.push(...deals);
  PROPOSALS.length = 0; PROPOSALS.push(...proposals);
  INVOICES.length = 0; INVOICES.push(...invoices);
}

/* ---------- profile setup (invite flow, step two) ---------- */
const WELCOME_SKIPPED = "olportal.welcomeSkipped";

/* True until someone finishes setup or dismisses it in this browser. Cognito
   handles the account and password; the portal still needs a photo, tags and
   a blurb before a person is any use on the bench. */
function needsWelcome() {
  const me = PEOPLE[ME];
  return !!me && !me.onboarded && !localStorage.getItem(WELCOME_SKIPPED);
}

/* A profile with neither a blurb nor specialties tells a browsing Lab Leader
   nothing, so the dashboard nudge stays until one of them exists — separate
   from `onboarded`, which only records that the screen was completed. */
function profileIncomplete() {
  const b = PEOPLE[ME]?.bench || {};
  return !(b.blurb || "").trim() && !(b.specialties || []).length;
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
  if (needsWelcome()) { location.replace("welcome.html"); return; }
  buildShell(title);
  render && render();
}

/* lists arrive already scoped by the server */
function visibleDeals() { return DEALS; }
function visibleProposals() { return PROPOSALS; }
function visibleInvoices() { return INVOICES; }

const can = {
  addDeal: () => ROLE === "Admin" || (ROLE === "Lab Leader" && MY_LABS.length > 0),
  editDeal: d => ROLE === "Admin" || (ROLE === "Lab Leader" && (MY_LABS.includes(d.lab) || d.owner === ME)),
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

/* Final is scoped to this proposal, so nothing else needs refreshing. */
async function toggleProposalFinal(id, value) {
  const cur = PROPOSALS.find(x => x.id === id);
  if (!cur) return;
  const final = value === undefined ? !cur.final : !!value;
  const p = await api(`/proposals/${id}`, { method: "PATCH", body: { final } });
  const i = PROPOSALS.findIndex(x => x.id === id);
  if (i > -1) PROPOSALS[i] = p;
  return p;
}

async function refreshProposals() {
  const list = await api("/proposals");
  PROPOSALS.length = 0; PROPOSALS.push(...list);
}

/* ---------- proposals: structured template, send, AI assistant ---------- */
async function createProposal(dealId, title) {
  const p = await api("/proposals", { method: "POST", body: { dealId, title } });
  PROPOSALS.unshift(p);
  return p;
}
/* draft: true saves the working draft without creating a version. The Optimist
   writes this way on every message; versions are created deliberately. */
async function saveProposalSections(id, sections, draft) {
  const p = await api(`/proposals/${id}`, { method: "PATCH", body: { sections, draft: !!draft } });
  const i = PROPOSALS.findIndex(x => x.id === id);
  if (i > -1) PROPOSALS[i] = p;
  return p;
}
async function commitProposalVersion(id) {
  const p = await api(`/proposals/${id}`, { method: "PATCH", body: { commit: true } });
  const i = PROPOSALS.findIndex(x => x.id === id);
  if (i > -1) PROPOSALS[i] = p;
  return p;
}
/* "v3", "v3 · unsaved changes", or "unsaved draft" before anything is committed. */
function versionLabel(p) {
  if (!p.version) return "unsaved draft";
  return `v${p.version}${p.dirty ? " · unsaved changes" : ""}`;
}
async function sendProposalToClient(id, { clientEmail, sendEmail } = {}) {
  const out = await api(`/proposals/${id}/send`, { method: "POST", body: { clientEmail, sendEmail } });
  await refreshProposals();
  return out; // { url, sentVersion, clientEmail, subject, text, emailSent, emailError }
}
async function assistChat(proposalId, messages, draft, attachment) {
  return api("/assist", { method: "POST", body: { proposalId, messages, draft, ...(attachment ? { attachment } : {}) } });
}

/* ---------- contracts ---------- */
async function updateContractApi(id, patch) {
  const c = await api(`/contracts/${id}`, { method: "PATCH", body: patch });
  const i = CONTRACTS.findIndex(x => x.id === id);
  if (i > -1) CONTRACTS[i] = c;
  return c;
}
async function generateContractPdf(id) {
  const out = await api(`/contracts/${id}/pdf`, { method: "POST" });
  const c = CONTRACTS.find(x => x.id === id);
  if (c) c.pdfFileId = out.fileId;
  return out;
}
async function generateProposalPdf(id) {
  const out = await api(`/proposals/${id}/pdf`, { method: "POST" });
  const p = PROPOSALS.find(x => x.id === id);
  if (p) p.pdfFileId = out.fileId;
  return out;
}
async function inviteContributor(fields) {
  return api("/admin/invites", { method: "POST", body: { ...fields, role: "Contributor" } });
}

/* ---------- knowledge base (admin) ---------- */
const kbApi = {
  list: () => api("/kb"),
  create: (title, content, lab) => api("/kb", { method: "POST", body: { title, content, lab: lab || undefined } }),
  update: (id, patch) => api(`/kb/${id}`, { method: "PATCH", body: patch }),
  remove: id => api(`/kb/${id}`, { method: "DELETE" })
};

async function runRecurrencesNow() {
  return api("/recurrences/run", { method: "POST" });
}

/* ---------- bench profiles ---------- */
async function updateProfileApi(fields, username) {
  const person = await api(username ? `/profile/${username}` : "/profile",
    { method: "PATCH", body: fields });
  const { id, ...rest } = person;
  PEOPLE[id] = rest;
  return person;
}
