"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Pill } from "@/components/optimist/pill";
import { SECTION_LABELS } from "@/lib/types";
import type { Proposal } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Version model (design_handoff_the_optimist, 1e), reachable from the version
   pill in the document view's header (3h). Turns the amber "draft ahead"
   sentence into a line you can read at a glance: every saved version, then
   the live draft if it has moved on. */

export function VersionPopover({
  proposal,
  draftAhead,
  changedKeys,
  onSaveVersion,
  onRevert,
  children,
}: {
  proposal: Proposal;
  draftAhead: boolean;
  changedKeys: string[];
  onSaveVersion: () => void;
  onRevert: () => void;
  children: React.ReactNode;
}) {
  const [showChanges, setShowChanges] = useState(false);
  const versions = proposal.versions ?? [];
  const finalV = proposal.finalVersion;

  return (
    <Popover onOpenChange={() => setShowChanges(false)}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-5.5">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="font-sans text-[10.5px] font-semibold uppercase tracking-[.18em] text-ink/50">
            Version
          </span>
          <span className="ml-auto font-sans text-xs text-ink/50">
            {proposal.updated ? `Last saved ${proposal.updated}` : "Autosaved"}
          </span>
        </div>

        <div className="flex items-start gap-2">
          {versions.length > 0 ? (
            versions.map((snap, i) => {
              const isFinal = snap.v === finalV;
              return (
                <div key={snap.v} className="flex flex-1 flex-col gap-2.5">
                  <span className={cn("h-[3px] rounded-full", isFinal ? "bg-violet-deep" : "bg-violet/30")} />
                  <span
                    className={cn(
                      "flex items-center gap-1.5 font-serif text-sm italic leading-none",
                      isFinal ? "text-violet-deep" : "text-ink/50"
                    )}
                  >
                    {`v${snap.v}`}
                    {isFinal && (
                      <span className="rounded-full bg-violet-deep px-1.5 py-0.5 font-sans text-[9px] font-medium tracking-[.09em] text-white uppercase">
                        Final
                      </span>
                    )}
                  </span>
                  <span className="font-sans text-[11.5px] leading-[1.3] text-ink/45">
                    {snap.date}
                    {proposal.sentVersion === snap.v ? " · sent to client" : ""}
                  </span>
                  {i < versions.length - 1 && <div className="w-2" />}
                </div>
              );
            })
          ) : (
            <div className="flex flex-1 flex-col gap-2.5">
              <span className="h-[3px] rounded-full bg-violet/30" />
              <span className="font-serif text-sm italic leading-none text-ink/50">{`v${proposal.version}`}</span>
              <span className="font-sans text-[11.5px] leading-[1.3] text-ink/45">Not yet saved</span>
            </div>
          )}

          {draftAhead && (
            <div className="flex flex-[1.2] flex-col gap-2.5">
              <span className="h-[3px] rounded-full bg-amber" />
              <span className="flex items-center gap-1.5 font-serif text-sm italic leading-none text-amber">
                Live draft
                <span className="size-1.5 rounded-full bg-amber" />
              </span>
              <span className="font-sans text-[11.5px] leading-[1.3] text-ink/45">
                {`${changedKeys.length} section${changedKeys.length === 1 ? "" : "s"} changed since v${finalV ?? proposal.version}`}
              </span>
            </div>
          )}
        </div>

        {draftAhead && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl bg-amber-pale p-3.5">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--amber)" strokeWidth={1.5} className="mt-0.5 shrink-0">
              <path d="M8 5v4M8 11.2v.1" />
              <circle cx="8" cy="8" r="6.2" />
            </svg>
            <div className="flex-1">
              <p className="font-sans text-[13px] leading-[1.5] text-amber">
                {`The draft has changed since the last saved version (v${finalV ?? proposal.version} is Final).`}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Pill
                  size="sm"
                  className="border-none bg-amber text-white hover:bg-amber/90"
                  onClick={() => setShowChanges((v) => !v)}
                >
                  See what changed
                </Pill>
                <Pill size="sm" className="border-amber/35 text-amber" onClick={onSaveVersion}>
                  {`Save as v${(finalV ?? proposal.version) + 1}`}
                </Pill>
                <Pill size="sm" className="border-amber/35 text-amber" onClick={onRevert}>
                  {`Revert to v${finalV ?? proposal.version}`}
                </Pill>
              </div>
              {showChanges && (
                <ul className="mt-3 flex flex-col gap-1 border-t border-amber/25 pt-2.5">
                  {changedKeys.length === 0 ? (
                    <li className="font-sans text-xs text-amber/80">No section text differs — only pricing or status changed.</li>
                  ) : (
                    changedKeys.map((k) => (
                      <li key={k} className="font-sans text-xs text-amber/90">{SECTION_LABELS[k] ?? k}</li>
                    ))
                  )}
                </ul>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
