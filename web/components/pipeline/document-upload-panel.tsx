"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ChevronDown, FileText, UploadCloud } from "lucide-react";
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
import { VERSIONED_FILE_KINDS } from "@/lib/types";
import type { Deal, FileKind, FileRecord } from "@/lib/types";

/* Proposals, contracts and invoices are written outside the portal now and
   uploaded here, so the deal drawer's three document sections are the same box
   three times: drag-and-drop or pick a file, watch it upload, then view /
   download / supersede / remove it. Nothing in here creates, prices or sends a
   document — that was the old ProposalPanel and InvoicesPanel, and it is gone.
   The bytes go straight to S3 through the portal's existing presigned upload
   (lib/uploads.ts); this only draws the states around it.

   A proposal and a contract are each one document that gets revised, so a
   second upload is the *next version* of it rather than a rival to it: the box
   shows the newest and folds the earlier ones behind a disclosure, because a
   superseded version is still a record — the client has a copy of it — but it
   is not what anyone opening the deal is looking for. A deal can be invoiced
   many times and each invoice stands alone, so the invoice box has no chain
   and every upload keeps its own row. Which is which comes from
   VERSIONED_FILE_KINDS, mirroring the server's own list. */

/** An upload in flight, or one that failed and can be retried. */
interface Pending {
  id: number;
  name: string;
  size: number;
  progress: number;
  error?: string;
}

let pendingSeq = 0;

/** The one line each box shows before anything has been uploaded into it. The
 *  three boxes differ only in copy and in whether they hold a chain, so the
 *  wording lives here as data rather than as a branch further down. */
const EMPTY_COPY: Record<FileKind, string> = {
  proposal: "No proposal uploaded yet.",
  contract: "No contract uploaded yet.",
  invoice: "No invoices uploaded yet.",
};

/** Files stored before versioning existed carry no number and read as v1. */
const versionOf = (f: FileRecord) => f.version ?? 1;

export function DocumentUploadPanel({
  deal,
  kind,
  label,
  hint,
  editable,
}: {
  deal: Deal;
  kind: FileKind;
  /** "Upload Proposal" / "Upload Contract" / "Upload Invoice" — the heading. */
  label: string;
  /** One line under the heading saying what belongs in this box. */
  hint: string;
  editable: boolean;
}) {
  const { files, setFiles, refreshFiles, role, myLabs, me } = usePortalData();
  const inputRef = useRef<HTMLInputElement>(null);
  /* Which file the next pick replaces, if any. The box has one hidden input:
     "choose a file" leaves this unset, and so does taking a new version, since
     that supersedes the old one instead of deleting it. Only an invoice row's
     Replace points it at a specific record. */
  const replaceTargetRef = useRef<string | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [justUploaded, setJustUploaded] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);

  /** A single-document slot (proposal, contract) keeps a numbered chain; an
   *  invoice box is a flat list. */
  const versioned = VERSIONED_FILE_KINDS.includes(kind);

  const uploaded = useMemo(() => {
    /* Newest first. In a versioned slot that is the highest version number;
       files stored before versioning existed share a number and fall back to
       upload date, which is the order they were already in. */
    return files
      .filter((f) => f.deal === deal.id && f.kind === kind)
      .sort(
        (a, b) =>
          (versioned ? versionOf(b) - versionOf(a) : 0) ||
          (b.date ?? "").localeCompare(a.date ?? "")
      );
  }, [files, deal.id, kind, versioned]);

  const current = versioned ? uploaded.slice(0, 1) : uploaded;
  const earlier = versioned ? uploaded.slice(1) : [];

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
         so a failed upload leaves the old invoice in place. A versioned slot
         never gets here: superseding keeps the old version on record. */
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
    /* A versioned slot takes one document per gesture — dropping three files
       on the proposal box would mint v2, v3 and v4 out of one action. */
    const chosen = versioned || replacing ? [list[0]] : Array.from(list);
    for (const file of chosen) void startUpload(file, versioned ? undefined : replacing);
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
    const what = versioned && versionOf(f) > 1 ? `v${versionOf(f)} of ${f.name}` : f.name;
    if (!window.confirm(`Remove ${what} from this deal? This cannot be undone.`)) return;
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

  const hasFile = current.length > 0;
  const dropLabel = versioned && hasFile ? "Drag and drop a new version" : "Drag and drop";

  /* One row, drawn the same whether it is the document on top of the chain or
     one folded underneath it. An earlier version can be read and removed but
     not superseded — the next version always comes off the current one. */
  const row = (f: FileRecord, isEarlier: boolean) => (
    <div
      key={f.id}
      className={cn(
        "rounded-xl border border-hair-soft p-3",
        isEarlier ? "bg-warm-panel" : "bg-white"
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            isEarlier ? "bg-white" : "bg-violet-pale"
          )}
        >
          <FileText
            size={15}
            className={isEarlier ? "text-warm-gray" : "text-violet-deep"}
            aria-hidden
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink" title={f.name}>
            {f.name}
          </span>
          <span className="block text-xs text-ink-mute">
            {formatOf(f)} · {fmtBytes(f.size)} · Uploaded {fmtUploadDate(f.date)}
          </span>
        </span>
        {/* A slot that has only ever held one document says nothing about
            versions; the badge appears once there is a chain to place it in. */}
        {versioned && (isEarlier || versionOf(f) > 1) && (
          <span
            className={cn(
              "flex-none rounded-full px-2 py-0.5 text-[11px] font-bold",
              isEarlier ? "bg-white text-warm-gray" : "bg-violet-pale text-violet-deep"
            )}
          >
            v{versionOf(f)}
          </span>
        )}
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
        {editable && !isEarlier && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => pick(versioned ? undefined : f.id)}
          >
            {versioned ? "Upload new version" : "Replace"}
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
  );

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
            multiple={!versioned}
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
        <p className={cn("text-xs text-ink-mute", editable && "mt-3")}>{EMPTY_COPY[kind]}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">{current.map((f) => row(f, false))}</div>
      )}

      {earlier.length > 0 && (
        <div className="mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-ink-mute"
            aria-expanded={showEarlier}
            onClick={() => setShowEarlier((v) => !v)}
          >
            <ChevronDown
              size={14}
              className={cn("transition-transform", showEarlier && "rotate-180")}
              aria-hidden
            />
            {showEarlier
              ? "Hide earlier versions"
              : `Show ${earlier.length} earlier version${earlier.length > 1 ? "s" : ""}`}
          </Button>
          {showEarlier && (
            <div className="mt-2 flex flex-col gap-2">{earlier.map((f) => row(f, true))}</div>
          )}
        </div>
      )}
    </div>
  );
}
