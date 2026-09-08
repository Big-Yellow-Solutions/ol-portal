"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { MessagesPanel } from "@/components/messages/panel";
import { MessagesProvider, useMessages } from "@/lib/messages";
import { NotificationsProvider } from "@/lib/notifications";
import { PortalDataProvider } from "@/lib/portal-data";
import { registerTokenSource } from "@/lib/session";

/*
 Click-test harness for Messages — the slide-over the shell mounts on every
 portal page — against real handlers, so "send, reload, still there" and
 "send, switch identity, it arrived" can both be walked in one browser.

 Same shape as /dev/pipeline: the real panel and the real providers, mounted
 outside app/(portal) so the layout's sign-in gate is not in the way, talking
 to backend/scripts/dev-api.mjs.

   Terminal 1:  cd backend && node scripts/dev-api.mjs
   Terminal 2:  cd web && NEXT_PUBLIC_API_URL=http://localhost:8788 \
                  NEXT_PUBLIC_AUTH_PROVIDER=cognito npm run dev

 Then open /dev/messages, or /dev/messages#messages/<id>. To read the thread
 from the other side, switch the identity the dev API injects and reload:

   fetch("http://localhost:8788/__dev/as/liz", { method: "POST" })
*/

/* See /dev/pipeline for why this is a string and why it registers from a
   microtask. */
const HARNESS_TOKEN = {
  getToken: async () => "dev-harness",
  endSession: async () => {},
};

export default function DevMessagesPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    queueMicrotask(() => {
      registerTokenSource(HARNESS_TOKEN);
      setReady(true);
    });
  }, []);

  if (process.env.NODE_ENV === "production") notFound();
  if (!ready) return null;

  return (
    <PortalDataProvider>
      <NotificationsProvider>
        <MessagesProvider>
          <Toolbar />
          <MessagesPanel />
        </MessagesProvider>
      </NotificationsProvider>
    </PortalDataProvider>
  );
}

function Toolbar() {
  const { openList, openNew, conversations } = useMessages();
  return (
    <div className="flex items-center gap-3 p-6">
      <button
        type="button"
        onClick={openList}
        className="rounded-full bg-violet-deep px-4 py-2 text-sm font-semibold text-white"
      >
        Open messages
      </button>
      <button
        type="button"
        onClick={openNew}
        className="rounded-full border border-hair-strong px-4 py-2 text-sm font-semibold text-violet-deep"
      >
        New chat
      </button>
      <span data-testid="convo-count" className="text-sm text-warm-gray">
        {conversations.length} conversations
      </span>
    </div>
  );
}
