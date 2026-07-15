/* OL Portal · proposals page (PRD 3.4-3.5, 3.8): structured OL template
   editor with version snapshots, status flow, ★ Final, send-to-client link,
   and the AI Proposal Assistant grounded in the admin-owned knowledge base. */

function renderProposals() {
  const drawList = () => {
    const props = visibleProposals();
    document.getElementById("propRows").innerHTML = props.length ? props.map(p => `<tr class="rowlink" data-open="${p.id}" tabindex="0">
        <td><b>${p.title}</b><br><small style="color:var(--ink-mute)">${p.id} · deal ${p.deal} · ${p.client || ""}</small></td>
        <td>${labCell(p.lab)}</td>
        <td>${personCell(p.author)}</td>
        <td><span class="badge ${PROPOSAL_CLASS[p.status] || "b-draft"}"><i></i>${p.status}</span></td>
        <td>v${p.version}${p.final ? ' <span class="badge b-approved">★ Final</span>' : ""}
          ${p.sentAt ? `<small style="display:block;color:var(--ink-mute)">sent v${p.sentVersion}</small>` : ""}</td>
        <td>${p.updated}</td>
      </tr>`).join("") : '<tr><td colspan="6" class="empty">No proposals visible for this role. Open one from a deal or start a new one.</td></tr>';
  };

  if (ROLE === "Admin" || ROLE === "Lab Leader") {
    const btn = document.createElement("button");
    btn.className = "pill pill-primary";
    btn.textContent = "+ New proposal";
    btn.onclick = () => openNewProposal(drawList);
    document.querySelector(".card-head").appendChild(btn);
  }

  document.getElementById("propRows").addEventListener("click", e => {
    const row = e.target.closest("[data-open]");
    if (row) openProposalEditor(row.dataset.open, drawList);
  });
  drawList();
}

function openNewProposal(onDone) {
  const dealOpts = DEALS.map(d =>
    `<option value="${d.id}">${d.client} (${d.id} · ${LABS[d.lab]?.name || d.lab})</option>`).join("");
  if (!dealOpts) { alert("Create a deal first — proposals are attached to deals."); return; }
  const back = overlay(`
    <div class="modal-head"><h2>New proposal</h2><button class="x" aria-label="Close">×</button></div>
    <div class="f-grid">
      <label class="field f-wide">Deal<select id="npDeal">${dealOpts}</select></label>
      <label class="field f-wide">Proposal title<input id="npTitle" placeholder="e.g. Capital campaign infrastructure — Phase 1"></label>
    </div>
    <div class="modal-foot">
      <button class="pill pill-outline" id="npCancel">Cancel</button>
      <button class="pill pill-primary" id="npCreate">Create draft</button>
    </div>`, "modal");
  back.querySelector(".x").onclick = back.querySelector("#npCancel").onclick = () => back.remove();
  back.querySelector("#npCreate").onclick = async e => {
    const title = back.querySelector("#npTitle").value.trim();
    if (!title) { alert("Give the proposal a title."); return; }
    e.target.disabled = true;
    try {
      const p = await createProposal(back.querySelector("#npDeal").value, title);
      back.remove(); onDone && onDone();
      openProposalEditor(p.id, onDone);
    } catch (ex) { alert(ex.message); e.target.disabled = false; }
  };
  back.querySelector("#npTitle").focus();
}

