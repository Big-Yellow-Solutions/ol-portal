/* OL Portal · inbound mail: the reply the forwarder gets.

   Plain text first — it is read in a mail client in the seconds after
   forwarding — with a matching HTML part. In the dry-run phase the reply
   says what it WOULD do, and says so on the first line. */

import { esc } from "./util.mjs";

const money = n => `$${Number(n).toLocaleString("en-US")}`;
const pad = s => (s + ":").padEnd(9);

function planLines(plan) {
  const p = plan.person, c = plan.company, d = plan.deal;
  const lines = [
    `${pad("Person")}${p.name}, ${p.email}  (${p.matched ? "matched existing" : "new"})`,
    c ? `${pad("Company")}${c.name}${c.website ? ", " + c.website : ""}  (${c.matched ? "matched existing" : "new"})`
      : `${pad("Company")}none (no company could be told from the email)`,
    `${pad("Deal")}${d.name}, ${d.amountStated ? money(d.amount) : "no amount stated"}, source ${d.source}`
  ];
  if (d.summary) lines.push("", d.summary);
  return lines;
}

/** `mode` is "dry-run" or "live". Returns { subject, text, html }. */
export function buildReply({ kind, plan, mode, reviewUrl, subject = "" }) {
  const re = subject ? `Re: ${subject}` : "Your forward to the Optimist";
  const dry = mode === "dry-run";
  let body;

  switch (kind) {
    case "contributor":
      body = ["Pipeline intake from email is for Admins and Lab Leaders, and your role doesn't include Pipeline access in the portal yet.", "Nothing was added."];
      break;
    case "needs-contact":
      body = ["I couldn't find a contact email address in that message, so nothing was added.",
        "Forward the message that contains the person's email, or add their email in a note above the forward."];
      break;
    case "unknown-intent":
      body = ["I couldn't tell what you wanted done with that, and today I only know how to add a lead to Pipeline. Nothing was changed.",
        "If it is a lead, forward it again with a short note, for example: \"Faith lab. Referral from Aliza.\""];
      break;
    case "rate-limit":
      body = ["You've forwarded a lot in the last hour, so I've paused. Try again a little later."];
      break;
    case "failed":
      body = ["Something went wrong reading that message, and nothing was added. Please try forwarding it again in a minute."];
      break;
    default: { // "plan"
      const where = plan.outcome === "held" ? "no lab chosen yet" : `${plan.labName}, ${plan.deal.stage}`;
      const head = dry
        ? `Dry run: nothing was created. This is what I would add to Pipeline (${where}).`
        : plan.outcome === "held" ? "I need a lab before I can add this to Pipeline." : `Added to Pipeline (${where})`;
      body = [head, "", ...planLines(plan)];
      if (!dry && reviewUrl) body.push(`${pad("Review it")}${reviewUrl}`);
      body.push("");
      if (plan.flags.length) body.push("To address:", ...plan.flags.map(f => `  - ${f.text}`));
      else body.push("Nothing to address.");
    }
  }

  const text = body.join("\n");
  const html = `<div style="font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#222"><pre style="font:inherit;white-space:pre-wrap;margin:0">${esc(text)}</pre></div>`;
  return { subject: re, text, html };
}
