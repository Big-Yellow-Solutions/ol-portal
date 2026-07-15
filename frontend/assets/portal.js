/* OL Portal · app shell + page renderers (no backend yet — renders sample data from data.js) */

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  pipeline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 5h16M7 12h10M10 19h4"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/></svg>',
  invoice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h3.75a1.75 1.75 0 0 1 0 3.5h-2.5a1.75 1.75 0 0 0 0 3.5H15"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 15.5c2.4.3 4.3 1.7 5 4.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.5-4.5"/></svg>',
  trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
  dollar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M17 6.5H9.8a3 3 0 0 0 0 6h4.4a3 3 0 0 1 0 6H6.5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>'
};

const NAV = [
  { href: "index.html",     icon: "home",     label: "Dashboard" },
  { href: "pipeline.html",  icon: "pipeline", label: "Pipeline" },
  { href: "proposals.html", icon: "doc",      label: "Proposals" },
  { href: "invoices.html",  icon: "invoice",  label: "Invoice Requests" },
  { href: "files.html",     icon: "doc",      label: "Files" },
  { href: "bench.html",     icon: "people",   label: "Bench Directory" }
];
const NAV_CONTRACTS = { href: "contracts.html", icon: "doc", label: "Contracts" };
const NAV_ADMIN = { href: "admin.html", icon: "gear", label: "Admin & Invites" };

function buildShell(pageTitle) {
  const here = location.pathname.split("/").pop() || "index.html";
  const navItems = [...NAV];
  if (ROLE !== "Contributor") navItems.splice(3, 0, { href: "optimist.html", icon: "spark", label: "The Optimist" });
  navItems.push(NAV_CONTRACTS);
  if (ROLE === "Admin") navItems.push(NAV_ADMIN);
  const nav = navItems.map(n =>
    `<a class="nav-item${n.href === here ? " active" : ""}" href="${n.href}">${ICONS[n.icon]}${n.label}</a>`).join("");

  document.getElementById("side").innerHTML = `
    <div class="side-logo"><img src="assets/ol-logo-white.svg" alt="Optimistic Labs"></div>
    <div class="side-tag">The Portal</div>
    <div class="side-label">Workspace</div>${nav}
    <div class="side-foot">Signed in as ${PEOPLE[ME].name}<br>
      <a href="#" id="signOut" style="color:var(--violet-light);font-weight:600">Sign out</a></div>`;

  const me = PEOPLE[ME];
  document.getElementById("top").innerHTML = `
    <button class="burger" id="burger" aria-label="Open menu"><span></span><span></span><span></span></button>
    <span class="top-title">${pageTitle}</span>
    <div class="top-right">
      <span class="top-role">${ROLE}</span>
      <span class="top-ava" title="${me.name} (${ROLE})">${faceHTML(me)}</span>
    </div>`;

  document.getElementById("signOut").addEventListener("click", e => { e.preventDefault(); logout(); });

  document.getElementById("burger").addEventListener("click", () => {
    document.getElementById("side").classList.toggle("open");
  });
  document.addEventListener("click", e => {
    const side = document.getElementById("side");
    if (side.classList.contains("open") && !side.contains(e.target) && e.target.id !== "burger" && !document.getElementById("burger").contains(e.target)) {
      side.classList.remove("open");
    }
  });
}

/* ---------- shared row builders ---------- */
const labCell = key => {
  const l = LABS[key];
  return `<span class="lab-dot"><i style="background:${l.color}"></i>${l.name}</span>`;
};
const personCell = key => {
  const p = PEOPLE[key];
  return `<span class="who">${faceHTML(p)}<span><b>${p.name}</b><small>${p.role}</small></span></span>`;
};

function dealRows(deals) {
  return deals.map(d => `<tr>
    <td><b>${d.client}</b><br><small style="color:var(--ink-mute)">${d.id} · ${d.source}</small></td>
    <td>${labCell(d.lab)}</td>
    <td>${personCell(d.owner)}</td>
    <td><span class="badge ${stageClass(d)}"><i></i>${stageLabel(d)}</span>${d.recurring ? ' <span class="badge b-recurring">↻ Recurring</span>' : ""}</td>
    <td class="amount">${fmt$(d.amount)}</td>
    <td>${d.close}</td>
  </tr>`).join("");
}