function openProposalEditor(id, onDone) {
  const p = PROPOSALS.find(x => x.id === id);
  if (!p) return;
  const editable = can.editProposal(p);
  const statuses = can.approveProposal()
    ? ["Draft", "In Review", "Internally Approved", "Sent", "Customer Approved", "Customer Rejected", "Revision Requested"]
    : ["Draft", "In Review", "Sent"];

  const sectionsHTML = Object.entries(SECTION_LABELS).map(([k, label]) => `
    <label class="field f-wide">${label}
      <textarea data-sec="${k}" rows="4" ${editable ? "" : "readonly"}
        style="font:inherit;padding:10px 12px;border:1.5px solid #ddd7ce;border-radius:9px;resize:vertical">${p.sections?.[k] || ""}</textarea></label>`).join("");

  const versionsHTML = (p.versions || []).slice().reverse().map(v =>
    `<button class="btn-mini" data-ver="${v.v}" title="Load this snapshot into the editor (save to restore it)">v${v.v} · ${v.date} · ${PEOPLE[v.author]?.name || v.author} · ${v.status}</button>`).join(" ")
    || '<small style="color:var(--ink-mute)">No earlier versions yet — every save creates one.</small>';

  const back = overlay(`
    <div class="modal-head">
      <div><h2>${p.title}</h2>
        <small class="drawer-sub">${p.id} · deal ${p.deal} · ${LABS[p.lab]?.name || p.lab} ·
          <span class="badge ${PROPOSAL_CLASS[p.status] || "b-draft"}"><i></i>${p.status}</span>
          v${p.version}${p.final ? " · ★ Final" : ""}</small></div>
      <button class="x" aria-label="Close">×</button>
    </div>
    ${p.decision ? `<div class="todo" style="margin-bottom:12px"><span class="dot" style="background:${p.decision.action === "approve" ? "var(--green,#3B6D11)" : "var(--red,#C0392B)"}"></span>
      <span><b>Client ${p.decision.action === "approve" ? "approved" : p.decision.action === "reject" ? "rejected" : "requested revisions on"} v${p.decision.version}</b>
      <small>${p.decision.name ? p.decision.name + " · " : ""}${(p.decision.at || "").slice(0, 10)}${p.decision.comment ? " · “" + p.decision.comment + "”" : ""}</small></span></div>` : ""}
    <div class="f-grid">${sectionsHTML}</div>
    ${editable ? `
    <div style="margin:14px 0;padding:12px;border:1.5px dashed var(--violet,#3D2FD4);border-radius:10px">
      <b style="font-size:13px">AI Proposal Assistant</b>
      <small style="display:block;color:var(--ink-mute);margin:2px 0 8px">Drafts from OL's knowledge base and this deal's context. It never sends or finalizes — you review every word.</small>
      <div style="display:flex;gap:8px">
        <input id="peGuide" placeholder="Optional guidance, e.g. three-tier pricing, 8-week timeline" style="flex:1;padding:9px 12px;border:1.5px solid #ddd7ce;border-radius:9px;font:inherit">
        <button class="pill pill-outline" id="peAssist">Draft with AI</button>
      </div>
      <div id="peAssistOut" style="display:none;margin-top:10px">
        <small id="peAssistNote" style="display:block;margin-bottom:6px"></small>
        <button class="btn-mini" id="peApply">Apply draft to editor</button>
      </div>
    </div>` : ""}
    <div style="margin-bottom:12px"><b style="font-size:13px">Version history</b><br>${versionsHTML}</div>
    <div class="modal-foot" style="flex-wrap:wrap;gap:8px">
      ${editable ? `<select id="peStatus" class="row-sel" aria-label="Status">
        ${statuses.includes(p.status) ? "" : `<option selected>${p.status}</option>`}
        ${statuses.map(s => `<option${s === p.status ? " selected" : ""}>${s}</option>`).join("")}</select>
      <button class="pill pill-outline" id="peFinal">${p.final ? "Unmark Final" : "★ Mark Final"}</button>
      <button class="pill pill-outline" id="peSend" ${p.final ? "" : 'disabled title="Mark Final first"'}>Send to client</button>` : ""}
      <span style="flex:1"></span>
      <button class="pill pill-outline" id="peClose">Close</button>
      ${editable ? '<button class="pill pill-primary" id="peSave">Save (new version)</button>' : ""}
    </div>
    <div id="peLink" style="display:none;margin-top:10px;padding:10px;background:#f6f3ee;border-radius:8px;font-size:13px;word-break:break-all"></div>`,
    "modal modal-wide");

  const $$ = sel => back.querySelector(sel);
  const readSections = () => Object.fromEntries(
    [...back.querySelectorAll("[data-sec]")].map(t => [t.dataset.sec, t.value]));
  const reopen = () => { back.remove(); onDone && onDone(); openProposalEditor(id, onDone); };

  $$(".x").onclick = $$("#peClose").onclick = () => { back.remove(); onDone && onDone(); };

  back.querySelectorAll("[data-ver]").forEach(b => b.onclick = () => {
    const snap = (p.versions || []).find(v => String(v.v) === b.dataset.ver);
    if (!snap) return;
    for (const t of back.querySelectorAll("[data-sec]")) t.value = snap.sections?.[t.dataset.sec] || "";
  });

  if (!editable) return;

  $$("#peSave").onclick = async e => {
    e.target.disabled = true;
    try { await saveProposalSections(id, readSections()); reopen(); }
    catch (ex) { alert(ex.message); e.target.disabled = false; }
  };
  $$("#peStatus").onchange = async e => {
    e.target.disabled = true;
    try { await setProposalStatus(id, e.target.value); reopen(); }
    catch (ex) { alert(ex.message); e.target.disabled = false; }
  };
  $$("#peFinal").onclick = async e => {
    e.target.disabled = true;
    try { await toggleProposalFinal(id); reopen(); }
    catch (ex) { alert(ex.message); e.target.disabled = false; }
  };
  $$("#peSend").onclick = async e => {
    if (!confirm("Send this proposal to the client? The current Final version gets locked as what they see, and you'll get a share link to pass along.")) return;
    e.target.disabled = true;
    try {
      const out = await sendProposalToClient(id);
      const link = $$("#peLink");
      link.style.display = "block";
      link.innerHTML = `Client link (v${out.sentVersion} locked): <b>${out.url}</b> <button class="btn-mini" id="peCopy">Copy</button>`;
      $$("#peCopy").onclick = () => navigator.clipboard.writeText(out.url);
    } catch (ex) { alert(ex.message); e.target.disabled = false; }
  };
  $$("#peAssist").onclick = async e => {
    e.target.disabled = true; e.target.textContent = "Drafting…";
    try {
      const draft = await assistDraft(id, $$("#peGuide").value.trim());
      back._draft = draft.sections;
      $$("#peAssistNote").textContent = "Assistant: " + draft.note;
      $$("#peAssistOut").style.display = "block";
    } catch (ex) { alert(ex.message); }
    e.target.disabled = false; e.target.textContent = "Draft with AI";
  };
  const applyBtn = $$("#peApply");
  if (applyBtn) applyBtn.onclick = () => {
    for (const t of back.querySelectorAll("[data-sec]"))
      if (back._draft?.[t.dataset.sec]) t.value = back._draft[t.dataset.sec];
  };
}
