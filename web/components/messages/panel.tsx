"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ArrowLeftIcon,
  CheckIcon,
  CloseIcon,
  PencilIcon,
  PlusIcon,
} from "@/components/community/icons";
import { ConversationList } from "@/components/messages/list";
import { NewChat } from "@/components/messages/new-chat";
import { Thread } from "@/components/messages/thread";
import { useMessages } from "@/lib/messages";
import { cn } from "@/lib/utils";

/* The Messages slide-over. Mounted once by the shell, so the top nav, the
   bench cards, Home's presence rows and any `#messages` link all open the
   same panel from wherever the reader happens to be.
 *
 * The design draws the panel by hand; this is the app's Sheet restyled to it,
 * so the focus trap, Escape and the scrim's click-to-close come from the
 * primitive and only the surface is the design's.
 */

const CIRCLE =
  "flex size-8 flex-none cursor-pointer items-center justify-center rounded-full border border-hair-strong bg-white text-violet-deep transition-colors hover:bg-violet-pale";

export function MessagesPanel() {
  const { mode, active, close, openList } = useMessages();

  /* Every portal screen links to messaging as `#messages`, including screens
     that are not this one — so honour the hash on arrival and on any later
     click of such a link while already here. */
  useEffect(() => {
    const openIfHashed = () => {
      if (window.location.hash === "#messages") openList();
    };
    openIfHashed();
    window.addEventListener("hashchange", openIfHashed);
    return () => window.removeEventListener("hashchange", openIfHashed);
  }, [openList]);

  return (
    <Sheet open={!!mode} onOpenChange={(open) => !open && close()}>
      <SheetContent
        showCloseButton={false}
        overlayClassName="bg-[rgba(17,17,17,0.28)] supports-backdrop-filter:backdrop-blur-none"
        /* Inline, because the primitive's own `sm:max-w-sm` is a class at the
           same specificity and would otherwise win at 384px. Paired with
           w-full this is the design's `min(420px, 100vw)`. */
        style={{ maxWidth: 420 }}
        className="w-full gap-0 border-l border-hair bg-white p-0 shadow-lift"
      >
        <Header key={`${mode}:${active?.id ?? ""}`} />
        {mode === "list" && <ConversationList />}
        {mode === "new" && <NewChat />}
        {mode === "thread" && active && <Thread key={active.id} />}
      </SheetContent>
    </Sheet>
  );
}

function Header() {
  const {
    mode,
    active,
    conversations,
    person,
    title,
    groupPlaceholder,
    openList,
    openNew,
    close,
    rename,
  } = useMessages();

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(active?.name ?? "");

  const group = !!active && active.members.length > 1;

  const heading =
    mode === "list"
      ? "Messages"
      : mode === "new"
        ? "New chat"
        : active
          ? title(active)
          : "";

  const meta =
    mode === "list"
      ? `${conversations.length} ${conversations.length === 1 ? "conversation" : "conversations"}`
      : mode === "new"
        ? "Pick one person for a DM, or several for a group"
        : active
          ? group
            ? `${active.members.map((id) => person(id).first).join(", ")} · group`
            : person(active.members[0]).role
          : "";

  const commit = () => {
    rename(nameDraft);
    setRenaming(false);
  };

  return (
    <header className="flex flex-none items-center gap-3 border-b border-hair px-[18px] py-4">
      {(mode === "thread" || mode === "new") && (
        <button
          type="button"
          onClick={openList}
          aria-label="Back to conversations"
          className={CIRCLE}
        >
          <ArrowLeftIcon size={14} />
        </button>
      )}

      <span className="min-w-0 flex-1">
        {renaming ? (
          <>
            <SheetTitle className="sr-only">{heading}</SheetTitle>
            <SheetDescription className="sr-only">{meta}</SheetDescription>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commit();
              }}
            >
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder={
                  active ? groupPlaceholder(active.members) : "Group name"
                }
                aria-label="Group name"
                className="w-full rounded-[9px] border border-violet-deep bg-white px-2.5 py-[7px] text-sm font-semibold text-ink outline-none"
              />
            </form>
          </>
        ) : (
          <>
            <SheetTitle className="block truncate font-sans text-[15px] font-semibold tracking-[-0.01em] text-ink">
              {heading}
            </SheetTitle>
            <SheetDescription className="block truncate text-xs text-warm-gray">
              {meta}
            </SheetDescription>
          </>
        )}
      </span>

      {mode === "thread" && group && (
        <button
          type="button"
          onClick={() => (renaming ? commit() : setRenaming(true))}
          aria-label={renaming ? "Save group name" : "Rename group"}
          className={CIRCLE}
        >
          {renaming ? <CheckIcon size={14} /> : <PencilIcon size={14} />}
        </button>
      )}

      {mode === "list" && (
        <button
          type="button"
          onClick={openNew}
          aria-label="New chat"
          className={cn(
            CIRCLE,
            "border-none bg-violet-deep text-white hover:bg-violet"
          )}
        >
          <PlusIcon size={14} />
        </button>
      )}

      <button
        type="button"
        onClick={close}
        aria-label="Close messages"
        className={CIRCLE}
      >
        <CloseIcon size={14} />
      </button>
    </header>
  );
}
