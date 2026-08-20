"use client";

import { ME, useMessages, type Conversation } from "@/lib/messages";
import { cn } from "@/lib/utils";

/* List mode: every conversation, most-said-in first. A group wears a squared
   avatar carrying its member count, so the shape alone separates a group from
   a DM before you read the name. */

export function ConversationList() {
  const { conversations, person, title, mentionIds, openConversation, openNew } =
    useMessages();

  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="m-0 text-[15px] text-warm-gray text-pretty">
          No conversations yet. Start one with anyone on the bench.
        </p>
        <button
          type="button"
          onClick={openNew}
          className="cursor-pointer rounded-full border border-hair-strong bg-white px-[15px] py-[7px] text-xs font-semibold text-violet-deep transition-colors hover:bg-violet-pale"
        >
          Start chat
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2.5">
      {conversations.map((convo) => (
        <Row
          key={convo.id}
          convo={convo}
          title={title(convo)}
          preview={preview(convo, person)}
          /* Only an incoming message is a notification — your own @ of
             someone else must not badge your own conversation. */
          mentionsMe={convo.msgs.some(
            (m) => m.from !== ME && mentionIds(m.text).includes(ME)
          )}
          initials={
            convo.members.length > 1
              ? String(convo.members.length)
              : person(convo.members[0]).initials
          }
          group={convo.members.length > 1}
          onOpen={() => openConversation(convo.id)}
        />
      ))}
    </div>
  );
}

function preview(
  convo: Conversation,
  person: (id: string) => { first: string }
): string {
  const last = convo.msgs[convo.msgs.length - 1];
  if (!last) return "No messages yet";
  const who = last.from === ME ? "You" : person(last.from).first;
  return `${who}: ${last.text}`;
}

function Row({
  convo,
  title,
  preview,
  mentionsMe,
  initials,
  group,
  onOpen,
}: {
  convo: Conversation;
  title: string;
  preview: string;
  mentionsMe: boolean;
  initials: string;
  group: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full cursor-pointer items-center gap-3 rounded-[12px] p-3 text-left transition-colors hover:bg-paper"
    >
      <span
        className={cn(
          "flex size-[38px] flex-none items-center justify-center text-[13px] font-semibold",
          group
            ? "rounded-[12px] bg-violet-deep text-white"
            : "rounded-full bg-violet-pale text-violet-deep"
        )}
      >
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {title}
          </span>
          {mentionsMe && (
            <span
              title="You were mentioned"
              className="flex size-[18px] flex-none items-center justify-center rounded-full bg-violet-deep text-[11px] font-bold text-white"
            >
              @
            </span>
          )}
          <span className="flex-none text-[11px] text-warm-gray">
            {convo.time}
          </span>
        </span>
        <span className="mt-[3px] block truncate text-[13px] text-warm-gray">
          {preview}
        </span>
      </span>
    </button>
  );
}
