/* OL Portal · inbound mail: MIME to the pieces intake needs.

   A team member forwards a thread with an optional note on top. What the rest
   of the pipeline wants is the three things apart: the forwarder's note (the
   most reliable signal, so it is kept separate), the forwarded message's own
   headers (who actually wrote it, when, to whom), and the forwarded body.

   Everything here is deterministic string handling — no model, no I/O beyond
   mailparser — so it can be unit-tested against real forwards. */

import { simpleParser } from "mailparser";

export const MAX_TEXT = 30_000;
export const COMPANY_DOMAIN = "optimisticlabs.com";

/* Gmail writes "---------- Forwarded message ---------"; Outlook writes
   "-----Original Message-----" or a bare "From:/Sent:/To:/Subject:" block
   under a rule; Apple Mail writes "Begin forwarded message:". */
const FORWARD_MARKER =
  /^\s*(?:-{2,}\s*Forwarded message\s*-{2,}|-{2,}\s*Original Message\s*-{2,}|Begin forwarded message:)\s*$/im;

const HEADER_LINE = /^\s*(From|Date|Sent|Subject|To|Cc|Reply-To):\s*(.*)$/i;

const addrOf = raw => {
  const s = String(raw || "").trim();
  const angled = s.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>/);
  if (angled) return { name: angled[1].replace(/["']/g, "").trim(), address: angled[2].toLowerCase() };
  const bare = s.match(/([^\s<>,;]+@[^\s<>,;]+)/);
  return bare ? { name: "", address: bare[1].toLowerCase() } : null;
};

const addrList = raw =>
  String(raw || "").split(/,(?![^<]*>)/).map(addrOf).filter(Boolean);

/* Quoted history is KEPT. The person a lead is about is often not the author
   of the message that was forwarded: a teammate forwards an internal reply
   ("Sounds great!") that quotes an outsider's original email, or a client
   forwards a message from someone they are referring to us. Cutting at the
   first "On … wrote:" would drop exactly the part that names them.

   What this does instead is make the quoted text readable — leading ">"
   markers removed, runs of blank lines collapsed — and cap the total. Nested
   forwards then read like any other forward, which is how the model and the
   participant scan below find the outsider. The cap cuts from the END, so
   the newest messages and the forwarded headers survive a very long thread. */
const FILTERED = /^(no-?reply|donotreply|do-not-reply|mailer-daemon|postmaster|notifications?|calendar-notification)@/i;

function tidyBody(body) {
  return String(body || "")
    .split(/\r?\n/).map(l => l.replace(/^(?:\s*>)+ ?/, ""))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
}

/** Every address in the thread's text, in order of first appearance, with the
 *  name written next to it where there is one. Used to tell the model who is
 *  in the thread, and to find the outsider when it names no one. */
export function addressesIn(text) {
  const seen = new Map();
  for (const m of String(text || "").matchAll(/(?:"?([^"<>\n,;]{1,80}?)"?\s*)?<([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>|([^\s<>,;:()"']+@[^\s<>,;:()"']+\.[a-z]{2,})/gi)) {
    const address = String(m[2] || m[3]).toLowerCase().replace(/[.,;:]+$/, "");
    if (!address || FILTERED.test(address)) continue;
    const name = (m[1] || "").replace(/^(from|to|cc|on|date|sent):\s*/i, "").replace(/\s+/g, " ").trim();
    if (!seen.has(address)) seen.set(address, { name, address });
    else if (name && !seen.get(address).name) seen.get(address).name = name;
  }
  return [...seen.values()];
}

export const isOutside = address => !!address && !address.endsWith("@" + COMPANY_DOMAIN) && !address.endsWith("." + COMPANY_DOMAIN);

/** Everything in the thread the person could be: the outside addresses in the
 *  forwarded headers and body, in order of first appearance. */
export function outsideParticipants(parsed) {
  const f = parsed.forwarded;
  if (!f) return [];
  const headerAddrs = [f.from, ...f.to, ...f.cc].filter(Boolean);
  const text = `${f.body}`;
  const merged = new Map();
  for (const a of [...headerAddrs, ...addressesIn(text)]) {
    if (!isOutside(a.address) || FILTERED.test(a.address)) continue;
    if (!merged.has(a.address)) merged.set(a.address, { name: a.name || "", address: a.address });
    else if (a.name && !merged.get(a.address).name) merged.get(a.address).name = a.name;
  }
  return [...merged.values()];
}

