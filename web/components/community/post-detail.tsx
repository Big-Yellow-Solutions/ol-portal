"use client";

import { useState } from "react";
import { HeartIcon } from "@/components/community/icons";
import {
  AvatarWithPresence,
  FIELD,
  Initials,
  TogglePill,
} from "@/components/community/primitives";
import { commentLabel, likeLabel, PhotoSlot } from "@/components/community/post-card";
import type { CommunityComment, CommunityPost } from "@/lib/community";
import { cn } from "@/lib/utils";

/* The opened post: the same content as the feed card at a larger measure,
   with the comment thread and a reply box underneath. */
export function PostDetail({
  post,
  comments,
  liked,
  likes,
  meInitials,
  onLike,
  onComment,
  onAuthor,
}: {
  post: CommunityPost;
  comments: CommunityComment[];
  liked: boolean;
  likes: number;
  meInitials: string;
  onLike: () => void;
  onComment: (text: string) => void;
  onAuthor: () => void;
}) {
  const [draft, setDraft] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onComment(text);
    setDraft("");
  };

  return (
    <>
      <div className="flex items-center gap-[11px]">
        <AvatarWithPresence
          initials={post.initials}
          who={post.who}
          online={post.who === "Optimistic Labs" ? undefined : !!post.online}
          size={38}
        />
        <span className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onAuthor}
            className="block cursor-pointer text-left text-[15px] font-semibold text-ink transition-colors hover:text-violet-deep"
          >
            {post.who}
          </button>
          <span className="block text-xs text-warm-gray">
            {post.lab} · {post.time}
          </span>
        </span>
      </div>

      <p className="m-0 text-[17px] leading-[1.6] text-pretty">{post.text}</p>

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

      {post.photo && <PhotoSlot height={170} />}

      <div className="flex items-center gap-2 border-b border-hair-soft pb-1">
        <TogglePill on={liked} onClick={onLike} aria-label="Like this post">
          <HeartIcon filled={liked} />
          {likeLabel(likes, liked)}
        </TogglePill>
        <span className="text-[13px] text-warm-gray">
          {commentLabel(comments.length)}
        </span>
      </div>

      {comments.map((c, i) => (
        <div key={`${c.who}-${i}`} className="flex gap-[11px]">
          <Initials size={30} tone="paper">
            {c.initials}
          </Initials>
          <div className="min-w-0 flex-1">
            <span className="block text-[13px]">
              <span className="font-semibold">{c.who}</span>
              <span className="text-warm-gray"> · {c.time}</span>
            </span>
            <p className="mt-1 mb-0 text-sm leading-[1.55] text-pretty">
              {c.text}
            </p>
          </div>
        </div>
      ))}

      <form onSubmit={submit} className="flex items-center gap-2.5 pt-1.5">
        <Initials size={30} tone="solid">
          {meInitials}
        </Initials>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment"
          aria-label="Add a comment"
          className={cn(FIELD, "min-w-0 flex-1 rounded-full px-3.5 py-2.5 text-sm")}
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="flex-none cursor-pointer rounded-full bg-violet-deep px-[18px] py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-violet disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reply
        </button>
      </form>
    </>
  );
}
