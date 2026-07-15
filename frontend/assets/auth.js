/* OL Portal · Cognito auth via plain fetch (USER_PASSWORD_AUTH + refresh).
   Handles the full challenge chain: NEW_PASSWORD_REQUIRED → MFA_SETUP (TOTP
   enrollment) → SOFTWARE_TOKEN_MFA, plus self-service password reset (PRD 2.4)
   and a HaveIBeenPwned breached-password check (PRD 2.3).
   Tokens live in localStorage; every API call attaches the ID token as a Bearer. */

const IDP_URL = `https://cognito-idp.${CONFIG.region}.amazonaws.com/`;
const TOKEN_KEY = "olportal.auth.v1";

async function cognito(target, body) {
  const res = await fetch(IDP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": "AWSCognitoIdentityProviderService." + target
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.__type || "Authentication failed");
  return data;
}

function getAuth() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY)); } catch { return null; }
}

function saveTokens(result, username) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify({
    id: result.IdToken,
    refresh: result.RefreshToken || getAuth()?.refresh,
    exp: Date.now() + (result.ExpiresIn || 3600) * 1000 - 60000,
    username
  }));
}

/* ---------- sign-in state machine ----------
   Each step returns one of: "done" | "new-password" | "mfa-setup" | "mfa-code".
   The pending session/secret lives here so login.html stays plain UI code. */
let pending = null;

async function handleAuthResponse(r, username) {
  if (r.AuthenticationResult) {
    saveTokens(r.AuthenticationResult, username.toLowerCase());
    pending = null;
    return "done";
  }
  if (r.ChallengeName === "NEW_PASSWORD_REQUIRED") {
    pending = { username, session: r.Session };
    return "new-password";
  }
  if (r.ChallengeName === "MFA_SETUP") {
    const a = await cognito("AssociateSoftwareToken", { Session: r.Session });
    pending = { username, session: a.Session, secret: a.SecretCode };
    return "mfa-setup";
  }
  if (r.ChallengeName === "SOFTWARE_TOKEN_MFA") {
    pending = { username, session: r.Session };
    return "mfa-code";
  }
  throw new Error("Unsupported sign-in challenge: " + r.ChallengeName);
}

async function startLogin(username, password) {
  const r = await cognito("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: CONFIG.clientId,
    AuthParameters: { USERNAME: username, PASSWORD: password }
  });
  return handleAuthResponse(r, username);
}

async function submitNewPassword(newPassword) {
  const r = await cognito("RespondToAuthChallenge", {
    ClientId: CONFIG.clientId,
    ChallengeName: "NEW_PASSWORD_REQUIRED",
    Session: pending.session,
    ChallengeResponses: { USERNAME: pending.username, NEW_PASSWORD: newPassword }
  });
  return handleAuthResponse(r, pending.username);
}

function mfaSetupSecret() { return pending?.secret; }
function mfaSetupUri() {
  return `otpauth://totp/OL%20Portal:${encodeURIComponent(pending.username)}` +
    `?secret=${pending.secret}&issuer=OL%20Portal`;
}

async function submitMfaSetupCode(code) {
  const v = await cognito("VerifySoftwareToken", {
    Session: pending.session, UserCode: code
  });
  if (v.Status !== "SUCCESS") throw new Error("That code didn't verify; try the next one.");
  const r = await cognito("RespondToAuthChallenge", {
    ClientId: CONFIG.clientId,
    ChallengeName: "MFA_SETUP",
    Session: v.Session,
    ChallengeResponses: { USERNAME: pending.username }
  });
  return handleAuthResponse(r, pending.username);
}

async function submitMfaCode(code) {
  const r = await cognito("RespondToAuthChallenge", {
    ClientId: CONFIG.clientId,
    ChallengeName: "SOFTWARE_TOKEN_MFA",
    Session: pending.session,
    ChallengeResponses: { USERNAME: pending.username, SOFTWARE_TOKEN_MFA_CODE: code }
  });
  return handleAuthResponse(r, pending.username);
}

/* ---------- self-service password reset (PRD 2.4) ---------- */
async function forgotPassword(username) {
  await cognito("ForgotPassword", { ClientId: CONFIG.clientId, Username: username });
}
async function confirmForgotPassword(username, code, newPassword) {
  await cognito("ConfirmForgotPassword", {
    ClientId: CONFIG.clientId, Username: username,
    ConfirmationCode: code, Password: newPassword
  });
}

/* ---------- password quality (PRD 2.3) ---------- */
function passwordProblem(pw) {
  if ((pw || "").length < 12) return "Password must be at least 12 characters.";
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw))
    return "Password needs an uppercase letter, a lowercase letter, and a number.";
  return null;
}

/* k-anonymity range check: only the first 5 chars of the SHA-1 leave the
   browser. Fails open if HIBP is unreachable — Cognito policy still applies. */
async function pwnedCount(pw) {
  try {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(pw));
    const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const res = await fetch("https://api.pwnedpasswords.com/range/" + hex.slice(0, 5),
      { headers: { "Add-Padding": "true" } });
    if (!res.ok) return 0;
    const hit = (await res.text()).split("\n").find(l => l.startsWith(hex.slice(5)));
    return hit ? parseInt(hit.split(":")[1], 10) || 0 : 0;
  } catch { return 0; }
}

/* ---------- session ---------- */
async function getToken() {
  const a = getAuth();
  if (!a) { logout(); throw new Error("Not signed in"); }
  if (Date.now() < a.exp) return a.id;
  try {
    const r = await cognito("InitiateAuth", {
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: CONFIG.clientId,
      AuthParameters: { REFRESH_TOKEN: a.refresh }
    });
    saveTokens(r.AuthenticationResult, a.username);
    return r.AuthenticationResult.IdToken;
  } catch {
    logout();
    throw new Error("Session expired");
  }
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  if (!location.pathname.endsWith("login.html")) location.href = "login.html";
}

function requireAuth() {
  if (!getAuth()) location.href = "login.html";
}