/** The address on the LAST "From:" line in the text: the author of the oldest
 *  message in a forwarded chain, which is who an introduction is about. */
export function deepestFrom(text) {
  let last = null;
  for (const line of String(text || "").split("\n")) {
    const m = /^\s*From:\s*(.+)$/i.exec(line);
    if (!m) continue;
    const a = addressesIn(m[1])[0];
    if (a) last = a.address;
  }
  return last;
}

/** Splits a plain-text forward into { note, forwarded }. `forwarded` is null
 *  when no forward marker is found — the message was typed, not forwarded. */
export function splitForward(text) {
  const t = String(text || "").replace(/\r\n/g, "\n");
  const m = FORWARD_MARKER.exec(t);
  if (!m) return { note: t.trim(), forwarded: null };

  const note = t.slice(0, m.index).trim();
  const rest = t.slice(m.index + m[0].length).replace(/^\n+/, "");
  const lines = rest.split("\n");
  const headers = {};
  let i = 0, lastKey = null;
  for (; i < lines.length; i++) {
    const h = HEADER_LINE.exec(lines[i]);
    if (h) { lastKey = h[1].toLowerCase(); headers[lastKey] = h[2].trim(); continue; }
    // A long To/Cc list wraps onto a continuation line — indented in some
    // clients, flush left (even mid-address) in Gmail's plain-text forward.
    if (lastKey && ["from", "to", "cc", "reply-to"].includes(lastKey) && lines[i].trim() && lines[i].includes("@"))
      { headers[lastKey] += lines[i].startsWith(" ") || lines[i].startsWith("\t") ? " " + lines[i].trim() : lines[i].trim(); continue; }
    if (!lines[i].trim() && lastKey) { i++; break; }
    if (!lastKey && !lines[i].trim()) continue;
    break;
  }
  const body = tidyBody(lines.slice(i).join("\n"));
  return {
    note,
    forwarded: {
      from: addrOf(headers.from),
      date: headers.date || headers.sent || "",
      subject: headers.subject || "",
      to: addrList(headers.to),
      cc: addrList(headers.cc),
      body
    }
  };
}

/** Headers an attacker-controlled message could carry twice are read from the
 *  TOP: receiving servers prepend what they add, so the first occurrence is
 *  the one this AWS account's SES wrote, and anything the sender included
 *  sits below it. */
export const firstHeader = (headerLines, name) =>
  headerLines.find(h => h.key === name.toLowerCase())?.line.replace(/^[^:]*:\s*/, "").replace(/\s*\r?\n\s*/g, " ") ?? null;

export const allHeaders = (headerLines, name) =>
  headerLines.filter(h => h.key === name.toLowerCase()).map(h => h.line.replace(/^[^:]*:\s*/, "").replace(/\s*\r?\n\s*/g, " "));

/** Parses raw MIME (as SES stored it) into everything intake needs. */
export async function parseInbound(raw) {
  const mail = await simpleParser(raw);
  const headerLines = mail.headerLines || [];

  /* A forward sent "as attachment" arrives as a message/rfc822 part, not as
     text. Parse the attached message and treat its text as the forwarded
     block, with the outer text as the note. */
  const attached = (mail.attachments || []).find(a => a.contentType === "message/rfc822");
  let note, forwarded;
  if (attached) {
    const inner = await simpleParser(attached.content);
    note = (mail.text || "").trim();
    forwarded = {
      from: inner.from?.value?.[0] ? { name: inner.from.value[0].name || "", address: String(inner.from.value[0].address || "").toLowerCase() } : null,
      date: inner.date ? inner.date.toUTCString() : "",
      subject: inner.subject || "",
      to: (inner.to?.value || []).map(a => ({ name: a.name || "", address: String(a.address || "").toLowerCase() })),
      cc: (inner.cc?.value || []).map(a => ({ name: a.name || "", address: String(a.address || "").toLowerCase() })),
      body: tidyBody(inner.text || "")
    };
  } else {
    ({ note, forwarded } = splitForward(mail.text || ""));
  }

  return {
    messageId: (mail.messageId || "").trim() || null,
    from: mail.from?.value?.[0]?.address?.toLowerCase() || null,
    fromName: mail.from?.value?.[0]?.name || "",
    subject: mail.subject || "",
    date: mail.date || null,
    note: note.slice(0, 4000),
    forwarded,
    headerLines
  };
}
