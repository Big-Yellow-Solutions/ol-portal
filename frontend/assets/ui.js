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
  .map(([k, p]) => `<option value="${k}"${k === sel ? " selected" : ""}>${fullName(p)}</option>`).join("");
const dealOwnerOptions = sel => Object.entries(PEOPLE).filter(([, p]) => p.role === "Lab Leader" || p.role === "Admin")
  .map(([k, p]) => `<option value="${k}"${k === sel ? " selected" : ""}>${fullName(p)}</option>`).join("");
const stageOptions = (d) => STAGES.map(s =>
  `<option value="${s}"${(d && d.stage === s) ? " selected" : ""}>${s}</option>`).join("");

function dealFormHTML(d) {
  const v = d || {};
  const lockLab = d ? !can.changeLab() : ROLE === "Lab Leader" && MY_LABS.length === 1;
  return `
    <div class="f-grid">
      <label class="field f-wide">Deal Name
        <input id="dfClient" required value="${v.client || ""}" placeholder="e.g. Beth Shalom Foundation"></label>
      <label class="field">Lab
        <select id="dfLab" ${lockLab ? "disabled" : ""}>${labOptions(v.lab || MY_LABS[0])}</select>
        ${d && !can.changeLab() ? '<small>Reassigning labs is admin-only</small>' : ""}</label>
      <label class="field">Lab Leader
        <select id="dfOwner" ${ROLE === "Lab Leader" ? "disabled" : ""}>${ownerOptions(v.owner || (ROLE === "Lab Leader" ? ME : "aliza"))}</select></label>
      <label class="field">Deal Owner
        <select id="dfDealOwner">${dealOwnerOptions(v.dealOwner || v.owner || (ROLE === "Lab Leader" ? ME : "aliza"))}</select></label>
      <label class="field">Stage
        <select id="dfStage">${stageOptions(d)}</select></label>
      <label class="field" id="dfOutcomeWrap" style="display:${v.stage === "Closed" ? "flex" : "none"}">Outcome
        <select id="dfOutcome"><option${v.outcome === "Won" ? " selected" : ""}>Won</option><option${v.outcome === "Lost" ? " selected" : ""}>Lost</option></select></label>
      <label class="field">Amount (USD)
        <input id="dfAmount" type="number" min="0" step="100" required value="${v.amount ?? ""}" placeholder="24000"></label>
      <label class="field"><span id="dfCloseLabel">${v.stage === "Closed" ? "Closed Date" : "Expected Close"}</span>
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
    dealOwner: document.getElementById("dfDealOwner").value,
    source: document.getElementById("dfSource").value,
    recurring: document.getElementById("dfRecurring").checked,
    autoInvoice: document.getElementById("dfAutoInvoice").checked,
    recurPaused: document.getElementById("dfRecurPaused").checked,
    recurEnd: document.getElementById("dfRecurEnd").value || ""
  };
  if (stage === "Closed") {
    f.outcome = document.getElementById("dfOutcome").value;
    if (pendingAssignmentNotice) f.assignmentNotice = pendingAssignmentNotice;
  }
  return f;
}

/* ---------- Assignment Notice (forced when a deal moves to Closed) ----------
   Customer name and contract value are read live off the deal card, not
   copied in, so they can never go stale. Lab Leader signing is the same
   lightweight attestation contracts use (PRD 3.7 defers real e-signature):
   each named person hits Sign themselves and the server stamps who + when. */
let pendingAssignmentNotice = null;

const labLeaderKeys = () => Object.entries(PEOPLE).filter(([, p]) => p.role === "Lab Leader").map(([k]) => k);

function assignmentNoticeFormHTML(ctx, existing) {
  const n = existing || { labLeaders: ctx.owner ? [{ key: ctx.owner, feeSharePct: 100 }] : [], subcontractorCosts: 0, hardCosts: 0 };
  const shareOf = new Map(n.labLeaders.map(l => [l.key, l.feeSharePct]));
  const rows = labLeaderKeys().map(k => {
    const checked = shareOf.has(k);
    return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid var(--paper)">
      <label style="display:flex;align-items:center;gap:8px;flex:1;font-weight:500;font-size:13px;cursor:pointer">
        <input type="checkbox" class="anLLCheck" value="${k}" ${checked ? "checked" : ""} style="width:16px;height:16px;accent-color:var(--violet-deep)">
        ${fullName(PEOPLE[k])}</label>
      <input type="number" class="anLLPct" data-key="${k}" min="0" max="100" step="0.1" placeholder="%"
        style="width:80px" value="${checked ? shareOf.get(k) : ""}" ${checked ? "" : "disabled"}>
      <span style="font-size:13px;color:var(--ink-mute)">%</span>
    </div>`;
  }).join("");
  return `
    <div class="f-grid readonly" style="margin-bottom:14px">
      <div class="field">Customer<b>${ctx.client || "—"}</b></div>
      <div class="field">Total contract value<b>${fmt$(ctx.amount || 0)}</b></div>
    </div>
    <div class="f-wide" style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:600;color:var(--ink-soft);margin-bottom:6px">Lab Leader(s) &amp; fee share</div>
      ${rows || '<small style="color:var(--ink-mute)">No Lab Leaders configured.</small>'}
      <small id="anFeeSum" style="display:block;margin-top:6px"></small>
    </div>
    <div class="f-grid">
      <label class="field">Anticipated subcontractor costs (USD)
        <input id="anSubcontractor" type="number" min="0" step="1" value="${n.subcontractorCosts ?? 0}"></label>
      <label class="field">Anticipated hard costs (USD)
        <input id="anHardCosts" type="number" min="0" step="1" value="${n.hardCosts ?? 0}"></label>
    </div>`;
}

