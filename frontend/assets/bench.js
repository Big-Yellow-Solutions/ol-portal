/* OL Portal · bench directory (PRD 4). Org-wide by design: every Lab Leader
   and Contributor is listed. Everyone edits their own profile; admins can fix
   anyone's. Email shows unless its owner hides it; phone only shows once its
   owner opts in (the server enforces this — hidden contacts never arrive). */

function renderBench() {
  const chipRow = document.getElementById("benchChips");
  const labKeys = Object.keys(LABS);

  const buildChips = () => {
    const allTags = [...new Set(BENCH.flatMap(b => b.specialties))].sort();
    chipRow.innerHTML = '<button class="chip on" data-t="">Everyone</button>' +
      '<button class="chip" data-t="__ll">Lab Leaders</button><button class="chip" data-t="__sc">Contributors</button>' +
      labKeys.map(k => `<button class="chip" data-t="__lab:${k}">${LABS[k].name}</button>`).join("") +
      allTags.map(t => `<button class="chip" data-t="${t}">${t}</button>`).join("");
  };

  const draw = () => {
    const active = chipRow.querySelector(".chip.on")?.dataset.t || "";
    const q = document.getElementById("benchSearch").value.trim().toLowerCase();
    const list = BENCH.filter(b => {
      const p = PEOPLE[b.key];
      if (!p) return false;
      if (active === "__ll" && p.role !== "Lab Leader") return false;
      if (active === "__sc" && p.role !== "Contributor") return false;
      if (active.startsWith("__lab:") && !(p.labs || []).includes(active.slice(6))) return false;
      if (active && !active.startsWith("__") && !b.specialties.includes(active)) return false;
      return !q || p.name.toLowerCase().includes(q) || (b.blurb || "").toLowerCase().includes(q) ||
        b.specialties.some(t => t.toLowerCase().includes(q));
    });
    document.getElementById("benchGrid").innerHTML = list.map(b => {
      const p = PEOPLE[b.key];
      const labs = (p.labs || []).map(k => LABS[k]?.name || k).join(", ");
      const links = [
        b.email ? `<a href="mailto:${b.email}">Email</a>` : "",
        b.phone ? `<a href="tel:${b.phone.replace(/[^\d+]/g, "")}">${b.phone}</a>` : "",
        b.linkedin ? `<a href="${b.linkedin}" target="_blank" rel="noopener">LinkedIn</a>` : ""
      ].filter(Boolean).join("");
      const mine = b.key === ME;
      return `<div class="card person">
        <div class="top-row">${faceHTML(p)}
          <div style="flex:1"><h3>${p.name}</h3><div class="role-line">${p.role}${labs ? " · " + labs : ""}</div></div>
          ${(mine || ROLE === "Admin") ? `<button class="btn-mini" data-edit="${b.key}" title="${mine ? "Edit my profile" : "Admin: edit profile"}">✎</button>` : ""}
        </div>
        <p class="blurb">${b.blurb || '<span style="color:var(--ink-mute)">No profile yet' + (mine ? " — add what people should engage you for." : ".") + "</span>"}</p>
        <div class="tags">${b.specialties.map(t => `<span class="tag">${t}</span>`).join("")}</div>
        <div class="links">${links || '<span style="color:var(--ink-mute);font-size:12px">No contact info shared</span>'}</div>
      </div>`;
    }).join("") || '<div class="empty">No one matches that filter.</div>';
  };

  const redraw = () => { buildChips(); draw(); };

  chipRow.addEventListener("click", e => {
    const c = e.target.closest(".chip"); if (!c) return;
    chipRow.querySelectorAll(".chip").forEach(x => x.classList.remove("on"));
    c.classList.add("on"); draw();
  });
  document.getElementById("benchSearch").oninput = draw;
  document.getElementById("benchGrid").addEventListener("click", e => {
    const b = e.target.closest("[data-edit]");
    if (b) openProfileEditor(b.dataset.edit, redraw);
  });

  const myBench = BENCH.some(b => b.key === ME);
  if (myBench) {
    const btn = document.createElement("button");
    btn.className = "pill pill-primary";
    btn.textContent = "Edit my profile";
    btn.style.flexShrink = "0";
    btn.onclick = () => openProfileEditor(ME, redraw);
    document.querySelector(".controls").appendChild(btn);
  }
  redraw();
}

/* Downscale the chosen image client-side so it stores as a small data URL. */
function readPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const S = 160, c = document.createElement("canvas");
      const scale = Math.max(S / img.width, S / img.height);
      c.width = Math.min(img.width, Math.round(img.width * scale));
      c.height = Math.min(img.height, Math.round(img.height * scale));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => reject(new Error("Couldn't read that image"));
    img.src = URL.createObjectURL(file);
  });
}

