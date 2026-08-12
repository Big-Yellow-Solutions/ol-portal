/* OL Portal · native e-signature (Base Contract PRD 5.5, FR13-FR16).

   Built rather than bought. Under the ESIGN Act and UETA an electronic
   signature is enforceable when four things are true, and each one is a
   concrete thing this module records:

     intent to sign        the signer performs a deliberate signing act and we
                           store what they typed or drew, not just a click
     consent to transact   an explicit, separately recorded affirmation, kept
                           with the signature rather than implied by use
     attribution           name, email, timestamp, source IP and user-agent for
                           the customer; the authenticated Cognito account for
                           the OL side
     record retention      a countersigned PDF with an audit certificate, kept
                           in S3 and reachable by both parties afterwards

   Tamper evidence comes from `documentHash`: a SHA-256 over the canonical JSON
   of the exact document put in front of the signer, computed when it is sent
   and re-verified before each signature is accepted. If the contract record
   were altered underneath a signer, the hash check fails and the signature is
   refused.

   Signing is sequential (FR13): the customer signs first, then the OL
   signatory countersigns. The OL side routes to an Admin — never the Lab
   Leader who negotiated the deal. */

import { createHash, randomBytes } from "node:crypto";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { resp, today, get, put, listType, fullName } from "./util.mjs";
import { writeAudit } from "./admin.mjs";
import { sendClientEmail } from "./email.mjs";
import { deviationsOf } from "./contracts.mjs";
import { pricingTotal, formatMoney } from "./pricing.mjs";

const s3 = new S3Client({});
const lambda = new LambdaClient({});
const FILES_BUCKET = process.env.FILES_BUCKET;

const MAX_SIGNATURE_IMAGE_CHARS = 120_000;   // ~90KB PNG, well inside the 400KB item cap
const MAX_NAME = 120;
const SIGNATURE_TYPES = ["typed", "drawn"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Deterministic serialization: key order can't affect the hash, or a harmless
   round-trip through DynamoDB would invalidate every signature. */
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value === undefined ? null : value);
}
/* Exported for tests: hash stability under key reordering is the property the
   whole tamper-evidence claim rests on. */
export const hashOf = doc => createHash("sha256").update(canonical(doc)).digest("hex");

/* The exact document the signers see and the hash covers. Anything not in here
   is metadata and can change without invalidating a signature; anything in here
   is frozen for the life of the contract. */
function executionCopy(c) {
  return {
    contractId: c.sk,
    client: c.client,
    lab: c.lab,
    sections: c.sections || {},
    pricing: c.pricing || null,
    total: pricingTotal(c.pricing),
    clauses: c.clauses || [],
    paymentSchedule: c.paymentSchedule || "",
    startDate: c.startDate || "",
    endDate: c.endDate || "",
    clientSignerName: c.clientSignerName || "",
    clientSignerTitle: c.clientSignerTitle || "",
    proposal: c.proposal || null,
    approvedVersion: c.inherited?.version ?? null
  };
}

/* ---------- send for signature ---------- */

