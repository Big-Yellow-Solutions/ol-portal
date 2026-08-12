/* OL Portal · welcome / profile setup. Step two of the invite flow: Cognito
   handles the account and the password, this collects the photo, specialties
   and blurb that make someone findable on the bench. New accounts land here
   once (store.js routes them); finishing sets PERSON.onboarded and it never
   shows again. Skipping is allowed — the dashboard keeps nudging until the
   profile has something in it. */

async function renderWelcome() {
  requireAuth();
  const card = document.getElementById("welCard");
  try {
    await loadPortalData();
  } catch (e) {
    card.innerHTML = `<h1>Couldn't load your profile</h1>
      <p class="lead">${e.message}</p><a class="wel-skip" href="login.html">Sign in again</a>`;
    return;
  }

  const me = PEOPLE[ME];
  const b = me.bench || {};
  const labs = (me.labs || []).map(k => LABS[k]?.name || k).join(", ");

  card.innerHTML = `
    <img class="logo" src="assets/ol-logo.svg" alt="Optimistic Labs">
    <h1>Welcome, ${me.firstName}</h1>
    <p class="lead">Your account is set. This is the part other people see: it puts you on the
      bench directory so the right work finds you. Two minutes, and you can change any of it later.</p>

    <div class="wel-photo">
      <span id="welFace">${faceHTML(me)}</span>
      <div>
        <button class="btn-mini" id="welPick" type="button">Add a photo</button>
        ${me.photo ? '<button class="btn-mini" id="welClear" type="button">Remove</button>' : ""}
        <div><small class="hint">${me.role}${labs ? " · " + labs : ""}</small></div>
      </div>
      <input id="welFile" type="file" accept="image/*" style="display:none">
    </div>

    <label class="field">What should people engage you for?
      <textarea id="welBlurb" rows="3" maxlength="500"
        placeholder="e.g. Capital campaigns for faith-based organizations, especially the messy first 90 days.">${b.blurb || ""}</textarea>
      <small class="hint">Plain language beats a job title. Up to 500 characters.</small></label>

    <label class="field">Specialties
      <input id="welSpecs" value="${(b.specialties || []).join(", ")}" placeholder="grant writing, board development, faith-based orgs">
      <small class="hint">Comma-separated, up to 10. These become the filter chips on the bench.</small></label>

    <div class="wel-two">
      <label class="field">Email
        <input id="welEmail" value="${b.email || me.email || ""}" placeholder="you@optimisticlabs.com"></label>
      <label class="field">Phone
        <input id="welPhone" value="${b.phone || ""}" placeholder="(555) 555-5555"></label>
    </div>
    <label class="field">LinkedIn
      <input id="welLinkedin" value="${b.linkedin || ""}" placeholder="https://linkedin.com/in/…"></label>

    <div class="field">Who can see your contact details
      <label class="field wel-check"><input id="welShowEmail" type="checkbox" ${b.showEmail !== false ? "checked" : ""}>
        Show my email to everyone in the portal</label>
      <label class="field wel-check"><input id="welShowPhone" type="checkbox" ${b.showPhone === true ? "checked" : ""}>
        Show my phone to everyone in the portal</label>
      <small class="hint">Off means it never leaves the server. Admins can always reach you.</small></div>

    <div class="wel-err" id="welErr" role="alert"></div>
    <div class="wel-foot">
      <a class="wel-skip" href="#" id="welSkip">Skip for now</a>
      <button class="wel-btn" id="welSave">Finish setup</button>
    </div>`;

  const $ = s => document.getElementById(s);
  let photo; // undefined = unchanged, "" = remove, string = new data URL

  $("welPick").onclick = () => $("welFile").click();
  if ($("welClear")) $("welClear").onclick = () => {
    photo = "";
    $("welFace").innerHTML = `<span class="face">${initials(me)}</span>`;
  };
  $("welFile").addEventListener("change", async e => {
    if (!e.target.files[0]) return;
    try {
      photo = await readPhoto(e.target.files[0]); // shared with the bench editor
      $("welFace").innerHTML = `<img src="${photo}" alt="">`;
    } catch (ex) { $("welErr").textContent = ex.message; }
  });

  $("welSkip").onclick = e => {
    e.preventDefault();
    localStorage.setItem(WELCOME_SKIPPED, "1");
    location.href = "index.html";
  };

  $("welSave").onclick = async e => {
    e.target.disabled = true;
    $("welErr").textContent = "";
    const fields = {
      specialties: $("welSpecs").value.split(",").map(s => s.trim()).filter(Boolean),
      blurb: $("welBlurb").value,
      linkedin: $("welLinkedin").value.trim(),
      email: $("welEmail").value.trim(),
      phone: $("welPhone").value.trim(),
      showEmail: $("welShowEmail").checked,
      showPhone: $("welShowPhone").checked,
      onboarded: true
    };
    if (photo !== undefined) fields.photo = photo;
    try {
      await updateProfileApi(fields);
      localStorage.removeItem(WELCOME_SKIPPED);
      location.href = "index.html";
    } catch (ex) {
      $("welErr").textContent = ex.message;
      e.target.disabled = false;
    }
  };
}

/* Downscale a chosen image client-side so it stores as a small data URL.
   Duplicated from bench.js so this page doesn't have to pull in the whole
   bench renderer; keep the two in step if the size cap changes. */
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
