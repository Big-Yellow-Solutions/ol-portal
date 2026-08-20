"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowUpIcon, PaperclipIcon, PlusIcon } from "@/components/optimist/icons";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  readAttachment,
  type Attachment,
} from "@/lib/optimist";
import { toast } from "sonner";

/* The composer, in both of the sizes the design draws it.

   "landing" is the one under the hero: 16px type, 62px tall, a labelled
   Attach pill. "reply" is the sticky one at the foot of a conversation: 15px,
   52px, the attach button collapses to an icon and a New chat button appears
   beside the scope pill. Everything else about them is identical, which is
   why they are one component and not two. */

export interface ScopeOption {
  id: string;
  name: string;
}

const MIN_HEIGHT = { landing: 62, reply: 52 };
const MAX_HEIGHT = 220;

export function Composer({
  variant,
  value,
  onChange,
  onSubmit,
  busy,
  scopes,
  scope,
  onScopeChange,
  attachment,
  onAttach,
  onNewChat,
  autoFocus,
}: {
  variant: "landing" | "reply";
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** A reply is streaming: submitting again is ignored until it lands. */
  busy: boolean;
  scopes: ScopeOption[];
  scope: string;
  onScopeChange: (id: string) => void;
  attachment: Attachment | null;
  onAttach: (attachment: Attachment | null) => void;
  onNewChat?: () => void;
  autoFocus?: boolean;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const landing = variant === "landing";
  const canSend = value.trim().length > 0 && !busy;

  /* Height is recomputed from scratch every time rather than nudged: setting
     it to auto first is what lets scrollHeight shrink again after a delete. */
  const fit = () => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  };

  useEffect(fit, [value, variant]);

  useEffect(() => {
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (autoFocus) textarea.current?.focus();
  }, [autoFocus]);

  const scopeLabel = scopes.find((s) => s.id === scope)?.name ?? "All labs";

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset immediately so choosing the same file twice in a row still fires.
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error("Attachments must be under 4MB.");
      return;
    }
    try {
      onAttach(await readAttachment(file));
    } catch {
      toast.error("That file could not be read.");
    }
  };

  return (
    <div>
      <div
        className={cn(
          "rounded-[20px] border bg-white transition-[border-color,box-shadow] duration-200 ease-[var(--ease-soft)]",
          focused
            ? "border-violet-deep shadow-[0_0_0_4px_rgba(124,109,245,.16),0_18px_40px_-22px_rgba(61,47,212,.45)]"
            : "border-hair-interactive shadow-card"
        )}
      >
        <textarea
          ref={textarea}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={
            landing ? "Ask The Optimist anything…" : "Reply to The Optimist…"
          }
          aria-label={landing ? "Ask The Optimist anything" : "Reply to The Optimist"}
          style={{ minHeight: MIN_HEIGHT[variant] }}
          className={cn(
            "block w-full resize-none overflow-hidden border-none bg-transparent font-sans text-ink outline-none placeholder:text-warm-gray",
            landing
              ? "px-5 pt-[18px] pb-1 text-base leading-[1.55]"
              : "px-[18px] pt-[15px] pb-0.5 text-[15px] leading-[1.55]"
          )}
        />

        {attachment && (
          /* Not in the design, which lists attachment previews as undesigned.
             Without it there is no way to tell a file is attached, or to
             change your mind about it, so it gets the quietest treatment that
             still answers both. */
          <div className="mx-3 mb-1 flex w-fit items-center gap-2 rounded-full bg-violet-pale px-3 py-1.5 text-xs font-medium text-violet-deep">
            <PaperclipIcon size={12} />
            <span className="max-w-[220px] truncate">{attachment.name}</span>
            <button
              type="button"
              onClick={() => onAttach(null)}
              aria-label={`Remove ${attachment.name}`}
              className="cursor-pointer text-violet-deep/70 transition-colors hover:text-violet-deep"
            >
              ✕
            </button>
          </div>
        )}

        <div
          className={cn(
            "flex items-center justify-between gap-3",
            landing ? "px-3 pt-2.5 pb-3" : "px-2.5 pt-2 pb-2.5"
          )}
        >
          <div className="flex items-center gap-1.5">
            <input
              ref={fileInput}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              onChange={pickFile}
              className="hidden"
            />
            {landing ? (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex cursor-pointer items-center gap-[7px] rounded-full px-[11px] py-[7px] font-sans text-[13px] font-medium text-warm-gray transition-colors hover:bg-wash hover:text-violet-deep"
              >
                <PaperclipIcon />
                Attach
              </button>
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                aria-label="Attach a file"
                className="flex size-8 cursor-pointer items-center justify-center rounded-full text-warm-gray transition-colors hover:bg-wash hover:text-violet-deep"
              >
                <PaperclipIcon />
              </button>
            )}

            {/* The handoff draws this pill cycling through labs on click, and
                says in the same breath that production should offer a real
                menu of the user's labs. Clicking four times to reach the fifth
                lab is what a prototype tolerates and a person does not, so the
                pill is drawn exactly as designed and opens a menu. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Scope: ${scopeLabel}. Change which labs The Optimist reads.`}
                  className={cn(
                    "flex cursor-pointer items-center gap-[7px] rounded-full border border-dashed border-[rgba(124,109,245,.42)] font-sans font-medium text-ink-soft transition-colors hover:border-violet-deep hover:bg-wash hover:text-violet-deep",
                    landing ? "px-3 py-1.5 text-[13px]" : "px-[11px] py-[5px] text-xs"
                  )}
                >
                  {landing && <PlusIcon />}
                  {scopeLabel}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[180px]">
                {scopes.map((option) => (
                  <DropdownMenuItem
                    key={option.id}
                    onSelect={() => onScopeChange(option.id)}
                    className={cn(
                      "cursor-pointer text-[13px]",
                      option.id === scope && "font-semibold text-violet-deep"
                    )}
                  >
                    {option.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {!landing && onNewChat && (
              <button
                type="button"
                onClick={onNewChat}
                className="flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-[5px] font-sans text-xs font-medium text-warm-gray transition-colors hover:bg-wash hover:text-violet-deep"
              >
                <PlusIcon size={13} />
                New chat
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSend}
            aria-label="Send"
            className={cn(
              "flex size-[38px] flex-none items-center justify-center rounded-full transition-colors duration-200 ease-[var(--ease-soft)]",
              canSend
                ? "cursor-pointer bg-violet-deep text-white"
                : "cursor-default bg-violet-pale text-violet-light"
            )}
          >
            <ArrowUpIcon size={landing ? 17 : 16} />
          </button>
        </div>
      </div>
    </div>
  );
}
