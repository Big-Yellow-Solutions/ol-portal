"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RippleMark } from "@/components/optimist/mark";
import { Pill } from "@/components/optimist/pill";
import { VersionPopover } from "@/components/optimist/version-popover";
import { PricingTable } from "@/components/pricing-table";
import { SECTION_KEYS, SECTION_LABELS } from "@/lib/types";
import type { Pricing, Proposal, ProposalStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/* 08 · Read it through (design_handoff_the_optimist, 3h). Full-bleed within
   the shell's content area: portal-shell.tsx marks that wrapper `relative`, so
   the absolutely-positioned overlay below fills it edge to edge and this route
   can swap in its own header.

   Under the old sidebar shell the containing block was SidebarInset and the
   overlay also painted over the shared Topbar. The redesign puts a sticky top
   nav there instead, and that nav is the constant chrome, so the overlay now
   starts beneath it rather than covering it. */

export function DocumentView({
  proposal,
  clientName,
  labName,
  draftSections,
  draftPricing,
  draftAhead,
  changedKeys,
  flaggedCount,
  statusOptions,
  onStatusChange,
  avatarInitials,
  avatarPhoto,
  onBack,
  onSaveVersion,
  onRevert,
  onDraftPdf,
  onMarkFinal,
  onSendClick,
  onAskToChange,
}: {
  proposal: Proposal;
  clientName?: string;
  labName: string;
  draftSections: Record<string, string>;
  draftPricing: Pricing | null;
  draftAhead: boolean;
  changedKeys: string[];
  flaggedCount: number;
  statusOptions: ProposalStatus[];
  onStatusChange: (s: ProposalStatus) => void;
  avatarInitials: string;
  avatarPhoto?: string;
  onBack: () => void;
  onSaveVersion: () => void;
  onRevert: () => void;
  onDraftPdf: () => void;
  onMarkFinal: () => void;
  onSendClick: () => void;
  onAskToChange: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [activeKey, setActiveKey] = useState(SECTION_KEYS[0]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const top = container.getBoundingClientRect().top + 120;
        let current = SECTION_KEYS[0];
        for (const key of SECTION_KEYS) {
          const el = sectionRefs.current[key];
          if (el && el.getBoundingClientRect().top <= top) current = key;
        }
        setActiveKey(current);
        ticking = false;
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  const drafted = SECTION_KEYS.filter((k) => draftSections[k]?.trim()).length;
  const versionLabel = proposal.finalVersion ? `v${proposal.finalVersion} Final` : `v${proposal.version} draft`;

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-desk">
      <div className="flex h-16 flex-none items-center gap-4 border-b border-hair bg-white px-8">
        <button onClick={onBack} className="flex items-center gap-1.5 font-sans text-[12.5px] font-medium text-violet-deep">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M10 3L5 8l5 5" />
          </svg>
          Back to the interview
        </button>
        <div className="h-4 w-px bg-violet/25" />
        <span className="truncate font-serif text-lg italic text-ink">{proposal.title}</span>

        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          <Select value={proposal.status} onValueChange={(v) => onStatusChange(v as ProposalStatus)}>
            <SelectTrigger className="h-auto gap-1 border-none bg-transparent px-1.5 py-1 text-xs text-ink-mute shadow-none hover:bg-paper">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <VersionPopover proposal={proposal} draftAhead={draftAhead} changedKeys={changedKeys} onSaveVersion={onSaveVersion} onRevert={onRevert}>
            <button className="flex items-center gap-2 rounded-full border border-violet/22 bg-white px-3.5 py-[7px]">
              <span className="font-sans text-xs font-medium text-ink/55">{versionLabel}</span>
              {draftAhead && (
                <>
                  <span className="h-[1px] w-3 bg-violet/30" />
                  <span className="flex items-center gap-1.5 font-sans text-xs font-medium text-amber">
                    <span className="size-1.5 rounded-full bg-amber" />
                    Draft ahead
                  </span>
                </>
              )}
            </button>
          </VersionPopover>

          <Pill tone="outline" size="sm" onClick={onSaveVersion}>Save version</Pill>
          <Pill tone="outline" size="sm" onClick={onDraftPdf}>Draft PDF</Pill>
          {proposal.final ? (
            <Pill tone="primary" size="sm" onClick={onSendClick}>
              Send to client
            </Pill>
          ) : (
            <Pill tone="primary" size="sm" onClick={onMarkFinal}>
              Mark Final
            </Pill>
          )}

          <Avatar className="size-8">
            {avatarPhoto && <AvatarImage src={avatarPhoto} alt="" />}
            <AvatarFallback className="bg-violet-pale text-xs font-medium text-violet-deep">
              {avatarInitials}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 justify-center overflow-y-auto pt-6">
        <div className="flex w-14 shrink-0 flex-col items-end self-start pt-[110px]">
          {SECTION_KEYS.map((key, i) => {
            const active = key === activeKey;
            return (
              <button
                key={key}
                onClick={() => sectionRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="flex h-[34px] items-center gap-2"
              >
                <span className={cn("font-serif text-xs italic leading-none", active ? "text-violet" : "text-violet-deep")}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={cn("h-0.5 transition-all", active ? "w-5 bg-violet" : "w-3 bg-violet-deep")} />
              </button>
            );
          })}
        </div>

        <div
          className="box-border w-[820px] shrink-0 rounded-t-[14px] bg-white px-[72px] py-11 shadow-[0_1px_2px_rgba(17,17,17,.05)]"
        >
          <h1 className="font-serif text-[26px] italic leading-[1.2] text-ink">{proposal.title}</h1>
          <div className="mt-2 mb-5.5 font-sans text-[11.5px] uppercase tracking-[.05em] text-ink/45">
            {`Prepared for ${clientName ?? proposal.client ?? ""} · ${labName} · ${versionLabel}`}
          </div>

          {draftAhead && (
            <div className="mb-6 rounded-[10px] bg-amber-pale px-3.5 py-2.5 font-sans text-[12.5px] leading-[1.5] text-amber">
              {`The draft has changed since the last saved version (v${proposal.finalVersion ?? proposal.version} is Final).`}
            </div>
          )}

          <div className="flex flex-col gap-5.5">
            {SECTION_KEYS.map((key) => (
              <div key={key} ref={(el) => { sectionRefs.current[key] = el; }}>
                <h3 className="mb-1.5 font-sans text-xs font-semibold tracking-[.1em] text-ink/55 uppercase">
                  {SECTION_LABELS[key]}
                </h3>
                {key === "pricing" ? (
                  draftPricing ? (
                    <PricingTable pricing={draftPricing} />
                  ) : (
                    <p className="text-wrap-pretty font-sans text-[15.5px] leading-[1.62] text-ink-soft">
                      No figures recorded yet. Tell The Optimist the numbers and it will build the pricing table.
                    </p>
                  )
                ) : (
                  <p className="text-wrap-pretty font-sans text-[15.5px] leading-[1.62] text-ink-soft">
                    {draftSections[key] || <span className="text-ink-mute">Not yet written.</span>}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="w-14 shrink-0" />
      </div>

      <button
        onClick={onAskToChange}
        className="flex flex-none items-center gap-3.5 border-t border-violet/20 bg-white px-10 py-3.5 text-left shadow-[0_-14px_34px_-22px_rgba(17,17,17,.3)]"
      >
        <RippleMark className="size-5 shrink-0 text-violet-deep" />
        <span className="font-sans text-[13.5px] text-ink/62">Select any line and tell me what to change.</span>
        <span className="ml-auto font-sans text-[12.5px] text-ink/45">
          {`${drafted} of 6 drafted${flaggedCount > 0 ? ` · ${flaggedCount} flagged` : ""}`}
        </span>
      </button>
    </div>
  );
}
