/* OL Portal · inbound mail: what would we create, and what needs attention?

   Pure. Takes the forwarder's ctx, the extraction and a snapshot of the data
   the forwarder can see, and returns a plan: which lab, which records are
   matched and which would be created, and the flags. The handler fetches the
   snapshot and later executes the plan; nothing here reads or writes.

   Every case resolves to "ready", "held" (Admin, no lab settled), or a stop
   ("needs-contact", "unknown-intent") — none asks the sender a question
   mid-flow. Flags are codes the Pipeline UI will render later; `text` is what
   the reply says today. */

import { inScope } from "./contacts.mjs";
import { SOURCES } from "./inbound-extract.mjs";
import { COMPANY_DOMAIN } from "./inbound-auth.mjs";

export const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "comcast.net", "verizon.net"
]);

const FLAG_TEXT = {
  "lab-guessed": lab => `Lab guessed: ${lab}. Change it if that's wrong.`,
  "company-by-domain": name => `Company matched by domain (${name}). Confirm it's the same organization.`,
  "possible-duplicate": id => `Possible duplicate of ${id}, which is open and already linked to this person.`,
  "pick-lab": () => "No lab could be chosen. Pick one to finish adding it."
};

const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

export const domainOfEmail = email => norm(email).split("@")[1] || "";

export const hostOf = website => {
  const w = norm(website).trim();
  if (!w) return "";
  try { return new URL(/^https?:\/\//.test(w) ? w : `https://${w}`).hostname.replace(/^www\./, ""); } catch { return ""; }
};

/* "River Church, Inc." and "river church" are the same company. */
export const companyKey = name =>
  norm(name).replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|inc|llc|ltd|co|corp|corporation|company|incorporated)\b/g, " ")
    .replace(/\s+/g, " ").trim();

/** A lab named in the forwarder's note: "Faith lab", "for Democracy", or the
 *  lab id. A lab's name is matched without its "Optimistic"/"Lab(s)" dressing.
 *  Exactly one lab must match; two is ambiguous and settles nothing. */
export function labFromNote(note, labs) {
  const text = ` ${norm(note).replace(/[^a-z0-9 ]/g, " ")} `;
  const hits = labs.filter(l => {
    const core = companyKey(l.name).replace(/\boptimistic\b/g, " ").replace(/\blabs?\b/g, " ").replace(/\s+/g, " ").trim();
    const keys = [norm(l.id), core].filter(k => k && k.length >= 3);
    return keys.some(k => text.includes(` ${k} `));
  });
  return hits.length === 1 ? hits[0].id : null;
}

/** Which lab, and why. Admins have no default lab: a deal can't exist without
 *  one and a guess would put it in front of the wrong Lab Leader, so an
 *  unsettled Admin intake is held instead. */
export function resolveLab({ ctx, labs, note, hint }) {
  const mine = ctx.role === "Admin" ? labs : labs.filter(l => (ctx.me.labs || []).includes(l.id));
  if (!mine.length) return { lab: null, how: "none" };
  const noted = labFromNote(note, mine);
  if (noted) return { lab: noted, how: "note" };
  if (ctx.role === "Lab Leader" && mine.length === 1) return { lab: mine[0].id, how: "only-lab" };
  if (hint && mine.some(l => l.id === hint)) return { lab: hint, how: "model" };
  if (ctx.role === "Lab Leader") return { lab: mine[0].id, how: "guessed" };
  return { lab: null, how: "held" };
}

/** The one external person: the original sender of the forwarded message; if
 *  that is a teammate (they wrote the email), the first outside recipient. */
export function externalPersonEmail(parsed) {
  const f = parsed.forwarded;
  const outside = a => a && a.address && !a.address.endsWith("@" + COMPANY_DOMAIN) && !a.address.endsWith("." + COMPANY_DOMAIN);
  if (outside(f?.from)) return f.from.address;
  return [...(f?.to || []), ...(f?.cc || [])].find(outside)?.address || "";
}

