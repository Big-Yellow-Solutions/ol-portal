"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Ban, Check, ChevronDown, Circle, FileText, MoreHorizontal, Paperclip, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { WaiverModal } from "@/components/pipeline/waiver-modal";
import { ApiError, api } from "@/lib/api";
import { can } from "@/lib/can";
import { fullName } from "@/lib/data";
import {
  GATE_STAGE,
  KIND_NAME,
  consequence,
  declinedNote,
  docsOf,
  highestVersion,
  isWaivable,
  openRequirements,
  protectedDeleteReason,
  requiredAt,
  requirementRows,
  requirementSummary,
  suggestKind,
  versionOf,
  type RequirementRow,
} from "@/lib/documents";
import { usePortalData } from "@/lib/portal-data";
import { stageLabel } from "@/lib/types";
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
import type { Deal, FileKind, FileRecord, Waiver, WaiverRequirement } from "@/lib/types";

/* The deal drawer's Documents tab: one uploader, then the deal's documents
   grouped by type. The user drops a file and says what it is; a proposal or
   contract becomes the next version of its document, an invoice is its own
   row. Stage gates are shown where they bite (the banner, the requirements
   strip, the empty groups) and a missing document can be waived, subject to an
   admin.

   The rules live in lib/documents.ts and are enforced again by the server
   (backend/src/documents.mjs). Uploads and deletes here save immediately and
   have nothing to do with the drawer's Save button. */

const GATE_NAME: Record<FileKind, string> = {
  proposal: GATE_STAGE.proposal,
  contract: GATE_STAGE.contract,
  invoice: "Closed Won",
};
const LOWER: Record<FileKind, string> = { proposal: "proposal", contract: "signed contract", invoice: "invoice" };

const card = "rounded-2xl border border-hair bg-white";
const ghostBtn = "rounded-full";

/** An upload in flight, or one that failed. */
interface Uploading {
  name: string;
  progress: number;
  error?: string;
}

