/* OL Portal · inbound mail: MIME to the pieces intake needs.

   A team member forwards a thread with an optional note on top. What the rest
   of the pipeline wants is the three things apart: the forwarder's note (the
   most reliable signal, so it is kept separate), the forwarded message's own
   headers (who actually wrote it, when, to whom), and the forwarded body.

   Everything here is deterministic string handling — no model, no I/O beyond
   mailparser — so it can be unit-tested against real forwards. */

import { simpleParser } from "mailparser";

export const MAX_TEXT = 30_000;

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

/* Quoted history past the forwarded message is noise that costs tokens and
   drags in third parties: drop "On … wrote:" trailers and ">" quoting. */
function stripQuoted(body) {
  const lines = body.split(/\r?\n/);
  const cut = lines.findIndex(l => /^\s*On .{5,200}wrote:\s*$/i.test(l));
  return (cut === -1 ? lines : lines.slice(0, cut))
    .filter(l => !/^\s*>/.test(l)).join("\n").trim();
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
    // A long To/Cc list wraps onto an indented continuation line.
    if (lastKey && /^\s+\S/.test(lines[i]) && lines[i].includes("@")) { headers[lastKey] += " " + lines[i].trim(); continue; }
    if (!lines[i].trim() && lastKey) { i++; break; }
    if (!lastKey && !lines[i].trim()) continue;
    break;
  }
  const body = stripQuoted(lines.slice(i).join("\n"));
  return {
    note,
    forwarded: {
      from: addrOf(headers.from),
      date: headers.date || headers.sent || "",
      subject: headers.subject || "",
      to: addrList(headers.to),
      cc: addrList(headers.cc),
      body: body.slice(0, MAX_TEXT)
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
      body: stripQuoted(inner.text || "").slice(0, MAX_TEXT)
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
