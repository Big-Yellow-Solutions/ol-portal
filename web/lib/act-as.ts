import { api, setActingAs } from "@/lib/api";
import type { Role } from "@/lib/types";

/* Admin "act as" (impersonation), in one place because two screens start it:
   the Admin page's user table and the Directory's person card. The sequence
   matters and is easy to get half-right — the server call is what writes the
   audit row, `setActingAs` is what makes every later request carry the
   x-act-as header, and the hard navigation is what forces the providers to
   re-bootstrap as that person rather than leaving a half-swapped session on
   screen. backend/src/admin.mjs enforces the real rules: the *real* caller
   must be an Admin, the target cannot be themselves, and one Admin cannot act
   as another.

   Returns false when the person changes their mind at the confirm, and throws
   when the server refuses, so the caller can surface why. */
export async function startActingAs(username: string, label = username): Promise<boolean> {
  if (
    !window.confirm(
      `View and act as ${label}? You'll see exactly what they see and can make changes as them until you exit — every action is logged.`
    )
  )
    return false;

  const info = await api<{ username: string; name: string; role: Role }>("/admin/act-as", {
    method: "POST",
    body: JSON.stringify({ target: username }),
  });
  setActingAs(info.username);
  /* A full document load, deliberately: router.push() would keep every
     provider's React state, so the portal would render the previous person's
     data under the new identity until something happened to refetch it. */
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/";
  return true;
}
