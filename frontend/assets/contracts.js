/* OL Portal · contracts page (PRD 3.6 + the 2.2 invite unlock).
   Contracts are auto-created from customer-approved proposals; admins move
   them Draft → Internal Review → Sent → Signed and name the Contributor.
   Once Signed, the lab's Lab Leader gets an Invite button for that person. */

const CONTRACT_STATUSES_UI = ["Draft", "Internal Review", "Sent", "Signed"];

function renderContracts() {
  const draw = () => {
    const rows = CONTRACTS.map(c => {
      const isAdmin = ROLE === "Admin";
      const statusCtl = isAdmin && c.status !== "Signed"
        ? `<select class="row-sel" data-status="${c.id}" aria-label="Change status">
            ${CONTRACT_STATUSES_UI.map(s => `<option${s === c.status ? " selected" : ""}>${s}</option>`).join("")}</select>`
        : "";
      const contributor = c.contributorName || c.contributorEmail
        ? `<b>${c.contributorName || "—"}</b><small style="display:block;color:var(--ink-mute)">${c.contributorEmail || ""}</small>`
        : '<small style="color:var(--ink-mute)">none named</small>';
      const canInvite = ROLE === "Lab Leader" && c.status === "Signed" && c.contributorEmail &&
        MY_LABS.includes(c.lab) &&
        !Object.values(PEOPLE).some(p => (p.email || "").toLowerCase() === c.contributorEmail.toLowerCase());
      return `<tr>
        <td><b>${c.client}</b><br><small style="color:var(--ink-mute)">${c.id} · from ${c.proposal} · deal ${c.deal}</small></td>
        <td>${labCell(c.lab)}</td>
        <td class="amount">${c.amount != null ? fmt$(c.amount) : "—"}</td>
        <td><span class="badge ${CONTRACT_CLASS[c.status] || "b-draft"}"><i></i>${c.status}</span>${statusCtl}
          ${c.signedAt ? `<small style="display:block;color:var(--ink-mute)">signed ${c.signedAt.slice(0, 10)}</small>` : ""}</td>
        <td>${contributor}
          ${ROLE === "Admin" ? `<button class="btn-mini" data-edit="${c.id}">✎</button>` : ""}
          ${canInvite ? `<button class="btn-mini" data-invite="${c.id}">Invite to portal</button>` : ""}</td>
        <td>${c.created}</td>
      </tr>`;
    }).join("");
    document.getElementById("conRows").innerHTML = rows ||
      '<tr><td colspan="6" class="empty">No contracts yet. They appear automatically when a client approves a proposal.</td></tr>';
  };

  const tbody = document.getElementById("conRows");
  tbody.addEventListener("change", async e => {
    const sel = e.target.closest("[data-status]");
    if (!sel) return;
    if (sel.value === "Signed" &&
        !confirm("Mark this contract Signed? E-signature is deferred post-raise (PRD 3.7), so this records that the signed copy exists outside the portal. Signing unlocks the Lab Leader's invite for the named Contributor.")) {
      draw(); return;
    }
    sel.disabled = true;
    try { await updateContractApi(sel.dataset.status, { status: sel.value }); } catch (ex) { alert(ex.message); }
    draw();
  });
  tbody.addEventListener("click", async e => {
    const edit = e.target.closest("[data-edit]");
    if (edit) {
      const c = CONTRACTS.find(x => x.id === edit.dataset.edit);
      const name = prompt("Contributor name on this contract:", c.contributorName || "");
      if (name === null) return;
      const email = prompt("Contributor email (unlocks the Lab Leader's invite once Signed):", c.contributorEmail || "");
      if (email === null) return;
      try { await updateContractApi(c.id, { contributorName: name, contributorEmail: email }); } catch (ex) { alert(ex.message); }
      draw();
      return;
    }
    const inv = e.target.closest("[data-invite]");
    if (inv) {
      const c = CONTRACTS.find(x => x.id === inv.dataset.invite);
      const name = prompt("Full name for the new portal account:", c.contributorName || "");
      if (!name) return;
      const username = prompt("Username (lowercase, e.g. first name):",
        (c.contributorName || "").split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") || "");
      if (!username) return;
      inv.disabled = true;
      try {
        await inviteContributor({ name, username, email: c.contributorEmail, labs: [c.lab] });
        alert(`Invite sent to ${c.contributorEmail}. They get a temporary password valid 7 days.`);
      } catch (ex) { alert(ex.message); inv.disabled = false; }
    }
  });
  draw();
}
