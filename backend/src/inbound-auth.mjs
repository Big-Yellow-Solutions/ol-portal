/* OL Portal · inbound mail: is this really from a teammate?

   The inbox is a public address that writes to the database, so the sender is
   the credential and it is checked before anything else. A `From` header
   proves nothing on its own; what counts is that SES validated DKIM for
   optimisticlabs.com and the result lines up with the From domain (DMARC
   alignment). SPF is deliberately not required: the Workspace routing hop
   changes the sending server, so SPF would fail for good mail.

   SES records its verdicts in an `Authentication-Results` header it adds when
   it receives the message (authserv-id `amazonses.com`). Only that header is
   trusted, and only its first occurrence — see firstHeader's note. Anything
   else a sender includes is ignored.

   ASSUMPTION TO CONFIRM IN PHASE 1: the exact shape of that header (and the
   X-SES-Spam/Virus verdicts) is read from SES's documented behaviour, not from
   a message captured in this account. The dry run logs which checks passed or
   failed for every message, and the phase gate requires a real forward to
   pass and a spoofed one to fail before anything is created. */

import { allHeaders } from "./inbound-parse.mjs";

export const COMPANY_DOMAIN = "optimisticlabs.com";
const AUTHSERV = "amazonses.com";

const domainOf = address => String(address || "").toLowerCase().split("@")[1] || "";
const insideDomain = host => host === COMPANY_DOMAIN || host.endsWith("." + COMPANY_DOMAIN);

/** Returns { ok, reason, checks }. `reason` is a short log code, never shown
 *  to the sender: a failed message gets no reply (no backscatter). */
export function authenticateSender(parsed) {
  const checks = {};
  const fromDomain = domainOf(parsed.from);
  checks.fromInDomain = insideDomain(fromDomain);
  if (!checks.fromInDomain) return { ok: false, reason: "from-outside-domain", checks };

  const results = allHeaders(parsed.headerLines, "authentication-results")
    .find(v => v.toLowerCase().startsWith(AUTHSERV));
  checks.hasSesResults = !!results;
  if (!results) return { ok: false, reason: "no-ses-authentication-results", checks };

  const r = results.toLowerCase();
  // dkim=pass with the signing domain (header.d, or header.i's domain) inside
  // the company domain AND aligned with the From domain.
  const dkimPass = /dkim=pass/.test(r);
  const signer = (r.match(/header\.d=([a-z0-9.-]+)/) || r.match(/header\.i=@?([a-z0-9.-]+)/) || [])[1] || "";
  checks.dkimPass = dkimPass;
  checks.dkimSigner = signer;
  checks.dkimAligned = !!signer && insideDomain(signer) &&
    (fromDomain === signer || fromDomain.endsWith("." + signer) || signer.endsWith("." + fromDomain));
  checks.dmarcPass = /dmarc=pass/.test(r);

  if (!dkimPass) return { ok: false, reason: "dkim-not-pass", checks };
  if (!checks.dkimAligned) return { ok: false, reason: "dkim-not-aligned", checks };
  if (!checks.dmarcPass) return { ok: false, reason: "dmarc-not-pass", checks };

  // SES scans for spam and viruses before delivery; a FAIL verdict stops it.
  for (const v of ["x-ses-spam-verdict", "x-ses-virus-verdict"]) {
    const [value] = allHeaders(parsed.headerLines, v);
    checks[v] = value || null;
    if (value && value.trim().toUpperCase() === "FAIL") return { ok: false, reason: v.replace("x-ses-", "").replace("-verdict", "-fail"), checks };
  }
  return { ok: true, reason: "ok", checks };
}
