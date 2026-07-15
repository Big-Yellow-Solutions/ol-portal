/* OL Portal · bench profiles (PRD 4.1-4.2). Everyone edits their own profile;
   admins can edit any. Contact visibility answers the PRD's open question with
   per-person opt-in: email shows by default (work address, people need to be
   reachable), phone stays hidden until its owner turns it on. The filtering
   happens server-side in bootstrap, so hidden contact info never leaves the API. */

import { resp, get, put } from "./util.mjs";
import { writeAudit } from "./admin.mjs";

const MAX_PHOTO_CHARS = 80_000; // ~60KB image, safe inside the DynamoDB item cap

function cleanSpecialties(input) {
  if (!Array.isArray(input)) return null;
  const out = [...new Set(input.map(s => String(s).trim()).filter(Boolean))]
    .slice(0, 10).map(s => s.slice(0, 40));
  return out;
}

export async function updateProfile(ctx, username, body) {
  const target = (username || ctx.me.sk).toLowerCase();
  if (target !== ctx.me.sk && ctx.role !== "Admin")
    return resp(403, { error: "You can only edit your own profile" });
  const person = await get("PERSON", target);
  if (!person) return resp(404, { error: "no such person" });

  const bench = { ...(person.bench || {}) };
  const b = body || {};

  if ("specialties" in b) {
    const s = cleanSpecialties(b.specialties);
    if (!s) return resp(400, { error: "specialties must be a list of short tags" });
    bench.specialties = s;
  }
  if ("blurb" in b) {
    if (typeof b.blurb !== "string") return resp(400, { error: "invalid blurb" });
    bench.blurb = b.blurb.trim().slice(0, 500);
  }
  if ("linkedin" in b) {
    const v = String(b.linkedin || "").trim().slice(0, 200);
    if (v && !/^https:\/\//.test(v)) return resp(400, { error: "LinkedIn link must start with https://" });
    bench.linkedin = v;
  }
  if ("email" in b) {
    const v = String(b.email || "").trim();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return resp(400, { error: "invalid email" });
    bench.email = v;
  }
  if ("phone" in b) {
    const v = String(b.phone || "").trim().slice(0, 40);
    if (v && !/^[\d\s()+.-]+$/.test(v)) return resp(400, { error: "invalid phone number" });
    bench.phone = v;
  }
  if ("showEmail" in b) bench.showEmail = !!b.showEmail;
  if ("showPhone" in b) bench.showPhone = !!b.showPhone;

  const next = { ...person, bench };
  if ("photo" in b) {
    const v = String(b.photo || "");
    if (v && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v))
      return resp(400, { error: "photo must be an uploaded image" });
    if (v.length > MAX_PHOTO_CHARS) return resp(400, { error: "photo too large — it should compress under 60KB" });
    if (v) next.photo = v; else delete next.photo;
  }

  await put(next);
  if (target !== ctx.me.sk) await writeAudit(ctx.me.sk, "profile.admin-edited", target);
  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest });
}

/* Applied to every person in bootstrap for non-admin viewers (self excluded):
   root email (auth/invite address) is admin-only, bench email hides when
   opted out, phone hides unless opted in. */
export function publicView(person, viewerKey, viewerRole, personKey) {
  if (viewerRole === "Admin" || personKey === viewerKey) return person;
  const { email, ...rest } = person;
  if (rest.bench) {
    const b = { ...rest.bench };
    if (b.showEmail === false) delete b.email;
    if (b.showPhone !== true) delete b.phone;
    delete b.showEmail; delete b.showPhone;
    rest.bench = b;
  }
  return rest;
}
