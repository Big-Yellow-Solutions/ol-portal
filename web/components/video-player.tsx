"use client";

/* Video playback for the Resource Library, with the completion rule the PRD
   settled on: a video counts as viewed at 95% watched (section 8.2).

   Measuring that means asking the player where it is, and each of the three
   supported sources answers differently:

     upload   a plain <video> off a presigned S3 URL. timeupdate gives exact
              position, so this is the accurate case.
     youtube  needs the IFrame Player API. Loaded lazily, only when a YouTube
              step is actually opened, then polled once a second.
     vimeo    posts timeupdate messages (with a percent) to the parent window
              once asked to; that's the documented Player API protocol, so no
              SDK script is needed.
     loom     exposes no playback position to an embedding page. Rather than
              silently marking it complete on open — which would quietly break
              the 95% rule for one provider — a Loom step shows an explicit
              "Mark as watched" button and says why.

   onWatched fires at most once per mount; the caller is free to make the
   request unconditionally since the server records the first view only. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ResourceItem } from "@/lib/types";

const COMPLETE_AT = 0.95;

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, opts: Record<string, unknown>) => {
        getCurrentTime: () => number;
        getDuration: () => number;
        destroy: () => void;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApi: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (ytApi) return ytApi;
  ytApi = new Promise<void>((resolve) => {
    if (window.YT?.Player) return resolve();
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prior?.();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApi;
}

interface VideoPlayerProps {
  resource: ResourceItem;
  /** Presigned S3 URL; required for source "upload". */
  src?: string;
  onWatched?: () => void;
}

export function VideoPlayer({ resource, src, onWatched }: VideoPlayerProps) {
  const fired = useRef(false);
  // Held in a ref so `complete` keeps a stable identity: it's an effect
  // dependency down in YouTubeEmbed, and a callback that changed every render
  // would tear down and rebuild the player on every render.
  const cb = useRef(onWatched);
  useEffect(() => {
    cb.current = onWatched;
  });
  const complete = useCallback(() => {
    if (fired.current) return;
    fired.current = true;
    cb.current?.();
  }, []);

  if (resource.source === "embed" && resource.provider === "youtube")
    return <YouTubeEmbed resource={resource} onComplete={complete} />;
  if (resource.source === "embed" && resource.provider === "vimeo")
    return <VimeoEmbed resource={resource} onComplete={complete} />;
  if (resource.source === "embed")
    return <LoomEmbed resource={resource} onComplete={complete} />;

  return <UploadedVideo src={src} onComplete={complete} />;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-hair bg-ink">
      {children}
    </div>
  );
}

function UploadedVideo({ src, onComplete }: { src?: string; onComplete: () => void }) {
  if (!src)
    return (
      <Frame>
        <div className="flex h-full items-center justify-center text-sm text-white/70">
          Preparing video…
        </div>
      </Frame>
    );
  return (
    <Frame>
      <video
        src={src}
        controls
        controlsList="nodownload"
        className="h-full w-full"
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration > 0 && v.currentTime / v.duration >= COMPLETE_AT) onComplete();
        }}
        onEnded={onComplete}
      />
    </Frame>
  );
}

function YouTubeEmbed({
  resource,
  onComplete,
}: {
  resource: ResourceItem;
  onComplete: () => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let player: { getCurrentTime: () => number; getDuration: () => number; destroy: () => void } | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    loadYouTubeApi()
      .then(() => {
        if (cancelled || !mount.current || !window.YT?.Player) return;
        player = new window.YT.Player(mount.current, {
          videoId: resource.embedId,
          playerVars: { rel: 0, modestbranding: 1 },
        });
        timer = setInterval(() => {
          try {
            const d = player?.getDuration?.() ?? 0;
            const t = player?.getCurrentTime?.() ?? 0;
            if (d > 0 && t / d >= COMPLETE_AT) onComplete();
          } catch {
            /* player not ready yet */
          }
        }, 1000);
      })
      // A blocked script shouldn't cost the learner the video itself, only the
      // automatic checkmark — fall back to the plain iframe plus the button.
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      try {
        player?.destroy();
      } catch {
        /* already gone */
      }
    };
  }, [resource.embedId, onComplete]);

  if (failed) return <ManualEmbed resource={resource} onComplete={onComplete} reason="" />;
  return (
    <Frame>
      <div ref={mount} className="h-full w-full" />
    </Frame>
  );
}

function VimeoEmbed({
  resource,
  onComplete,
}: {
  resource: ResourceItem;
  onComplete: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const post = (method: string, value?: unknown) =>
      frame.current?.contentWindow?.postMessage(JSON.stringify({ method, value }), "https://player.vimeo.com");

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== "https://player.vimeo.com") return;
      let data: { event?: string; data?: { percent?: number } };
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (data.event === "ready") post("addEventListener", "timeupdate");
      if (data.event === "timeupdate" && (data.data?.percent ?? 0) >= COMPLETE_AT) onComplete();
    };

    window.addEventListener("message", onMessage);
    // The player may have signalled "ready" before this listener attached.
    post("addEventListener", "timeupdate");
    return () => window.removeEventListener("message", onMessage);
  }, [onComplete]);

  return (
    <Frame>
      <iframe
        ref={frame}
        src={resource.embedUrl}
        title={resource.title}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        className="h-full w-full"
      />
    </Frame>
  );
}

function LoomEmbed({ resource, onComplete }: { resource: ResourceItem; onComplete: () => void }) {
  return (
    <ManualEmbed
      resource={resource}
      onComplete={onComplete}
      reason="Loom doesn't report playback progress to the portal, so this step won't tick itself off."
    />
  );
}

function ManualEmbed({
  resource,
  onComplete,
  reason,
}: {
  resource: ResourceItem;
  onComplete: () => void;
  reason: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <Frame>
        <iframe
          src={resource.embedUrl}
          title={resource.title}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </Frame>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={done}
          onClick={() => {
            setDone(true);
            onComplete();
          }}
        >
          {done ? "Marked as watched" : "Mark as watched"}
        </Button>
        {reason && <span className="text-xs text-ink-mute">{reason}</span>}
      </div>
    </div>
  );
}