function wireAssignmentNoticeForm(root) {
  const update = () => {
    root.querySelectorAll(".anLLCheck").forEach(c => {
      const pct = root.querySelector(`.anLLPct[data-key="${c.value}"]`);
      pct.disabled = !c.checked;
      if (!c.checked) pct.value = "";
    });
    const sum = [...root.querySelectorAll(".anLLPct")].filter(i => !i.disabled)
      .reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
    const ok = Math.abs(sum - 100) < 0.01;
    const el = root.querySelector("#anFeeSum");
    el.textContent = `Total fee share: ${sum}%${ok ? " ✓" : " — must total 100%"}`;
    el.style.color = ok ? "var(--ink-mute)" : "var(--red)";
  };
  root.querySelectorAll(".anLLCheck, .anLLPct").forEach(el => {
    el.addEventListener("change", update);
    el.addEventListener("input", update);
  });
  update();
}

function readAssignmentNoticeForm(root) {
  const labLeaders = [];
  for (const c of root.querySelectorAll(".anLLCheck")) {
    if (!c.checked) continue;
    const pct = parseFloat(root.querySelector(`.anLLPct[data-key="${c.value}"]`).value);
    if (!Number.isFinite(pct) || pct < 0) {
      alert(`Enter a valid fee share % for ${fullName(PEOPLE[c.value])}.`);
      return null;
    }
    labLeaders.push({ key: c.value, feeSharePct: pct });
  }
  if (!labLeaders.length) { alert("Select at least one Lab Leader."); return null; }
  const sum = labLeaders.reduce((s, l) => s + l.feeSharePct, 0);
  if (Math.abs(sum - 100) > 0.01) {
    alert(`Lab Leader fee shares must total 100% (currently ${sum}%).`);
    return null;
  }
  const subcontractorCosts = parseFloat(root.querySelector("#anSubcontractor").value);
  const hardCosts = parseFloat(root.querySelector("#anHardCosts").value);
  if (!Number.isFinite(subcontractorCosts) || subcontractorCosts < 0 ||
      !Number.isFinite(hardCosts) || hardCosts < 0) {
    alert("Anticipated costs must be zero or a positive number.");
    return null;
  }
  return { labLeaders, subcontractorCosts, hardCosts };
}

