/* OL Portal · WorkOS management API client.

   Distinct from authz.mjs, which verifies tokens on the way in and needs no
   credentials at all. This is the outbound half — reading and changing the
   directory of people — and it is the only thing in the portal that holds the
   WorkOS API key.

   The key is read at runtime from Secrets Manager and cached in module memory
   — never a build-time value, never committed. It is a *secret*, unlike the
   client id, so it must never reach the browser: the frontend is a static
   export and every NEXT_PUBLIC_* value is baked into publicly served
   JavaScript.

   Secrets Manager rather than the SSM SecureString that docusign.mjs and
   qbo.mjs use, because that is where this key actually lives. The secret is a
   JSON object; a bare string is accepted too, so moving it later does not
   require a code change. Note the id and the JSON key differ in case
   ("WorkOs" holding "WorkOS") — both are overridable rather than assumed.

   Nothing here logs a request header or an error body verbatim, because both
   can carry the Authorization line. Failures surface as the status plus
   WorkOS's own message field. */

import {
  SecretsManagerClient, GetSecretValueCommand
} from "@aws-sdk/client-secrets-manager";

const API = "https://api.workos.com";
const sm = new SecretsManagerClient({});

const SECRET_ID = () => process.env.WORKOS_SECRET_ID || "WorkOs";
const SECRET_KEY = () => process.env.WORKOS_SECRET_KEY || "WorkOS";

let keyCache;
async function apiKey() {
  if (keyCache !== undefined) return keyCache;
  try {
    const out = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_ID() }));
    const raw = (out.SecretString || "").trim();
    let key = raw;
    if (raw.startsWith("{")) {
      const obj = JSON.parse(raw);
      // Named key first; fall back to the only value if the secret holds one.
      const values = Object.values(obj).filter(v => typeof v === "string");
      key = obj[SECRET_KEY()] ?? (values.length === 1 ? values[0] : "");
    }
    return (keyCache = key ? key.trim() : null);
  } catch (err) {
    console.error(JSON.stringify({
      level: "warn", message: "WorkOS API key unreadable", detail: err.message
    }));
    return (keyCache = null);
  }
}

/* Which WorkOS environment the configured key addresses. Reported by callers
   so a staging key pointed at production (or the reverse) is visible rather
   than mysterious. Derived from the documented prefix only — never logged
   alongside anything else from the key. */
export async function environment() {
  const key = await apiKey();
  if (!key) return "unconfigured";
  if (key.startsWith("sk_test_")) return "staging";
  if (key.startsWith("sk_live_")) return "production";
  return "unknown";
}

/* True when the portal can talk to WorkOS at all. Callers use this to degrade
   rather than fail: the admin user list, for instance, still renders every
   PERSON record when WorkOS is unreachable — it just cannot say who has
   actually signed in. */
export async function isConfigured() {
  return Boolean(await apiKey());
}

export class WorkosError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(method, path, body) {
  const key = await apiKey();
  if (!key) throw new WorkosError("WorkOS is not configured", 503);

  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body ? { "content-type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    // WorkOS puts a human-readable reason in `message` (or `error_description`).
    // Deliberately not echoing the whole body: it can quote the request.
    const detail = data?.message || data?.error_description || data?.error || res.statusText;
    throw new WorkosError(`WorkOS ${method} ${path} failed: ${detail}`, res.status);
  }
  return data;
}

/* WorkOS paginates on `after`; a portal-sized directory fits in one page, but
   a loop here costs nothing and removes a silent truncation at 100. */
async function all(path, params = {}) {
  const out = [];
  let after;
  do {
    const qs = new URLSearchParams({ ...params, limit: "100", ...(after ? { after } : {}) });
    const page = await call("GET", `${path}?${qs}`);
    out.push(...(page.data || []));
    after = page.list_metadata?.after;
  } while (after);
  return out;
}

/* ---------- users ---------- */

export const listUsers = () => all("/user_management/users");

export async function findUserByEmail(email) {
  const [user] = await all("/user_management/users", {
    email: String(email).trim().toLowerCase()
  });
  return user || null;
}

/* Removes the account itself, which is what "remove from the portal" has to
   mean once sign-in is self-serve: deleting only the PERSON record would leave
   someone able to sign in and land in an empty lobby, and to keep doing so. */
export const deleteUser = id => call("DELETE", `/user_management/users/${id}`);

/* ---------- organizations ---------- */

export const listOrganizations = () => all("/organizations");

/* ---------- diagnostics ---------- */

/* Confirms the key works and reports what the environment actually holds,
   without revealing the key. Pair with environment() for which WorkOS
   environment that is. */
export async function status() {
  const [users, organizations] = await Promise.all([listUsers(), listOrganizations()]);
  return {
    reachable: true,
    users: users.length,
    organizations: organizations.map(o => ({ id: o.id, name: o.name })),
    signedIn: users.filter(u => u.last_sign_in_at).length
  };
}
