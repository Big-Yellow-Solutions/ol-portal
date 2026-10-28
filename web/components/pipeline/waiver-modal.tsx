"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Info, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { can } from "@/lib/can";
import { KIND_NAME } from "@/lib/documents";
import { usePortalData } from "@/lib/portal-data";
import {
  UPLOAD_ACCEPT,
  fmtBytes,
  uploadDealDocument,
  validateUpload,
} from "@/lib/uploads";
import { cn } from "@/lib/utils";
import type { Deal, Waiver, WaiverRequirement } from "@/lib/types";

/* "Request a waiver" — the only place a waiver starts. It asks for the reason
   in plain words and any proof that exists (an email, an approval), and sends
   one request per requirement ticked, all pending until an admin decides.

   The proof is held in the browser until Send: uploading as each file is
   chosen would leave orphaned attachments behind every cancelled request. */

export function WaiverModal({
  deal,
  missing,
  open,
  onClose,
}: {
  deal: Deal;
  /** The requirements with nothing on file and no waiver yet; ticked to start. */
  missing: WaiverRequirement[];
  open: boolean;
  onClose: () => void;
}) {
  const { role, myLabs, refreshWaivers } = usePortalData();
  const [checked, setChecked] = useState<WaiverRequirement[]>(missing);
  const [reason, setReason] = useState("");
  const [proof, setProof] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const lab = role && can.seesLab(role, myLabs, deal.lab) ? deal.lab : undefined;
  const ready = checked.length > 0 && !!reason.trim() && !busy;

  function addProof(list: FileList | null) {
    if (!list?.length) return;
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      const invalid = validateUpload(f);
      if (invalid) toast.error(invalid);
      else ok.push(f);
    }
    setProof((prev) => [...prev, ...ok].slice(0, 10));
  }

  async function send() {
    if (!ready) return;
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const f of proof) ids.push(await uploadDealDocument({ file: f, dealId: deal.id, attachment: true, lab }));
      await api<Waiver[]>(`/deals/${deal.id}/waivers`, {
        method: "POST",
        body: JSON.stringify({ requirements: checked, reason: reason.trim(), attachments: ids }),
      });
      await refreshWaivers();
      toast.success("Waiver sent — an admin has to approve it before the requirement is cleared.");
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not send the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Request a waiver</DialogTitle>
          <DialogDescription>{deal.client}</DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-ink">Waive</legend>
          {missing.map((kind) => (
            <label key={kind} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
              <Checkbox
                checked={checked.includes(kind)}
                onCheckedChange={(v) =>
                  setChecked((prev) => (v === true ? [...prev, kind] : prev.filter((k) => k !== kind)))
                }
              />
              {KIND_NAME[kind]}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="waiver-reason">
            Why isn&rsquo;t it uploaded? <span className="font-normal text-ink-mute">(required)</span>
          </Label>
          <Textarea
            id="waiver-reason"
            rows={3}
            value={reason}
            maxLength={2000}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain what happened and where the agreement lives"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>
            Supporting documentation <span className="font-normal text-ink-mute">(optional)</span>
          </Label>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addProof(e.dataTransfer.files);
            }}
            className={cn(
              "flex items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-xs text-ink-mute",
              dragging ? "border-violet-deep bg-violet-pale" : "border-hair-strong"
            )}
          >
            <Paperclip size={14} className="shrink-0 text-violet-deep" aria-hidden />
            <span>
              Drop an email, approval or other proof, or{" "}
              <button type="button" className="font-semibold text-violet-deep" onClick={() => inputRef.current?.click()}>
                choose a file
              </button>
            </span>
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple
              accept={UPLOAD_ACCEPT}
              aria-label="Supporting documentation"
              onChange={(e) => {
                addProof(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {proof.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-warm-panel px-3 py-2 text-xs text-ink">
              <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
              <span className="shrink-0 text-ink-mute">{fmtBytes(f.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                className="shrink-0 text-ink-mute hover:text-ink"
                onClick={() => setProof((prev) => prev.filter((_, j) => j !== i))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        <p className="flex items-start gap-2 rounded-xl bg-warm-panel px-3 py-2.5 text-xs leading-relaxed text-ink-mute">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
          An OL admin has to approve this. The requirement stays open until they do.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" className="rounded-full" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button className="rounded-full" disabled={!ready} onClick={send}>
            {busy ? "Sending…" : "Send for approval"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
