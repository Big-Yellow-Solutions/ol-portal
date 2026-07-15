/* QuickBooks Online integration — ported from Bookspark (invoice-collapse) qbo.py.
   Real Intuit OAuth 2.0 authorization-code flow + live invoice reads, adapted to
   this stack: SSM SecureString for credentials (same pattern as the analyzer's
   Anthropic key), the existing ol-portal DynamoDB table for tokens + CSRF state.

   Endpoints (verified against Intuit docs):
     Authorization : https://appcenter.intuit.com/connect/oauth2
     Token exchange: https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
     API base      : https://quickbooks.api.intuit.com          (production)
                     https://sandbox-quickbooks.api.intuit.com  (sandbox)

   Single-tenant on purpose: one connected QuickBooks company (OL's). */

import { randomBytes, createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand
} from "@aws-sdk/lib-dynamodb";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";
const MINOR_VERSION = "75";

const TABLE = process.env.TABLE_NAME;
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const ssm = new SSMClient({});

/* ---------- credentials: SSM SecureString, env fallback ----------
   The SSM param (QBO_CREDS_PARAM) holds JSON {"clientId":"…","clientSecret":"…"}.
   Cached for the warm Lambda; after rotating the secret, force a cold start. */
let credsCache;
async function creds() {
  if (credsCache) return credsCache;
  const param = process.env.QBO_CREDS_PARAM;
  if (param) {
    try {
      const p = await ssm.send(new GetParameterCommand({ Name: param, WithDecryption: true }));
      credsCache = JSON.parse(p.Parameter.Value);
      return credsCache;
    } catch (err) {
      console.error(JSON.stringify({ level: "warn", message: "QBO creds param unreadable, falling back to env", detail: err.message }));
    }
  }
  credsCache = {
    clientId: process.env.QBO_CLIENT_ID || "",
    clientSecret: process.env.QBO_CLIENT_SECRET || ""
  };
  return credsCache;
}

const redirectUri = () => process.env.QBO_REDIRECT_URI || "";
const apiBase = () =>
  (process.env.QBO_ENV || "sandbox").toLowerCase() === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

export async function isConfigured() {
  const c = await creds();
  return Boolean(c.clientId && c.clientSecret && redirectUri());
}

/* ---------- token + CSRF-state store (ol-portal table) ----------
   Tokens: one fixed row pk QBO / sk TOKENS. States: pk QBO / sk STATE#<state>,
   expiry enforced in code on consume (the table has no TTL attribute). */
const STATE_TTL_MS = 10 * 60 * 1000;

const loadTokens = async () =>
  (await doc.send(new GetCommand({ TableName: TABLE, Key: { pk: "QBO", sk: "TOKENS" } }))).Item || {};

const saveTokens = tok =>
  doc.send(new PutCommand({ TableName: TABLE, Item: { pk: "QBO", sk: "TOKENS", ...tok } }));

const clearTokens = () =>
  doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: "QBO", sk: "TOKENS" } }));

const rememberState = state =>
  doc.send(new PutCommand({
    TableName: TABLE,
    Item: { pk: "QBO", sk: `STATE#${state}`, expiresAt: Date.now() + STATE_TTL_MS }
  }));

async function consumeState(state) {
  if (!state) return false;
  const key = { pk: "QBO", sk: `STATE#${state}` };
  const row = (await doc.send(new GetCommand({ TableName: TABLE, Key: key }))).Item;
  if (!row) return false;
  await doc.send(new DeleteCommand({ TableName: TABLE, Key: key }));
  return row.expiresAt > Date.now();
}

export async function isConnected() {
  const tok = await loadTokens();
  return Boolean(tok.accessToken && tok.realmId);
}

export async function status() {
  const tok = await loadTokens();
  return {
    configured: await isConfigured(),
    connected: Boolean(tok.accessToken && tok.realmId),
    realmId: tok.realmId || null,
    env: (process.env.QBO_ENV || "sandbox").toLowerCase()
  };
}

/* ---------- OAuth 2.0 authorization-code flow ---------- */
export async function buildAuthorizeUrl() {
  const c = await creds();
  const state = randomBytes(24).toString("base64url");
  await rememberState(state);
  const params = new URLSearchParams({
    client_id: c.clientId,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri(),
    state
  });
  return `${AUTH_URL}?${params}`;
}

async function basicAuthHeader() {
  const c = await creds();
  return "Basic " + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
}

async function tokenRequest(form) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: await basicAuthHeader(),
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json"
    },
    body: new URLSearchParams(form)
  });
  if (!res.ok) {
    // Fingerprints (non-reversible) prove WHICH credentials this instance used:
    // a 401 invalid_client almost always means the other Intuit environment's
    // secret (dev and prod share the client id but not the secret).
    const c = await creds();
    const fp = v => (v ? createHash("sha256").update(v).digest("hex").slice(0, 8) : "EMPTY");
    const text = (await res.text()).slice(0, 300);
    throw new Error(`QBO token request HTTP ${res.status}: ${text} (id#${fp(c.clientId)} sec#${fp(c.clientSecret)}, redirect_uri ${redirectUri()})`);
  }
  return res.json();
}

async function storeTokens(tok, realmId) {
  const current = await loadTokens();
  await saveTokens({
    accessToken: tok.access_token,
    // refresh responses may omit the refresh token; keep the existing one
    refreshToken: tok.refresh_token || current.refreshToken,
    // expires_in is seconds; refresh a minute early to be safe
    expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000 - 60_000,
    realmId: realmId || current.realmId
  });
}

export async function exchangeCode(code, realmId, state) {
  if (!(await consumeState(state)))
    throw new Error("Invalid OAuth state: possible CSRF, or the flow expired.");
  const tok = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri()
  });
  await storeTokens(tok, realmId);
}

async function validAccessToken() {
  const tok = await loadTokens();
  if (!tok.accessToken) throw new Error("Not connected to QuickBooks.");
  if (Date.now() < (tok.expiresAt || 0)) return tok.accessToken;
  await storeTokens(await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: tok.refreshToken
  }));
  return (await loadTokens()).accessToken;
}

export const disconnect = () => clearTokens();

/* ---------- live reads ---------- */
async function companyGet(path, query) {
  const { realmId } = await loadTokens();
  const params = new URLSearchParams({ ...query, minorversion: MINOR_VERSION });
  const res = await fetch(`${apiBase()}/v3/company/${realmId}/${path}?${params}`, {
    headers: { authorization: `Bearer ${await validAccessToken()}`, accept: "application/json" }
  });
  if (!res.ok) throw new Error(`QBO ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function listInvoices() {
  const body = await companyGet("query", { query: "SELECT * FROM Invoice MAXRESULTS 100" });
  return (body.QueryResponse?.Invoice || []).map(normalizeInvoice);
}

/* Map a QBO Invoice to the shape the invoices page renders. DocNumber is the
   human invoice number; a zero Balance means Paid. */
function normalizeInvoice(inv) {
  const balance = Number(inv.Balance ?? 0);
  return {
    id: inv.Id,
    number: inv.DocNumber || inv.Id,
    customer: inv.CustomerRef?.name || "(unknown)",
    total: Number(inv.TotalAmt ?? 0),
    balance,
    status: balance === 0 ? "Paid" : "Open",
    txnDate: inv.TxnDate || null,
    dueDate: inv.DueDate || null
  };
}
