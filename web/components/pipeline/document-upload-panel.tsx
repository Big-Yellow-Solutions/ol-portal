"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, FileText, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { can } from "@/lib/can";
import { usePortalData } from "@/lib/portal-data";
import {
  MAX_UPLOAD_LABEL,
  UPLOAD_ACCEPT,
  UPLOAD_TYPES_LABEL,
  fileUrl,
  fmtBytes,
  fmtUploadDate,
  formatOf,
  uploadDealDocument,
  validateUpload,
} from "@/lib/uploads";
import { cn } from "@/lib/utils";
import type { Deal, FileKind, FileRecord } from "@/lib/types";

/* Proposals and invoices are written outside the portal now and uploaded
   here, so the deal drawer's two document sections are the same box twice:
   drag-and-drop or pick a file, watch it upload, then view / download /
   replace / remove it. Nothing in here creates, prices, versions or sends a
   document — that was the old ProposalPanel and InvoicesPanel, and it is
   gone. The bytes go straight to S3 through the portal's existing presigned
   upload (lib/uploads.ts); this only draws the states around it.

   A proposal is a single document, so a second upload replaces the first. A
   deal can be invoiced more than once, so invoices accumulate. */

/** An upload in flight, or one that failed and can be retried. */
interface Pending {
  id: number;
  name: string;
  size: number;
  progress: number;
  error?: string;
}

let pendingSeq = 0;