export async function sendForSignature(ctx, id, body) {
  const c = await get("CONTRACT", id);
  if (!c) return resp(404, { error: "contract not found" });
  if (ctx.role !== "Admin" && !(ctx.role === "Lab Leader" && (ctx.can.seesLab(c.lab) || c.owner === ctx.me.sk)))
    return resp(403, { error: "Not allowed to send this contract" });
  if (c.status === "Signed") return resp(409, { error: "This contract is already fully executed" });
  if (c.status === "Out for Signature")
    return resp(409, { error: "This contract is already out for signature" });

  // Everything that would make a signed document defective is checked here,
  // once, rather than discovered by the customer on the signing page.
  const problems = [];
  if (!c.clientSignerName) problems.push("the client signer's name");
  if (!c.clientSignerEmail || !EMAIL_RE.test(c.clientSignerEmail)) problems.push("a valid client signer email");
  if (!(c.clauses || []).length) problems.push("contract terms (no template is attached to this lab)");
  if (!c.paymentSchedule) problems.push("a payment schedule");
  if ((c.unresolvedVars || []).length)
    problems.push(`values for the unfilled template fields: ${c.unresolvedVars.join(", ")}`);
  if (problems.length)
    return resp(400, { error: `Before sending, add ${problems.join("; ")}.` });

  // FR13: the OL countersignature routes to an Admin. Default to the named
  // signatory, otherwise the single Super Admin, so the contract always knows
  // who owes a signature before it goes out.
  let signatory = c.olSignatory ? await get("PERSON", c.olSignatory) : null;
  if (!signatory) {
    const admins = (await listType("PERSON")).filter(p => p.role === "Admin");
    signatory = admins.find(p => p.superAdmin) || admins[0];
  }
  if (!signatory) return resp(409, { error: "No Admin is available to countersign for Optimistic Labs" });

  const doc = executionCopy(c);
  const next = {
    ...c,
    status: "Out for Signature",
    signToken: c.signToken || randomBytes(16).toString("hex"),
    executionCopy: doc,
    documentHash: hashOf(doc),
    olSignatory: signatory.sk,
    olSignatoryName: fullName(signatory),
    sentForSignatureAt: new Date().toISOString(),
    sentForSignatureBy: ctx.me.sk,
    signatures: {},
    updated: today()
  };
  await put(next);
  await writeAudit(ctx.me.sk, "contract.sent-for-signature",
    `${id} (${c.client}) → ${c.clientSignerEmail} · countersigner ${signatory.sk} · sha256 ${next.documentHash.slice(0, 12)}`);

  const url = signUrl(next.signToken);
  const senderName = fullName(ctx.me);
  const subject = `Please sign: Optimistic Labs services agreement (${c.client})`;
  const text = `Hi ${c.clientSignerName},\n\n${senderName} at Optimistic Labs has sent you a services agreement to review and sign.\n\n` +
    `Review and sign it here: ${url}\n\n` +
    `You'll get a countersigned PDF copy by email once we've signed too.\n\n— Optimistic Labs`;
  const html = `<p>Hi ${esc(c.clientSignerName)},</p>` +
    `<p>${esc(senderName)} at Optimistic Labs has sent you a services agreement to review and sign.</p>` +
    `<p><a href="${url}">Review and sign it here</a>.</p>` +
    `<p>You'll get a countersigned PDF copy by email once we've signed too.</p><p>— Optimistic Labs</p>`;

  let emailSent = false, emailError;
  try {
    await sendClientEmail({ sender: { ...ctx.me, name: senderName }, toEmail: c.clientSignerEmail, subject, text, html });
    emailSent = true;
  } catch (err) {
    emailError = err.message;
  }

  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest, url, emailSent, emailError });
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, ch =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const signUrl = token => `${process.env.FRONTEND_URL}/contract-sign.html?token=${token}`;

/* ---------- public signing routes (Authorizer NONE) ---------- */

async function byToken(token) {
  if (!/^[0-9a-f]{32}$/.test(token || "")) return null;
  return (await listType("CONTRACT")).find(c => c.signToken === token) || null;
}

/* Signature metadata minus anything the counterparty shouldn't see. The IP is
   kept on the record for the audit trail but never returned to the browser. */
const publicSignature = s => s && ({
  name: s.name, title: s.title || null, at: s.at,
  signatureType: s.signatureType, signatureImage: s.signatureImage || null,
  verifiedAccount: s.verifiedAccount || null
});

export async function signView(token) {
  const c = await byToken(token);
  if (!c || !c.signToken) return resp(404, { error: "This signing link is not valid" });

  const lab = await get("LAB", c.lab);
  const sigs = c.signatures || {};
  return resp(200, {
    contractId: c.sk,
    client: c.client,
    status: c.status,
    document: c.executionCopy,
    documentHash: c.documentHash,
    brand: { lab: lab?.name || null, accent: lab?.color || null, org: "Optimistic Labs" },
    signerName: c.clientSignerName || "",
    signerTitle: c.clientSignerTitle || "",
    olSignatoryName: c.olSignatoryName || "",
    signatures: { client: publicSignature(sigs.client), ol: publicSignature(sigs.ol) },
    // Whose turn it is, so the page never offers a signature that would 409.
    awaiting: sigs.client ? (sigs.ol ? null : "ol") : "client",
    executedAt: c.executedAt || null,
    pdfReady: !!c.executedFileId
  });
}

function readSignature(body) {
  const name = String(body?.name || "").trim().slice(0, MAX_NAME);
  if (!name) return { error: "Type your full name to sign" };
  if (body?.consent !== true)
    return { error: "You must agree to sign electronically before signing" };
  const signatureType = SIGNATURE_TYPES.includes(body?.signatureType) ? body.signatureType : null;
  if (!signatureType) return { error: "Choose a typed or drawn signature" };

  let signatureImage = null;
  if (signatureType === "drawn") {
    const data = String(body?.signatureData || "");
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data))
      return { error: "The drawn signature is not a valid image" };
    if (data.length > MAX_SIGNATURE_IMAGE_CHARS)
      return { error: "The drawn signature is too large; try again with a simpler mark" };
    signatureImage = data;
  }
  return {
    signature: {
      name,
      title: String(body?.title || "").trim().slice(0, MAX_NAME),
      signatureType,
      signatureImage,
      // Recorded verbatim so the certificate can show exactly what the signer
      // agreed to, not a paraphrase of it.
      consent: true,
      consentText: CONSENT_TEXT
    }
  };
}

