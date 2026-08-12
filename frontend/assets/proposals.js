/* OL Portal · proposals list (PRD 3.4-3.5). This page is the management view;
   writing happens in The Optimist (optimist.html), OL's proposal-writing chat.
   Rows link straight into the conversation for that proposal. */

function renderProposals() {
  if (ROLE === "Contributor") return renderMyProposals();

  document.getElementById("propTableCard").style.display = "";
  document.getElementById("propCardsCard").style.display = "none";

  const draw = () => {
    const props = visibleProposals();
    document.getElementById("propRows").innerHTML = props.length ? props.map(p => {
      const contributor = p.contributorName || p.contributorEmail
        ? `<b>${p.contributorName || "—"}</b><small style="display:block;color:var(--ink-mute)">${p.contributorEmail || ""}</small>`
        : '<small style="color:var(--ink-mute)">none named</small>';
      return `<tr class="rowlink" data-open="${p.id}" tabindex="0">
      <td><b>${p.title}</b><br><small style="color:var(--ink-mute)">${p.id} · deal ${p.deal} · ${p.client || ""}</small></td>
      <td>${labCell(p.lab)}</td>
      <td>${personCell(p.author)}</td>
      <td><span class="badge ${PROPOSAL_CLASS[p.status] || "b-draft"}"><i></i>${p.status}</span></td>
      <td>${versionLabel(p)}${p.final ? ` <span class="badge b-approved">★ Final v${p.finalVersion || p.version}</span>` : ""}
        ${p.sentAt ? `<small style="display:block;color:var(--ink-mute)">sent v${p.sentVersion}</small>` : ""}</td>
      <td>${contributor} <button class="btn-mini" data-share="${p.id}">✎</button></td>
      <td>${p.updated}</td>
    </tr>`;
    }).join("") : '<tr><td colspan="7" class="empty">No proposals yet. Open The Optimist and start one.</td></tr>';
  };
  draw();

  if (ROLE === "Admin" || ROLE === "Lab Leader") {
    const btn = document.createElement("a");
    btn.className = "pill pill-primary";
    btn.textContent = "✦ Write with The Optimist";
    btn.href = "optimist.html?new=1";
    document.querySelector(".card-head").appendChild(btn);
  }

  document.getElementById("propRows").addEventListener("click", async e => {
    const share = e.target.closest("[data-share]");
    if (share) {
      const p = visibleProposals().find(x => x.id === share.dataset.share);
      const name = prompt("Contributor name on this proposal (who it's shared with):", p.contributorName || "");
      if (name === null) return;
      const email = prompt("Contributor email (they'll see this proposal, read-only, once named):", p.contributorEmail || "");
      if (email === null) return;
      try { await setProposalContributor(p.id, { contributorName: name, contributorEmail: email }); } catch (ex) { alert(ex.message); }
      draw();
      return;
    }
    const row = e.target.closest("[data-open]");
    if (row) location.href = "optimist.html?p=" + row.dataset.open;
  });
}

/* Contributors aren't lab-scoped — they only ever see the proposal(s) naming
   their own email, as a read-only card list (no Optimist access). */
function renderMyProposals() {
  document.getElementById("propTableCard").style.display = "none";
  const cardsCard = document.getElementById("propCardsCard");
  cardsCard.style.display = "";

  const cards = document.getElementById("propCards");
  const props = visibleProposals();
  cards.innerHTML = props.length ? props.map(p => `
    <div class="todo" style="align-items:flex-start;gap:12px" data-view="${p.id}" tabindex="0" role="button">
      <span style="flex:1;min-width:0">
        <b>${p.title}</b> <span class="badge ${PROPOSAL_CLASS[p.status] || "b-draft"}" style="margin-left:8px"><i></i>${p.status}</span>
        <small style="display:block;color:var(--ink-mute)">${p.id} · ${labCell(p.lab)} · ${p.client || ""}</small>
      </span>
      <button class="btn-mini" data-view-btn="${p.id}">View</button>
    </div>`).join("") : '<div class="empty">No proposals shared with you yet.</div>';

  const openReadOnly = id => {
    const p = props.find(x => x.id === id);
    if (!p) return;
    overlay(`
      <div class="modal-head">
        <div><h2>${p.title}</h2>
          <small class="drawer-sub">${p.id} · ${labCell(p.lab)} · ${versionLabel(p)}</small></div>
        <button class="x" aria-label="Close">×</button>
      </div>
      <div class="doc-preview">
        ${Object.entries(SECTION_LABELS).map(([k, label]) => `
          <h4>${label}</h4>
          ${(p.sections?.[k] || "").trim()
            ? `<div class="doc-sec">${p.sections[k].replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>`
            : '<div class="doc-sec doc-empty">Not written yet</div>'}`).join("")}
      </div>`, "modal");
  };
  cards.addEventListener("click", e => {
    const view = e.target.closest("[data-view],[data-view-btn]");
    if (view) openReadOnly(view.dataset.view || view.dataset.viewBtn);
  });
}