export function DocumentsTab({ deal, editable }: { deal: Deal; editable: boolean }) {
  const { files, waivers, proposals, role, me, myLabs, people, labs, refreshFiles, refreshWaivers } = usePortalData();
  const inputRef = useRef<HTMLInputElement>(null);
  const forcedKindRef = useRef<FileKind | null>(null);
  const [dragging, setDragging] = useState(false);
  const [chosen, setChosen] = useState<{ file: File; forced: FileKind | null } | null>(null);
  const [picked, setPicked] = useState<FileKind | null>(null);
  const [uploading, setUploading] = useState<Uploading | null>(null);
  const [waiverOpen, setWaiverOpen] = useState(false);

  const nameOf = (key?: string) => (key ? fullName(people[key]) || key : "");
  const lab = role && can.seesLab(role, myLabs, deal.lab) ? deal.lab : undefined;
  const isAdmin = role === "Admin";

  const legacyProposalSent = useMemo(
    () => proposals.some((p) => p.deal === deal.id && !!p.sentAt),
    [proposals, deal.id]
  );
  const rows = useMemo(
    () => requirementRows({ deal, files, waivers, legacyProposalSent }),
    [deal, files, waivers, legacyProposalSent]
  );
  const open = openRequirements(rows);
  const missing = rows.filter((r) => r.state === "missing" && isWaivable(r.kind)).map((r) => r.kind as WaiverRequirement);
  const dealWaivers = useMemo(() => waivers.filter((w) => w.deal === deal.id), [waivers, deal.id]);
  const toReview = isAdmin ? dealWaivers.filter((w) => w.status === "pending") : [];

  /* ---------- uploading ---------- */

  function pick(kind: FileKind | null) {
    forcedKindRef.current = kind;
    inputRef.current?.click();
  }

  function choose(list: FileList | null, forced: FileKind | null) {
    const file = list?.[0];
    if (!file) return;
    const invalid = validateUpload(file);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setChosen({ file, forced });
    setPicked(forced ?? suggestKind(file.name));
  }

  async function undo(id: string) {
    try {
      await api(`/files/${id}?undo=1`, { method: "DELETE" });
      await Promise.all([refreshFiles(), refreshWaivers()]);
      toast.success("Upload undone");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not undo this upload.");
    }
  }

  async function upload() {
    if (!chosen || !picked) return;
    const { file } = chosen;
    const kind = picked;
    const before = highestVersion(files, deal.id, kind);
    setChosen(null);
    setUploading({ name: file.name, progress: 0 });
    try {
      const id = await uploadDealDocument({
        file,
        dealId: deal.id,
        kind,
        lab,
        onProgress: (progress) => setUploading((u) => (u ? { ...u, progress } : u)),
      });
      await Promise.all([refreshFiles(), refreshWaivers()]);
      setUploading(null);
      const message =
        kind === "invoice"
          ? "Uploaded as Invoice."
          : before
            ? `Uploaded as ${KIND_NAME[kind]} v${before + 1}. v${before} moved to earlier versions.`
            : `Uploaded as ${KIND_NAME[kind]} v1.`;
      toast.success(message, { action: { label: "Undo", onClick: () => void undo(id) } });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Upload failed.";
      setUploading((u) => (u ? { ...u, error: message } : u));
      toast.error(message);
    }
  }

  async function openFile(id: string, inline: boolean) {
    try {
      window.open(await fileUrl(id, inline), "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not open this file.");
    }
  }

  const canDelete = (f: FileRecord) => role === "Admin" || f.uploader === me;

  async function deleteDoc(f: FileRecord) {
    const label = f.kind !== "invoice" ? `v${versionOf(f)} of ${f.name}` : f.name;
    if (!window.confirm(`Delete ${label} from this deal? It stays on record for audit but disappears from the deal.`)) return;
    try {
      await api(`/files/${f.id}`, { method: "DELETE" });
      await refreshFiles();
      toast.success(`${f.name} deleted`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete this file.");
    }
  }

  const groupProps = {
    deal, files, waivers: dealWaivers, rows, editable, nameOf, canDelete,
    onPick: pick, onOpen: openFile, onDelete: deleteDoc,
  };

  return (
    <div className="flex flex-col gap-4">
      {open.length > 0 && (
        <Banner
          deal={deal}
          rows={open}
          canWaive={editable && missing.length > 0}
          editable={editable}
          onUpload={pick}
          onWaive={() => setWaiverOpen(true)}
        />
      )}

      {toReview.map((w) => (
        <AdminReview key={w.id} deal={deal} waiver={w} labName={labs.find((l) => l.id === deal.lab)?.name ?? deal.lab} nameOf={nameOf} onOpen={openFile} />
      ))}

      {rows.length > 0 && <Strip rows={rows} />}

      {editable && (
        <div className={cn(card, chosen && "border-violet-deep shadow-sm")}>
          {chosen ? (
            <TypePicker
              file={chosen.file}
              forced={chosen.forced}
              suggested={suggestKind(chosen.file.name)}
              picked={picked}
              onPick={setPicked}
              files={files}
              dealId={deal.id}
              onCancel={() => setChosen(null)}
              onUpload={upload}
            />
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                choose(e.dataTransfer.files, null);
              }}
              className={cn(
                "m-0 flex flex-col items-center gap-1.5 rounded-2xl border border-dashed px-3 py-7 text-center transition-colors",
                dragging ? "border-violet-deep bg-violet-pale" : "border-hair-strong"
              )}
            >
              <UploadCloud size={22} className="text-violet-deep" aria-hidden />
              <p className="text-sm text-ink">
                Drag and drop, or{" "}
                <button type="button" className="font-semibold text-violet-deep hover:underline" onClick={() => pick(null)}>
                  choose a file
                </button>
              </p>
              <p className="text-xs text-ink-mute">You&rsquo;ll pick proposal, contract or invoice next</p>
              <p className="text-[11px] text-warm-gray">
                {UPLOAD_TYPES_LABEL} · up to {MAX_UPLOAD_LABEL}
              </p>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            hidden
            accept={UPLOAD_ACCEPT}
            aria-label="Upload a document"
            onChange={(e) => {
              choose(e.target.files, forcedKindRef.current);
              forcedKindRef.current = null;
              e.target.value = "";
            }}
          />
          {uploading && <UploadingRow u={uploading} onDismiss={() => setUploading(null)} />}
        </div>
      )}

      <VersionedGroup kind="proposal" {...groupProps} />
      <VersionedGroup kind="contract" {...groupProps} />
      <InvoiceGroup {...groupProps} />

      {missing.length > 0 && editable && (
        <WaiverModal key={missing.join()} deal={deal} missing={missing} open={waiverOpen} onClose={() => setWaiverOpen(false)} />
      )}
    </div>
  );
}

/* ---------- B. banner ---------- */

function Banner({
  deal, rows, canWaive, editable, onUpload, onWaive,
}: {
  deal: Deal;
  rows: RequirementRow[];
  canWaive: boolean;
  editable: boolean;
  onUpload: (kind: FileKind) => void;
  onWaive: () => void;
}) {
  const sentence = (r: RequirementRow) =>
    r.kind === "proposal"
      ? `every stage from ${stageLabel("Proposal Sent")} on needs a proposal`
      : r.kind === "contract"
        ? `${stageLabel("Contracted")} needs a signed contract`
        : `${stageLabel("Closed")} needs an invoice`;
  const parts = rows.map(sentence);
  const body = parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}` : parts[0];
  const asked = rows.some((r) => r.state === "missing");
  return (
    <div role="alert" className="rounded-2xl border border-amber/30 bg-amber-pale p-4 text-amber">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">
            This deal is missing {rows.length} required document{rows.length === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed">
            {deal.stage === "Contracted" || deal.stage === "Closed" || deal.stage === "Proposal Sent"
              ? `${body.charAt(0).toUpperCase()}${body.slice(1)}.`
              : `${body}.`}
            {asked && editable ? " Upload them, or say why they aren’t available." : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {rows.map((r) =>
              r.state === "pending" ? (
                <span key={r.kind} className="rounded-full border border-amber/40 bg-white/60 px-3 py-1 text-xs font-semibold">
                  {KIND_NAME[r.kind]}: waiver requested, waiting on admin approval
                </span>
              ) : (
                editable && (
                  <Button
                    key={r.kind}
                    size="sm"
                    variant="outline"
                    className="rounded-full border-amber/50 bg-white text-amber hover:bg-white/80"
                    onClick={() => onUpload(r.kind)}
                  >
                    Upload {LOWER[r.kind]}
                  </Button>
                )
              )
            )}
            {canWaive && (
              <button type="button" className="px-1 text-xs font-bold underline underline-offset-2" onClick={onWaive}>
                Waive requirements
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- C. stage requirements ---------- */

function Strip({ rows }: { rows: RequirementRow[] }) {
  const summary = requirementSummary(rows);
  return (
    <div className={cn(card, "p-4")}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-warm-gray uppercase">Stage requirements</span>
        <span className={cn("text-xs font-bold", summary.tone === "ok" ? "text-violet-deep" : "text-amber")}>{summary.text}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {rows.map((r) => (
          <Chip key={r.kind} row={r} />
        ))}
      </div>
    </div>
  );
}

function Chip({ row }: { row: RequirementRow }) {
  const base = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium";
  const name = KIND_NAME[row.kind];
  if (row.state === "met")
    return (
      <span className={cn(base, "bg-violet-pale text-violet-deep")}>
        <Check size={12} aria-hidden /> {name} · for {GATE_NAME[row.kind]}
      </span>
    );
  if (row.state === "waived")
    return (
      <span className={cn(base, "border border-hair-strong text-ink-soft")}>
        <Ban size={12} aria-hidden /> {name} · waived
      </span>
    );
  if (row.state === "pending")
    return (
      <span className={cn(base, "border border-amber/40 bg-amber-pale text-amber")}>
        <Circle size={11} aria-hidden /> {name} · waiver pending
      </span>
    );
  return (
    <span className={cn(base, "border border-dashed border-amber/60 text-amber")}>
      <Circle size={11} aria-hidden /> {name} · for {GATE_NAME[row.kind]}
    </span>
  );
}

/* ---------- D. uploader ---------- */

function UploadingRow({ u, onDismiss }: { u: Uploading; onDismiss: () => void }) {
  return (
    <div className="border-t border-hair-soft px-4 py-3">
      <div className="flex items-center gap-2">
        {u.error ? <AlertTriangle size={14} className="shrink-0 text-red" aria-hidden /> : <UploadCloud size={14} className="shrink-0 text-violet-deep" aria-hidden />}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{u.name}</span>
        <span className="shrink-0 text-[11px] text-warm-gray">{u.error ? "Failed" : `${u.progress}%`}</span>
      </div>
      {u.error ? (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-[11px] text-red">{u.error}</span>
          <Button size="xs" variant="outline" className={ghostBtn} onClick={onDismiss}>Dismiss</Button>
        </div>
      ) : (
        <div
          className="mt-1.5 h-1 overflow-hidden rounded-full bg-violet-pale"
          role="progressbar"
          aria-label={`Uploading ${u.name}`}
          aria-valuenow={u.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-violet-deep transition-[width] duration-150" style={{ width: `${u.progress}%` }} />
        </div>
      )}
    </div>
  );
}

const PICK_KINDS: FileKind[] = ["proposal", "contract", "invoice"];

function TypePicker({
  file, forced, suggested, picked, onPick, files, dealId, onCancel, onUpload,
}: {
  file: File;
  forced: FileKind | null;
  suggested: FileKind | null;
  picked: FileKind | null;
  onPick: (k: FileKind) => void;
  files: FileRecord[];
  dealId: string;
  onCancel: () => void;
  onUpload: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3 rounded-xl bg-warm-panel p-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-pale">
          <FileText size={16} className="text-violet-deep" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink" title={file.name}>{file.name}</span>
          <span className="block text-xs text-ink-mute">{formatOf({ name: file.name, type: file.type })} · {fmtBytes(file.size)}</span>
        </span>
        <button type="button" aria-label="Discard this file" className="shrink-0 text-ink-mute hover:text-ink" onClick={onCancel}>
          <X size={16} />
        </button>
      </div>

      <div role="radiogroup" aria-label="What is this document?" className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink">What is this document?</p>
        {PICK_KINDS.map((kind) => {
          const on = picked === kind;
          const live = docsOf(files, dealId, kind);
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(kind)}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                on ? "border-violet-deep bg-violet-pale" : "border-hair hover:border-hair-strong"
              )}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-ink">{KIND_NAME[kind] === "Invoices" ? "Invoice" : KIND_NAME[kind]}</span>
                {!forced && suggested === kind && (
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-violet-deep">Suggested from file name</span>
                )}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">
                {consequence(kind, live.length, highestVersion(files, dealId, kind))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" className={ghostBtn} onClick={onCancel}>Cancel</Button>
        <Button className={ghostBtn} disabled={!picked} onClick={onUpload}>
          {picked ? `Upload as ${picked === "contract" ? "signed contract" : picked}` : "Pick a type to upload"}
        </Button>
      </div>
    </div>
  );
}

/* ---------- E. groups ---------- */

interface GroupProps {
  deal: Deal;
  files: FileRecord[];
  waivers: Waiver[];
  rows: RequirementRow[];
  editable: boolean;
  nameOf: (key?: string) => string;
  canDelete: (f: FileRecord) => boolean;
  onPick: (kind: FileKind) => void;
  onOpen: (id: string, inline: boolean) => void;
  onDelete: (f: FileRecord) => void;
}

function GroupShell({ title, count, tag, children }: { title: string; count: string; tag?: string; children: React.ReactNode }) {
  return (
    <section className={cn(card, "overflow-hidden")}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-hair-soft px-4 py-3">
        <h3 className="text-[15px] font-bold text-ink">{title}</h3>
        <span className="text-xs text-ink-mute">{count}</span>
        <span className="flex-1" />
        {tag && <span className="rounded-full bg-violet-pale px-2.5 py-0.5 text-[11px] font-semibold text-violet-deep">{tag}</span>}
      </header>
      {children}
    </section>
  );
}

function VersionedGroup({ kind, ...p }: GroupProps & { kind: "proposal" | "contract" }) {
  const [showEarlier, setShowEarlier] = useState(false);
  const docs = docsOf(p.files, p.deal.id, kind);
  const [current, ...earlier] = docs;
  const row = p.rows.find((r) => r.kind === kind);
  const waiver = p.waivers.find(
    (w) => w.requirement === kind && (w.status === "pending" || w.status === "approved")
  );
  const declined = declinedNote(p.waivers, p.deal.id, kind);
  const title = KIND_NAME[kind];
  const tag = `Gate: ${GATE_NAME[kind]}`;

  if (!current) {
    if (waiver) return <WaiverGroup kind={kind} waiver={waiver} {...p} />;
    return (
      <GroupShell title={title} count="None yet" tag={tag}>
        <div className="flex items-center gap-3 px-4 py-3">
          <span className={cn("flex-1 text-xs", row ? "font-semibold text-amber" : "text-ink-mute")}>
            {requiredAt(kind, p.deal.stage) ? "Required · none yet" : "None yet"}
          </span>
          {p.editable && (
            <Button size="sm" variant="outline" className={ghostBtn} onClick={() => p.onPick(kind)}>Upload</Button>
          )}
        </div>
        {declined && <DeclinedNote waiver={declined} />}
      </GroupShell>
    );
  }

  return (
    <GroupShell title={title} count={`${docs.length} version${docs.length === 1 ? "" : "s"}`} tag={tag}>
      <div className="flex flex-col gap-3 p-4">
        <DocLine f={current} badge={`v${versionOf(current)} · Current`} filled p={p} withDownload />
      </div>
      {earlier.length > 0 && (
        <div className="border-t border-hair-soft bg-warm-panel px-4 py-2">
          <button
            type="button"
            aria-expanded={showEarlier}
            className="flex items-center gap-1.5 py-1 text-xs font-semibold text-ink-mute"
            onClick={() => setShowEarlier((v) => !v)}
          >
            <ChevronDown size={14} className={cn("transition-transform", showEarlier && "rotate-180")} aria-hidden />
            {showEarlier ? "Hide" : "Show"} {earlier.length} earlier version{earlier.length === 1 ? "" : "s"}
          </button>
          {showEarlier && (
            <div className="flex flex-col divide-y divide-hair-soft">
              {earlier.map((f) => (
                <DocLine key={f.id} f={f} badge={`v${versionOf(f)}`} p={p} compact />
              ))}
            </div>
          )}
        </div>
      )}
    </GroupShell>
  );
}

function InvoiceGroup(p: GroupProps) {
  const docs = docsOf(p.files, p.deal.id, "invoice");
  const row = p.rows.find((r) => r.kind === "invoice");
  return (
    <GroupShell
      title="Invoices"
      count={docs.length ? `${docs.length} file${docs.length === 1 ? "" : "s"}` : "None yet"}
      tag="Each upload is its own record"
    >
      {docs.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-3">
          <span className={cn("flex-1 text-xs", row ? "font-semibold text-amber" : "text-ink-mute")}>
            {row ? "Required · none yet" : "None yet"}
          </span>
          {p.editable && (
            <Button size="sm" variant="outline" className={ghostBtn} onClick={() => p.onPick("invoice")}>Upload</Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-hair-soft px-4">
          {docs.map((f) => (
            <DocLine key={f.id} f={f} p={p} compact />
          ))}
        </div>
      )}
    </GroupShell>
  );
}

/* One document, as the current version (a card with View / Download), an
   earlier version, or an invoice (a flat row). Every row has the ⋯ menu. */
function DocLine({
  f, badge, filled, compact, withDownload, p,
}: {
  f: FileRecord;
  badge?: string;
  filled?: boolean;
  compact?: boolean;
  withDownload?: boolean;
  p: GroupProps;
}) {
  const meta = [formatOf(f), compact && f.kind !== "invoice" ? null : fmtBytes(f.size), fmtUploadDate(f.date), p.nameOf(f.uploader)]
    .filter(Boolean)
    .join(" · ");
  const title = (
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        {badge && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold",
              filled ? "bg-violet-deep text-white" : "bg-violet-pale text-violet-deep"
            )}
          >
            {badge}
          </span>
        )}
        <span className={cn("min-w-0 text-sm font-semibold text-ink", compact && "truncate")} title={f.name}>
          {f.name}
        </span>
      </span>
      <span className="mt-0.5 block text-xs text-ink-mute">{meta}</span>
    </span>
  );
  const actions = (
    <span className="flex shrink-0 items-center gap-2">
      <Button size="sm" variant="outline" className={ghostBtn} onClick={() => p.onOpen(f.id, true)}>View</Button>
      {withDownload && (
        <Button size="sm" variant="outline" className={ghostBtn} onClick={() => p.onOpen(f.id, false)}>Download</Button>
      )}
      <RowMenu f={f} p={p} />
    </span>
  );

  // The current version is a card: the name gets the full width and the
  // actions sit beneath it. Invoices and earlier versions are one-line rows.
  if (!compact)
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-pale">
            <FileText size={16} className="text-violet-deep" aria-hidden />
          </span>
          {title}
        </div>
        {actions}
      </div>
    );
  return (
    <div className="flex items-center gap-3 py-2.5">
      {title}
      {actions}
    </div>
  );
}

/* View / Download / Delete. Delete is `aria-disabled` rather than `disabled`
   when the deal still needs this document, so it stays clickable and explains
   itself in the menu instead of silently doing nothing. */
function RowMenu({ f, p }: { f: FileRecord; p: GroupProps }) {
  const [warn, setWarn] = useState<string | null>(null);
  const reason = protectedDeleteReason({
    file: f, deal: p.deal, files: p.files, waivers: p.waivers, stageLabel,
  });
  return (
    <DropdownMenu onOpenChange={(o) => !o && setWarn(null)}>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="outline" className="rounded-full" aria-label={`More actions for ${f.name}`}>
          <MoreHorizontal size={15} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={() => p.onOpen(f.id, true)}>View</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => p.onOpen(f.id, false)}>Download</DropdownMenuItem>
        {p.canDelete(f) && (
          <DropdownMenuItem
            variant="destructive"
            aria-disabled={!!reason}
            className={cn(reason && "opacity-50")}
            onSelect={(e) => {
              if (reason) {
                e.preventDefault();
                setWarn(reason);
              } else p.onDelete(f);
            }}
          >
            Delete
          </DropdownMenuItem>
        )}
        {warn && (
          <p role="alert" className="mt-1 flex items-start gap-2 rounded-md border border-amber/30 bg-amber-pale p-2.5 text-xs leading-relaxed text-amber">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            {warn}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------- waivers ---------- */

function Attachments({ waiver, onOpen }: { waiver: Waiver; onOpen: (id: string, inline: boolean) => void }) {
  if (!waiver.attachments.length) return null;
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs font-semibold text-ink">Supporting documentation</p>
      <div className="flex flex-col gap-1.5">
        {waiver.attachments.map((a) => (
          <div key={a.id} className="flex items-center gap-2 rounded-lg bg-warm-panel px-3 py-2 text-xs">
            <Paperclip size={13} className="shrink-0 text-ink-mute" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium text-ink">{a.name}</span>
            <button type="button" className="shrink-0 font-bold text-violet-deep" onClick={() => onOpen(a.id, true)}>View</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* E4 / E5: a requirement with no document, covered by a waiver that is waiting
   on an admin or has been approved. */
function WaiverGroup({ kind, waiver, ...p }: GroupProps & { kind: "proposal" | "contract"; waiver: Waiver }) {
  const { refreshWaivers } = usePortalData();
  const proofRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const approved = waiver.status === "approved";
  const lab = p.deal.lab;

  async function addProof(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const file of Array.from(list)) {
        const invalid = validateUpload(file);
        if (invalid) {
          toast.error(invalid);
          continue;
        }
        ids.push(await uploadDealDocument({ file, dealId: p.deal.id, attachment: true, lab }));
      }
      if (ids.length) {
        await api(`/waivers/${waiver.id}/attachments`, { method: "POST", body: JSON.stringify({ attachments: ids }) });
        await refreshWaivers();
        toast.success("Documentation added to the waiver");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not add documentation.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!window.confirm("Withdraw this waiver request?")) return;
    setBusy(true);
    try {
      await api(`/waivers/${waiver.id}/withdraw`, { method: "POST" });
      await refreshWaivers();
      toast.success("Waiver request withdrawn");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not withdraw this request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cn(card, "overflow-hidden")}>
      <header className="flex items-center gap-2 border-b border-hair-soft px-4 py-3">
        <h3 className="flex-1 text-[15px] font-bold text-ink">{KIND_NAME[kind]}</h3>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
            approved ? "border border-hair-strong text-ink-soft" : "border border-amber/40 bg-amber-pale text-amber"
          )}
        >
          {approved ? "Waived" : "Waiver pending"}
        </span>
      </header>
      <div className="p-4">
        <p className="text-sm leading-relaxed text-ink">&ldquo;{waiver.reason}&rdquo;</p>
        <p className="mt-1 text-xs text-ink-mute">
          Requested by {p.nameOf(waiver.requestedBy)}
          {approved && waiver.reviewedBy ? ` · Approved by ${p.nameOf(waiver.reviewedBy)}` : ""} ·{" "}
          {fmtUploadDate(approved ? waiver.reviewedAt : waiver.requestedAt)}
        </p>
        <Attachments waiver={waiver} onOpen={p.onOpen} />
        {p.editable && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className={ghostBtn} disabled={busy} onClick={() => proofRef.current?.click()}>
              Add documentation
            </Button>
            {approved ? (
              <Button size="sm" className={ghostBtn} onClick={() => p.onPick(kind)}>
                Upload {kind === "contract" ? "contract" : "proposal"}
              </Button>
            ) : (
              <Button size="sm" variant="outline" className={ghostBtn} disabled={busy} onClick={withdraw}>
                Withdraw request
              </Button>
            )}
            <input
              ref={proofRef}
              type="file"
              hidden
              multiple
              accept={UPLOAD_ACCEPT}
              aria-label="Add documentation to the waiver"
              onChange={(e) => {
                void addProof(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function DeclinedNote({ waiver }: { waiver: Waiver }) {
  const { refreshWaivers } = usePortalData();
  async function dismiss() {
    try {
      await api(`/waivers/${waiver.id}/dismiss`, { method: "POST" });
      await refreshWaivers();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not dismiss this note.");
    }
  }
  return (
    <div className="mx-4 mb-4 flex items-start gap-2 rounded-xl border border-amber/30 bg-amber-pale p-3 text-xs leading-relaxed text-amber">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-bold">Waiver declined.</span> {waiver.adminNote}
      </span>
      <button type="button" className="shrink-0 font-bold underline" onClick={dismiss}>Dismiss</button>
    </div>
  );
}

/* What the admin sees on a deal with a waiver waiting on them. */
function AdminReview({
  deal, waiver, labName, nameOf, onOpen,
}: {
  deal: Deal;
  waiver: Waiver;
  labName: string;
  nameOf: (key?: string) => string;
  onOpen: (id: string, inline: boolean) => void;
}) {
  const { refreshWaivers } = usePortalData();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(decision: "approve" | "decline") {
    setBusy(true);
    try {
      await api(`/waivers/${waiver.id}/${decision}`, { method: "POST", body: JSON.stringify({ note: note.trim() }) });
      await refreshWaivers();
      toast.success(decision === "approve" ? "Waiver approved" : "Waiver declined — the requester has been told why");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not record this decision.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-violet-deep bg-white p-4">
      <p className="text-[11px] font-bold tracking-wide text-violet-deep uppercase">Waiver request</p>
      <h3 className="mt-0.5 text-[15px] font-bold text-ink">
        {KIND_NAME[waiver.requirement]} · {deal.client}
      </h3>
      <p className="text-xs text-ink-mute">
        {labName} · {nameOf(waiver.requestedBy)} · {fmtUploadDate(waiver.requestedAt)}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink">&ldquo;{waiver.reason}&rdquo;</p>
      <Attachments waiver={waiver} onOpen={onOpen} />
      <label className="mt-3 block text-xs font-semibold text-ink" htmlFor={`note-${waiver.id}`}>
        Note to requester <span className="font-normal text-ink-mute">(required to decline)</span>
      </label>
      <Textarea
        id={`note-${waiver.id}`}
        rows={2}
        className="mt-1.5"
        value={note}
        maxLength={1000}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="outline"
          className="rounded-full border-red/40 text-red hover:bg-red/5"
          disabled={busy || !note.trim()}
          onClick={() => decide("decline")}
        >
          Decline
        </Button>
        <Button className="rounded-full" disabled={busy} onClick={() => decide("approve")}>
          Approve waiver
        </Button>
      </div>
    </section>
  );
}
