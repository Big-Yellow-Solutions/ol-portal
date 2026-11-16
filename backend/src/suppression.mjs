/* OL Portal · addresses we have stopped sending to.

   SES keeps its own account-level suppression list, but it only refuses the
   send after we have already asked it to. This list is ours: mail-events.mjs
   fills it from SES's bounce and complaint events, and email.mjs checks it
   before every send, so a dead or complaining address fails visibly to the
   person who tried to use it instead of quietly counting against our
   reputation again.

   Only what SES calls a permanent bounce, or a complaint, suppresses. A
   transient bounce (full mailbox, server down) and an undetermined one are
   logged and retried by whoever sends next. Rows have no TTL: a hard bounce
   does not stop being true after 90 days. They are cleared on purpose, with
   scripts/clear-suppression.mjs, once the address has been corrected. */

import { get, put } from "./util.mjs";

export const normalizeAddress = a => String(a || "").trim().toLowerCase();

export class SuppressedRecipientError extends Error {
  constructor(address, row) {
    super(`${address} is suppressed after a ${row.reason}; nothing was sent`);
    this.name = "SuppressedRecipientError";
    this.code = "SuppressedRecipient";
    this.address = address;
  }
}

/** The suppression row, or null. Fails OPEN: if the lookup itself breaks, the
 *  mail still goes (SES's own list is the backstop). Blocking every email
 *  because a read failed would be the worse failure — it would take sign-in
 *  codes down with it. */
export async function suppressionFor(address) {
  try {
    return (await get("SUPPRESSION", normalizeAddress(address))) || null;
  } catch (err) {
    console.log(JSON.stringify({ level: "error", message: "suppression lookup failed; sending anyway", detail: err.message }));
    return null;
  }
}

export async function assertNotSuppressed(address) {
  const row = await suppressionFor(address);
  if (row) throw new SuppressedRecipientError(address, row);
}

export async function suppress({ address, reason, detail = "", messageId = "", at = new Date() }) {
  const email = normalizeAddress(address);
  if (!email) return null;
  const existing = await get("SUPPRESSION", email);
  // Keep the first cause: it is the one that explains why we stopped.
  if (existing) return existing;
  const row = {
    pk: "SUPPRESSION", sk: email, reason, detail: String(detail).slice(0, 500),
    messageId, at: at.toISOString()
  };
  await put(row);
  return row;
}