export const CONSENT_TEXT =
  "I agree to sign this agreement electronically, I intend my electronic signature to be " +
  "the legal equivalent of my handwritten signature, and I consent to conduct this transaction " +
  "electronically with Optimistic Labs.";

export async function signSubmit(token, body, meta = {}) {
  const c = await byToken(token);
  if (!c || !c.signToken) return resp(404, { error: "This signing link is not valid" });
  if (c.status === "Signed") return resp(409, { error: "This agreement is already fully executed" });
  if (c.status !== "Out for Signature") return resp(409, { error: "This agreement is not open for signature" });
  if ((c.signatures || {}).client) return resp(409, { error: "This agreement has already been signed" });

  // Tamper check: the document must still hash to what was frozen at send.
  if (hashOf(c.executionCopy) !== c.documentHash)
    return resp(409, { error: "This agreement has changed since it was sent. Please ask for a fresh link." });

  const { signature, error } = readSignature(body);
  if (error) return resp(400, { error });

  const record = {
    ...signature,
    party: "client",
    email: c.clientSignerEmail || null,
    at: new Date().toISOString(),
    ip: String(meta.ip || "").slice(0, 60),
    userAgent: String(meta.ua || "").slice(0, 300),
    documentHash: c.documentHash
  };
  await put({ ...c, signatures: { ...(c.signatures || {}), client: record }, updated: today() });
  await writeAudit(record.name, "contract.signed-by-client",
    `${c.sk} (${c.client}) · ${record.signatureType} · ip ${record.ip}`);

  // FR13 step two: tell the OL signatory it's their turn.
  await notifyCountersigner(c, record);
  return resp(200, { recorded: "client", awaiting: "ol" });
}

async function notifyCountersigner(c, clientSig) {
  try {
    const signatory = c.olSignatory ? await get("PERSON", c.olSignatory) : null;
    if (!signatory?.email) return;
    const url = `${process.env.FRONTEND_URL}/contracts.html`;
    const line = `${clientSig.name} signed the services agreement for ${c.client} (${c.sk}). It needs your countersignature.`;
    await sendClientEmail({
      sender: { name: "Optimistic Labs", email: null },
      toEmail: signatory.email,
      subject: `[OL Portal] Countersignature needed: ${c.client}`,
      text: `${line}\n\nCountersign it here: ${url}\n\n— Optimistic Labs Portal`,
      html: `<p>${esc(line)}</p><p><a href="${url}">Countersign it here</a></p><p>— Optimistic Labs Portal</p>`
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", message: "countersign notification failed", detail: err.message }));
  }
}

/* ---------- OL countersignature (authenticated) ---------- */

export async function countersign(ctx, id, body, meta = {}) {
  const c = await get("CONTRACT", id);
  if (!c) return resp(404, { error: "contract not found" });
  if (ctx.role !== "Admin") return resp(403, { error: "Only an Admin can sign for Optimistic Labs" });
  // FR13: when a specific signatory is named, only they may countersign.
  if (c.olSignatory && c.olSignatory !== ctx.me.sk)
    return resp(403, { error: `This contract routes to ${c.olSignatoryName || c.olSignatory} for countersignature` });
  if (c.status === "Signed") return resp(409, { error: "This contract is already fully executed" });
  if (c.status !== "Out for Signature") return resp(409, { error: "This contract is not out for signature" });
  // Sequential order is the point of the flow, so this is a hard stop.
  if (!(c.signatures || {}).client)
    return resp(409, { error: "The client hasn't signed yet" });
  if ((c.signatures || {}).ol) return resp(409, { error: "You've already countersigned this contract" });
  if (hashOf(c.executionCopy) !== c.documentHash)
    return resp(409, { error: "This contract changed after it was sent; it can't be countersigned" });

  const { signature, error } = readSignature(body);
  if (error) return resp(400, { error });

  const executedAt = new Date().toISOString();
  const record = {
    ...signature,
    party: "ol",
    email: ctx.me.email || null,
    at: executedAt,
    ip: String(meta.ip || "").slice(0, 60),
    userAgent: String(meta.ua || "").slice(0, 300),
    documentHash: c.documentHash,
    // The OL side signs from an authenticated session, which is stronger
    // attribution than the customer's link-plus-IP and worth recording as such.
    verifiedAccount: ctx.me.sk
  };

  const next = {
    ...c,
    status: "Signed",
    signatures: { ...(c.signatures || {}), ol: record },
    executedAt,
    signedAt: executedAt,          // legacy field other code already reads
    updated: today()
  };
  await put(next);
  await writeAudit(ctx.me.sk, "contract.executed",
    `${id} (${c.client}) · countersigned · sha256 ${c.documentHash.slice(0, 12)}`);

  // FR15/FR18 run after execution and must not be able to un-execute it.
  const pdf = await generateExecutedPdf(next).catch(err => {
    console.error(JSON.stringify({ level: "error", message: "executed PDF failed", detail: err.message }));
    return null;
  });
  await rollUpDeal(next).catch(err =>
    console.error(JSON.stringify({ level: "warn", message: "deal roll-up failed", detail: err.message })));
  await deliverCopies(next, pdf).catch(err =>
    console.error(JSON.stringify({ level: "warn", message: "copy delivery failed", detail: err.message })));

  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest, pdfFileId: pdf?.fileId || null });
}

