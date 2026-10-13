/* The planning half of the backfill importer: CSV rows in, the exact records
   to write out. No AWS here — scripts/import-backfill.mjs reads the table,
   hands what it found to plan(), and writes what plan() decides. That split is
   what lets tests/backfill.test.mjs run the whole decision against fixtures.

   Record shapes mirror createCompany, createContact and createDeal in
   src/contacts.mjs and src/app.mjs, and the validation mirrors theirs, so an
   imported record is indistinguishable from one made in the portal. The
   difference is deliberate: nothing here goes through the stage gates. A deal
   imported as Closed with no invoice file is the point of a backfill, not a
   bug — the same stance import-hubspot-companies.mjs takes.

   Stage names. The portal stores Proposal Sent, Contracted and Closed and
   shows them as Proposal & Negotiation, Contracted (Signed) and Closed Won
   (Paid) (web/lib/types.ts). A CSV may use either spelling. */

/* ---------- CSV (RFC 4180: quoted fields, doubled quotes, commas in quotes) ---------- */

export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter(r => r.some(c => c.trim()));
  if (!header) return { header: [], rows: [] };
  const keys = header.map(h => h.trim().toLowerCase());
  return {
    header: keys,
    rows: body.map((r, i) => ({
      line: i + 2,
      ...Object.fromEntries(keys.map((k, j) => [k, (r[j] ?? "").trim()]))
    }))
  };
}

/* ---------- validation, mirroring src/contacts.mjs ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS_RE = /^\+?[\d\s().-]+$/;

const cleanEmail = v => {
  const e = (v || "").trim().toLowerCase().slice(0, 200);
  return e && !EMAIL_RE.test(e) ? { error: `invalid email "${v}"` } : { value: e };
};
const cleanWebsite = v => {
  const site = (v || "").trim().slice(0, 300);
  if (!site) return { value: "" };
  try {
    const url = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
    if (/\s/.test(site) || !url.hostname.includes(".")) throw new Error();
  } catch { return { error: `invalid website "${v}"` }; }
  return { value: site };
};
const cleanPhone = v => {
  const phone = (v || "").trim().slice(0, 40);
  if (!phone) return { value: "" };
  if (!PHONE_CHARS_RE.test(phone)) return { error: `invalid phone "${v}"` };
  const digits = phone.replace(/\D/g, "").length;
  if (digits < 10 || digits > 15) return { error: `phone "${v}" needs 10–15 digits` };
  return { value: phone };
};

/* ---------- deal vocabulary ---------- */

export const SOURCES = ["Referral", "Inbound", "Network", "Event", "Outbound"];
export const STORED_STAGES = ["Lead", "Discovery", "Proposal Sent", "Contracted", "Closed", "Closed Lost"];

const STAGE_ALIASES = {
  "lead": "Lead",
  "discovery": "Discovery",
  "proposal sent": "Proposal Sent",
  "proposal & negotiation": "Proposal Sent",
  "proposal and negotiation": "Proposal Sent",
  "contracted": "Contracted",
  "contracted (signed)": "Contracted",
  "contracted won": "Contracted",
  "closed": "Closed",
  "closed won": "Closed",
  "closed won (paid)": "Closed",
  "closed lost": "Closed Lost"
};
const outcomeOf = stage => (stage === "Closed" ? "Won" : stage === "Closed Lost" ? "Lost" : null);
const stageIndex = s => STORED_STAGES.indexOf(s);
/* From here a deal must be billable, unless it was lost: app.mjs's
   BILLING_GATE_STAGE. */
const needsBillingEntity = stage => stage !== "Closed Lost" && stageIndex(stage) >= stageIndex("Proposal Sent");

const SOURCE_BY_LOWER = Object.fromEntries(SOURCES.map(s => [s.toLowerCase(), s]));

/* "The Independent Center" and "Independent Center" are one company; so are
   "SixDegrees.org" and "sixdegrees org". */
export const normName = s =>
  String(s || "").toLowerCase().replace(/&/g, " and ").replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ").trim();

/* "Optimistic Democracy Lab" should find a lab called "Democracy" or
   "Democracy Lab" or one whose id is "democracy". */
const labCore = s => normName(s).replace(/^optimistic\s+/, "").replace(/\s+lab$/, "").trim();

