"use client";

import { toast } from "sonner";
import { RippleMark } from "@/components/optimist/mark";
import { Pill } from "@/components/optimist/pill";

/* 10 · Sent (design_handoff_the_optimist, 3j). The one screen on a violet-deep
   surface — says what happened and what the proposal is now waiting on. The
   "Back to the document" link isn't in the handoff (which treats this as a
   terminal screen); it's added so the view is reachable again without a
   reload, since the app still needs somewhere for that click to go. */
export function SentScreen({
  clientName,
  sentVersion,
  clientEmail,
  shareUrl,
  onBack,
}: {
  clientName: string;
  sentVersion: number;
  clientEmail: string;
  shareUrl: string;
  onBack: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-violet-deep px-14 py-13">
      <button onClick={onBack} className="mb-8 self-start font-sans text-[12.5px] font-medium text-violet-light">
        ← Back to the document
      </button>

      <RippleMark className="size-[34px] text-white/90" />
      <h2 className="mt-5.5 font-sans text-[30px] leading-[1.22] font-bold tracking-[-.018em] text-white">
        {`v${sentVersion} is with `}
        <em className="font-serif text-[30px] leading-[1.22] font-normal not-italic italic text-violet-light">
          {clientName}
        </em>
        .
      </h2>
      <p className="mt-3 max-w-[460px] font-sans text-[15px] leading-[1.6] text-white/78">
        {`Emailed to ${clientEmail} with a one-time link. They pick a package on the page; the total flows back to the deal.`}
      </p>
      <div className="mt-6.5 flex items-center gap-2.5">
        <Pill tone="onViolet" size="md" onClick={() => window.open(shareUrl, "_blank")}>
          View what they see
        </Pill>
        <Pill
          tone="ghostOnViolet"
          size="md"
          onClick={() => {
            navigator.clipboard.writeText(shareUrl);
            toast.success("Link copied");
          }}
        >
          Copy the link
        </Pill>
      </div>
      <div className="mt-auto flex items-center gap-2.5 border-t border-white/18 pt-6.5">
        <span className="size-[7px] shrink-0 rounded-full bg-violet-light" />
        <span className="font-sans text-[12.5px] text-white/70">
          Status moved to Sent. The Optimist stops writing until they respond.
        </span>
      </div>
    </div>
  );
}
