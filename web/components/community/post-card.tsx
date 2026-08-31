"use client";

import { CommentIcon, HeartIcon } from "@/components/community/icons";
import {
  AvatarWithPresence,
  KindChip,
  Panel,
  TogglePill,
} from "@/components/community/primitives";
import type { CommunityPost } from "@/lib/community";

export function likeLabel(count: number, liked: boolean) {
  return `${count}${liked ? " · you" : ""}`;
}

export function commentLabel(count: number) {
  return count === 1 ? "1 comment" : `${count} comments`;
}

/* A post's photo. The artboard fills this with the canvas image-slot
   component, which has no counterpart here — until posts can carry a real
   upload, the slot keeps its exact footprint (190px, violet-pale, 12px radius)
   so the feed's rhythm matches the design. */
export function PhotoSlot({
  label = "Post photo",
  height = 190,
}: {
  label?: string;
  height?: number;
}) {
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center overflow-hidden rounded-[12px] bg-violet-pale"
    >
      <span className="text-[11px] font-semibold tracking-[0.12em] text-violet-deep/55 uppercase">
        {label}
      </span>
    </div>
  );
}

export function PostCard({
  post,
  liked,
  likes,
  comments,
  onLike,
  onOpen,
  onAuthor,
}: {
  post: CommunityPost;
  liked: boolean;
  likes: number;
  comments: number;
  onLike: () => void;
  onOpen: () => void;
  onAuthor: () => void;
}) {
  return (
    <Panel as="article" className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-[11px]">
        <AvatarWithPresence
          initials={post.initials}
          who={post.who}
          /* Undefined draws no dot. There is no presence backend, and a
             stored post carries no presence, so coercing this to a boolean
             would put a permanent "away" marker on every real author. */
          online={post.online}
        />
        <span className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onAuthor}
            className="block cursor-pointer text-left text-sm font-semibold text-ink transition-colors hover:text-violet-deep"
          >
            {post.who}
          </button>
          <span className="block text-xs text-warm-gray">
            {post.lab} · {post.time}
          </span>
        </span>
        <KindChip>{post.kind}</KindChip>
      </div>

      <p className="m-0 text-base leading-[1.55] text-pretty text-ink">
        {post.text}
      </p>

      {post.linkTitle && (
        <a
          href="#"
          className="block rounded-[12px] border border-hair bg-paper px-3.5 py-3 text-ink transition-colors hover:border-violet-deep"
        >
          <span className="mb-[5px] block text-[10px] tracking-[0.12em] text-warm-gray uppercase">
            {post.linkSource}
          </span>
          <span className="block text-sm leading-[1.4] font-semibold">
            {post.linkTitle}
          </span>
        </a>
      )}

      {post.photo && <PhotoSlot />}

      <div className="flex flex-wrap items-center gap-2 border-t border-hair-soft pt-3">
        <TogglePill on={liked} onClick={onLike} aria-label="Like this post">
          <HeartIcon filled={liked} />
          {likeLabel(likes, liked)}
        </TogglePill>
        <TogglePill onClick={onOpen} aria-label="Open post and comments">
          <CommentIcon />
          {commentLabel(comments)}
        </TogglePill>
      </div>
    </Panel>
  );
}
