"use client";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { CloseIcon } from "@/components/community/icons";
import { cn } from "@/lib/utils";

/* The artboard hand-rolls its modals: a dimmed sheet, the panel pinned near
   the top of the viewport rather than centred, 20px corners and the violet
   lift shadow. This wraps the app's Dialog so all of that is styling only —
   focus trapping, Escape and the labelling still come from the primitive.

   The visible title is the uppercase kicker in the header row, so the
   accessible name is supplied separately by `title`. */
export function CommunityDialog({
  open,
  onOpenChange,
  kicker,
  title,
  width = 660,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kicker: React.ReactNode;
  title: string;
  width?: number;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        style={{ maxWidth: width }}
        className={cn(
          "top-14 max-h-[calc(100vh-7rem)] translate-y-0 gap-0 overflow-y-auto rounded-[20px] bg-white p-0 shadow-lift ring-0",
          // The inline maxWidth is the design's per-modal width; clear the
          // primitive's own sm: cap so it does not win at wide viewports.
          "sm:max-w-none"
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>

        <div className="flex items-center justify-between gap-4 border-b border-hair px-[22px] py-[18px]">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-warm-gray uppercase">
            {kicker}
          </span>
          <DialogClose
            aria-label="Close"
            className="flex cursor-pointer p-1 text-ink transition-colors hover:text-violet-deep"
          >
            <CloseIcon />
          </DialogClose>
        </div>

        <div className="flex flex-col gap-3.5 p-[22px]">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