/* ---------- execution follow-through ---------- */

/* The PDF renderer is a separate Lambda (puppeteer is too heavy to bundle into
   the API function). Invoking it directly rather than over HTTP keeps this out
   of the API's own request path and avoids re-authenticating as the caller. */
async function generateExecutedPdf(c) {
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

/* FR18. The pipeline refuses to close a deal without a valid Assignment Notice
   (fee splits summing to 100%), and that gate predates this flow and still has
   to hold. So execution closes the deal when the notice is already on file, and
   otherwise flags it as ready to close so the pipeline can prompt for the
   notice instead of silently stalling. */
async function rollUpDeal(c) {
  if (!c.deal) return;
  const deal = await get("DEAL", c.deal);
  if (!deal) return;
  const hasNotice = !!deal.assignmentNotice;
  await put({
    ...deal,
    contractSigned: true,
    contractSignedAt: c.executedAt,
    contract: c.sk,
    ...(hasNotice
      ? { stage: "Closed", outcome: "Won" }
      : { readyToClose: true, stage: deal.stage === "Closed" ? deal.stage : "Negotiating" })
  });
}

/* FR15: both parties get the countersigned copy. The customer has no login, so
   their copy is a short-lived presigned link plus the signing page, which
   serves the same PDF for as long as the token lives. */
async function deliverCopies(c, pdf) {
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
  const summary = `${c.client} · ${c.sk}${total === null ? "" : " · " + formatMoney(total)}`;
  for (const r of recipients) {
    await sendClientEmail({
      sender: { name: "Optimistic Labs", email: null },
      toEmail: r.email,
      subject: `Fully executed: Optimistic Labs services agreement (${c.client})`,
      text: `Hi${r.name ? " " + r.name : ""},\n\nThe services agreement is now fully executed.\n\n${summary}\n\n` +
        `Download your countersigned copy: ${link}\n\n— Optimistic Labs`,
      html: `<p>Hi${r.name ? " " + esc(r.name) : ""},</p><p>The services agreement is now fully executed.</p>` +
        `<p>${esc(summary)}</p><p><a href="${link}">Download your countersigned copy</a></p><p>— Optimistic Labs</p>`
    }).catch(err =>
      console.error(JSON.stringify({ level: "warn", message: "copy email failed", to: r.email, detail: err.message })));
  }
}

/* Public download of the executed copy — the signing token is the credential,
   same as the rest of the customer-facing flow. */
export async function signPdf(token) {
  const c = await byToken(token);
  if (!c || !c.signToken) return resp(404, { error: "This signing link is not valid" });
  if (c.status !== "Signed" || !c.executedFileId)
    return resp(409, { error: "The countersigned copy isn't ready yet" });
  const file = await get("FILE", c.executedFileId);
  if (!file?.key) return resp(404, { error: "The countersigned copy isn't available" });
  const url = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: FILES_BUCKET, Key: file.key,
    ResponseContentDisposition: `attachment; filename="${String(file.name).replace(/"/g, "")}"`
  }), { expiresIn: 300 });
  return resp(200, { url });
}

/* Pre-send readiness, surfaced in the UI so the Send button can explain itself
   rather than failing on click. */
export function signingReadiness(c) {
  const missing = [];
  if (!c.clientSignerName) missing.push("Client signer name");
  if (!c.clientSignerEmail) missing.push("Client signer email");
  if (!(c.clauses || []).length) missing.push("Contract terms");
  if (!c.paymentSchedule) missing.push("Payment schedule");
  if ((c.unresolvedVars || []).length) missing.push(`Template fields: ${c.unresolvedVars.join(", ")}`);
  return { ready: !missing.length, missing, deviations: deviationsOf(c) };
}
