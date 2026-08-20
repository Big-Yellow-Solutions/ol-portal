import { fetchAuthSession, signOut } from "aws-amplify/auth";
import { CONFIG } from "@/lib/config";
import { actingAsTarget } from "@/lib/api";

/* The Optimist's client half.

   This does not go through lib/api.ts, and it is the only thing in the app
   that doesn't. api() awaits the whole response and parses it as one JSON
   document, which is exactly wrong for an endpoint whose entire purpose is to
   hand back an answer a few words at a time. The chat also lives on its own
   origin: API Gateway cannot stream, so the assistant runs behind a Lambda
   Function URL (see backend/src/optimist-stream.mjs). Same Cognito token,
   different host.

   The wire format is newline-delimited JSON, one event per line. */

export type OptimistEvent =
  | { t: "meta"; conversationId: string }
  | { t: "tool"; name: string }
  | { t: "text"; v: string }
  | { t: "done"; conversationId: string }
  | { t: "error"; v: string };

export interface Attachment {
  type: string;
  data: string;
  name: string;
}

/* Raw-byte ceiling chosen so the base64-encoded upload (~4/3 larger) stays
   under the backend's own cap — a raw file just under a flat 4MB passes a
   naive check but is still rejected once encoded, which reads as the request
   silently going nowhere. */
export const MAX_ATTACHMENT_BYTES = 4_125_000;

export const ATTACHMENT_ACCEPT =
  "application/pdf,text/plain,text/markdown,text/csv,image/png,image/jpeg";

export async function readAttachment(file: File): Promise<Attachment> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return { type: file.type, data, name: file.name };
}

export class OptimistError extends Error {}

export async function streamOptimist(
  body: {
    message: string;
    scope: string;
    conversationId?: string | null;
    attachment?: Attachment | null;
    /** Retry: how many stored turns the server should keep before this one. */
    historyLength?: number;
  },
  onEvent: (event: OptimistEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!CONFIG.optimistUrl) {
    throw new OptimistError(
      "The Optimist is not configured for this environment yet."
    );
  }

  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  const target = actingAsTarget();

  const res = await fetch(CONFIG.optimistUrl, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(target ? { "x-act-as": target } : {}),
    },
    body: JSON.stringify({
      message: body.message,
      scope: body.scope,
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
      ...(body.attachment ? { attachment: body.attachment } : {}),
      ...(body.historyLength !== undefined ? { historyLength: body.historyLength } : {}),
    }),
  });

  /* A refused request answers with a status and a single error line, so the
     failure is known before any of the answer exists. Once the status is 200
     the answer has started and every later problem arrives as an error event
     instead — see the note in optimist-stream.mjs. */
  if (res.status === 401) {
    await signOut();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new OptimistError("Unauthorized");
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    const first = text.split("\n").find(Boolean);
    let message = "The Optimist is unavailable right now.";
    try {
      const parsed = first ? JSON.parse(first) : null;
      if (parsed?.v) message = parsed.v;
    } catch {
      // Not one of our error lines — a gateway or network failure. Keep the
      // generic message rather than showing the user raw HTML.
    }
    throw new OptimistError(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // A chunk can split a line anywhere, so only whole lines are parsed and
    // the remainder stays in the buffer for the next read.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as OptimistEvent);
      } catch {
        // A malformed line is one lost event, not a lost answer.
      }
    }
  }
}

/* ---------- the composer's quick starts ----------
   Clicking one submits its prompt immediately; it does not fill the box. */

export interface Starter {
  label: string;
  /** Single-path inline stroke glyph, drawn in a 24x24 viewBox. */
  glyph: string;
  prompt: string;
}

export const STARTERS: Starter[] = [
  {
    label: "Draft a funder update",
    glyph: "M4 5h16M4 10h16M4 15h10",
    prompt:
      "Draft a funder update for the Grace Network renewal, warm, two paragraphs, ends with a specific ask.",
  },
  {
    label: "Summarize the pipeline",
    glyph: "M5 19V9M12 19V5M19 19v-7",
    prompt:
      "Summarize where every open opportunity in the pipeline stands and what is blocking each one.",
  },
  {
    label: "Find someone on the bench",
    glyph: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0",
    prompt:
      "Who on the bench should I pull in for a faith-based grant narrative due in three weeks?",
  },
  {
    label: "Prep a kickoff agenda",
    glyph: "M7 3v3M17 3v3M4 9h16M5 6h14v14H5z",
    prompt:
      "Build a 60-minute kickoff agenda for a new lab partner, including the trust-mapping exercise.",
  },
  {
    label: "Turn notes into a proposal",
    glyph: "M14 3v5h5M8 4h6l5 5v11H8zM5 8v12h9",
    prompt:
      "Turn my kickoff notes into the first draft of a proposal using our standard structure.",
  },
];
