/* OL Portal · The Optimist — a full-page chat app for writing proposals.
   Proposals are the conversations (left rail), the chat fills the center, and
   the document forms live on the right with the human-only controls (status,
   ★ Final, Send). Chats persist per proposal in this browser; the document
   itself is saved server-side on every update The Optimist makes. */

const CHAT_KEY = id => `olportal.optimist.${id}`;
const GREETING = "Hi, I'm The Optimist — I write OL's proposals. Tell me about this engagement: who's the client, what problem are we solving for them, and roughly what should OL do? I'll build the document as we talk.";

function loadChat(id) {
  try {
    const c = JSON.parse(localStorage.getItem(CHAT_KEY(id)));
    if (Array.isArray(c) && c.length) return c;
  } catch { }
  return [{ role: "assistant", content: GREETING }];
}
function saveChat(id, chat) {
  try { localStorage.setItem(CHAT_KEY(id), JSON.stringify(chat.slice(-60))); } catch { }
}

function renderOptimist() {
  const $ = id => document.getElementById(id);
  if (ROLE === "Contributor") {
    $("optWrap").innerHTML = '<div class="empty" style="padding:60px;text-align:center">The Optimist writes proposals, which are Lab-Leader/Admin territory. The bench directory is all yours though.</div>';
    return;
  }

  let currentId = new URLSearchParams(location.search).get("p");
  let chat = [];

  const current = () => PROPOSALS.find(x => x.id === currentId);

  const drawRail = () => {
    $("optList").innerHTML = PROPOSALS.length ? PROPOSALS.map(p => `
      <div class="opt-item${p.id === currentId ? " on" : ""}" data-sel="${p.id}" tabindex="0">
        <b>${p.title}</b>
        <small>${p.client || ""} · v${p.version}</small>
        <span class="badge ${PROPOSAL_CLASS[p.status] || "b-draft"}"><i></i>${p.status}</span>
      </div>`).join("")
      : '<div class="empty" style="padding:20px 8px;font-size:13px">No proposals yet. Start one above and The Optimist takes it from there.</div>';
  };

  const drawChat = (thinking) => {
    $("optLog").innerHTML = currentId ? chat.map(m =>
      `<div class="msg ${m.role}"><span>${m.content.replace(/</g, "&lt;").replace(/\n/g, "<br>")}${m.applied ? ` <em class="applied">✦ document updated · v${m.ver} saved</em>` : ""}</span></div>`).join("") +
      (thinking ? '<div class="msg assistant"><span class="typing">writing…</span></div>' : "")
      : '<div class="empty" style="margin:auto">Pick a proposal on the left, or start a new one.</div>';
    $("optLog").scrollTop = $("optLog").scrollHeight;
    $("optIn").disabled = $("optSend").disabled = !currentId;
  };

  const drawDoc = () => {
    const p = current();
    if (!p) { $("optDoc").innerHTML = ""; return; }
    const statuses = can.approveProposal()
      ? ["Draft", "In Review", "Internally Approved", "Sent", "Customer Approved", "Customer Rejected", "Revision Requested"]
      : ["Draft", "In Review", "Sent"];
    const versions = (p.versions || []).slice().reverse().slice(0, 5).map(v =>
      `<button class="btn-mini" data-ver="${v.v}">v${v.v} · ${v.date}</button>`).join(" ");
    $("optDoc").innerHTML = `
      <div class="doc-head">
        <b>${p.title}</b>
        <small style="display:block;color:var(--ink-mute)">${p.id} · deal ${p.deal} · ${LABS[p.lab]?.name || p.lab} ·
          <span id="optVer">v${p.version}</span>${p.final ? " · ★ Final" : ""}${p.sentAt ? ` · sent v${p.sentVersion}` : ""}</small>
      </div>
      ${p.decision ? `<div class="todo" style="margin:8px 0"><span class="dot" style="background:${p.decision.action === "approve" ? "var(--green,#3B6D11)" : "var(--red,#C0392B)"}"></span>
        <span><b>Client ${p.decision.action === "approve" ? "approved" : p.decision.action === "reject" ? "rejected" : "requested revisions on"} v${p.decision.version}</b>
        <small>${p.decision.name ? p.decision.name + " · " : ""}${(p.decision.at || "").slice(0, 10)}${p.decision.comment ? " · “" + p.decision.comment + "”" : ""}</small></span></div>` : ""}
      <div class="doc-preview" id="optPreview">
        ${Object.entries(SECTION_LABELS).map(([k, label]) => `
          <h4>${label}</h4>
          ${(p.sections?.[k] || "").trim()
            ? `<div class="doc-sec">${p.sections[k].replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>`
            : '<div class="doc-sec doc-empty">Not written yet</div>'}`).join("")}
      </div>
      <div class="doc-controls">
        <select id="optStatus" class="row-sel" aria-label="Status">
          ${statuses.includes(p.status) ? "" : `<option selected>${p.status}</option>`}
          ${statuses.map(s => `<option${s === p.status ? " selected" : ""}>${s}</option>`).join("")}</select>
        <button class="btn-mini" id="optFinal">${p.final ? "Unmark Final" : "★ Mark Final"}</button>
        <button class="btn-mini" id="optSendClient" ${p.final ? "" : "disabled"}>Send to client</button>
      </div>
      ${versions ? `<div style="margin-top:8px"><small style="font-weight:700">VERSIONS</small> ${versions}</div>` : ""}
      <div id="optLink" style="display:none;margin-top:8px;padding:8px;background:#f6f3ee;border-radius:8px;font-size:12.5px;word-break:break-all"></div>`;

    $("optStatus").onchange = async e => {
      e.target.disabled = true;
      try { await setProposalStatus(p.id, e.target.value); } catch (ex) { alert(ex.message); }
      drawDoc(); drawRail();
    };
    $("optFinal").onclick = async e => {
      e.target.disabled = true;
      try { await toggleProposalFinal(p.id); } catch (ex) { alert(ex.message); }
      drawDoc(); drawRail();
    };
    $("optSendClient").onclick = async e => {
      if (!confirm("Send this proposal to the client? The current Final version gets locked as what they see, and you'll get a share link.")) return;
      e.target.disabled = true;
      try {
        const out = await sendProposalToClient(p.id);
        drawDoc(); drawRail();
        const link = $("optLink");
        link.style.display = "block";
        link.innerHTML = `Client link (v${out.sentVersion} locked): <b>${out.url}</b> <button class="btn-mini" id="optCopy">Copy</button>`;
        $("optCopy").onclick = () => navigator.clipboard.writeText(out.url);
      } catch (ex) { alert(ex.message); e.target.disabled = false; }
    };
    document.querySelectorAll("#optDoc [data-ver]").forEach(b => b.onclick = async () => {
      const snap = (p.versions || []).find(v => String(v.v) === b.dataset.ver);
      if (!snap) return;
      if (!confirm(`Restore the v${snap.v} snapshot? It saves as a new version, so nothing is lost.`)) return;
      b.disabled = true;
      try { await saveProposalSections(p.id, snap.sections || {}); } catch (ex) { alert(ex.message); }
      drawDoc(); drawRail();
    });
  };

  const select = (id, push = true) => {
    currentId = id;
    if (push) history.replaceState(null, "", id ? `optimist.html?p=${id}` : "optimist.html");
    chat = id ? loadChat(id) : [];
    drawRail(); drawChat(); drawDoc();
    if (id) $("optIn").focus();
  };

  /* attachments: hand The Optimist your own draft/notes to pull in */
  let pendingFile = null;
  const drawFileChip = () => {
    $("optChip").innerHTML = pendingFile
      ? `<span class="tag">📎 ${pendingFile.name} <a href="#" id="optChipX" style="text-decoration:none">✕</a></span>`
      : "";
    const x = $("optChipX");
    if (x) x.onclick = e => { e.preventDefault(); pendingFile = null; drawFileChip(); };
  };
  $("optAttach").onclick = () => $("optFile").click();
  $("optFile").addEventListener("change", e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { alert("Keep attachments under 4 MB."); return; }
    const ext = f.name.toLowerCase().split(".").pop();
    const type = f.type || ({ md: "text/markdown", txt: "text/plain", csv: "text/csv" }[ext] || "");
    const r = new FileReader();
    r.onload = () => { pendingFile = { name: f.name, type, data: String(r.result).split(",")[1] }; drawFileChip(); };
    r.readAsDataURL(f);
  });
  $("optAuto").onclick = () => {
    if (!currentId) return;
    $("optIn").value = "Auto-fill the rest of the proposal from what you have so far. Make reasonable assumptions, fill every missing section, and note your key assumptions — I'll correct anything that's off.";
    sendChat();
  };

  const sendChat = async () => {
    const p = current();
    if (!p) return;
    const input = $("optIn"), btn = $("optSend");
    const text = input.value.trim();
    const att = pendingFile;
    if (!text && !att) return;
    chat.push({ role: "user", content: (att ? `📎 ${att.name}\n` : "") + (text || "Here's my draft — pull it into the proposal.") });
    input.value = ""; input.disabled = btn.disabled = true;
    pendingFile = null; drawFileChip();
    drawChat(true);
    try {
      const out = await assistChat(p.id,
        chat.map(({ role, content }) => ({ role, content })), p.sections || {}, att);
      let applied = false;
      const sections = { ...(p.sections || {}) };
      for (const k of Object.keys(SECTION_LABELS)) {
        const v = out.sections?.[k];
        if (v && v.trim()) { sections[k] = v; applied = true; }
      }
      let ver;
      if (applied) {
        const saved = await saveProposalSections(p.id, sections);
        Object.assign(p, saved, { id: p.id });
        ver = saved.version;
        drawDoc(); drawRail();
      }
      chat.push({ role: "assistant", content: out.reply, applied, ver });
      saveChat(p.id, chat);
    } catch (ex) {
      chat.pop();
      input.value = text;
      alert(ex.message);
    }
    input.disabled = btn.disabled = false;
    drawChat();
    input.focus();
  };

  $("optList").addEventListener("click", e => {
    const item = e.target.closest("[data-sel]");
    if (item) select(item.dataset.sel);
  });
  $("optSend").onclick = sendChat;
  $("optIn").addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });
  $("optNew").onclick = () => {
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
        <button class="pill pill-primary" id="npCreate">Start the conversation</button>
      </div>`, "modal");
    back.querySelector(".x").onclick = back.querySelector("#npCancel").onclick = () => back.remove();
    back.querySelector("#npCreate").onclick = async e => {
      const title = back.querySelector("#npTitle").value.trim();
      if (!title) { alert("Give the proposal a title."); return; }
      e.target.disabled = true;
      try {
        const p = await createProposal(back.querySelector("#npDeal").value, title);
        back.remove();
        select(p.id);
      } catch (ex) { alert(ex.message); e.target.disabled = false; }
    };
    back.querySelector("#npTitle").focus();
  };

  const initial = currentId && PROPOSALS.some(x => x.id === currentId)
    ? currentId
    : (PROPOSALS[0]?.id || null);
  select(initial, false);
  if (new URLSearchParams(location.search).get("new")) $("optNew").click();
}
