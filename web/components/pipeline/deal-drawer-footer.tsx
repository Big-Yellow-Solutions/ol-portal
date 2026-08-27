"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 The drawer's action bar: Delete on the left, the save-gate hint in the middle,
 the primary action on the right. The hint is free-form and can run long ("Mark
 the proposal final and send it before saving at this stage"), while both
 buttons are `shrink-0 whitespace-nowrap` — so on a single nowrap row the hint
 pushes the primary button past the drawer's right edge. The bar is a query
 container instead: under ~340px it drops the hint onto its own line above the
 buttons, and the hint carries `min-w-0` so it can never shove a button out of
 the padding box on the wide layout either.
*/
export function DealDrawerFooter({
  hint,
  tone = "mute",
  onDelete,
  deleting = false,
  onSave,
  saving = false,
  saveLabel = "Save",
  saveDisabled = false,
}: {
  hint: string;
  tone?: "mute" | "warn";
  onDelete?: () => void;
  deleting?: boolean;
  onSave?: () => void;
  saving?: boolean;
  saveLabel?: string;
  saveDisabled?: boolean;
}) {
  return (
    <div data-slot="deal-drawer-footer" className="@container flex-none border-t border-hair">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
        {onDelete && (
          <Button
            variant="outline"
            className="order-2 rounded-full text-red @min-[340px]:order-1"
            onClick={onDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        )}

        <span
          className={cn(
            "order-1 w-full min-w-0 text-xs leading-tight break-words",
            "@min-[340px]:order-2 @min-[340px]:w-auto @min-[340px]:flex-1",
            tone === "warn" ? "text-red" : "text-ink-mute"
          )}
        >
          {hint}
        </span>

        {onSave && (
          <Button
            className="order-3 ml-auto rounded-full"
            onClick={onSave}
            disabled={saving || saveDisabled}
          >
            {saving ? "Saving…" : saveLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
