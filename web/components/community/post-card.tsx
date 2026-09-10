"use client";

import { useState } from "react";
import { CommentIcon } from "@/components/community/icons";
import { AnimatedHeartIcon } from "@/components/ui/animated-state-icons";
import {
  AvatarWithPresence,
  FIELD,
  KindChip,
  Panel,
  TogglePill,
} from "@/components/community/primitives";
import type { CommunityPost } from "@/lib/community";
import { cn } from "@/lib/utils";

export function likeLabel(count: number, liked: boolean) {
  return `${count}${liked ? " · you" : ""}`;
}

export function commentLabel(count: number) {
  return count === 1 ? "1 comment" : `${count} comments`;
}

/* The meta line under an author's name. "edited" rides on the end so a
   rewritten post never reads as the one people replied to. */
export function postMeta(post: Pick<CommunityPost, "lab" | "time" | "edited">) {
  return `${post.lab} · ${post.time}${post.edited ? " · edited" : ""}`;
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

/* The body of a post while it is being rewritten: the composer's textarea in
   the text's own place, with Save and Cancel under it. The draft lives here,
   the way the composer's does in the feed, and a failed save keeps it —
   `onSave` is awaited and a rejection leaves the editor open with the text
   still in it. ⌘/Ctrl+Enter saves, Escape cancels. */
export function PostEditor({
  initial,
  onSave,
  onCancel,
  size = "card",
}: {
  initial: string;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
  size?: "card" | "detail";
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const text = draft.trim();
  const canSave = !!text && text !== initial.trim() && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(text);
    } catch {
      // The page has already said what went wrong; the draft stays put.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
        }}
        aria-label="Edit post"
        rows={4}
        disabled={saving}
        className={cn(
          FIELD,
          "w-full resize-none rounded-[12px] px-3.5 py-[11px] leading-[1.5]",
          size === "detail" ? "text-[17px]" : "text-[15px]"
        )}
      />
      <div className="flex items-center justify-end gap-3.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="cursor-pointer text-[13px] font-medium text-warm-gray transition-colors hover:text-ink disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className={cn(
            "rounded-full px-5 py-[9px] text-sm font-semibold transition-colors",
            canSave
              ? "cursor-pointer bg-violet-deep text-white hover:bg-violet"
              : "cursor-not-allowed bg-violet-pale text-violet-deep/50"
          )}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/* Edit and Delete, for the author and for an Admin. Quiet text at the end of
   the action row rather than pills: these are not the things a reader does
   with a post, only what its owner can. `onDelete` is awaited so the button
   cannot be pressed twice while the first press is still in flight. */
export function OwnerActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };
  return (
    <span className="ml-auto flex items-center gap-3.5">
      <button
        type="button"
        onClick={onEdit}
        disabled={deleting}
        className="cursor-pointer text-[13px] font-medium text-warm-gray transition-colors hover:text-violet-deep disabled:cursor-not-allowed"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={deleting}
        className="cursor-pointer text-[13px] font-medium text-warm-gray transition-colors hover:text-red disabled:cursor-not-allowed"
      >
        {deleting ? "Deleting…" : "Delete"}
      </button>
    </span>
  );
}

export function PostCard({
  post,
  liked,
  likes,
  comments,
  canEdit,
  onLike,
  onOpen,
  onAuthor,
  onEdit,
  onDelete,
}: {
  post: CommunityPost;
  liked: boolean;
  likes: number;
  comments: number;
  canEdit: boolean;
  onLike: () => void;
  onOpen: () => void;
  onAuthor: () => void;
  onEdit: (text: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

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
          <span className="block text-xs text-warm-gray">{postMeta(post)}</span>
        </span>
        <KindChip>{post.kind}</KindChip>
      </div>

      {editing ? (
        <PostEditor
          initial={post.text}
          onSave={async (text) => {
            await onEdit(text);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="m-0 text-base leading-[1.55] text-pretty text-ink">
          {post.text}
        </p>
      )}

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
          <AnimatedHeartIcon filled={liked} />
          {likeLabel(likes, liked)}
        </TogglePill>
        <TogglePill onClick={onOpen} aria-label="Open post and comments">
          <CommentIcon />
          {commentLabel(comments)}
        </TogglePill>
        {canEdit && !editing && (
          <OwnerActions onEdit={() => setEditing(true)} onDelete={onDelete} />
        )}
      </div>
    </Panel>
  );
}