function openAssignmentNoticeModal(ctx, existing, mandatory, onSubmit, onCancel) {
  const html = `
    <div class="modal-head"><h2>Assignment Notice</h2>${mandatory ? "" : '<button class="x" aria-label="Close">×</button>'}</div>
    <p class="sub">${mandatory
      ? "Closing this deal requires an Assignment Notice to hand off fee splits and costs."
      : "Update the Assignment Notice terms. Terms lock once anyone has signed."}</p>
    ${assignmentNoticeFormHTML(ctx, existing)}
    <div class="modal-foot">
      <button class="pill pill-outline" id="anCancel">Cancel</button>
      <button class="pill pill-primary" id="anSave">${mandatory ? "Save &amp; close deal" : "Save terms"}</button>
    </div>`;
  let back;
  if (mandatory) {
    // Mandatory gate: no backdrop/Escape dismissal, only the explicit buttons below.
    back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(back);
  } else {
    back = overlay(html, "modal");
  }
  wireAssignmentNoticeForm(back);
  const cancel = () => { back.remove(); onCancel && onCancel(); };
  back.querySelector("#anCancel").onclick = cancel;
  const x = back.querySelector(".x");
  if (x) x.onclick = cancel;
  back.querySelector("#anSave").onclick = () => {
    const n = readAssignmentNoticeForm(back);
    if (!n) return;
    back.remove();
    onSubmit(n);
  };
}

