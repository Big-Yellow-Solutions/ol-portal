/* OL Portal · what happens after a document is fully executed.

   Countersigning is the end of the signature flow but the start of several
   other things: a countersigned PDF has to be rendered and stored, both
   parties need their copy, a customer contract has to roll its deal forward,
   and an executed MSA invites its Contributor into the portal.

   These live apart from signing.mjs because they share one hard rule that the
   signing code does not: none of them may fail the execution. The signature is
   already recorded and legally effective by the time any of this runs, so each
   is invoked with a .catch() at the call site and each is written to give up
   quietly rather than throw. A PDF that didn't render is a job to re-run; an
   execution that got rolled back because an email bounced would be a mess. */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { get, put, fullName, esc, signUrl, docKind, docMeta } from "./util.mjs";
import { writeAudit, inviteContributor } from "./admin.mjs";
import { sendClientEmail } from "./email.mjs";
import { pricingTotal, formatMoney } from "./pricing.mjs";

const s3 = new S3Client({});
const lambda = new LambdaClient({});
const FILES_BUCKET = process.env.FILES_BUCKET;



/* The PDF renderer is a separate Lambda (puppeteer is too heavy to bundle into
   the API function). Invoking it directly rather than over HTTP keeps this out
   of the API's own request path and avoids re-authenticating as the caller. */
export async function generateExecutedPdf(c) {
  if (!process.env.PDF_FUNCTION_NAME) return null;
  const out = await lambda.send(new InvokeCommand({
    FunctionName: process.env.PDF_FUNCTION_NAME,
    Payload: Buffer.from(JSON.stringify({ direct: true, kind: "contracts", id: c.sk, actor: c.olSignatory }))
  }));
  const parsed = JSON.parse(Buffer.from(out.Payload).toString("utf8") || "{}");
  const payload = parsed.body ? JSON.parse(parsed.body) : parsed;
  if (!payload?.fileId) return null;
  const fresh = await get("CONTRACT", c.sk);
  await put({ ...fresh, executedFileId: payload.fileId });
  return payload;
}

/* FR18. An executed contract closes the deal. Until Pipeline v3 this had to
   wait on an Assignment Notice — the deal was parked at "ready to close" until
   somebody filled one in — but closing no longer depends on the assignment
   (assignments.mjs): a won deal is won, and the assignment is chased after the
   fact by the drawer's Assignment tab. */
export async function rollUpDeal(c) {
  if (!c.deal) return;
  const deal = await get("DEAL", c.deal);
  if (!deal) return;
  await put({
    ...deal,
    contractSigned: true,
    contractSignedAt: c.executedAt,
    contract: c.sk,
    stage: "Closed",
    outcome: "Won"
  });
}

/* FR15: both parties get the countersigned copy. The customer has no login, so
   their copy is a short-lived presigned link plus the signing page, which
   serves the same PDF for as long as the token lives. */
export async function deliverCopies(c, pdf) {
  const recipients = [];
  if (c.clientSignerEmail) recipients.push({ email: c.clientSignerEmail, name: c.clientSignerName });
  const [signatory, owner] = await Promise.all([
    c.olSignatory ? get("PERSON", c.olSignatory) : null,
    c.owner ? get("PERSON", c.owner) : null
  ]);
  for (const p of [signatory, owner]) if (p?.email) recipients.push({ email: p.email, name: fullName(p) });
  if (!recipients.length) return;

  let link = signUrl(c.signToken);
  if (pdf?.fileId) {
    const file = await get("FILE", pdf.fileId);
    if (file?.key) {
      link = await getSignedUrl(s3, new GetObjectCommand({
        Bucket: FILES_BUCKET, Key: file.key,
        ResponseContentDisposition: `attachment; filename="${String(file.name).replace(/"/g, "")}"`
      }), { expiresIn: 7 * 24 * 3600 });
    }
  }

  const total = pricingTotal(c.pricing);
  const title = docMeta(c).title;
  const summary = `${c.client} · ${c.sk}${total === null ? "" : " · " + formatMoney(total)}`;
  for (const r of recipients) {
    await sendClientEmail({
      sender: { name: "Optimistic Labs", email: null },
      toEmail: r.email,
      subject: `Fully executed: Optimistic Labs ${title} (${c.client})`,
      text: `Hi${r.name ? " " + r.name : ""},\n\nThe ${title} is now fully executed.\n\n${summary}\n\n` +
        `Download your countersigned copy: ${link}\n\n— Optimistic Labs`,
      html: `<p>Hi${r.name ? " " + esc(r.name) : ""},</p><p>The ${esc(title)} is now fully executed.</p>` +
        `<p>${esc(summary)}</p><p><a href="${link}">Download your countersigned copy</a></p><p>— Optimistic Labs</p>`
    }).catch(err =>
      console.error(JSON.stringify({ level: "warn", message: "copy email failed", to: r.email, detail: err.message })));
  }
}

/* FR4. A Contributor who isn't already a Portal member is invited to create a
   profile once their MSA is fully executed.

   On execution rather than on their own signature. FR4 says "signing the MSA
   (not sending it)", and §5.2 puts the OL countersignature after the
   Contributor's — but an MSA that OL never countersigned isn't an agreement,
   and an invite is hard to walk back once someone has a login and a temporary
   password in their inbox. Waiting for the second signature costs minutes and
   removes that case entirely.

   Task orders deliberately don't invite: by the time one exists the MSA has
   already been executed, so the invite has already happened. */
export async function inviteOnExecution(c) {
  if (docKind(c) !== "msa") return;
  const result = await inviteContributor({
    actor: c.olSignatory || "system",
    email: c.clientSignerEmail || c.contributorEmail,
    // The name they actually signed under is better evidence than the name
    // someone typed into the draft weeks earlier.
    name: c.signatures?.client?.name || c.clientSignerName || c.client,
    labs: c.lab ? [c.lab] : []
  });
  if (result.invited)
    await writeAudit(c.olSignatory || "system", "contributor.invited",
      `${result.username} · on execution of ${c.sk}`);
}