export function DocumentUploadPanel({
  deal,
  kind,
  label,
  hint,
  multiple = false,
  editable,
}: {
  deal: Deal;
  kind: FileKind;
  /** "Upload Proposal" / "Upload Invoice" — the section's heading. */
  label: string;
  /** One line under the heading saying what belongs in this box. */
  hint: string;
  /** An invoice box keeps every file; a proposal box keeps the latest. */
  multiple?: boolean;
  editable: boolean;
}) {
  const { files, setFiles, refreshFiles, role, myLabs, me } = usePortalData();
  const inputRef = useRef<HTMLInputElement>(null);
  /* Which file the next pick replaces, if any. The box has one hidden input:
     "choose a file" leaves this unset, a row's Replace points it at that row. */
  const replaceTargetRef = useRef<string | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [justUploaded, setJustUploaded] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const uploaded = useMemo(
    () =>
      files
        .filter((f) => f.deal === deal.id && f.kind === kind)
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    [files, deal.id, kind]
  );
  /* A proposal box shows one document even if older uploads are still on
     record — a failed replace shouldn't leave two proposals on the deal. */
  const shown = multiple ? uploaded : uploaded.slice(0, 1);

  /* Tagging the file with the deal's lab keeps it visible to exactly the
     people who can see the deal. A Lab Leader who owns a deal outside their
     labs can't tag into that lab (the server rejects it), so their upload
     goes untagged, as it would from the Files page. */
  const lab = role && can.seesLab(role, myLabs, deal.lab) ? deal.lab : undefined;
  const canDelete = (f: FileRecord) => role === "Admin" || f.uploader === me;

  async function startUpload(file: File, replacing?: string) {
    const invalid = validateUpload(file);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    const entry: Pending = { id: ++pendingSeq, name: file.name, size: file.size, progress: 0 };
    setPending((prev) => [...prev, entry]);

    try {
      const id = await uploadDealDocument({
        file,
        dealId: deal.id,
        kind,
        lab,
        onProgress: (progress) =>
          setPending((prev) => prev.map((p) => (p.id === entry.id ? { ...p, progress } : p))),
      });
      /* Replacing swaps the document only once the new one is safely stored,
         so a failed upload leaves the old proposal in place. */
      if (replacing) await api(`/files/${replacing}`, { method: "DELETE" }).catch(() => {});
      await refreshFiles();
      setPending((prev) => prev.filter((p) => p.id !== entry.id));
      setJustUploaded((prev) => [...prev, id]);
      toast.success(`${file.name} uploaded`);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Upload failed.";
      setPending((prev) => prev.map((p) => (p.id === entry.id ? { ...p, error: message } : p)));
      toast.error(message);
    }
  }

  function accept(list: FileList | null, replacing?: string) {
    if (!list?.length) return;
    const chosen = multiple && !replacing ? Array.from(list) : [list[0]];
    const replaceTarget = replacing ?? (!multiple ? shown[0]?.id : undefined);
    for (const file of chosen) void startUpload(file, replaceTarget);
  }

  function pick(replacing?: string) {
    replaceTargetRef.current = replacing;
    inputRef.current?.click();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!editable) return;
    accept(e.dataTransfer.files);
  }

  async function open(f: FileRecord, inline: boolean) {
    setBusyId(f.id);
    try {
      const url = await fileUrl(f.id, inline);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not open this file.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(f: FileRecord) {
    if (!window.confirm(`Remove ${f.name} from this deal? This cannot be undone.`)) return;
    setBusyId(f.id);
    try {
      await api(`/files/${f.id}`, { method: "DELETE" });
      setFiles((prev) => prev.filter((x) => x.id !== f.id));
      toast.success(`${f.name} removed`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove this file.");
    } finally {
      setBusyId(null);
    }
  }

  const hasFile = shown.length > 0;
  const dropLabel = !multiple && hasFile ? "Drag and drop to replace" : "Drag and drop";

  return (
    <div className="rounded-2xl border border-hair bg-warm-panel p-4">
      <div className="mb-1 text-[11px] font-semibold tracking-wide text-warm-gray uppercase">{label}</div>
      <p className="mb-3 text-xs leading-relaxed text-ink-mute">{hint}</p>

      {editable && (
        <div
          onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-2 rounded-xl border border-dashed px-3 py-5 text-center transition-colors",
            dragging ? "border-violet-deep bg-violet-pale" : "border-hair-strong bg-white"
          )}
        >
          <UploadCloud size={20} className="text-violet-deep" aria-hidden />
          <p className="text-xs text-ink-mute">
            {dropLabel}, or{" "}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 align-baseline text-xs font-semibold"
              onClick={() => pick()}
            >
              choose a file
            </Button>
          </p>
          <p className="text-[11px] text-warm-gray">
            {UPLOAD_TYPES_LABEL} · up to {MAX_UPLOAD_LABEL}
          </p>
          <input
            ref={inputRef}
            type="file"
            hidden
            accept={UPLOAD_ACCEPT}
            multiple={multiple}
            aria-label={label}
            onChange={(e) => {
              accept(e.target.files, replaceTargetRef.current);
              replaceTargetRef.current = undefined;
              e.target.value = "";
            }}
          />
        </div>
      )}

      {pending.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {pending.map((p) => (
            <div key={p.id} className="rounded-xl border border-hair-soft bg-white px-3 py-2">
              <div className="flex items-center gap-2">
                {p.error ? (
                  <AlertCircle size={14} className="shrink-0 text-red" aria-hidden />
                ) : (
                  <UploadCloud size={14} className="shrink-0 text-violet-deep" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{p.name}</span>
                <span className="flex-none text-[11px] text-warm-gray">
                  {p.error ? "Failed" : `${p.progress}%`}
                </span>
              </div>
              {p.error ? (
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 text-[11px] text-red">{p.error}</span>
                  <Button
                    size="xs"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}
                  >
                    Dismiss
                  </Button>
                </div>
              ) : (
                <div
                  className="mt-1.5 h-1 overflow-hidden rounded-full bg-violet-pale"
                  role="progressbar"
                  aria-label={`Uploading ${p.name}`}
                  aria-valuenow={p.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-violet-deep transition-[width] duration-150"
                    style={{ width: `${p.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!hasFile && pending.length === 0 ? (
        <p className={cn("text-xs text-ink-mute", editable && "mt-3")}>
          {multiple ? "No invoices uploaded yet." : "No proposal uploaded yet."}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {shown.map((f) => (
            <div key={f.id} className="rounded-xl border border-hair-soft bg-white p-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-pale">
                  <FileText size={15} className="text-violet-deep" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink" title={f.name}>
                    {f.name}
                  </span>
                  <span className="block text-xs text-ink-mute">
                    {formatOf(f)} · {fmtBytes(f.size)} · Uploaded {fmtUploadDate(f.date)}
                  </span>
                </span>
                {justUploaded.includes(f.id) && (
                  <CheckCircle2 size={15} className="shrink-0 text-green" aria-label="Uploaded" />
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hair-soft pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={busyId === f.id}
                  onClick={() => open(f, true)}
                >
                  View
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={busyId === f.id}
                  onClick={() => open(f, false)}
                >
                  Download
                </Button>
                {editable && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => pick(f.id)}
                  >
                    Replace
                  </Button>
                )}
                {canDelete(f) && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="rounded-full"
                    disabled={busyId === f.id}
                    onClick={() => remove(f)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
