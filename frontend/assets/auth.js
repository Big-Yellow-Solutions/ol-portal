/* OL Portal · Cognito auth via plain fetch (USER_PASSWORD_AUTH + refresh).
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

async function login(username, password, newPassword) {
  const r = await cognito("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: CONFIG.clientId,
    AuthParameters: { USERNAME: username, PASSWORD: password }
  });
  if (r.ChallengeName === "NEW_PASSWORD_REQUIRED") {
    if (!newPassword) {
      const e = new Error("Set a new password to finish signing in.");
      e.code = "NEW_PASSWORD_REQUIRED";
      throw e;
    }
    const c = await cognito("RespondToAuthChallenge", {
      ClientId: CONFIG.clientId,
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      Session: r.Session,
      ChallengeResponses: { USERNAME: username, NEW_PASSWORD: newPassword }
    });
    saveTokens(c.AuthenticationResult, username.toLowerCase());
    return;
  }
  if (r.ChallengeName) throw new Error("Unsupported sign-in challenge: " + r.ChallengeName);
  saveTokens(r.AuthenticationResult, username.toLowerCase());
}

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
