"use client";

/* Resolves one `![alt](embed:name)` reference inside a post body (see
   lib/markdown.tsx) to the actual picture. The bucket stays private, so this
   asks the API for a fresh presigned GET on every mount rather than ever
   holding a URL that could go stale sitting in a post someone reads months
   later — the same trade-off resource-viewer.tsx already makes for a file's
   inline preview. */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function ResourcePostImage({
  resourceId,
  fileName,
  alt,
}: {
  resourceId: string;
  fileName: string;
  alt: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api<{ url: string }>(`/resources/${resourceId}/images/${encodeURIComponent(fileName)}`)
      .then((r) => live && setUrl(r.url))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [resourceId, fileName]);

  if (failed) return <span className="text-xs text-ink-mute">Image unavailable</span>;
  if (!url)
    return (
      <div
        className="my-3 h-40 max-w-full animate-pulse rounded-lg border border-hair bg-violet-pale"
        aria-label="Loading image"
      />
    );
  // eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL, not a static asset
  return <img src={url} alt={alt} className="my-3 max-w-full rounded-lg border border-hair" />;
}