/* ---------- dashboard ---------- */
function renderDashboard() {
  const deals = visibleDeals();
  const open = deals.filter(d => d.stage !== "Closed");
  const won = deals.filter(d => d.stage === "Closed" && d.outcome === "Won");
  const pipelineVal = open.reduce((s, d) => s + d.amount, 0);
  const wonVal = won.reduce((s, d) => s + d.amount, 0);
  // MRR (PRD 3.9): current month's generated instances when they exist,
  // otherwise projected from Closed-Won recurring deals.
  const month = TODAY.slice(0, 7);
  const monthInstances = RECURS.filter(r => r.month === month);
  const mrrItems = monthInstances.length ? monthInstances
    : deals.filter(d => d.recurring && d.outcome === "Won" && !d.recurPaused)
        .map(d => ({ lab: d.lab, owner: d.owner, amount: Math.round(d.amount / 12) }));
  const mrr = mrrItems.reduce((s, x) => s + x.amount, 0);

  document.getElementById("helloName").textContent = PEOPLE[ME].name.split(" ")[0];

  document.getElementById("bannerStats").innerHTML = `
    <div class="banner-chip"><b>${open.length}</b><span>Open deals</span></div>
    <div class="banner-chip"><b>${fmtK(pipelineVal)}</b><span>In pipeline</span></div>`;

  const liveLabs = Object.values(LABS).filter(l => l.status === "live").length;
  document.getElementById("stats").innerHTML = [
    { ic: "trend",  cls: "ic-violet", num: fmtK(pipelineVal), lbl: "Open pipeline value", d: open.length + " open deal" + (open.length === 1 ? "" : "s") },
    { ic: "dollar", cls: "ic-green",  num: fmtK(wonVal),      lbl: "Closed won (all time)", d: won.length + " deal" + (won.length === 1 ? "" : "s") + " won" },
    { ic: "repeat", cls: "ic-amber",  num: fmt$(mrr),         lbl: "MRR from recurring deals", d: monthInstances.length ? monthInstances.length + " instance" + (monthInstances.length === 1 ? "" : "s") + " this month" : deals.filter(x => x.recurring).length + " recurring" },
    { ic: "people", cls: "ic-red",    num: String(BENCH.length), lbl: "People on the bench", d: liveLabs + " lab" + (liveLabs === 1 ? "" : "s") + " live" }
  ].map(s => `<div class="card stat">
      <div class="ic ${s.cls}">${ICONS[s.ic]}</div>
      <div class="num">${s.num}</div><div class="lbl">${s.lbl}</div>
      <span class="delta flat">${s.d}</span>
    </div>`).join("");

  // pipeline by stage bars
  const byStage = STAGES.slice(0, 4).map(st => {
    const ds = open.filter(d => d.stage === st);
    return { st, n: ds.length, val: ds.reduce((s, d) => s + d.amount, 0) };
  });
  const max = Math.max(...byStage.map(b => b.val), 1);
  document.getElementById("stageBars").innerHTML = byStage.map((b, i) => `
    <div class="bar-col">
      <div class="bar${b.val === max ? " hot" : ""}" style="height:${Math.max(8, Math.round(b.val / max * 100))}%">
        <span class="val">${fmtK(b.val)}</span></div>
      <span class="cap">${b.st}<br>${b.n} deal${b.n === 1 ? "" : "s"}</span>
    </div>`).join("");

  // deals by lab donut
  const byLab = Object.keys(LABS).map(k => ({
    k, val: open.filter(d => d.lab === k).reduce((s, d) => s + d.amount, 0)
  })).filter(x => x.val > 0).sort((a, b) => b.val - a.val);
  const total = byLab.reduce((s, x) => s + x.val, 0);
  if (!total) {
    document.getElementById("labDonut").innerHTML =
      '<div class="empty">No pipeline visible for this role.<br><small>Deals are lab-scoped; the bench stays org-wide.</small></div>';
  } else {
  let acc = 0, C = 2 * Math.PI * 42;
  const segs = byLab.map(x => {
    const frac = x.val / total, off = acc; acc += frac;
    return `<circle r="42" cx="60" cy="60" fill="none" stroke="${LABS[x.k].color}" stroke-width="14"
      stroke-dasharray="${(frac * C - 2).toFixed(1)} ${(C - frac * C + 2).toFixed(1)}"
      stroke-dashoffset="${(-off * C).toFixed(1)}" transform="rotate(-90 60 60)" stroke-linecap="butt"/>`;
  }).join("");
  document.getElementById("labDonut").innerHTML = `
    <div class="donut-wrap">
      <svg width="150" height="150" viewBox="0 0 120 120" role="img" aria-label="Open pipeline by lab">
        ${segs}<text x="60" y="57" text-anchor="middle" font-family="Anton" font-size="17" fill="#111">${fmtK(total)}</text>
        <text x="60" y="73" text-anchor="middle" font-family="Inter" font-size="7.5" fill="#9E9589">OPEN PIPELINE</text>
      </svg>
      <div class="legend">${byLab.map(x =>
        `<span><i style="background:${LABS[x.k].color}"></i>${LABS[x.k].name} · ${Math.round(x.val / total * 100)}%</span>`).join("")}
      </div>
    </div>`;
  }

  // recent deals table (open, by close date)
  const recent = [...open].sort((a, b) => a.close.localeCompare(b.close)).slice(0, 6);
  document.getElementById("recentDeals").innerHTML = recent.length ? dealRows(recent)
    : '<tr><td colspan="6" class="empty">No deals visible for this role.</td></tr>';

  // needs attention
  const props = visibleProposals(), invs = visibleInvoices();
  const todos = [
    ...props.filter(p => p.status === "In Review").map(p =>
      ({ c: "var(--amber)", t: "Proposal awaiting admin review", s: p.title })),
    ...invs.filter(i => i.status === "Admin review").map(i =>
      ({ c: "var(--violet)", t: "Invoice request to review: " + fmt$(i.amount), s: i.client + " · requested by " + PEOPLE[i.requestedBy].name })),
    ...props.filter(p => p.status === "Revision Requested").map(p =>
      ({ c: "var(--red)", t: "Client requested revisions", s: p.title }))
  ];
  document.getElementById("todos").innerHTML = todos.length
    ? todos.map(t => `<div class="todo"><span class="dot" style="background:${t.c}"></span><span><b>${t.t}</b><small>${t.s}</small></span></div>`).join("")
    : '<div class="empty">Nothing needs attention. Enjoy it.</div>';

  // MRR by lab / leader (PRD 3.9 reporting)
  const mrrEl = document.getElementById("mrrReport");
  if (mrrEl) {
    if (!mrrItems.length) {
      mrrEl.innerHTML = '<div class="empty">No recurring revenue yet. Flag a Closed-Won deal as recurring and instances generate monthly.</div>';
    } else {
      const groupSum = key => {
        const m = {};
        for (const x of mrrItems) m[x[key]] = (m[x[key]] || 0) + x.amount;
        return Object.entries(m).sort((a, b) => b[1] - a[1]);
      };
      const rows = (pairs, nameOf) => pairs.map(([k, v]) =>
        `<div class="todo"><span class="dot" style="background:var(--amber,#BA7517)"></span>
          <span><b>${nameOf(k)}</b><small>${fmt$(v)} / month</small></span></div>`).join("");
      mrrEl.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
          <div><h3 style="margin:0 0 8px;font-size:13px;color:var(--ink-mute)">BY LAB</h3>
            ${rows(groupSum("lab"), k => LABS[k]?.name || k)}</div>
          <div><h3 style="margin:0 0 8px;font-size:13px;color:var(--ink-mute)">BY LAB LEADER</h3>
            ${rows(groupSum("owner"), k => PEOPLE[k]?.name || k)}</div>
        </div>
        <small style="display:block;margin-top:10px;color:var(--ink-mute)">Org-wide MRR: <b>${fmt$(mrr)}</b> · ${monthInstances.length ? "from this month's generated instances" : "projected from recurring Closed-Won deals"}</small>`;
    }
  }

  // recent files with analysis
  const rf = document.getElementById("recentFiles");
  if (rf) {
    const recentFiles = FILES.slice(0, 3);
    rf.innerHTML = recentFiles.length ? recentFiles.map(f => `
      <div class="todo" style="align-items:flex-start">
        <span class="dot" style="background:${f.status === "Analyzed" ? "var(--green, #3B6D11)" : "var(--amber, #BA7517)"};margin-top:6px"></span>
        <span style="min-width:0">
          <b>${f.name}</b> <span class="badge ${FILE_CLASS[f.status] || "b-draft"}" style="margin-left:6px"><i></i>${f.status}</span>
          <small style="display:block">${f.analysis ? f.analysis.summary : "Uploaded by " + (PEOPLE[f.uploader]?.name || f.uploader)}</small>
        </span>
      </div>`).join("") + '<a class="more" href="files.html" style="display:inline-block;margin-top:10px">All files →</a>'
      : '<div class="empty">No files yet. <a href="files.html">Upload the first one</a> and the analysis will appear here.</div>';
  }
}

/* ---------- files ---------- */
const FILE_CLASS = {
  "Uploading": "b-draft", "Analyzing": "b-review", "Analyzed": "b-won",
  "Stored": "b-sent", "Analysis failed": "b-lost"
};
const fmtBytes = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";

function renderFiles() {
  const labSel = document.getElementById("fileLab");
  const labChoices = ROLE === "Admin" ? Object.keys(LABS) : MY_LABS;
  labSel.innerHTML = '<option value="">Everyone (no lab)</option>' +
    labChoices.map(k => `<option value="${k}">${LABS[k].name}</option>`).join("");

  let pollTimer = null;
  const draw = () => {
    const list = document.getElementById("fileList");
    list.innerHTML = FILES.length ? FILES.map(f => `
      <div class="todo" style="align-items:flex-start;gap:12px">
        <span style="flex:1;min-width:0">
          <b>${f.name}</b>
          <span class="badge ${FILE_CLASS[f.status] || "b-draft"}" style="margin-left:8px"><i></i>${f.status}</span>
          ${f.lab && LABS[f.lab] ? `<span class="lab-dot" style="margin-left:8px"><i style="background:${LABS[f.lab].color}"></i>${LABS[f.lab].name}</span>` : ""}
          <small style="display:block;color:var(--ink-mute)">
            ${fmtBytes(f.size)} · uploaded by ${PEOPLE[f.uploader]?.name || f.uploader} · ${(f.date || "").slice(0, 10)}
            ${f.analysis?.docType ? " · " + f.analysis.docType : ""}
          </small>
          ${f.analysis?.summary ? `<small style="display:block;margin-top:4px">${f.analysis.summary}</small>` : ""}
          ${f.analysis?.keyPoints?.length ? `<small style="display:block;margin-top:2px;color:var(--ink-mute)">${f.analysis.keyPoints.map(k => "• " + k).join("<br>")}</small>` : ""}
        </span>
        <span style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn-mini" data-dl="${f.id}">Download</button>
          ${(ROLE === "Admin" || f.uploader === ME) ? `<button class="btn-mini" data-del="${f.id}">Delete</button>` : ""}
        </span>
      </div>`).join("")
      : '<div class="empty">No files yet. Upload the first one.</div>';

    const pending = FILES.some(f => f.status === "Uploading" || f.status === "Analyzing");
    if (pending && !pollTimer) {
      pollTimer = setInterval(async () => {
        try { await refreshFiles(); } catch { }
        if (!FILES.some(f => f.status === "Uploading" || f.status === "Analyzing")) {
          clearInterval(pollTimer); pollTimer = null;
        }
        draw();
      }, 4000);
    }
  };

  document.getElementById("uploadBtn").onclick = () => document.getElementById("filePick").click();
  document.getElementById("filePick").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    const btn = document.getElementById("uploadBtn");
    btn.disabled = true; btn.textContent = "Uploading…";
    try {
      await uploadFile(file, labSel.value || undefined);
      await refreshFiles();
    } catch (ex) { alert(ex.message); }
    btn.disabled = false; btn.textContent = "+ Upload file";
    e.target.value = "";
    draw();
  });

  document.getElementById("fileList").addEventListener("click", async e => {
    const dl = e.target.closest("[data-dl]");
    if (dl) {
      dl.disabled = true;
      try { location.href = await downloadFileUrl(dl.dataset.dl); } catch (ex) { alert(ex.message); }
      dl.disabled = false;
      return;
    }
    const del = e.target.closest("[data-del]");
    if (del && confirm("Delete this file permanently?")) {
      del.disabled = true;
      try { await deleteFileApi(del.dataset.del); } catch (ex) { alert(ex.message); }
      draw();
    }
  });

  draw();
}

/* ---------- pipeline board ---------- */
function renderPipeline() {
  const mine = visibleDeals();
  const labSel = document.getElementById("fLab"), ownerSel = document.getElementById("fOwner");
  const labKeys = [...new Set(mine.map(d => d.lab))];
  labSel.innerHTML = '<option value="">All labs</option>' +
    labKeys.map(k => `<option value="${k}">${LABS[k].name}</option>`).join("");
  const owners = [...new Set(mine.map(d => d.owner))];
  ownerSel.innerHTML = '<option value="">All lab leaders</option>' +
    owners.map(k => `<option value="${k}">${PEOPLE[k].name}</option>`).join("");

  if (can.addDeal()) {
    const btn = document.createElement("button");
    btn.className = "pill pill-primary";
    btn.textContent = "+ New deal";
    btn.onclick = () => openNewDeal(draw);
    document.querySelector(".controls").appendChild(btn);
  }

  const draw = () => {
    const lab = labSel.value, owner = ownerSel.value,
      q = document.getElementById("fSearch").value.trim().toLowerCase();
    const ds = visibleDeals().filter(d =>
      (!lab || d.lab === lab) && (!owner || d.owner === owner) &&
      (!q || d.client.toLowerCase().includes(q)));
    document.getElementById("board").innerHTML = STAGES.map(st => {
      const col = ds.filter(d => d.stage === st);
      const sum = col.reduce((s, d) => s + d.amount, 0);
      return `<div class="col">
        <div class="col-head"><b>${st}</b><span class="n">${col.length}</span></div>
        <div class="col-sum">${fmtK(sum)} total</div>
        ${col.map(d => `<div class="deal" data-id="${d.id}" tabindex="0" role="button" aria-label="Open ${d.client}">
            <b>${d.client}</b>
            <div class="meta">${labCell(d.lab)}</div>
            <div class="amt">${fmt$(d.amount)}</div>
            <div class="foot">${faceHTML(PEOPLE[d.owner])} ${PEOPLE[d.owner].name.split(" ")[0]} · closes ${d.close.slice(5).replace("-", "/")}
              ${d.stage === "Closed" ? `<span class="badge ${stageClass(d)}" style="margin-left:auto"><i></i>${d.outcome}</span>` : d.recurring ? '<span class="rec">↻ RECURRING</span>' : ""}</div>
          </div>`).join("") || '<div class="empty" style="padding:18px 0;font-size:12px">No deals</div>'}
      </div>`;
    }).join("");
    document.getElementById("pipeCount").textContent = ROLE === "Contributor"
      ? "Deal visibility is Lab-Leader/Admin only in this build (PRD open question: view-only access for contributors)."
      : ds.length + " deals · " + fmt$(ds.reduce((s, d) => s + d.amount, 0)) + " total across all stages · click a card to open it";
  };
  labSel.onchange = ownerSel.onchange = draw;
  document.getElementById("fSearch").oninput = draw;
  document.getElementById("board").addEventListener("click", e => {
    const card = e.target.closest(".deal");
    if (card) openDealDrawer(card.dataset.id, draw);
  });
  document.getElementById("board").addEventListener("keydown", e => {
    const card = e.target.closest(".deal");
    if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDealDrawer(card.dataset.id, draw); }
  });
  draw();
}

/* ---------- proposals: see assets/proposals.js (editor, send, AI assist) ---------- */

/* ---------- invoices ---------- */
function renderInvoices() {
  const draw = () => {
    const invs = visibleInvoices();
    document.getElementById("invRows").innerHTML = invs.length ? invs.map(i => {
      const next = i.status === "Admin review" ? "Sent to client" : i.status === "Sent to client" ? "Paid" : null;
      const action = can.reviewInvoices() && next
        ? `<button class="btn-mini" data-inv="${i.id}" data-next="${next}">Mark ${next.toLowerCase()}</button>` : "";
      return `<tr>
        <td><b>${i.client}</b><br><small style="color:var(--ink-mute)">${i.id} · deal ${i.deal}</small></td>
        <td>${labCell(i.lab)}</td>
        <td>${personCell(i.requestedBy)}</td>
        <td class="amount">${fmt$(i.amount)}</td>
        <td>${i.recurring ? '<span class="badge b-recurring">↻ Monthly</span>' : '<span class="badge b-draft">One-time</span>'}</td>
        <td><span class="badge ${INVOICE_CLASS[i.status]}"><i></i>${i.status}</span> ${action}</td>
        <td>${i.date}</td>
      </tr>`;
    }).join("") : '<tr><td colspan="7" class="empty">No invoice requests visible for this role.</td></tr>';
  };
  document.getElementById("invRows").addEventListener("click", async e => {
    const b = e.target.closest("[data-inv]");
    if (!b) return;
    b.disabled = true;
    try { await setInvoiceStatus(b.dataset.inv, b.dataset.next); } catch (ex) { alert(ex.message); }
    draw();
  });
  draw();
}

/* ---------- bench: see assets/bench.js (directory + profile editor) ---------- */
