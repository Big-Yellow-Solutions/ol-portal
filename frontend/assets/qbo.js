/* OL Portal · QuickBooks card on the invoices page (admin-only).
   Ported from Bookspark: connect via Intuit OAuth, show connection status,
   list live QuickBooks invoices next to the portal's invoice requests. */

const QBO_STATUS_CLASS = { Paid: "b-won", Open: "b-sent" };

async function renderQboCard() {
  const mount = document.getElementById("qboCard");
  if (!mount) return;
  if (!can.reviewInvoices()) { mount.remove(); return; }
  mount.hidden = false;

  // one-time flash after the OAuth round trip (?qbo=connected|error)
  const flash = new URLSearchParams(location.search).get("qbo");
  if (flash) history.replaceState(null, "", location.pathname);

  const draw = html => {
    mount.innerHTML = `<div class="card-head"><h2>QuickBooks</h2></div>` +
      (flash === "error"
        ? `<p class="footnote" style="margin:0 0 12px">Connection attempt failed. Check the Intuit app settings and try again.</p>` : "") +
      html;
  };

  let s;
  try { s = await api("/qbo/status"); }
  catch (e) { draw(`<p class="footnote" style="margin:0">QuickBooks status unavailable (${e.message}).</p>`); return; }

  if (!s.configured) {
    draw(`<p class="footnote" style="margin:0">Not configured yet. Add the Intuit app credentials to
      SSM parameter <code>/ol-portal/qbo-credentials</code> and redeploy the backend to enable connecting.</p>`);
    return;
  }

  if (!s.connected) {
    draw(`<p class="footnote" style="margin:0 0 12px">Connect the portal to QuickBooks Online (${s.env})
      so invoice requests can be checked against real invoices. PRD Option A groundwork.</p>
      <button class="btn-mini" id="qboConnect">Connect to QuickBooks</button>`);
    document.getElementById("qboConnect").addEventListener("click", async e => {
      e.target.disabled = true;
      try {
        const { url } = await api("/qbo/connect");
        location.href = url;
      } catch (ex) { alert(ex.message); e.target.disabled = false; }
    });
    return;
  }

  draw(`<p class="footnote" style="margin:0 0 12px">
      Connected to QuickBooks Online (${s.env}), company ${s.realmId}.
      <button class="btn-mini" id="qboDisconnect">Disconnect</button></p>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Invoice</th><th>Customer</th><th>Total</th><th>Balance</th><th>Status</th><th>Date</th></tr></thead>
      <tbody id="qboRows"><tr><td colspan="6" class="empty">Loading live invoices…</td></tr></tbody>
    </table></div>`);

  document.getElementById("qboDisconnect").addEventListener("click", async () => {
    if (!confirm("Disconnect the portal from QuickBooks?")) return;
    try { await api("/qbo/disconnect", { method: "POST" }); renderQboCard(); }
    catch (ex) { alert(ex.message); }
  });

  try {
    const invs = await api("/qbo/invoices");
    document.getElementById("qboRows").innerHTML = invs.length ? invs.map(i => `<tr>
        <td><b>#${i.number}</b></td>
        <td>${i.customer}</td>
        <td class="amount">${fmt$(i.total)}</td>
        <td class="amount">${fmt$(i.balance)}</td>
        <td><span class="badge ${QBO_STATUS_CLASS[i.status] || "b-draft"}"><i></i>${i.status}</span></td>
        <td>${i.txnDate || ""}</td>
      </tr>`).join("")
      : '<tr><td colspan="6" class="empty">No invoices in this QuickBooks company yet.</td></tr>';
  } catch (e) {
    document.getElementById("qboRows").innerHTML =
      `<tr><td colspan="6" class="empty">Could not load QuickBooks invoices (${e.message}).</td></tr>`;
  }
}
