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
   Leader who negotiated the deal.

   The Contributor MSA PRD reuses all of this unchanged for MSAs and task
   orders: same tokenized link, same hash, same countersignature routing "with
   no exceptions" (PRD 5.2.2). What varies per kind is which fields must be
   present before a document can go out, and what the emails call it. */

import { createHash, randomBytes } from "node:crypto";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { resp, today, get, put, listType, fullName, esc, signUrl, docKind, docMeta, byToken } from "./util.mjs";
import { writeAudit } from "./admin.mjs";
import { sendClientEmail } from "./email.mjs";
import { deviationsOf } from "./contracts.mjs";
import { mergeClauses, templateVars } from "./templates.mjs";
import { generateExecutedPdf, rollUpDeal, deliverCopies, inviteOnExecution } from "./execution.mjs";
import { pricingTotal } from "./pricing.mjs";
import * as docusign from "./docusign.mjs";

const s3 = new S3Client({});
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
export function executionCopy(c) {
  return {
    contractId: c.sk,
    /* What kind of paper this is, and what it hangs off, are part of the
       agreement rather than metadata about it: a task order that could be
       re-pointed at a different MSA after signature would not be the document
       anyone signed.

       Adding fields here is safe for documents already out for signature. The
       tamper check rehashes the *stored* executionCopy, never a freshly built
       one, so a contract sent before this deploy keeps its own copy and its
       own hash and still verifies. Only documents sent from now on carry
       these keys. */
    docKind: docKind(c),
    ...(c.parentId ? { parentId: c.parentId } : {}),
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

  /* Re-merge the terms before checking readiness. updateContract() already
     does this on every save, but a contract generated before that existed
     would carry a stale unresolved list and could never be sent; re-merging
     here is idempotent and lets those self-heal. */
  if ((c.clauses || []).length) {
    const [deal, lab, owner, parent] = await Promise.all([
      c.deal ? get("DEAL", c.deal) : null,
      get("LAB", c.lab),
      c.owner ? get("PERSON", c.owner) : null,
      c.parentId ? get("CONTRACT", c.parentId) : null
    ]);
    const merged = mergeClauses(c.clauses, templateVars({ contract: c, deal, lab, owner, signatory: null, parent }));
    c.clauses = merged.clauses;
    c.unresolvedVars = merged.unresolved;
  }

  // Everything that would make a signed document defective is checked here,
  // once, rather than discovered by the counterparty on the signing page.
  const problems = requirements(c);
  if (problems.length)
    return resp(400, { error: `Before sending, add ${problems.map(p => p.sentence).join("; ")}.` });

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
    signMethod: "native",
    updated: today()
  };
  await put(next);

  /* DocuSign is the default signing method when connected — scoped to the
     external signer only, so nothing past this point (the OL countersign
     dialog, execution.mjs) has to know or care which method was used.
     Sending invokes the PDF renderer, which reads this record back from
     DynamoDB, which is why it has to be persisted (frozen, Out for Signature)
     before this runs. If creating the envelope itself fails, the contract
     reverts to exactly its pre-send state rather than being left half-sent —
     deliberately NOT a silent fall-back to native, since that would leave
     DocuSign's own dashboard showing nothing for a contract the Portal thinks
     went out. */
  let sent = next;
  if (await docusign.isConnected()) {
    try {
      const envelopeId = await docusign.sendContractEnvelope(ctx, next);
      sent = { ...next, envelopeId, signMethod: "docusign" };
      await put(sent);
    } catch (err) {
      await put({ ...c, updated: today() });
      console.error(JSON.stringify({ level: "error", message: "DocuSign envelope creation failed, contract not sent", detail: err.message }));
      return resp(502, { error: `Could not send via DocuSign: ${err.message}. The contract was not sent — try again, or disconnect DocuSign to send natively.` });
    }
  }

  await writeAudit(ctx.me.sk, "contract.sent-for-signature",
    `${id} (${c.client}) → ${c.clientSignerEmail} · countersigner ${signatory.sk} · sha256 ${sent.documentHash.slice(0, 12)} · via ${sent.signMethod}`);

  const url = signUrl(sent.signToken);
  const senderName = fullName(ctx.me);
  const { subject, intro } = requestCopy(c, senderName);
  const text = `Hi ${c.clientSignerName},\n\n${intro}\n\n` +
    `Review and sign it here: ${url}\n\n` +
    `You'll get a countersigned PDF copy by email once we've signed too.\n\n— Optimistic Labs`;
  const html = `<p>Hi ${esc(c.clientSignerName)},</p>` +
    `<p>${esc(intro)}</p>` +
    `<p><a href="${url}">Review and sign it here</a>.</p>` +
    `<p>You'll get a countersigned PDF copy by email once we've signed too.</p><p>— Optimistic Labs</p>`;

  let emailSent = false, emailError;
  try {
    await sendClientEmail({ sender: { ...ctx.me, name: senderName }, toEmail: c.clientSignerEmail, subject, text, html });
    emailSent = true;
  } catch (err) {
    emailError = err.message;
  }

  const { pk, sk, ...rest } = sent;
  return resp(200, { id: sk, ...rest, url, emailSent, emailError });
}

