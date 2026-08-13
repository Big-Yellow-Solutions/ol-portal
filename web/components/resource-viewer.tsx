"use client";

/* Renders one Resource Item's actual content — the thing a learner came for.
   Used both by the Resource Library (standalone) and by the course player
   (as a step), which is why completion is a callback rather than something
   this component decides what to do with.

   The completion rule is PRD 8.2, split by type:
     post, file   opening it counts. onViewed fires on mount.
     video        95% watched, measured in video-player.tsx.

   Files are fetched through the API's presigned-URL route rather than linked
   directly, so the bucket stays private and every download is counted. */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/lib/markdown";
import { api } from "@/lib/api";
import { VideoPlayer } from "@/components/video-player";
import type { ResourceItem } from "@/lib/types";

const PREVIEWABLE = ["application/pdf"];

export function fmtBytes(n?: number): string {
  if (!n || n <= 0) return "";
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}

export function fmtDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} min${s >= 30 ? " 30s" : ""}` : `${s}s`;
}

/** Presigned URL for inline display (PDF preview, <video> source). */
function useInlineUrl(resource: ResourceItem, wanted: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    api<{ url: string }>(`/resources/${resource.id}/download?disposition=inline`)
      .then((r) => live && setUrl(r.url))
      .catch(() => live && setUrl(null));
    return () => {
      live = false;
    };
  }, [resource.id, wanted]);
  return url;
}

export async function downloadResource(resource: ResourceItem) {
  try {
    const { url } = await api<{ url: string }>(`/resources/${resource.id}/download`);
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Could not get a download link.");
  }
}

interface ResourceViewerProps {
  resource: ResourceItem;
  /** Fired once the item counts as viewed, per PRD 8.2. */
  onViewed?: () => void;
  /** Resolves @[resource](ID) embeds inside a post body. */
  lookup?: (id: string) => ResourceItem | undefined;
  compact?: boolean;
}

export function ResourceViewer({ resource, onViewed, lookup, compact }: ResourceViewerProps) {
  const isVideo = resource.type === "video";
  const previewable = resource.type === "file" && PREVIEWABLE.includes(resource.mime ?? "");
  const inlineUrl = useInlineUrl(resource, isVideo ? resource.source === "upload" : previewable);

  // Posts and files complete on open; videos wait for the 95% mark. The ref
  // keeps this to one call per item even if the caller passes a fresh
  // onViewed closure on every render.
  const viewedCb = useRef(onViewed);
  useEffect(() => {
    viewedCb.current = onViewed;
  });
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (isVideo || announced.current === resource.id) return;
    announced.current = resource.id;
    viewedCb.current?.();
  }, [isVideo, resource.id]);

  const embed = useCallback(
    (id: string) => {
      const r = lookup?.(id);
      if (!r) return <p className="text-sm text-ink-mute">This embedded resource is no longer available.</p>;
      return <EmbeddedResource resource={r} />;
    },
    [lookup]
  );

  return (
    <div className="flex flex-col gap-4">
      {isVideo && (
        <VideoPlayer resource={resource} src={inlineUrl ?? undefined} onWatched={() => onViewed?.()} />
      )}

      {resource.type === "post" && (
        <Markdown text={resource.body ?? ""} renderEmbed={embed} className="max-w-prose" />
      )}

      {resource.type === "file" && (
        <div className="flex flex-col gap-3">
          {previewable && (
            <iframe
              src={inlineUrl ?? "about:blank"}
              title={resource.title}
              className="h-[60vh] w-full rounded-lg border border-hair bg-paper"
            />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => downloadResource(resource)}>Download</Button>
            <span className="text-xs text-ink-mute">
              {[resource.fileName, fmtBytes(resource.size)].filter(Boolean).join(" · ")}
              {resource.downloads ? ` · ${resource.downloads} download${resource.downloads === 1 ? "" : "s"}` : ""}
            </span>
          </div>
          {!previewable && (
            <p className="text-xs text-ink-mute">
              This file type can&apos;t be previewed in the browser — download it to open.
            </p>
          )}
        </div>
      )}

      {isVideo && resource.transcript && !compact && (
        <details className="rounded-lg border border-hair bg-paper p-3">
          <summary className="cursor-pointer text-sm font-medium text-ink">Transcript</summary>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{resource.transcript}</p>
        </details>
      )}
    </div>
  );
}

/* A resource embedded inside a post body. Videos play in place; anything else
   becomes a compact card, so the post keeps its narrative flow instead of
   handing the reader off to another page. */
function EmbeddedResource({ resource }: { resource: ResourceItem }) {
  const inlineUrl = useInlineUrl(resource, resource.type === "video" && resource.source === "upload");

  if (resource.type === "video")
    return (
      <div className="flex flex-col gap-2">
        <VideoPlayer resource={resource} src={inlineUrl ?? undefined} />
        <p className="text-xs text-ink-mute">{resource.title}</p>
      </div>
    );

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-hair bg-paper p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{resource.type === "file" ? "File" : "Post"}</Badge>
          <span className="truncate text-sm font-medium text-ink">{resource.title}</span>
        </div>
        {resource.description && (
          <p className="mt-0.5 truncate text-xs text-ink-mute">{resource.description}</p>
        )}
      </div>
      {resource.type === "file" && (
        <Button size="sm" variant="outline" onClick={() => downloadResource(resource)}>
          Download
        </Button>
      )}
    </div>
  );
}
