/* OL Portal · outbound email via Amazon SES: client mail sent on a person's
   behalf (proposal delivery, message notices) and the portal's own system
   mail (the sign-in code).
   optimisticlabs.com is a verified SES domain identity, which authorizes
   sending from any address on that domain — no per-person verification
   needed. Senders outside that domain get a shared fallback address with
   Reply-To set to their real one, so replies still land with the right person. */

import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { assertNotSuppressed } from "./suppression.mjs";

const ses = new SESv2Client({});
const DOMAIN = "optimisticlabs.com";
const FALLBACK_FROM = `Optimistic Labs <hello@${DOMAIN}>`;
/* Mail the portal sends as itself. Nobody reads replies to it, and the domain
   identity covers the address without a mailbox behind it. */
const SYSTEM_FROM = `Optimistic Labs Portal <no-reply@${DOMAIN}>`;

function fromHeader(sender) {
  if (sender?.email && sender.email.toLowerCase().endsWith(`@${DOMAIN}`)) {
    return { from: `${sender.name} <${sender.email}>`, replyTo: null };
  }
  return { from: FALLBACK_FROM, replyTo: sender?.email || null };
}

export async function sendClientEmail({ sender, toEmail, subject, text, html }) {
  const { from, replyTo } = fromHeader(sender);
  await deliver({ from, replyTo, toEmail, subject, text, html });
}

export async function sendSystemEmail({ toEmail, subject, text, html }) {
  await deliver({ from: SYSTEM_FROM, replyTo: null, toEmail, subject, text, html });
}

/* Every message carries the configuration set, which is what publishes its
   bounces and complaints to mail-events.mjs. Unset in a stack that doesn't
   define one (a test, a local run), where the send simply isn't tracked. */
const CONFIG_SET = () => process.env.MAIL_CONFIG_SET || undefined;

async function deliver({ from, replyTo, toEmail, subject, text, html }) {
  // A permanent bounce or a complaint stops mail to that address until a
  // person clears it (suppression.mjs). Throws, so the sender sees it.
  await assertNotSuppressed(toEmail);
  await ses.send(new SendEmailCommand({
    FromEmailAddress: from,
    ConfigurationSetName: CONFIG_SET(),
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
