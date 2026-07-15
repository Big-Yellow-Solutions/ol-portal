/* OL Portal · Admin & Invites page (PRD 2.2 invite lifecycle, 2.5 2FA reset,
   2.6 audit log). The server re-checks Admin on every route; this file only
   renders. */

const STATUS_BADGE = {
  CONFIRMED: ["b-won", "Active"],
  FORCE_CHANGE_PASSWORD: ["b-review", "Invite pending"],
  RESET_REQUIRED: ["b-lost", "Reset required"]
};

async function renderAdmin() {
  if (ROLE !== "Admin") {
    document.getElementById("adminWrap").innerHTML =
      '<div class="empty" style="padding:60px;text-align:center">This page is for OL admins only.</div>';
    return;
  }

  let users = [], audit = [];
  const load = async () => {
    [users, audit] = await Promise.all([api("/admin/users"), api("/admin/audit")]);
  };

  const labChecks = () => Object.entries(LABS).map(([k, l]) =>
    `<label style="display:inline-flex;align-items:center;gap:6px;font-weight:500;margin-right:14px">
      <input type="checkbox" name="invLab" value="${k}">${l.name}</label>`).join("");

  const drawUsers = () => {
    document.getElementById("userRows").innerHTML = users.map(u => {
      const [cls, label] = STATUS_BADGE[u.status] || ["b-draft", u.status];
      const pending = u.status === "FORCE_CHANGE_PASSWORD";
      const self = u.username === ME;
      return `<tr>
        <td><b>${u.name}</b><br><small style="color:var(--ink-mute)">${u.username}</small></td>
        <td>${u.email || '<span style="color:var(--red)">no email</span>'}
          <button class="btn-mini" data-email="${u.username}" title="Change email">✎</button></td>
        <td>${u.role || "—"}<br><small style="color:var(--ink-mute)">${(u.labs || []).map(k => LABS[k]?.name || k).join(", ")}</small></td>
        <td><span class="badge ${cls}"><i></i>${label}</span></td>
        <td>${u.mfaEnrolled ? '<span class="badge b-won"><i></i>2FA on</span>' : '<span class="badge b-draft"><i></i>2FA not set</span>'}</td>
        <td style="white-space:nowrap">
          ${pending ? `<button class="btn-mini" data-resend="${u.username}">Resend invite</button>
            <button class="btn-mini" data-revoke="${u.username}">Revoke</button>` : ""}
          ${!pending && !self ? `<button class="btn-mini" data-mfa="${u.username}">Reset access</button>` : ""}
        </td>
      </tr>`;
    }).join("") || '<tr><td colspan="6" class="empty">No users yet.</td></tr>';
  };

  const drawAudit = () => {
    document.getElementById("auditList").innerHTML = audit.length ? audit.map(a => `
      <div class="todo">
        <span class="dot" style="background:${a.action.startsWith("auth.") ? "var(--green,#3B6D11)" : "var(--violet)"}"></span>
        <span><b>${a.action}</b> · ${a.actor}${a.detail ? " · " + a.detail : ""}
          <small style="display:block">${a.at} UTC</small></span>
      </div>`).join("")
      : '<div class="empty">No auth events recorded yet.</div>';
  };

  const drawAll = () => { drawUsers(); drawAudit(); };

  document.getElementById("inviteLabs").innerHTML = labChecks();

  document.getElementById("inviteForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button"), msg = document.getElementById("inviteMsg");
    btn.disabled = true; msg.textContent = ""; msg.style.color = "";
    try {
      await api("/admin/invites", {
        method: "POST",
        body: {
          name: f.invName.value.trim(),
          username: f.invUser.value.trim().toLowerCase(),
          email: f.invEmail.value.trim(),
          role: f.invRole.value,
          labs: [...f.querySelectorAll('input[name="invLab"]:checked')].map(c => c.value)
        }
      });
      msg.style.color = "var(--green, #3B6D11)";
      msg.textContent = `Invite sent to ${f.invEmail.value.trim()} — temp password valid 7 days.`;
      f.reset();
      await load(); drawAll();
    } catch (ex) {
      msg.style.color = "var(--red, #C0392B)";
      msg.textContent = ex.message;
    }
    btn.disabled = false;
  });

  document.getElementById("invName").addEventListener("input", e => {
    const u = document.getElementById("invUser");
    if (!u.dataset.touched) u.value = e.target.value.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9._-]/g, "");
  });
  document.getElementById("invUser").addEventListener("input", e => { e.target.dataset.touched = "1"; });

  document.getElementById("userRows").addEventListener("click", async e => {
    const b = e.target.closest("button");
    if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.resend) {
        await api(`/admin/invites/${b.dataset.resend}/resend`, { method: "POST" });
        alert("Invite email resent.");
      } else if (b.dataset.revoke) {
        if (confirm(`Revoke the invite for "${b.dataset.revoke}"? Their account and profile are removed.`)) {
          await api(`/admin/invites/${b.dataset.revoke}`, { method: "DELETE" });
        }
      } else if (b.dataset.mfa) {
        if (confirm(`Reset access for "${b.dataset.mfa}"? Verify their identity out-of-band first (call or known email thread). They get a new emailed temporary password and re-enroll two-factor at next sign-in. Their portal data is untouched.`)) {
          await api(`/admin/users/${b.dataset.mfa}/reset-mfa`, { method: "POST" });
        }
      } else if (b.dataset.email) {
        const email = prompt(`New email for ${b.dataset.email}:`);
        if (email) await api(`/admin/users/${b.dataset.email}`, { method: "PATCH", body: { email } });
      }
      await load(); drawAll();
    } catch (ex) { alert(ex.message); }
    b.disabled = false;
  });

  await load();
  drawAll();
}
