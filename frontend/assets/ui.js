/* OL Portal · interactive UI: new-deal modal + deal drawer.
   Injected into <body> on demand so pages stay thin. */

function overlay(html, cls) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="${cls}" role="dialog" aria-modal="true">${html}</div>`;
  let downOnBack = false;
  back.addEventListener("mousedown", e => { downOnBack = e.target === back; });
  back.addEventListener("click", e => { if (e.target === back && downOnBack) back.remove(); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { back.remove(); document.removeEventListener("keydown", esc); }
  });
  document.body.appendChild(back);
  return back;
}

const labOptions = sel => assignableLabs()
  .map(k => `<option value="${k}"${k === sel ? " selected" : ""}>${LABS[k].name}</option>`).join("");
const ownerOptions = sel => Object.entries(PEOPLE).filter(([, p]) => p.role === "Lab Leader")
  .map(([k, p]) => `<option value="${k}"${k === sel ? " selected" : ""}>${p.name}</option>`).join("");
const stageOptions = (d) => STAGES.map(s =>
  `<option value="${s}"${(d && d.stage === s) ? " selected" : ""}>${s}</option>`).join("");

function dealFormHTML(d) {
  const v = d || {};
  const lockLab = d ? !can.changeLab() : ROLE === "Lab Leader" && MY_LABS.length === 1;
  return `
    <div class="f-grid">
      <label class="field f-wide">Client / deal name
        <input id="dfClient" required value="${v.client || ""}" placeholder="e.g. Beth Shalom Foundation"></label>
      <label class="field">Lab
        <select id="dfLab" ${lockLab ? "disabled" : ""}>${labOptions(v.lab || MY_LABS[0])}</select>
        ${d && !can.changeLab() ? '<small>Reassigning labs is admin-only</small>' : ""}</label>
      <label class="field">Lab Leader owner
        <select id="dfOwner" ${ROLE === "Lab Leader" ? "disabled" : ""}>${ownerOptions(v.owner || (ROLE === "Lab Leader" ? ME : "aliza"))}</select></label>
      <label class="field">Stage
        <select id="dfStage">${stageOptions(d)}</select></label>
      <label class="field" id="dfOutcomeWrap" style="display:${v.stage === "Closed" ? "flex" : "none"}">Outcome
        <select id="dfOutcome"><option${v.outcome === "Won" ? " selected" : ""}>Won</option><option${v.outcome === "Lost" ? " selected" : ""}>Lost</option></select></label>
      <label class="field">Amount (USD)
        <input id="dfAmount" type="number" min="0" step="100" required value="${v.amount ?? ""}" placeholder="24000"></label>
      <label class="field">Expected close
        <input id="dfClose" type="date" required value="${v.close || ""}"></label>
      <label class="field">Source
        <select id="dfSource">${["Referral", "Inbound", "Outbound"].map(s =>
          `<option${v.source === s ? " selected" : ""}>${s}</option>`).join("")}</select></label>
      <label class="field f-check"><input id="dfRecurring" type="checkbox" ${v.recurring ? "checked" : ""}>
        Recurring (generates a monthly instance, feeds MRR)</label>
      <div id="dfRecurOpts" class="f-wide" style="display:${v.recurring ? "block" : "none"};padding:10px 12px;background:#f6f3ee;border-radius:9px">
        <label class="field f-check" style="margin-bottom:6px"><input id="dfAutoInvoice" type="checkbox" ${v.autoInvoice ? "checked" : ""}>
          Auto-request an invoice each month (goes to admin review, never straight to the client)</label>
        <label class="field f-check" style="margin-bottom:6px"><input id="dfRecurPaused" type="checkbox" ${v.recurPaused ? "checked" : ""}>
          Pause recurrence (past instances stay on record)</label>
        <label class="field">End date (blank = ongoing until cancelled)
          <input id="dfRecurEnd" type="date" value="${v.recurEnd || ""}"></label>
      </div>
    </div>`;
}

function readDealForm() {
  const client = document.getElementById("dfClient").value.trim();
  const amount = parseInt(document.getElementById("dfAmount").value, 10);
  const close = document.getElementById("dfClose").value;
  if (!client || !close || isNaN(amount) || amount < 0) {
    alert("Client, a valid amount, and an expected close date are required.");
    return null;
  }
  const stage = document.getElementById("dfStage").value;
  const f = {
    client, amount, close, stage,
    lab: document.getElementById("dfLab").value,
    owner: document.getElementById("dfOwner").value,
    source: document.getElementById("dfSource").value,
    recurring: document.getElementById("dfRecurring").checked,
    autoInvoice: document.getElementById("dfAutoInvoice").checked,
    recurPaused: document.getElementById("dfRecurPaused").checked,
    recurEnd: document.getElementById("dfRecurEnd").value || ""
  };
  if (stage === "Closed") f.outcome = document.getElementById("dfOutcome").value;
  return f;
}

function wireOutcomeToggle(root) {
  root.querySelector("#dfStage").addEventListener("change", e => {
    root.querySelector("#dfOutcomeWrap").style.display = e.target.value === "Closed" ? "flex" : "none";
  });
  root.querySelector("#dfRecurring").addEventListener("change", e => {
    root.querySelector("#dfRecurOpts").style.display = e.target.checked ? "block" : "none";
  });
}

function openNewDeal(onDone) {
  const back = overlay(`
    <div class="modal-head"><h2>New deal</h2><button class="x" aria-label="Close">×</button></div>
    ${dealFormHTML(null)}
    <div class="modal-foot">
      <button class="pill pill-outline" id="dfCancel">Cancel</button>
      <button class="pill pill-primary" id="dfSave">Add deal</button>
    </div>`, "modal");
  wireOutcomeToggle(back);
  back.querySelector(".x").onclick = back.querySelector("#dfCancel").onclick = () => back.remove();
  back.querySelector("#dfSave").onclick = async e => {
    const f = readDealForm();
    if (!f) return;
    e.target.disabled = true;
    try { await addDeal(f); } catch (ex) { alert(ex.message); e.target.disabled = false; return; }
    back.remove();
    onDone && onDone();
  };
  back.querySelector("#dfClient").focus();
}

function openDealDrawer(id, onDone) {
  const d = DEALS.find(x => x.id === id);
  if (!d) return;
  const editable = can.editDeal(d);
  const won = d.stage === "Closed" && d.outcome === "Won";
  const back = overlay(`
    <div class="modal-head">
      <div><h2>${d.client}</h2>
        <small class="drawer-sub">${d.id} · ${LABS[d.lab].name} · owned by ${PEOPLE[d.owner].name}</small></div>
      <button class="x" aria-label="Close">×</button>
    </div>
    ${editable ? dealFormHTML(d) : `
      <div class="f-grid readonly">
        <div class="field">Stage<b>${stageLabel(d)}</b></div>
        <div class="field">Amount<b>${fmt$(d.amount)}</b></div>
        <div class="field">Expected close<b>${d.close}</b></div>
        <div class="field">Source<b>${d.source}</b></div>
      </div>`}
    <div class="modal-foot">
      ${can.deleteDeal() ? '<button class="pill pill-danger" id="dfDelete">Delete</button>' : ""}
      ${(editable && (won || d.recurring)) ? '<button class="pill pill-outline" id="dfInvoice">Request invoice</button>' : ""}
      <span style="flex:1"></span>
      <button class="pill pill-outline" id="dfCancel">Close</button>
      ${editable ? '<button class="pill pill-primary" id="dfSave">Save changes</button>' : ""}
    </div>`, "modal");
  if (editable) wireOutcomeToggle(back);
  back.querySelector(".x").onclick = back.querySelector("#dfCancel").onclick = () => back.remove();
  const invBtn = back.querySelector("#dfInvoice");
  if (invBtn) invBtn.onclick = async () => {
    invBtn.disabled = true;
    try {
      await requestInvoice(d.id, d.recurring);
      invBtn.textContent = "Requested ✓ (sent to admin review)";
    } catch (ex) { alert(ex.message); invBtn.disabled = false; }
  };
  const delBtn = back.querySelector("#dfDelete");
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm(`Delete ${d.client} (${d.id})? Per the PRD this is admin-only and permanent.`)) return;
    delBtn.disabled = true;
    try { await deleteDeal(d.id); } catch (ex) { alert(ex.message); delBtn.disabled = false; return; }
    back.remove(); onDone && onDone();
  };
  const saveBtn = back.querySelector("#dfSave");
  if (saveBtn) saveBtn.onclick = async () => {
    const f = readDealForm();
    if (!f) return;
    if (!can.changeLab()) f.lab = d.lab;
    saveBtn.disabled = true;
    try { await updateDeal(d.id, f); } catch (ex) { alert(ex.message); saveBtn.disabled = false; return; }
    back.remove();
    onDone && onDone();
  };
}
