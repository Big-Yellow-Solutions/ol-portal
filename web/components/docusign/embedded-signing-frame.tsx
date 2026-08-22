"use client";

import { useEffect, useState } from "react";
import { publicApi } from "@/lib/public-api";

/* Renders DocuSign's embedded signing ceremony inside the Portal's own page —
   the signer never sees docusign.net. DocuSign's own guidance is explicit
   that the iframe's returnUrl/event query param should NOT be treated as the
   source of truth for completion (a signer can close the tab, or a browser
   can block the redirect), so this polls the caller instead and lets it
   decide when to stop rendering this component — typically once its own
   status fetch shows the signature recorded via the Connect webhook. */
export function EmbeddedSigningFrame({
  viewUrlPath,
  onPoll,
}: {
  /** Public path that mints a fresh, short-lived embedded-signing URL, e.g. "/sign/TOKEN/docusign-view". */
  viewUrlPath: string;
  /** Called every few seconds so the caller can re-check whether signing completed. */
  onPoll: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    setError(null);
    publicApi<{ url: string }>(viewUrlPath)
      .then((v) => setUrl(v.url))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not open the signing window.")
      );
  }, [viewUrlPath]);

  useEffect(() => {
    const id = setInterval(onPoll, 4000);
    return () => clearInterval(id);
  }, [onPoll]);

  if (error) {
    return <p className="rounded-md bg-red-pale px-3 py-2 text-sm text-red">{error}</p>;
  }
  if (!url) {
    return <p className="text-sm text-ink-mute">Opening the signing window…</p>;
  }

  return (
    <iframe
      src={url}
      title="DocuSign signing"
      className="h-[70vh] w-full rounded-md ring-1 ring-foreground/10"
    />
  );
}
