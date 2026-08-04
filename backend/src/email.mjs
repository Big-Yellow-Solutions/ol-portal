/* OL Portal · outbound client email (proposal delivery) via Amazon SES.
   optimisticlabs.com is a verified SES domain identity, which authorizes
   sending from any address on that domain — no per-person verification
   needed. Senders outside that domain get a shared fallback address with
   Reply-To set to their real one, so replies still land with the right person. */

import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const ses = new SESv2Client({});
const DOMAIN = "optimisticlabs.com";
const FALLBACK_FROM = `Optimistic Labs <hello@${DOMAIN}>`;

function fromHeader(sender) {
  if (sender?.email && sender.email.toLowerCase().endsWith(`@${DOMAIN}`)) {
    return { from: `${sender.name} <${sender.email}>`, replyTo: null };
  }
  return { from: FALLBACK_FROM, replyTo: sender?.email || null };
}

export async function sendClientEmail({ sender, toEmail, subject, text, html }) {
  const { from, replyTo } = fromHeader(sender);
  await ses.send(new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [toEmail] },
    ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: text, Charset: "UTF-8" },
          Html: { Data: html, Charset: "UTF-8" }
        }
      }
    }
  }));
}