const nameOf = p => [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
const OPEN = d => d.stage !== "Closed" && d.stage !== "Closed Lost";

/** `data` = { labs: [{id,name}], contacts, companies, deals } as stored rows
 *  (contacts/companies/deals carry `sk`); `scope` = contacts.labScope(ctx). */
export function planIntake({ ctx, parsed, extraction: x, data, scope }) {
  if (x.intent !== "pipeline.add") return { outcome: "unknown-intent", flags: [] };

  // The server's own reading of who the person is beats the model's: it must
  // be a real address in the headers, and an outside one.
  const email = x.person.email || externalPersonEmail(parsed);
  if (!email) return { outcome: "needs-contact", flags: [] };

  const flags = [];
  const lab = resolveLab({ ctx, labs: data.labs, note: parsed.note, hint: x.deal.labHint });
  const labName = data.labs.find(l => l.id === lab.lab)?.name;
  if (lab.how === "guessed") flags.push({ code: "lab-guessed", text: FLAG_TEXT["lab-guessed"](labName) });
  if (lab.how === "held" || lab.how === "none") flags.push({ code: "pick-lab", text: FLAG_TEXT["pick-lab"]() });

  // Person. Out of scope reads as "not found" — a Lab Leader gets a new record
  // rather than a confirmation that someone else already has one.
  const seen = data.contacts.filter(c => norm(c.email) === email);
  const contactHit = seen.find(c => inScope(scope, "contacts", c.sk));
  const outOfScopeDuplicate = !contactHit && seen.length > 0;

  const free = FREE_MAIL.has(domainOfEmail(email));
  const siteHost = hostOf(x.company.website) || (free ? "" : domainOfEmail(email));
  const person = {
    name: nameOf(x.person) || email, email, phone: x.person.phone, title: x.person.title,
    matched: contactHit ? contactHit.sk : null
  };

  // Company: by domain first, then by normalised name — both within scope.
  const visible = data.companies.filter(c => inScope(scope, "companies", c.sk));
  let company = null;
  if (siteHost) {
    const byDomain = visible.find(c => hostOf(c.website) === siteHost);
    if (byDomain) {
      company = { name: byDomain.name, matched: byDomain.sk, via: "domain" };
      flags.push({ code: "company-by-domain", text: FLAG_TEXT["company-by-domain"](byDomain.name) });
    }
  }
  if (!company && x.company.name) {
    const key = companyKey(x.company.name);
    const byName = key && visible.find(c => companyKey(c.name) === key);
    company = byName
      ? { name: byName.name, matched: byName.sk, via: "name" }
      : { name: x.company.name, website: siteHost, matched: null, via: null };
  }

  // An open deal the forwarder can see already linked to this person.
  const contactId = person.matched;
  const dup = contactId && data.deals.find(d =>
    OPEN(d) && d.contactId === contactId && (ctx.can.seesLab(d.lab) || ctx.can.leadsDeal(d)));
  if (dup) flags.push({ code: "possible-duplicate", text: FLAG_TEXT["possible-duplicate"](dup.sk) });

  const subject = String(parsed.forwarded?.subject || parsed.subject || "").replace(/^(?:\s*(?:fwd?|re):\s*)+/i, "");
  const label = company?.name || person.name;
  const dealName = (x.deal.name || `${label} (from email)`).slice(0, 80);

  return {
    outcome: lab.lab ? "ready" : "held",
    lab: lab.lab, labName, labHow: lab.how,
    person, company,
    deal: { name: dealName, amount: x.deal.amount ?? 0, amountStated: x.deal.amount != null, source: SOURCES.includes(x.deal.source) ? x.deal.source : "Inbound", stage: "Lead", summary: x.deal.summary, subject },
    flags, outOfScopeDuplicate, ambiguities: x.ambiguities
  };
}
