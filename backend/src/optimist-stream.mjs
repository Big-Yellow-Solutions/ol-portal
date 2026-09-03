/* OL Portal · The Optimist's transport.

   Why this is a separate function and not another route on the API:
   API Gateway buffers. An HTTP API integration returns one complete response
   and caps it at 29 seconds, which is fine for "save this deal" and wrong for
   an assistant that should put words on screen as it writes them. Lambda can
   stream, but only through a Function URL, so the chat gets its own function
   and its own URL. Everything else stays on the API.

   That trade has one cost: a Function URL has no JWT authorizer in front of
   it, so this handler verifies the Cognito token itself before doing anything
   else. Same pool, same client, same token the rest of the app already sends;
   the verified claims then go through identity.mjs so the permission matrix is
   the one every other route uses.

   The wire format is newline-delimited JSON, one event per line:
     {"t":"meta","conversationId":"..."}   once, before any text
     {"t":"tool","name":"search_pipeline"} a lookup started
     {"t":"text","v":"..."}                a chunk of the answer
     {"t":"done","conversationId":"..."}   the answer is complete
     {"t":"error","v":"..."}               fatal; nothing more is coming
   NDJSON rather than SSE because there is no EventSource here (EventSource
   cannot send an Authorization header), the client reads the body with a
   stream reader either way, and line-delimited JSON is the smaller thing to
   parse correctly.

   One consequence of streaming worth holding onto: the status code is spent
   the moment the first byte leaves. Anything that can fail with a status is
   checked before the stream opens; anything that fails after it arrives as an
   error event on an otherwise successful response. */

import { CognitoJwtVerifier } from "aws-jwt-verify";
import { verifyWorkosToken } from "./authz.mjs";
import { identityFromClaims, buildContext } from "./identity.mjs";
import { runOptimist } from "./optimist.mjs";

/* A Function URL has no authorizer of any kind, so unlike the API routes this
   function always verifies the token itself — under either provider.

   Cached across invocations: the verifier holds the JWKS, and refetching it
   per request would add a round trip to every message. */
const PROVIDER = process.env.AUTH_PROVIDER === "workos" ? "workos" : "cognito";

let verifier;
function cognitoVerifier() {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.USER_POOL_ID,
      tokenUse: "id",
      clientId: process.env.USER_POOL_CLIENT_ID
    });
  }
  return verifier;
}

const verifyToken = token =>
  PROVIDER === "workos" ? verifyWorkosToken(token) : cognitoVerifier().verify(token);

const MAX_BODY_BYTES = 6_000_000; // an attachment at the 4MB cap, base64'd

const NDJSON = {
  "content-type": "application/x-ndjson",
  "cache-control": "no-store",
  // Proxies that buffer would defeat the entire point of this function; this
  // is the conventional opt-out.
  "x-accel-buffering": "no"
};

/* Everything that has to be true before a single token is generated. Returns
   { ctx, body } or { error: { status, message } }. */
async function validate(event) {
  if ((event.requestContext?.http?.method || "").toUpperCase() !== "POST")
    return { error: { status: 405, message: "POST only" } };

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : (event.body || "");
  if (raw.length > MAX_BODY_BYTES)
    return { error: { status: 413, message: "That attachment is too large" } };

  let body;
  try { body = raw ? JSON.parse(raw) : {}; }
  catch { return { error: { status: 400, message: "invalid JSON body" } }; }

  const header = event.headers?.authorization || event.headers?.Authorization || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: { status: 401, message: "Not signed in" } };

  let claims;
  try {
    claims = await verifyToken(token);
  } catch {
    // Deliberately opaque: expired, wrong pool, wrong audience and forged all
    // read the same from here, and the client's only useful move is the same
    // for all of them.
    return { error: { status: 401, message: "Session expired; sign in again" } };
  }

  const { username, role } = identityFromClaims(claims);
  const { ctx, error } = await buildContext({
    username, role,
    actAsTarget: event.headers?.["x-act-as"],
    meta: {
      ip: event.requestContext?.http?.sourceIp || "",
      ua: event.headers?.["user-agent"] || ""
    }
  });
  return error ? { error } : { ctx, body };
}

function fail(responseStream, status, message) {
  const out = globalThis.awslambda.HttpResponseStream.from(responseStream, {
    statusCode: status, headers: NDJSON
  });
  out.write(JSON.stringify({ t: "error", v: message }) + "\n");
  out.end();
}

async function chat(event, responseStream) {
  // Stays null until the response is committed at 200. Its nullness is what
  // tells the catch below whether a status is still available to us.
  let stream = null;
  const send = obj => stream.write(JSON.stringify(obj) + "\n");

  try {
    const { ctx, body, error } = await validate(event);
    if (error) return fail(responseStream, error.status, error.message);

    stream = globalThis.awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200, headers: NDJSON
    });

    const result = await runOptimist({
      ctx,
      message: body?.message,
      scope: body?.scope,
      conversationId: body?.conversationId,
      attachment: body?.attachment,
      historyLength: body?.historyLength,
      onEvent: send
    });
    // runOptimist's own failures are ordinary outcomes, not exceptions: the
    // stream is open, so they travel as events like everything else.
    if (result?.error) send({ t: "error", v: result.error.message });
    stream.end();
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: err.message, stack: err.stack }));
    if (!stream) return fail(responseStream, 500, "The Optimist is unavailable right now");
    try {
      send({ t: "error", v: "The Optimist hit an error mid-answer. Ask again and it will pick up from here." });
      stream.end();
    } catch {
      // The stream is already gone; the request is over either way.
    }
  }
}

/* `awslambda` only exists inside the Lambda Node runtime. Falling back to the
   bare function keeps this module importable by the test runner and by any
   local script that wants to reach runOptimist through it. */
const streamify = globalThis.awslambda?.streamifyResponse ?? (fn => fn);
export const handler = streamify(chat);
