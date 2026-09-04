/* OL Portal · Companies and Contacts (Pipeline v2 billing entities).

   These are the organizations and individuals a deal bills to — separate from
   PERSON, which is OL's own staff directory. A Contributor has no pipeline
   visibility at all and never sees these.

   A billing entity carries no `lab` of its own — any deal, in any lab, can
   bill to any of them — so a Lab Leader's slice of them cannot be a stored
   field and is derived instead: see labScope below. That derivation is the
   whole tenant boundary for these two record types, so every read and every
   write goes through it, including the deal-attach validation in app.mjs.

   Companies have no delete endpoint: the design never exposes one (only
   "remove from this deal", which just clears the deal's companyId). A contact
   does — see deleteContact, which refuses while a deal still points at it. */

import { resp, today, get, put, del, listType, nextId } from "./util.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Allows an optional leading "+" for international numbers, plus digits and
// common formatting characters (spaces, dashes, dots, parens).
const PHONE_CHARS_RE = /^\+?[\d\s().-]+$/;
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function cleanEmail(v) {
  const email = str(v, 200);
  if (email && !EMAIL_RE.test(email)) return { error: "invalid email" };
  return { value: email };
}

// A person's phone is optional, but when given must be a real number: at
// least 10 significant digits (a bare US number) and no more than 15
// (E.164's max), once formatting characters are stripped out.
function cleanPhone(v) {
  const phone = str(v, 40);
  if (!phone) return { value: "" };
  if (!PHONE_CHARS_RE.test(phone)) return { error: "invalid phone number" };
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return { error: "phone number must have at least 10 digits" };
  if (digits.length > 15) return { error: "phone number is too long" };
  return { value: phone };
}

/* ---------- lab scope ----------

   Which client records a caller's pipeline reaches.

   The seed is every deal the caller can see, using the SAME predicate
   app.mjs's /deals uses — ctx.can.seesLab, plus PRD 3.3's "a deal you lead in
   another lab" — so the Companies/People tabs and the board can never disagree
   about whose deals these are.

   One hop out from that seed, and no further: a visible company's primary
   contact, and the company a visible contact works at. Both are rendered
   (the Companies table's "Primary contact" column, billingOf's "· Acme Corp"
   subtitle, the record drawer), and an id that resolves to nothing reads as a
   broken record rather than as a hidden one.

   Plus whatever the caller created that no deal points at yet. The billing
   entity panel creates a company before it links one, so without this a
   just-typed client would vanish on the next refresh. Records written before
   `createdBy` existed carry none and are reachable only through a deal, which
   is the safe direction to fail.

   Returns `null` for a caller who sees every client record (an Admin) —
   meaning no filter at all, not an empty one. */
export async function labScope(ctx) {
  if (ctx.can.seesEveryClientRecord()) return null;

  const [deals, companies, contacts] = await Promise.all([
    listType("DEAL"), listType("COMPANY"), listType("CONTACT")
  ]);
  const mine = deals.filter(d => ctx.can.seesLab(d.lab) || ctx.can.leadsDeal(d));

  const companyIds = new Set(mine.map(d => d.companyId).filter(Boolean));
  const contactIds = new Set(mine.map(d => d.contactId).filter(Boolean));
  for (const c of companies) if (companyIds.has(c.sk) && c.contactId) contactIds.add(c.contactId);
  for (const c of contacts) if (contactIds.has(c.sk) && c.companyId) companyIds.add(c.companyId);
  for (const c of companies) if (c.createdBy && c.createdBy === ctx.me.sk) companyIds.add(c.sk);
  for (const c of contacts) if (c.createdBy && c.createdBy === ctx.me.sk) contactIds.add(c.sk);

  return { companies: companyIds, contacts: contactIds };
}

/** Whether `id` is inside a scope from labScope. A null scope contains
 *  everything. Exported because app.mjs asks it about a deal's companyId and
 *  contactId — attaching an out-of-scope entity to a deal you own would
 *  otherwise pull that entity into your scope, which is the same leak by a
 *  slower route. */
export const inScope = (scope, kind, id) => !scope || scope[kind].has(id);

