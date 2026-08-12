"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePortalData } from "@/lib/portal-data";
import { api } from "@/lib/api";
import type { FileRecord, FileStatus } from "@/lib/types";
import { FILE_VARIANT, fullName } from "@/lib/data";

// The `/files` list endpoint returns more (and differently-named) fields than
// the FileRecord type in lib/types.ts models (that type has labId/createdAt/
// summary/keyPoints; the API actually returns lab/date/uploader/type and a
// nested `analysis` object — see backend/src/app.mjs `listFiles` and
// backend/src/analyzer.mjs). We read the real shape here rather than the
// (currently inaccurate) shared type. See final report for details.
interface ApiFileRecord extends FileRecord {
  lab?: string;
  deal?: string;
  uploader: string;
  type?: string;
  date?: string;
  analysis?: {
    docType?: string;
    summary?: string;
    keyPoints?: string[];
  };
}

const NO_LAB = "__none__";
const PENDING_STATUSES: FileStatus[] = ["Uploading", "Analyzing"];

function fmtBytes(n?: number): string {
  if (!n || n <= 0) return "—";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}

function fmtDate(d?: string): string {
  if (!d) return "";
  return d.slice(0, 10);
}

export default function FilesPage() {
  const { loading, error, labs, people, role, me, myLabs, files, setFiles, refreshFiles } =
    usePortalData();
  const rawFiles = files as unknown as ApiFileRecord[];

  const [selectedLab, setSelectedLab] = useState<string>(NO_LAB);
  const [uploading, setUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ApiFileRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [detailFile, setDetailFile] = useState<ApiFileRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const labChoices = useMemo(() => {
    const ids = role === "Admin" ? labs.map((l) => l.id) : myLabs;
    return labs.filter((l) => ids.includes(l.id));
  }, [labs, role, myLabs]);

  const labName = (id?: string) => (id ? labs.find((l) => l.id === id)?.name ?? id : undefined);

  // Poll while anything is still uploading/analyzing, stop once settled.
  useEffect(() => {
    const pending = rawFiles.some((f) => PENDING_STATUSES.includes(f.status));
    if (!pending) return;
    const timer = setInterval(() => {
      refreshFiles().catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [rawFiles, refreshFiles]);

  const onPick = () => fileInputRef.current?.click();

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    try {
      const lab = selectedLab === NO_LAB ? undefined : selectedLab;
      const { uploadUrl } = await api<{ id: string; uploadUrl: string }>("/files", {
        method: "POST",
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream",
          ...(lab ? { lab } : {}),
        }),
      });

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload to storage failed (${putRes.status})`);

      await refreshFiles();
      toast.success(`${file.name} uploaded — analysis will appear shortly.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const onDownload = async (f: ApiFileRecord) => {
    try {
      const { url } = await api<{ url: string }>(`/files/${f.id}/download`);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not get a download link.");
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api(`/files/${pendingDelete.id}`, { method: "DELETE" });
      setFiles((prev) => prev.filter((x) => x.id !== pendingDelete.id));
      toast.success(`${pendingDelete.name} deleted.`);
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete this file.");
    } finally {
      setDeleting(false);
    }
  };

  const canDelete = (f: ApiFileRecord) => role === "Admin" || f.uploader === me;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl italic text-ink">Files &amp; analysis</h1>
        <p className="mt-1 text-sm text-ink-mute">
          Upload proposals, contracts, and documents. Every file is stored securely and
          analyzed automatically — the summary and key points show up here and on the
          dashboard.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="font-serif text-lg">All files</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={selectedLab} onValueChange={setSelectedLab}>
              <SelectTrigger aria-label="Lab for upload">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LAB}>Everyone (no lab)</SelectItem>
                {labChoices.map((lab) => (
                  <SelectItem key={lab.id} value={lab.id}>
                    {lab.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={onPick} disabled={uploading}>
              {uploading ? "Uploading…" : "+ Upload file"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              onChange={onFileChosen}
              disabled={uploading}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-ink-mute">Loading files…</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : rawFiles.length === 0 ? (
            <p className="text-sm text-ink-mute">No files yet. Upload the first one.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Lab</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rawFiles.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="max-w-xs">
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => setDetailFile(f)}
                          className="truncate text-left font-medium text-ink hover:text-violet-deep"
                          title={f.name}
                        >
                          {f.name}
                        </button>
                        {f.analysis?.summary && (
                          <span className="truncate text-xs text-ink-mute" title={f.analysis.summary}>
                            {f.analysis.summary}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={FILE_VARIANT[f.status]}>{f.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-ink-mute">
                      {labName(f.lab) ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-ink-mute">
                      <div className="flex flex-col">
                        <span>{fmtDate(f.date)}</span>
                        <span>{fullName(people[f.uploader]) || f.uploader}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-ink-mute">{fmtBytes(f.size)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => onDownload(f)}>
                          Download
                        </Button>
                        {canDelete(f) && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setPendingDelete(f)}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-ink-mute">
        Files are private to the portal. Lab-tagged files are visible to that lab&apos;s leader
        and admins; untagged files are visible to everyone signed in.
      </p>

      {/* Full analysis detail */}
      <Dialog open={!!detailFile} onOpenChange={(open) => !open && setDetailFile(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{detailFile?.name}</DialogTitle>
            <DialogDescription>
              {detailFile?.analysis?.docType ?? "File"} ·{" "}
              {detailFile && <Badge variant={FILE_VARIANT[detailFile.status]}>{detailFile.status}</Badge>}
            </DialogDescription>
          </DialogHeader>
          {detailFile?.analysis?.summary && (
            <p className="text-sm text-ink">{detailFile.analysis.summary}</p>
          )}
          {detailFile?.analysis?.keyPoints && detailFile.analysis.keyPoints.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm text-ink-mute">
              {detailFile.analysis.keyPoints.map((point, i) => (
                <li key={i}>• {point}</li>
              ))}
            </ul>
          )}
          {!detailFile?.analysis && (
            <p className="text-sm text-ink-mute">
              No analysis yet — this file may still be processing.
            </p>
          )}
          <DialogFooter showCloseButton>
            {detailFile && (
              <Button onClick={() => onDownload(detailFile)}>Download</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this file?</DialogTitle>
            <DialogDescription>
              &ldquo;{pendingDelete?.name}&rdquo; will be permanently deleted. This can&apos;t be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
