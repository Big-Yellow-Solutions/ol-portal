"use client";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { SECTION_KEYS, SECTION_LABELS } from "@/lib/types";
import type { ProposalVersionSnapshot } from "@/lib/types";

/* The design's read-only document version viewer.
 *
 * Its point is that a superseded version is still a record: the client has a
 * copy of it, so it has to stay readable after a newer draft replaces it. The
 * prototype fills the page with grey skeleton bars because it has no document
 * behind the version — this app does, so the snapshot's own sections render
 * instead. Nothing here is editable, and there is no download: a proposal
 * snapshot lives in DynamoDB, not as a file with a URL to hand over.
 */
export function VersionViewer({
  open,
  onOpenChange,
  snapshot,
  title,
  supersededBy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: ProposalVersionSnapshot | null;
  title: string;
  /** The version that replaced this one, when there is one. */
  supersededBy?: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        style={{ maxWidth: 620 }}
        className="max-h-[80vh] gap-0 overflow-y-auto rounded-[18px] p-0 shadow-[0_40px_70px_-24px_rgba(17,17,17,0.45)] sm:max-w-none"
      >
        {snapshot && (
          <>
            <div className="flex items-center gap-3 border-b border-hair px-5 py-4">
              <span className="flex-none rounded-full bg-violet-pale px-2.5 py-1 text-[11px] font-bold text-violet-deep">
                v{snapshot.v}
              </span>
              <div className="min-w-0 flex-1">
                <span className="block text-[10px] font-bold tracking-[0.12em] text-warm-gray uppercase">
                  Proposal · earlier version
                </span>
                <DialogTitle className="truncate text-[15px] font-semibold">
                  {title}
                </DialogTitle>
                <span className="block text-xs text-warm-gray">
                  {[snapshot.status, snapshot.date].filter(Boolean).join(" · ") ||
                    "No date on record"}
                </span>
              </div>
            </div>

            <div className="bg-paper p-5">
              <div className="rounded-[12px] bg-white px-8 py-7">
                <h2 className="m-0 font-serif text-[22px] leading-tight font-normal text-violet-deep italic">
                  {title}
                </h2>
                <div className="mt-5 flex flex-col gap-4">
                  {SECTION_KEYS.map((k) => (
                    <div key={k}>
                      <h3 className="font-heading text-sm text-ink">
                        {SECTION_LABELS[k]}
                      </h3>
                      <p className="mt-1 text-sm whitespace-pre-wrap text-ink-soft">
                        {snapshot.sections?.[k] || "—"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-3 mb-0 text-xs text-warm-gray">
                Read-only snapshot. This version stays on record and cannot be
                edited.
              </p>
            </div>

            <div className="flex items-center gap-3 border-t border-hair px-5 py-4">
              <span className="flex-1 text-xs text-warm-gray">
                {supersededBy
                  ? `Superseded by v${supersededBy}.`
                  : "The current version."}
              </span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