/* An out-of-scope record answers exactly as a missing one does. A 403 would
   confirm that the id names something real, which is the one fact this
   boundary exists to withhold. */
const NO_COMPANY = { error: "company not found" };
const NO_CONTACT = { error: "contact not found" };

/* ---------- companies ---------- */

export async function listCompanies(ctx) {
  if (!ctx.can.manageContacts()) return resp(200, []);
  const scope = await labScope(ctx);
  const items = (await listType("COMPANY")).filter(c => inScope(scope, "companies", c.sk));
  items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return resp(200, items.map(({ pk, sk, ...rest }) => ({ id: sk, ...rest })));
}

export async function createCompany(ctx, body) {
  if (!ctx.can.manageContacts()) return resp(403, { error: "Not allowed to add companies" });
  const b = body || {};
  const name = str(b.name, 200);
  if (!name) return resp(400, { error: "name is required" });
  const email = cleanEmail(b.email);
  if (email.error) return resp(400, { error: email.error });
  const scope = await labScope(ctx);
  // A contact outside the caller's scope is "unknown", not "forbidden" —
  // naming one must not confirm it exists.
  if (b.contactId && (!(await get("CONTACT", b.contactId)) || !inScope(scope, "contacts", b.contactId)))
    return resp(400, { error: "unknown contact" });

  const id = await nextId("COMPANY", "CO-");
  const stamp = today();
  const company = {
    pk: "COMPANY", sk: id, name, kind: str(b.kind, 200),
    phone: str(b.phone, 40), email: email.value,
    contactId: b.contactId || null,
    // What keeps a just-created record in its author's scope until a deal
    // points at it — see labScope.
    createdBy: ctx.me.sk,
    created: stamp, updated: stamp
  };
  await put(company);
  const { pk, sk, ...rest } = company;
  return resp(201, { id: sk, ...rest });
}

export async function updateCompany(ctx, id, body) {
  if (!ctx.can.manageContacts()) return resp(403, { error: "Not allowed to edit companies" });
  const c = await get("COMPANY", id);
  if (!c) return resp(404, NO_COMPANY);
  const scope = await labScope(ctx);
  if (!inScope(scope, "companies", id)) return resp(404, NO_COMPANY);
  const b = body || {};
  const patch = {};
  if ("name" in b) {
    const name = str(b.name, 200);
    if (!name) return resp(400, { error: "name is required" });
    patch.name = name;
  }
  if ("kind" in b) patch.kind = str(b.kind, 200);
  if ("phone" in b) patch.phone = str(b.phone, 40);
  if ("email" in b) {
    const email = cleanEmail(b.email);
    if (email.error) return resp(400, { error: email.error });
    patch.email = email.value;
  }
  if ("contactId" in b) {
    if (b.contactId && (!(await get("CONTACT", b.contactId)) || !inScope(scope, "contacts", b.contactId)))
      return resp(400, { error: "unknown contact" });
    patch.contactId = b.contactId || null;
  }
  const next = { ...c, ...patch, updated: today() };
  await put(next);
  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest });
}

/* ---------- contacts (people who work at companies, or bill directly) ---------- */

export async function listContacts(ctx) {
  if (!ctx.can.manageContacts()) return resp(200, []);
  const scope = await labScope(ctx);
  const items = (await listType("CONTACT")).filter(c => inScope(scope, "contacts", c.sk));
  items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return resp(200, items.map(({ pk, sk, ...rest }) => ({ id: sk, ...rest })));
}

