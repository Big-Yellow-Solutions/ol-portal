export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return "Password must be at least 12 characters.";
  if (!/[a-z]/.test(pw)) return "Password must include a lowercase letter.";
  if (!/[A-Z]/.test(pw)) return "Password must include an uppercase letter.";
  if (!/[0-9]/.test(pw)) return "Password must include a digit.";
  return null;
}

async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

// k-anonymity check against the HaveIBeenPwned breached-password range API.
// Fails open (returns 0) on any network error, matching the original behavior.
export async function pwnedCount(pw: string): Promise<number> {
  try {
    const hash = await sha1Hex(pw);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!res.ok) return 0;
    const text = await res.text();
    for (const line of text.split("\n")) {
      const [lineSuffix, count] = line.trim().split(":");
      if (lineSuffix === suffix) return parseInt(count, 10) || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}