/* Per-kind wording for the signature request. A Contributor asked to sign an
   MSA shouldn't receive an email calling it a client services agreement — the
   subject line is the first thing they read, and getting it wrong makes the
   whole exchange look like a misdirected email. */
function requestCopy(c, senderName) {
  const from = `${senderName} at Optimistic Labs`;
  if (docKind(c) === "msa") return {
    subject: "Please sign: Optimistic Labs Master Services Agreement",
    intro: `${from} has sent you a Master Services Agreement to review and sign.`
  };
  if (docKind(c) === "task-order") return {
    subject: `Please sign: Optimistic Labs Task Order ${c.sk}`,
    intro: `${from} has sent you Task Order ${c.sk} to review and sign. It's issued under the ` +
      `Master Services Agreement you've already signed with us, whose terms it doesn't change.`
  };
  return {
    subject: `Please sign: Optimistic Labs services agreement (${c.client})`,
    intro: `${from} has sent you a services agreement to review and sign.`
  };
}

/* ---------- public signing routes (Authorizer NONE) ---------- */

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
    /* What the signing page should call this. It reads from the live record
       rather than the frozen copy so a document sent before docKind existed
       still labels itself correctly instead of rendering "undefined". */
    docKind: docKind(c),
    docLabel: docMeta(c).label,
    docTitle: docMeta(c).title,
    parentId: c.parentId || null,
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
    pdfReady: !!c.executedFileId,
    // Tells the sign page whether to render the native signature capture or
    // embed the DocuSign signing ceremony (GET /sign/{token}/docusign-view).
    signMethod: c.signMethod === "docusign" ? "docusign" : "native",
    envelopeId: c.envelopeId || null
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
  // A DocuSign-routed agreement's client signature can only ever be recorded
  // by the Connect webhook — never by this native endpoint, or the two
  // sources of truth could disagree about who signed what.
  if (c.envelopeId) return resp(409, { error: "Sign this agreement in the DocuSign window above." });

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
    `${c.sk} ${docMeta(c).label} (${c.client}) · ${record.signatureType} · ip ${record.ip}`);

  // FR13 step two: tell the OL signatory it's their turn.
  await notifyCountersigner(c, record);
  return resp(200, { recorded: "client", awaiting: "ol" });
}

async function notifyCountersigner(c, clientSig) {
  try {
    const signatory = c.olSignatory ? await get("PERSON", c.olSignatory) : null;
    if (!signatory?.email) return;
    const url = `${process.env.FRONTEND_URL}/contracts.html`;
    const line = `${clientSig.name} signed the ${docMeta(c).title} for ${c.client} (${c.sk}). It needs your countersignature.`;
    await sendClientEmail({
      sender: { name: "Optimistic Labs", email: null },
      subject: `[OL Portal] Countersignature needed: ${docMeta(c).label} · ${c.client}`,
      toEmail: signatory.email,
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
  await inviteOnExecution(next).catch(err =>
    console.error(JSON.stringify({ level: "warn", message: "contributor invite failed", detail: err.message })));

  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest, pdfFileId: pdf?.fileId || null });
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

/* What a document needs before it can be signed, in one place. Two callers
   read it: sendForSignature refuses on it, and signingReadiness renders it so
   the Send button can explain itself rather than failing on click. These were
   two separate literals that had already drifted apart in wording; one list
   means the UI can never promise a document is ready when the API disagrees.

   The requirements themselves depend on what the document is:

     client      a payment schedule. A customer contract without one is the
                 most common cause of an invoicing argument later.
     msa         no payment schedule and no price. An MSA sets the terms of a
                 relationship; money is agreed per task order, and a schedule
                 here would commit nobody to anything (PRD 5.1.2).
     task-order  compensation and a timeline, which are the substance of
                 authorising one specific piece of work (PRD 5.3.2). */
function requirements(c) {
  const kind = docKind(c);
  const who = kind === "client" ? "client signer" : "contributor signer";
  const unresolved = c.unresolvedVars || [];
  const checks = [
    [!c.clientSignerName, `the ${who}'s name`, "Signer name"],
    [!c.clientSignerEmail || !EMAIL_RE.test(c.clientSignerEmail), `a valid ${who} email`, "Signer email"],
    [!(c.clauses || []).length,
      `${docMeta(c).label} terms (no template is attached to this lab)`, "Terms"]
  ];
  if (kind === "client") checks.push([!c.paymentSchedule, "a payment schedule", "Payment schedule"]);
  if (kind === "task-order") {
    checks.push([pricingTotal(c.pricing) === null, "the compensation for this task order", "Compensation"]);
    checks.push([!(c.sections?.timeline || "").trim(), "a timeline", "Timeline"]);
  }
  checks.push([unresolved.length > 0,
    `values for the unfilled template fields: ${unresolved.join(", ")}`,
    `Template fields: ${unresolved.join(", ")}`]);
  return checks.filter(([missing]) => missing).map(([, sentence, label]) => ({ sentence, label }));
}

/* Pre-send readiness, surfaced in the UI so the Send button can explain itself
   rather than failing on click. */
export function signingReadiness(c) {
  const missing = requirements(c).map(p => p.label);
  return { ready: !missing.length, missing, deviations: deviationsOf(c) };
}