function assignmentNoticeSummaryHTML(d, editable) {
  const n = d.assignmentNotice;
  const signed = n.signatures || {};
  const lines = [
    ...n.labLeaders.map(ll => ({ key: ll.key, label: `${fullName(PEOPLE[ll.key])} — ${ll.feeSharePct}% fee share` })),
    { key: "ol", label: "Optimistic Labs" }
  ];
  const rows = lines.map(({ key, label }) => {
    const sig = signed[key];
    const canSign = !sig && (key === "ol" ? ROLE === "Admin" : (ME === key || ROLE === "Admin"));
    const status = sig
      ? `<span class="sig-line">
          <span class="sig-script">${escapeHtml(sig.name)}</span>
          <small style="color:var(--ink-mute)">${escapeHtml(sig.verifiedName || "")} · signed ${sig.at.slice(0, 10)}</small>
        </span>`
      : '<span class="badge b-review"><i></i>Pending</span>';
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--paper)">
      <span style="flex:1;font-size:13px">${label}</span>
      ${status}
      ${canSign ? `<button class="btn-mini" data-sign="${key}">Sign</button>` : ""}
    </div>`;
  }).join("");
  const allSigned = lines.every(({ key }) => signed[key]);
  return `
    <div class="card" style="margin-top:16px;padding:16px 18px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
        <b style="font-family:var(--head)">Assignment Notice</b>
        ${editable && !Object.keys(signed).length ? '<button class="btn-mini" id="anEdit">Edit terms</button>' : ""}
      </div>
      <div class="f-grid readonly" style="margin-bottom:10px">
        <div class="field">Subcontractor costs<b>${fmt$(n.subcontractorCosts || 0)}</b></div>
        <div class="field">Hard costs<b>${fmt$(n.hardCosts || 0)}</b></div>
      </div>
      ${rows}
      ${allSigned ? '<small style="color:var(--ink-mute);display:block;margin-top:8px">All parties have signed.</small>' : ""}
    </div>`;
}

/* In-portal signing: the signer types their name (pre-filled from their own
   profile, editable) and confirms; the account is already verified by the
   session, so this is the identity check plus explicit consent. */
function openSignAssignmentModal(clientName, signerLabel, onSigned) {
  const suggested = fullName(PEOPLE[ME]) || "";
  const html = `
    <div class="modal-head"><h2>Sign Assignment Notice</h2><button class="x" aria-label="Close">×</button></div>
    <p class="sub">Signing for <b>${clientName}</b> as <b>${signerLabel}</b>.</p>
    <label class="field f-wide">Type your name to sign
      <input id="sigName" value="${escapeHtml(suggested)}" placeholder="Full name" autocomplete="off"></label>
    <div class="sig-preview" id="sigPreview">${escapeHtml(suggested)}</div>
    <label class="field f-check" style="margin-top:10px">
      <input type="checkbox" id="sigAgree">
      I agree this constitutes my electronic signature on this Assignment Notice.</label>
    <div class="modal-foot">
      <button class="pill pill-outline" id="sigCancel">Cancel</button>
      <button class="pill pill-primary" id="sigSubmit" disabled>Sign</button>
    </div>`;
  const back = overlay(html, "modal");
  const nameInput = back.querySelector("#sigName");
  const preview = back.querySelector("#sigPreview");
  const agree = back.querySelector("#sigAgree");
  const submitBtn = back.querySelector("#sigSubmit");
  const refresh = () => {
    preview.textContent = nameInput.value.trim() || "Your signature";
    submitBtn.disabled = !(nameInput.value.trim() && agree.checked);
  };
  nameInput.addEventListener("input", refresh);
  agree.addEventListener("change", refresh);
  refresh();
  const close = () => back.remove();
  back.querySelector(".x").onclick = back.querySelector("#sigCancel").onclick = close;
  submitBtn.onclick = async () => {
    submitBtn.disabled = true;
    try { await onSigned(nameInput.value.trim()); close(); }
    catch (ex) { alert(ex.message); submitBtn.disabled = false; }
  };
  nameInput.focus();
}

function wireOutcomeToggle(root, d) {
  pendingAssignmentNotice = (d && d.assignmentNotice) || null;
  const stageSel = root.querySelector("#dfStage");
  let prevStage = stageSel.value;
  const readCtx = () => ({
    client: root.querySelector("#dfClient").value.trim() || (d && d.client) || "",
    amount: parseInt(root.querySelector("#dfAmount").value, 10) || (d && d.amount) || 0,
    owner: root.querySelector("#dfOwner").value || (d && d.owner)
  });
  stageSel.addEventListener("change", e => {
    const newStage = e.target.value;
    root.querySelector("#dfOutcomeWrap").style.display = newStage === "Closed" ? "flex" : "none";
    root.querySelector("#dfCloseLabel").textContent = newStage === "Closed" ? "Closed Date" : "Expected Close";
    if (newStage === "Closed" && !pendingAssignmentNotice) {
      openAssignmentNoticeModal(readCtx(), null, true, n => {
        pendingAssignmentNotice = n;
        prevStage = newStage;
      }, () => {
        stageSel.value = prevStage;
        stageSel.dispatchEvent(new Event("change"));
      });
    } else {
      prevStage = newStage;
    }
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
  wireOutcomeToggle(back, null);
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
        <small class="drawer-sub">${d.id} · ${LABS[d.lab].name} · owned by ${fullName(PEOPLE[d.owner])}</small></div>
      <button class="x" aria-label="Close">×</button>
    </div>
    ${editable ? dealFormHTML(d) : `
      <div class="f-grid readonly">
        <div class="field">Stage<b>${stageLabel(d)}</b></div>
        <div class="field">Amount<b>${fmt$(d.amount)}</b></div>
        <div class="field">${d.stage === "Closed" ? "Closed Date" : "Expected Close"}<b>${d.close}</b></div>
        <div class="field">Source<b>${d.source}</b></div>
      </div>`}
    ${d.stage === "Closed" && d.assignmentNotice ? assignmentNoticeSummaryHTML(d, editable) : ""}
    <div class="modal-foot">
      ${can.deleteDeal() ? '<button class="pill pill-danger" id="dfDelete">Delete</button>' : ""}
      ${(editable && (won || d.recurring)) ? '<button class="pill pill-outline" id="dfInvoice">Request invoice</button>' : ""}
      <span style="flex:1"></span>
      <button class="pill pill-outline" id="dfCancel">Close</button>
      ${editable ? '<button class="pill pill-primary" id="dfSave">Save changes</button>' : ""}
    </div>`, "modal");
  if (editable) wireOutcomeToggle(back, d);
  back.querySelector(".x").onclick = back.querySelector("#dfCancel").onclick = () => back.remove();
  back.querySelectorAll("[data-sign]").forEach(btn => btn.onclick = () => {
    const key = btn.dataset.sign;
    const label = key === "ol" ? "Optimistic Labs" : fullName(PEOPLE[key]);
    openSignAssignmentModal(d.client, label, async typedName => {
      await signAssignmentNotice(d.id, key, typedName);
      back.remove(); openDealDrawer(d.id, onDone); onDone && onDone();
    });
  });
  const anEditBtn = back.querySelector("#anEdit");
  if (anEditBtn) anEditBtn.onclick = () => {
    openAssignmentNoticeModal({ client: d.client, amount: d.amount, owner: d.owner }, d.assignmentNotice, false, async n => {
      try { await updateDeal(d.id, { assignmentNotice: n }); } catch (ex) { alert(ex.message); return; }
      back.remove(); openDealDrawer(d.id, onDone); onDone && onDone();
    }, () => {});
  };
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
