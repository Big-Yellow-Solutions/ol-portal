"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { CONFIG } from "@/lib/config";

/* Where AuthKit lands after a hosted sign-in.

   The exchange itself is not done here — the AuthKit client mounted in the
   root layout spots the ?code= and trades it for a session, then routes on to
   wherever the user was heading. This route exists so that lands somewhere
   real: authkit-js only performs the exchange when the current pathname equals
   the registered redirect URI's path, and Amplify rewrites every unmatched
   path to /index.html with a 200, so without a page here a misconfigured
   redirect URI would serve the app shell and drop the code in silence rather
   than 404 where anyone would notice.

   So this page waits, and says something useful when waiting is the wrong
   answer. */

/* Long enough not to trip over a slow token exchange, short enough that a
   dead-ended sign-in doesn't sit on a spinner indefinitely. The usual cause is
   a missing PKCE verifier: it lives in sessionStorage, so finishing a sign-in
   in a different tab than it started in cannot complete. */
const STUCK_AFTER_MS = 10_000;

export default function CallbackPage() {
  const { status } = useAuth();
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (CONFIG.authProvider !== "workos") {
      router.replace("/login");
      return;
    }

    /* Read the query directly rather than through useSearchParams, which
       forces a Suspense boundary under `output: "export"`. This effect runs
       before the provider's, so the code is still in the URL here — the client
       strips it once the exchange succeeds. */
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) {
      setProblem(params.get("error_description") ?? error);
      return;
    }
    if (!params.has("code")) {
      router.replace("/login");
      return;
    }

    const timer = window.setTimeout(() => setStuck(true), STUCK_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [router]);

  useEffect(() => {
    /* Belt and braces. onRedirectCallback normally moves the user on; this
       covers arriving here with a session already live. */
    if (status === "signedIn") router.replace("/");
  }, [status, router]);

  const failed = problem ?? (stuck ? STUCK_MESSAGE : null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-violet-deep px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Image src="/ol-mark.svg" alt="" width={32} height={32} />
          <span className="font-serif text-lg italic text-ink">The Portal</span>
        </div>

        {failed ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-red">{failed}</p>
            <Button onClick={() => router.replace("/login")}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <p className="text-center text-sm text-ink-mute" aria-live="polite">
            Signing you in…
          </p>
        )}
      </div>
    </div>
  );
}

const STUCK_MESSAGE =
  "That sign-in couldn't be completed. It may have been started in a " +
  "different browser tab, or taken too long. Try signing in again.";
