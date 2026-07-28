/* OL Portal · proposals list (PRD 3.4-3.5). This page is the management view;
   writing happens in The Optimist (optimist.html), OL's proposal-writing chat.
   Rows link straight into the conversation for that proposal. */

function renderProposals() {
  const props = visibleProposals();
  document.getElementById("propRows").innerHTML = props.length ? props.map(p => `<tr class="rowlink" data-open="${p.id}" tabindex="0">
      <td><b>${p.title}</b><br><small style="color:var(--ink-mute)">${p.id} · deal ${p.deal} · ${p.client || ""}</small></td>
      <td>${labCell(p.lab)}</td>
      <td>${personCell(p.author)}</td>
      <td><span class="badge ${PROPOSAL_CLASS[p.status] || "b-draft"}"><i></i>${p.status}</span></td>
      <td>${versionLabel(p)}${p.final ? ` <span class="badge b-approved">★ Final v${p.finalVersion || p.version}</span>` : ""}
        ${p.sentAt ? `<small style="display:block;color:var(--ink-mute)">sent v${p.sentVersion}</small>` : ""}</td>
      <td>${p.updated}</td>
    </tr>`).join("") : '<tr><td colspan="6" class="empty">No proposals yet. Open The Optimist and start one.</td></tr>';

  if (ROLE === "Admin" || ROLE === "Lab Leader") {
    const btn = document.createElement("a");
    btn.className = "pill pill-primary";
    btn.textContent = "✦ Write with The Optimist";
    btn.href = "optimist.html?new=1";
    document.querySelector(".card-head").appendChild(btn);
  }

  document.getElementById("propRows").addEventListener("click", e => {
    const row = e.target.closest("[data-open]");
    if (row) location.href = "optimist.html?p=" + row.dataset.open;
  });
}
