/* OL Portal · DocuSign eSignature integration.

   Platform-wide connection (one Optimistic Labs DocuSign account), same shape
   as qbo.mjs: credentials in SSM SecureString, Admin-gated connect/disconnect,
   a public OAuth-adjacent callback route. Two real differences from QBO:

     - Grant type is JWT, not Authorization Code. This runs unattended from a
       Lambda with no human present at call time — exactly what DocuSign
       recommends JWT Grant for — and it needs no refresh token at all (QBO's
       ~30-day refresh token going stale from disuse is an operational trap
       this avoids entirely). The one-time step is a browser consent grant for
       a dedicated impersonated service user, not a login-and-authorize.

     - DocuSign is scoped to the EXTERNAL signer only. OL's own countersignature
       stays exactly as it was (signing.mjs's countersign()); this module only
       ever writes `signatures.client` on a CONTRACT, the same field
       signing.mjs::signSubmit() already writes, so execution.mjs and the
       countersign dialog need no changes to keep working.

   Envelope records live at pk="ENVELOPE" sk=<docusignEnvelopeId>, independent
   of CONTRACT so an ad hoc document (envelopes.mjs) can use the exact same
   shape without a contract behind it. CONTRACT gains `envelopeId` (pointer)
   and `signMethod` (native|docusign, decided at send time and never changed
   retroactively — a contract keeps whichever method it was actually sent
   with even if the platform default flips later). */

import jwt from "jsonwebtoken";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { resp, today, get, put, docKind, byToken } from "./util.mjs";
import { writeAudit } from "./admin.mjs";
import { decorate } from "./contracts.mjs";

const s3 = new S3Client({});
const lambda = new LambdaClient({});
const ssm = new SSMClient({});
const FILES_BUCKET = process.env.FILES_BUCKET;

/* ---------- credentials: SSM SecureString, same shape as qbo.mjs::creds() ----------
   JSON blob: { integrationKey, userId, privateKey, impersonatedUserEmail, hmacKey }.
   No clientSecret (JWT Grant doesn't use one) and no refresh token to store. */
let credsCache;
async function creds() {
  if (credsCache) return credsCache;
  const param = process.env.DOCUSIGN_CREDS_PARAM;
  if (!param) return (credsCache = {});
  try {
    const p = await ssm.send(new GetParameterCommand({ Name: param, WithDecryption: true }));
    return (credsCache = JSON.parse(p.Parameter.Value));
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", message: "DocuSign creds param unreadable", detail: err.message }));
    return (credsCache = {});
  }
}

export async function isConfigured() {
  const c = await creds();
  return Boolean(c.integrationKey && c.userId && c.privateKey && c.impersonatedUserEmail);
}

const isProd = () => (process.env.DOCUSIGN_ENV || "demo").toLowerCase() === "production";
const authServer = () => (isProd() ? "account.docusign.com" : "account-d.docusign.com");
const redirectUri = () => process.env.DOCUSIGN_REDIRECT_URI || "";

/* ---------- connection state (ol-portal table, pk=DOCUSIGN sk=CONFIG) ----------
   Purely status/display — the account id and per-datacenter base URI, both
   discovered via /oauth/userinfo rather than hardcoded, since they vary by
   account. No tokens live here: a JWT access token is minted fresh (module-
   memory cache, see below) whenever one is needed. */
const loadConfig = async () => (await get("DOCUSIGN", "CONFIG")) || {};
const saveConfig = cfg => put({ pk: "DOCUSIGN", sk: "CONFIG", ...cfg });

export async function status(ctx) {
  if (ctx.role !== "Admin") return resp(403, { error: "DocuSign status is admin-only" });
  const cfg = await loadConfig();
  return resp(200, {
    configured: await isConfigured(),
    connected: !!cfg.connected,
    accountId: cfg.accountId || null,
    env: (process.env.DOCUSIGN_ENV || "demo").toLowerCase(),
    impersonatedUserEmail: cfg.impersonatedUserEmail || null,
    connectedAt: cfg.connectedAt || null,
    connectedBy: cfg.connectedBy || null,
    lastError: cfg.lastError || null
  });
}

