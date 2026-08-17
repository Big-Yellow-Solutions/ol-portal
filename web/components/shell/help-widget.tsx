"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CircleHelpIcon, SendIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePortalData } from "@/lib/portal-data";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Mirrors app-sidebar.tsx's nav hrefs: the first path segment is the page key
// a GUIDE record is stored under ("dashboard" for the root page, since "/"
// has no segment of its own). Only used here for the ambient "you're on the
// X page" line; the assistant itself isn't limited to the current page.
function pageKeyFor(pathname: string): string {
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment ?? "dashboard";
}

const WELCOME: ChatMessage = {
  role: "assistant",
  content:
    'Hi, I\'m the portal\'s help assistant. Ask me how to do anything in here, like "how do I close a deal" or "where do I invite a contributor", and I\'ll tell you exactly where to click.',
};

/* A small persistent "?" tab, bottom-right on every portal page, that opens a
   chat with an assistant grounded in the same guide content the (now retired)
   static help panel used to show. Ask-anything beats a per-page reference
   panel because the answer to "how do I..." often lives on a different page
   than the one you're asking from. */
export function HelpWidget() {
  const pathname = usePathname();
  const { guides } = usePortalData();
  const pageKey = pageKeyFor(pathname);
  const guide = useMemo(
    () => guides.find((g) => g.page === pageKey),
    [guides, pageKey]
  );

  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function send() {
    const question = input.trim();
    if (!question || sending) return;
    setInput("");
    setError(null);
    const withQuestion = [...messages, { role: "user" as const, content: question }];
    setMessages(withQuestion);
    setSending(true);
    try {
      const { reply } = await api<{ reply: string }>("/help/assist", {
        method: "POST",
        body: JSON.stringify({
          messages: withQuestion
            .filter((m) => m !== WELCOME)
            .map(({ role, content }) => ({ role, content })),
        }),
      });
      setMessages((cur) => [...cur, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't reach the assistant. Try again in a moment."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="secondary"
          size="icon-lg"
          className="fixed right-5 bottom-5 z-40 rounded-full shadow-lg"
          aria-label="Ask the portal's help assistant"
        >
          <CircleHelpIcon />
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-0">
        <SheetHeader>
          <SheetTitle className="font-serif text-lg italic">Portal Help</SheetTitle>
          <SheetDescription>
            {guide
              ? `You're on the ${guide.title} page. Ask how to do anything in the portal.`
              : "Ask how to do anything in the portal."}
          </SheetDescription>
        </SheetHeader>

        <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                m.role === "user"
                  ? "self-end bg-primary text-primary-foreground"
                  : "self-start bg-muted text-foreground"
              )}
            >
              {m.content}
            </div>
          ))}
          {sending && (
            <div className="self-start rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">
              Thinking…
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-center gap-2 border-t border-border p-3"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="How do I…?"
            disabled={sending}
          />
          <Button type="submit" size="icon" disabled={sending || !input.trim()} aria-label="Send">
            <SendIcon />
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