function openProfileEditor(key, onDone) {
  const p = PEOPLE[key];
  const b = p.bench || {};
  const mine = key === ME;
  const back = overlay(`
    <div class="modal-head">
      <div><h2>${mine ? "My profile" : p.name}</h2>
        <small class="drawer-sub">Shown to everyone in the portal on the bench directory.</small></div>
      <button class="x" aria-label="Close">×</button>
    </div>
    <div class="f-grid">
      <div class="field">Photo
        <div style="display:flex;align-items:center;gap:10px" id="pfFaceWrap">
          <span id="pfFace">${faceHTML(p)}</span>
          <button class="btn-mini" id="pfPickPhoto" type="button">Change</button>
          ${p.photo ? '<button class="btn-mini" id="pfClearPhoto" type="button">Remove</button>' : ""}
          <input id="pfPhotoFile" type="file" accept="image/*" style="display:none">
        </div></div>
      <label class="field">Specialties (comma-separated tags)
        <input id="pfSpecs" value="${(b.specialties || []).join(", ")}" placeholder="grant writing, faith-based orgs"></label>
      <label class="field f-wide">"Engage me for" blurb
        <textarea id="pfBlurb" rows="3" maxlength="500" placeholder="When and why should someone bring you in?"
          style="font:inherit;padding:10px 12px;border:1.5px solid #ddd7ce;border-radius:9px;resize:vertical">${b.blurb || ""}</textarea></label>
      <label class="field">LinkedIn
        <input id="pfLinkedin" value="${b.linkedin || ""}" placeholder="https://linkedin.com/in/…"></label>
      <label class="field">Email
        <input id="pfEmail" value="${b.email || ""}" placeholder="you@optimisticlabs.com"></label>
      <label class="field">Phone
        <input id="pfPhone" value="${b.phone || ""}" placeholder="(555) 555-5555"></label>
      <div class="field">Contact visibility
        <label class="field f-check" style="margin:4px 0 0"><input id="pfShowEmail" type="checkbox" ${b.showEmail !== false ? "checked" : ""}>
          Show my email org-wide</label>
        <label class="field f-check" style="margin:2px 0 0"><input id="pfShowPhone" type="checkbox" ${b.showPhone === true ? "checked" : ""}>
          Show my phone org-wide (off until you opt in)</label></div>
    </div>
    <div class="modal-foot">
      <button class="pill pill-outline" id="pfCancel">Cancel</button>
      <button class="pill pill-primary" id="pfSave">Save profile</button>
    </div>`, "modal");

  let photo; // undefined = unchanged, "" = remove, string = new data URL
  const $$ = s => back.querySelector(s);
  $$(".x").onclick = $$("#pfCancel").onclick = () => back.remove();
  $$("#pfPickPhoto").onclick = () => $$("#pfPhotoFile").click();
  const clearBtn = $$("#pfClearPhoto");
  if (clearBtn) clearBtn.onclick = () => { photo = ""; $$("#pfFace").innerHTML = `<span class="face">${initials(p.name)}</span>`; };
  $$("#pfPhotoFile").addEventListener("change", async e => {
    if (!e.target.files[0]) return;
    try {
      photo = await readPhoto(e.target.files[0]);
      $$("#pfFace").innerHTML = `<img src="${photo}" alt="">`;
    } catch (ex) { alert(ex.message); }
  });
  $$("#pfSave").onclick = async e => {
    e.target.disabled = true;
    const fields = {
      specialties: $$("#pfSpecs").value.split(",").map(s => s.trim()).filter(Boolean),
      blurb: $$("#pfBlurb").value,
      linkedin: $$("#pfLinkedin").value.trim(),
      email: $$("#pfEmail").value.trim(),
      phone: $$("#pfPhone").value.trim(),
      showEmail: $$("#pfShowEmail").checked,
      showPhone: $$("#pfShowPhone").checked
    };
    if (photo !== undefined) fields.photo = photo;
    try {
      await updateProfileApi(fields, mine ? undefined : key);
      BENCH.length = 0;
      BENCH.push(...Object.entries(PEOPLE)
        .filter(([, x]) => x.role === "Lab Leader" || x.role === "Contributor" || x.bench)
        .map(([k, x]) => ({ key: k, specialties: [], blurb: "", ...(x.bench || {}) })));
      back.remove();
      onDone && onDone();
    } catch (ex) { alert(ex.message); e.target.disabled = false; }
  };
}
