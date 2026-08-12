import { CONFIG } from "@/lib/config";

// Unauthenticated requests only — used by the public, tokenized proposal
// share view. Never attaches a Cognito token or act-as header.
export async function publicApi<T = unknown>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${CONFIG.apiUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.error ?? res.statusText ?? "Request failed");
  }
  return data as T;
}