export async function isConnected() {
  return !!(await loadConfig()).connected;
}

/* ---------- JWT Grant ----------
   Assertion signed RS256 per DocuSign's JWT Grant spec; access tokens last 1h
   and there is no refresh token, so a fresh assertion is minted whenever the
   cached token is within 60s of expiry. Consent (impersonation + signature
   scope) has to already be on file for `userId` — see connect()/callback(). */
let tokenCache = null; // { accessToken, expiresAt }

async function mintAccessToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.accessToken;
  const c = await creds();
  if (!c.integrationKey || !c.userId || !c.privateKey) throw new Error("DocuSign is not configured.");

  const assertion = jwt.sign(
    { scope: "signature impersonation" },
    c.privateKey,
    { algorithm: "RS256", issuer: c.integrationKey, subject: c.userId, audience: authServer(), expiresIn: "1h" }
  );
  const res = await fetch(`https://${authServer()}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // consent_required is DocuSign's own error code when the one-time consent
    // grant hasn't happened yet (or was revoked) — surface it distinctly so
    // /docusign/status can point an Admin at reconnecting instead of a generic
    // failure.
    const err = new Error(body.error === "consent_required" ? "consent_required" : `DocuSign token request HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    err.consentRequired = body.error === "consent_required";
    throw err;
  }
  tokenCache = { accessToken: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 - 60_000 };
  return tokenCache.accessToken;
}

