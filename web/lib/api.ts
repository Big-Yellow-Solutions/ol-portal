import { fetchAuthSession, signOut } from "aws-amplify/auth";
import { CONFIG } from "@/lib/config";

const ACTING_AS_KEY = "olportal.actingAs";

// Session-scoped (not localStorage) by design: impersonation should not
// survive a browser restart.
export function actingAsTarget(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(ACTING_AS_KEY);
}

export function setActingAs(target: string) {
  window.sessionStorage.setItem(ACTING_AS_KEY, target);
}

export function clearActingAs() {
  window.sessionStorage.removeItem(ACTING_AS_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  opts: RequestInit & { skipActAs?: boolean } = {}
): Promise<T> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const target = opts.skipActAs ? null : actingAsTarget();
  if (target) headers["x-act-as"] = target;

  const res = await fetch(`${CONFIG.apiUrl}${path}`, { ...opts, headers });

  if (res.status === 401) {
    await signOut();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new ApiError("Unauthorized", 401);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = data?.error ?? res.statusText ?? "Request failed";
    // A stale "act as" target can cause a request to fail; retry once
    // without impersonation, mirroring the original store.js behavior.
    if (target && !opts.skipActAs) {
      clearActingAs();
      return api<T>(path, { ...opts, skipActAs: true });
    }
    throw new ApiError(message, res.status);
  }

  return data as T;
}