export async function createContact(ctx, body) {
  if (!ctx.can.manageContacts()) return resp(403, { error: "Not allowed to add contacts" });
  const b = body || {};
  const name = str(b.name, 200);
  if (!name) return resp(400, { error: "name is required" });
  const email = cleanEmail(b.email);
  if (email.error) return resp(400, { error: email.error });
  const phone = cleanPhone(b.phone);
  if (phone.error) return resp(400, { error: phone.error });
  const scope = await labScope(ctx);
  if (b.companyId && (!(await get("COMPANY", b.companyId)) || !inScope(scope, "companies", b.companyId)))
    return resp(400, { error: "unknown company" });

  const id = await nextId("CONTACT", "CT-");
  const stamp = today();
  const contact = {
    pk: "CONTACT", sk: id, name, title: str(b.title, 120),
    companyId: b.companyId || null,
    phone: phone.value, email: email.value,
    createdBy: ctx.me.sk,
    created: stamp, updated: stamp
  };
  await put(contact);
  // A newly-created contact becomes its company's primary contact when it
  // doesn't have one yet — mirrors the design's inline-create behavior.
  if (contact.companyId) {
    const company = await get("COMPANY", contact.companyId);
    if (company && !company.contactId) await put({ ...company, contactId: contact.sk, updated: stamp });
  }
  const { pk, sk, ...rest } = contact;
  return resp(201, { id: sk, ...rest });
}

export async function updateContact(ctx, id, body) {
  if (!ctx.can.manageContacts()) return resp(403, { error: "Not allowed to edit contacts" });
  const c = await get("CONTACT", id);
  if (!c) return resp(404, NO_CONTACT);
  const scope = await labScope(ctx);
  if (!inScope(scope, "contacts", id)) return resp(404, NO_CONTACT);
  const b = body || {};
  const patch = {};
  if ("name" in b) {
    const name = str(b.name, 200);
    if (!name) return resp(400, { error: "name is required" });
    patch.name = name;
  }
  if ("title" in b) patch.title = str(b.title, 120);
  if ("phone" in b) {
    const phone = cleanPhone(b.phone);
    if (phone.error) return resp(400, { error: phone.error });
    patch.phone = phone.value;
  }
  if ("email" in b) {
    const email = cleanEmail(b.email);
    if (email.error) return resp(400, { error: email.error });
    patch.email = email.value;
  }
  if ("companyId" in b) {
    if (b.companyId && (!(await get("COMPANY", b.companyId)) || !inScope(scope, "companies", b.companyId)))
      return resp(400, { error: "unknown company" });
    patch.companyId = b.companyId || null;
  }
  const next = { ...c, ...patch, updated: today() };
  await put(next);
  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest });
}

/* A person can be deleted, but never out from under a deal. A deal past the
   billing gate must have a company or a contact (app.mjs enforces that on
   every write), so removing the person a deal points at would leave it
   billable to nobody — and the deal, not the contact, is the record that
   matters. The blocking deals come back with the refusal so the UI can say
   which ones to detach first rather than just saying no. */
export async function deleteContact(ctx, id) {
  if (!ctx.can.manageContacts()) return resp(403, { error: "Not allowed to delete contacts" });
  const c = await get("CONTACT", id);
  if (!c) return resp(404, NO_CONTACT);
  const scope = await labScope(ctx);
  if (!inScope(scope, "contacts", id)) return resp(404, NO_CONTACT);

  const onDeals = (await listType("DEAL")).filter(d => d.contactId === id);
  if (onDeals.length) {
    const n = onDeals.length;
    /* The count is every deal, so a deal in a lab the caller cannot see still
       blocks the delete — the refusal has to be right about the data, not
       about the caller. The list is only the deals they can see, because it
       names clients: "on 2 deals" with one listed says go look, without
       saying whose the other one is. */
    const namable = onDeals.filter(d => ctx.can.seesLab(d.lab) || ctx.can.leadsDeal(d));
    return resp(409, {
      error: `${c.name} is the person on ${n} ${n === 1 ? "deal" : "deals"} and can't be deleted — ` +
        `${n === 1 ? "it" : "they"} would be left without a person. ` +
        `Remove ${c.name} from ${n === 1 ? "that deal" : "those deals"} first.`,
      deals: namable.map(d => ({ id: d.sk, client: d.client }))
    });
  }

  // A company naming this person as its primary contact would be left holding
  // a dangling id, which reads in the UI as a contact that cannot be opened.
  const stamp = today();
  for (const company of await listType("COMPANY"))
    if (company.contactId === id) await put({ ...company, contactId: null, updated: stamp });

  await del("CONTACT", id);
  return resp(200, { deleted: id });
}