async function userInfo(accessToken) {
  const res = await fetch(`https://${authServer()}/oauth/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`DocuSign userinfo HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/* accountId/apiBase come from the cached CONFIG record, refreshed at connect
   time — calling userinfo on every API request would be wasteful and DocuSign
   documents the base URI as effectively static per account. */
async function apiFetch(path, opts = {}) {
  const cfg = await loadConfig();
  if (!cfg.accountId || !cfg.apiBase) throw new Error("DocuSign is not connected.");
  const token = await mintAccessToken();
  const res = await fetch(`${cfg.apiBase}/v2.1/accounts/${cfg.accountId}${path}`, {
    ...opts,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(opts.headers || {}) }
  });
  if (!res.ok) throw new Error(`DocuSign API ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

/* ---------- connect / disconnect ----------
   "Connect" is a one-time browser consent grant for the impersonated service
   user (they log in to DocuSign once and approve `signature impersonation`
   scope for this integration key) — after that, mintAccessToken() above needs
   no further human interaction, ever. */
export async function connect(ctx) {
  if (ctx.role !== "Admin") return resp(403, { error: "DocuSign connection is admin-only" });
  if (!(await isConfigured())) return resp(409, { error: "DocuSign credentials are not configured yet" });
  const c = await creds();
  const params = new URLSearchParams({
    response_type: "code",
    scope: "signature impersonation",
    client_id: c.integrationKey,
    redirect_uri: redirectUri()
  });
  return resp(200, { url: `https://${authServer()}/oauth/auth?${params}` });
}

export async function disconnectConnection(ctx) {
  if (ctx.role !== "Admin") return resp(403, { error: "DocuSign disconnect is admin-only" });
  tokenCache = null;
  await saveConfig({ connected: false });
  await writeAudit(ctx.me.sk, "docusign.disconnected", "DocuSign connection cleared");
  return resp(200, { disconnected: true });
}

/* DocuSign redirects the admin's browser here after the consent screen; there
   is no JWT on this request (Authorizer NONE in template.yaml). The `code`
   query param is only proof consent completed — JWT Grant never exchanges it
   for a token, it just means the next mintAccessToken() call will succeed. */
export async function callback(event) {
  const back = ok => ({
    statusCode: 302,
    headers: { location: `${process.env.FRONTEND_URL}/contracts.html?docusign=${ok ? "connected" : "error"}` }
  });
  const { code, error } = event.queryStringParameters || {};
  if (error || !code) return back(false);
  try {
    tokenCache = null;
    const token = await mintAccessToken();
    const info = await userInfo(token);
    const account = info.accounts?.find(a => a.is_default) || info.accounts?.[0];
    if (!account) throw new Error("DocuSign userinfo returned no accounts");
    const c = await creds();
    await saveConfig({
      connected: true,
      accountId: account.account_id,
      apiBase: `https://${account.base_uri.replace(/^https?:\/\//, "")}/restapi`,
      impersonatedUserEmail: c.impersonatedUserEmail,
      connectedAt: new Date().toISOString(),
      lastError: null
    });
    await registerConnectWebhook().catch(err =>
      // Non-fatal: the sandbox PoC can configure Connect manually via the
      // admin console if this call's request shape needs adjusting for the
      // account — verify against DocuSign's Connect Configurations API
      // reference before relying on this in production.
      console.error(JSON.stringify({ level: "warn", message: "DocuSign Connect webhook auto-register failed", detail: err.message })));
    await writeAudit("system", "docusign.connected", `account ${account.account_id}`);
    return back(true);
  } catch (err) {
    await saveConfig({ connected: false, lastError: err.message }).catch(() => {});
    console.error(JSON.stringify({ level: "error", message: "DocuSign callback failed", detail: err.message }));
    return back(false);
  }
}

/* Registers (or leaves alone, if one already points here) an account-level
   Connect configuration in JSON SIM format for the events this integration
   consumes. Best-effort — see the caller's comment. */
async function registerConnectWebhook() {
  const c = await creds();
  const url = `${process.env.DOCUSIGN_WEBHOOK_URL || ""}`;
  if (!url || !c.hmacKey) return;
  const existing = await apiFetch("/connect").catch(() => null);
  if ((existing?.configurations || []).some(cfg => cfg.urlToPublishTo === url)) return;
  await apiFetch("/connect", {
    method: "POST",
    body: JSON.stringify({
      connectConfiguration: {
        urlToPublishTo: url,
        name: "OL Portal",
        allowEnvelopePublish: "true",
        enableLog: "true",
        requiresAcknowledgement: "true",
        signMessageWithX509Cert: "false",
        includeHMAC: "true",
        hmacKey: c.hmacKey,
        events: ["envelope-sent", "envelope-delivered", "recipient-completed", "envelope-completed", "envelope-declined", "envelope-voided"]
      }
    })
  });
}

/* ---------- templates (for the ad hoc "pick a template" picker in envelopes.mjs) ---------- */
export async function listDocuSignTemplates(ctx) {
  if (ctx.role === "Contributor") return resp(403, { error: "Not allowed" });
  if (!(await isConnected())) return resp(409, { error: "DocuSign is not connected" });
  const body = await apiFetch("/templates?count=100");
  return resp(200, (body.envelopeTemplates || []).map(t => ({ templateId: t.templateId, name: t.name })));
}

/* ---------- envelope primitives (shared by the contract flow below and envelopes.mjs) ---------- */

/* documentBase64 is a full PDF; anchors like "[[ds_sig_client]]" placed in it
   (see pdf/index.mjs's signatureBlock()) let DocuSign autoplace tabs instead
   of relying on fixed coordinates, since these documents are dynamically
   generated and vary in length. clientUserId flags a recipient as embedded
   (signs inside the Portal) rather than remote (signs via an emailed link). */
export async function createEnvelope({ documentBase64, documentName, subject, emailBlurb, recipients }) {
  const signers = recipients.map((r, i) => ({
    email: r.email, name: r.name, recipientId: String(i + 1), routingOrder: String(r.routingOrder ?? i + 1),
    ...(r.clientUserId ? { clientUserId: r.clientUserId } : {}),
    tabs: {
      signHereTabs: [{ anchorString: `[[ds_sig_${r.anchor}]]`, anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "-10", optional: "false" }],
      dateSignedTabs: [{ anchorString: `[[ds_date_${r.anchor}]]`, anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "-10" }]
    }
  }));
  const body = await apiFetch("/envelopes", {
    method: "POST",
    body: JSON.stringify({
      emailSubject: subject.slice(0, 100),
      emailBlurb,
      status: "sent",
      documents: [{ documentBase64, name: documentName, fileExtension: "pdf", documentId: "1" }],
      recipients: { signers }
    })
  });
  return body.envelopeId;
}

export async function voidEnvelope(envelopeId, reason) {
  await apiFetch(`/envelopes/${envelopeId}`, {
    method: "PUT",
    body: JSON.stringify({ status: "voided", voidedReason: reason.slice(0, 200) })
  });
}

export async function resendEnvelopeNotification(envelopeId) {
  await apiFetch(`/envelopes/${envelopeId}?resend_envelope=true`, { method: "PUT", body: JSON.stringify({}) });
}

/* One-time, 5-minute-lived embedded signing URL — minted fresh on every page
   load per DocuSign's own guidance (never stored, never emailed). */
export async function createEmbeddedRecipientView({ envelopeId, clientUserId, name, email, returnUrl }) {
  const body = await apiFetch(`/envelopes/${envelopeId}/views/recipient`, {
    method: "POST",
    body: JSON.stringify({ returnUrl, authenticationMethod: "none", clientUserId, userName: name, email })
  });
  return body.url;
}

export async function downloadCombinedPdf(envelopeId) {
  const cfg = await loadConfig();
  const token = await mintAccessToken();
  const res = await fetch(`${cfg.apiBase}/v2.1/accounts/${cfg.accountId}/envelopes/${envelopeId}/documents/combined`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`DocuSign document download HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ---------- ENVELOPE record (pk=ENVELOPE) ----------
   Exported so docusign-webhook.mjs (inbound Connect events) and envelopes.mjs
   (ad hoc documents) can read/write the same record shape this module writes
   when a contract's envelope is created. */
export const saveEnvelopeRecord = rec => put({ pk: "ENVELOPE", sk: rec.envelopeId, ...rec });
export const getEnvelopeRecord = envelopeId => get("ENVELOPE", envelopeId);

export function appendHistory(rec, event) {
  return { ...rec, history: [...(rec.history || []), { event, at: new Date().toISOString() }] };
}

/* ---------- contract/MSA/task-order integration ----------
   Called from signing.mjs::sendForSignature when DocuSign is connected. The
   caller has already run requirements()/frozen executionCopy+documentHash —
   this only needs to get a PDF of that frozen document in front of DocuSign. */
export async function sendContractEnvelope(ctx, c) {
  // Render the (unsigned) draft PDF via the existing PDF Lambda, then read the
  // bytes back from S3 — the same pattern execution.mjs uses for the executed
  // copy, just invoked before either signature exists.
  const out = await lambda.send(new InvokeCommand({
    FunctionName: process.env.PDF_FUNCTION_NAME,
    Payload: Buffer.from(JSON.stringify({ direct: true, kind: "contracts", id: c.sk, actor: ctx.me.sk }))
  }));
  const parsed = JSON.parse(Buffer.from(out.Payload).toString("utf8") || "{}");
  const payload = parsed.body ? JSON.parse(parsed.body) : parsed;
  if (!payload?.fileId) throw new Error("Could not render the document for DocuSign");
  const file = await get("FILE", payload.fileId);
  const obj = await s3.send(new GetObjectCommand({ Bucket: FILES_BUCKET, Key: file.key }));
  const documentBase64 = Buffer.from(await obj.Body.transformToByteArray()).toString("base64");

  const { subject, intro } = requestCopy(c);
  const envelopeId = await createEnvelope({
    documentBase64, documentName: file.name, subject, emailBlurb: intro,
    recipients: [{ email: c.clientSignerEmail, name: c.clientSignerName, anchor: "client", clientUserId: `contract-${c.sk}` }]
  });

  await saveEnvelopeRecord({
    envelopeId, source: "contract", contractId: c.sk, docKind: docKind(c),
    status: "sent", subject, sentBy: ctx.me.sk, sentAt: new Date().toISOString(), lastStatusAt: new Date().toISOString(),
    recipients: [{ name: c.clientSignerName, email: c.clientSignerEmail, role: "signer", routingOrder: 1, status: "sent" }],
    history: [{ event: "envelope-sent", at: new Date().toISOString() }]
  });
  await writeAudit(ctx.me.sk, "docusign.envelope-sent", `${c.sk} → envelope ${envelopeId}`);
  return envelopeId;
}

function requestCopy(c) {
  if (docKind(c) === "msa") return { subject: "Please sign: Optimistic Labs Master Services Agreement", intro: "Please review and sign the attached Master Services Agreement." };
  if (docKind(c) === "task-order") return { subject: `Please sign: Optimistic Labs Task Order ${c.sk}`, intro: `Please review and sign Task Order ${c.sk}.` };
  return { subject: `Please sign: Optimistic Labs services agreement (${c.client})`, intro: "Please review and sign the attached services agreement." };
}

const canManageContract = (ctx, c) => ctx.role === "Admin" || (ctx.role === "Lab Leader" && (ctx.can.seesLab(c.lab) || c.owner === ctx.me.sk));

export async function resendContractEnvelope(ctx, id) {
  const c = await get("CONTRACT", id);
  if (!c) return resp(404, { error: "contract not found" });
  if (!canManageContract(ctx, c)) return resp(403, { error: "Not allowed to manage this contract" });
  if (!c.envelopeId) return resp(409, { error: "This contract has no DocuSign envelope" });
  await resendEnvelopeNotification(c.envelopeId);
  await writeAudit(ctx.me.sk, "docusign.envelope-resent", `${id} envelope ${c.envelopeId}`);
  return resp(200, { resent: true });
}

/* Void reverts the contract to Internal Review for editing/re-send, rather
   than exposing DocuSign's own "Correct" view — Correct would let someone
   edit document bytes DocuSign holds independently of this app's own
   template/pricing/clause/hash model, which would drift the two apart. */
export async function voidContractEnvelope(ctx, id, body) {
  const c = await get("CONTRACT", id);
  if (!c) return resp(404, { error: "contract not found" });
  if (!canManageContract(ctx, c)) return resp(403, { error: "Not allowed to manage this contract" });
  if (!c.envelopeId) return resp(409, { error: "This contract has no DocuSign envelope" });
  const reason = String(body?.reason || "Voided from the OL Portal").slice(0, 200);
  await voidEnvelope(c.envelopeId, reason);
  const rec = await getEnvelopeRecord(c.envelopeId);
  if (rec) await saveEnvelopeRecord(appendHistory({ ...rec, status: "voided", voidReason: reason, lastStatusAt: new Date().toISOString() }, "envelope-voided"));
  const next = { ...c, status: "Internal Review", updated: today() };
  await put(next);
  await writeAudit(ctx.me.sk, "docusign.envelope-voided", `${id} envelope ${c.envelopeId} · ${reason}`);
  return resp(200, decorate(next));
}

/* Public: the contract-sign page iframes this URL for the external signer.
   Token is the credential, same model as the rest of the customer flow. */
export async function contractEmbeddedView(token) {
  const c = await byToken(token);
  if (!c || !c.envelopeId) return resp(404, { error: "No DocuSign envelope for this link" });
  const url = await createEmbeddedRecipientView({
    envelopeId: c.envelopeId, clientUserId: `contract-${c.sk}`,
    name: c.clientSignerName, email: c.clientSignerEmail,
    returnUrl: `${process.env.FRONTEND_URL}/contract-sign.html?token=${token}`
  });
  return resp(200, { url });
}

/* Webhook (Connect) receiving and idempotent-processing lives in
   docusign-webhook.mjs — a separate module for the same reason execution.mjs
   is split from signing.mjs: this file makes outbound DocuSign API calls,
   that one processes inbound events, and the two shouldn't have to grow
   together. It reads the shared HMAC key via credsForWebhook() below. */
export const credsForWebhook = creds;