const parseMoney = v => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/* ISO as is, or US month/day/year — the spreadsheet default. Returns null for
   anything else, including a date that does not exist (2/30). */
export function parseDate(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  let y, m, d, hit;
  if ((hit = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, m, d] = hit.map(Number);
  else if ((hit = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [, m, d, y] = hit.map(Number);
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const truthy = v => ["yes", "y", "true", "1"].includes(String(v || "").trim().toLowerCase());

const REQUIRED = {
  companies: ["name"],
  contacts: ["name"],
  deals: ["client", "lab", "stage", "amount", "source", "owner_email"]
};

/* ---------- the plan ---------- */

/**
 * @param {{companies: object[], contacts: object[], deals: object[]}} csv  parsed rows (parseCsv().rows)
 * @param {{header?: Record<string,string[]>}} headers  optional, to catch missing columns
 * @param {{labs, people, companies, contacts, deals}} existing  what the table holds now
 * @param {{actor: string, today: string}} ctx
 * @returns {{ errors: string[], warnings: string[], skipped: string[], writes: object[], updates: object[], summary: object }}
 *   writes are whole records to put (never over an existing key); updates are
 *   {pk, sk, set} patches to existing records.
 */
export function plan(csv, headers, existing, ctx) {
  const errors = [], warnings = [], skipped = [];
  const err = (kind, row, msg) => errors.push(`${kind} line ${row.line}${row.name || row.client ? ` (${row.name || row.client})` : ""}: ${msg}`);
  const warn = (kind, row, msg) => warnings.push(`${kind} line ${row.line}${row.name || row.client ? ` (${row.name || row.client})` : ""}: ${msg}`);

  for (const [kind, cols] of Object.entries(REQUIRED)) {
    const have = headers?.[kind];
    if (!have) continue;
    for (const c of cols) if (!have.includes(c)) errors.push(`${kind}.csv has no "${c}" column`);
  }
  if (errors.length) return { errors, warnings, skipped, writes: [], updates: [], summary: {} };

  const nextNo = {};
  const counter = (pk, prefix, items) => {
    nextNo[pk] = items.reduce((m, x) => Math.max(m, parseInt(String(x.sk).replace(/\D/g, ""), 10) || 0), 0);
    return () => prefix + String(++nextNo[pk]).padStart(3, "0");
  };
  const newCompanyId = counter("COMPANY", "CO-", existing.companies);
  const newContactId = counter("CONTACT", "CT-", existing.contacts);
  const newDealId = counter("DEAL", "D-", existing.deals);

  const writes = [], updates = [];
  const summary = { companies: { new: 0, existing: 0 }, contacts: { new: 0, existing: 0 }, deals: { new: 0, existing: 0 } };

  /* ----- people and labs, to resolve deal fields against ----- */
  const personKey = Object.create(null);
  for (const p of existing.people) {
    personKey[String(p.sk).toLowerCase()] = p;
    if (p.email) personKey[String(p.email).toLowerCase()] = p;
  }
  const actor = personKey[ctx.actor.toLowerCase()];
  if (!actor) errors.push(`--as ${ctx.actor} is not a portal user`);

  const labFor = name => {
    const want = labCore(name);
    if (!want) return null;
    return existing.labs.find(l => String(l.sk).toLowerCase() === String(name).toLowerCase()) ||
      existing.labs.find(l => normName(l.name) === normName(name)) ||
      existing.labs.find(l => labCore(l.name) === want || labCore(l.sk) === want) || null;
  };

  /* ----- companies ----- */
  const companyByName = new Map();      // normName -> { sk, isNew }
  for (const c of existing.companies) companyByName.set(normName(c.name), { sk: c.sk, isNew: false, rec: c });
  const companyRows = [];               // CSV rows that became new companies, for primary-contact wiring

  for (const row of csv.companies) {
    if (!row.name) { err("company", row, "name is required"); continue; }
    const key = normName(row.name);
    if (companyByName.has(key)) {
      const hit = companyByName.get(key);
      (hit.isNew ? warnings : skipped).push(hit.isNew
        ? `company line ${row.line} (${row.name}): listed twice in the CSV — the later row is ignored`
        : `company "${row.name}" already exists (${hit.sk})`);
      if (!hit.isNew) summary.companies.existing++;
      continue;
    }
    const email = cleanEmail(row.email), site = cleanWebsite(row.website), phone = cleanPhone(row.phone);
    for (const r of [email, site, phone]) if (r.error) err("company", row, r.error);
    if (email.error || site.error || phone.error) continue;
    const sk = newCompanyId();
    const rec = {
      pk: "COMPANY", sk, name: row.name.trim().slice(0, 200), kind: (row.kind || "").trim().slice(0, 200),
      website: site.value, address: (row.address || "").trim().slice(0, 500),
      phone: phone.value, email: email.value, contactId: null,
      createdBy: actor?.sk, created: ctx.today, updated: ctx.today
    };
    writes.push(rec);
    companyByName.set(key, { sk, isNew: true, rec });
    companyRows.push({ row, rec });
    summary.companies.new++;
  }

  /* ----- contacts ----- */
  /* One person at three companies is three contact records — a contact has a
     single companyId — so a contact is identified by company AND email, never
     email alone. */
  const contactKey = (companyId, email, name) => `${companyId || ""}|${email || `name:${normName(name)}`}`;
  const contactByKey = new Map();       // contactKey -> { sk, isNew }
  for (const c of existing.contacts)
    contactByKey.set(contactKey(c.companyId, (c.email || "").toLowerCase(), c.name), { sk: c.sk, isNew: false });
  const newContactsByCompany = new Map(); // company sk -> [contact rec] in CSV order

  for (const row of csv.contacts) {
    if (!row.name) { err("contact", row, "name is required"); continue; }
    let companyId = null;
    if (row.company) {
      const co = companyByName.get(normName(row.company));
      if (!co) { err("contact", row, `company "${row.company}" is not in companies.csv or the portal`); continue; }
      companyId = co.sk;
    }
    const email = cleanEmail(row.email), phone = cleanPhone(row.phone);
    for (const r of [email, phone]) if (r.error) err("contact", row, r.error);
    if (email.error || phone.error) continue;

    const key = contactKey(companyId, email.value, row.name);
    if (contactByKey.has(key)) {
      const hit = contactByKey.get(key);
      if (hit.isNew) warn("contact", row, "listed twice for the same company — the later row is ignored");
      else { skipped.push(`contact "${row.name}" <${email.value}> already exists at ${companyId} (${hit.sk})`); summary.contacts.existing++; }
      continue;
    }
    if (!/\s/.test(row.name.trim())) warn("contact", row, `"${row.name.trim()}" has no last name`);
    const sk = newContactId();
    const rec = {
      pk: "CONTACT", sk, name: row.name.trim().slice(0, 200), title: (row.title || "").trim().slice(0, 120),
      companyId, phone: phone.value, email: email.value,
      createdBy: actor?.sk, created: ctx.today, updated: ctx.today
    };
    writes.push(rec);
    contactByKey.set(key, { sk, isNew: true });
    if (companyId) {
      if (!newContactsByCompany.has(companyId)) newContactsByCompany.set(companyId, []);
      newContactsByCompany.get(companyId).push(rec);
    }
    summary.contacts.new++;
  }

  /* ----- primary contacts: the named one, else the first, like createContact ----- */
  const contactAt = (companyId, email) => {
    const e = (email || "").toLowerCase();
    if (!e) return null;
    const fresh = (newContactsByCompany.get(companyId) || []).find(c => c.email === e);
    if (fresh) return fresh.sk;
    const old = existing.contacts.find(c => c.companyId === companyId && (c.email || "").toLowerCase() === e);
    return old ? old.sk : null;
  };
  for (const { row, rec } of companyRows) {
    const named = row.primary_contact_email;
    let primary = named ? contactAt(rec.sk, named) : null;
    if (named && !primary) warn("company", row, `primary_contact_email ${named} matches no contact at this company`);
    if (!primary) primary = newContactsByCompany.get(rec.sk)?.[0]?.sk ?? null;
    rec.contactId = primary;
  }
  /* A company that already existed and has no primary contact takes its first
     new contact — what createContact does when you add one in the portal. */
  for (const [companyId, list] of newContactsByCompany) {
    const old = existing.companies.find(c => c.sk === companyId);
    if (old && !old.contactId) updates.push({ pk: "COMPANY", sk: companyId, set: { contactId: list[0].sk, updated: ctx.today } });
  }

  /* ----- deals ----- */
  const dealKey = (client, lab) => `${normName(client)}|${lab}`;
  const seenDeal = new Set(existing.deals.map(d => dealKey(d.client, d.lab)));

  for (const row of csv.deals) {
    if (!row.client) { err("deal", row, "client is required"); continue; }
    const lab = labFor(row.lab);
    if (!lab) {
      err("deal", row, `lab "${row.lab}" matches no lab. The portal's labs: ${existing.labs.map(l => `${l.name} (${l.sk})`).join(", ") || "none found"}`);
      continue;
    }
    const stage = STAGE_ALIASES[String(row.stage).trim().toLowerCase()];
    if (!stage) { err("deal", row, `stage "${row.stage}" is not one of Lead, Discovery, Proposal & Negotiation, Contracted (Signed), Closed Won (Paid), Closed Lost`); continue; }
    const source = SOURCE_BY_LOWER[String(row.source).trim().toLowerCase()];
    if (!source) { err("deal", row, `source "${row.source}" is not one of ${SOURCES.join(", ")}`); continue; }
    const amount = parseMoney(row.amount);
    if (amount === null) { err("deal", row, `amount "${row.amount}" is not a number`); continue; }
    const close = parseDate(row.close);
    if (close === null) { err("deal", row, `close "${row.close}" is not a date (use YYYY-MM-DD or M/D/YYYY)`); continue; }
    if (stage === "Closed" && !close) warn("deal", row, "is Closed Won (Paid) with no close date — the portal will ask for one the next time someone saves it");

    const owner = personKey[String(row.owner_email).toLowerCase()];
    if (!owner) { err("deal", row, `owner_email "${row.owner_email}" is not a portal user`); continue; }
    let dealOwner = owner;
    if (row.deal_owner_email) {
      dealOwner = personKey[row.deal_owner_email.toLowerCase()];
      if (!dealOwner) { err("deal", row, `deal_owner_email "${row.deal_owner_email}" is not a portal user (an email is needed, not a name)`); continue; }
    }
    if (dealOwner.role && !["Admin", "Lab Leader"].includes(dealOwner.role)) { err("deal", row, `deal owner ${dealOwner.sk} is a ${dealOwner.role}; it must be an Admin or Lab Leader`); continue; }

    let companyId = null, contactId = null;
    if (row.company) {
      const co = companyByName.get(normName(row.company));
      if (!co) { err("deal", row, `company "${row.company}" is not in companies.csv or the portal`); continue; }
      companyId = co.sk;
    }
    if (row.contact_email) {
      contactId = companyId ? contactAt(companyId, row.contact_email) : null;
      if (!contactId) {
        const any = [...newContactsByCompany.values()].flat().find(c => c.email === row.contact_email.toLowerCase()) ||
          existing.contacts.find(c => (c.email || "").toLowerCase() === row.contact_email.toLowerCase());
        if (any && !companyId) contactId = any.sk;
        else warn("deal", row, `contact ${row.contact_email} is not a contact at ${row.company || "any company"} — the deal is linked to the company only`);
      }
    }
    if (needsBillingEntity(stage) && !companyId && !contactId) {
      err("deal", row, `a deal at ${stage} needs a company or a contact`);
      continue;
    }

    const k = dealKey(row.client, lab.sk);
    if (seenDeal.has(k)) {
      skipped.push(`deal "${row.client}" already exists in ${lab.name}`);
      summary.deals.existing++;
      continue;
    }
    seenDeal.add(k);
    writes.push({
      pk: "DEAL", sk: newDealId(), client: row.client.slice(0, 300), lab: lab.sk,
      owner: owner.sk, dealOwner: dealOwner.sk, stage, amount, close, source,
      recurring: truthy(row.recurring), companyId, contactId,
      created: ctx.today, updated: ctx.today,
      ...(outcomeOf(stage) ? { outcome: outcomeOf(stage) } : {})
    });
    summary.deals.new++;
  }

  const recurringWon = writes.filter(w => w.pk === "DEAL" && w.recurring && (w.stage === "Contracted" || w.stage === "Closed"));
  if (recurringWon.length)
    warnings.push(`${recurringWon.length} deal(s) are marked recurring at Contracted or later: the daily recurring engine will start generating monthly invoice instances for them (src/recurring.mjs).`);

  return { errors, warnings, skipped, writes, updates, summary };
}
