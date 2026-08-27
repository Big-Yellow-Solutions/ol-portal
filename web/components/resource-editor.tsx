"use client";

/* Admin authoring for a single Resource Item (PRD 4.1). One dialog covers
   every type because they share every field that matters — audience, lab,
   tags, visibility — and differ only in their payload.

   The library takes uploads, not documents written here: a resource arrives as
   a file from someone's device, or as a video (uploaded or linked). The post
   composer that used to live in this dialog is gone, and with it the only way
   to author a document body in the portal. Posts saved before that still open
   here so their metadata stays editable, but their body is read-only — the
   backend ignores an incoming `body` too (backend/src/resources.mjs).

   Uploads are two steps by design: the API mints the record and hands back a
   presigned PUT, and the browser sends the bytes straight to S3. That keeps
   large files (a 400 MB screen recording) out of the Lambda entirely. The
   record exists before the bytes land, so an upload that fails leaves a
   visible draft to retry rather than a silent nothing. */

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { readPhoto } from "@/lib/photo";
import { usePortalData } from "@/lib/portal-data";
import { PERMISSION_LABELS } from "@/lib/types";
import type {
  CreatableResourceType,
  ResourceItem,
  ResourcePermission,
  ResourceVisibility,
  VideoSource,
} from "@/lib/types";

const NO_LAB = "__all__";
const DOC_ACCEPT = ".pdf,.pptx,.docx,application/pdf";
const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime";

interface ResourceEditorProps {
  /** Editing an existing item, or null when creating one of `createType`. */
  resource: ResourceItem | null;
  /** Only an upload-backed type can be created; posts are read-only legacy. */
  createType?: CreatableResourceType;
  open: boolean;
  onClose: () => void;
  onSaved: (r: ResourceItem) => void;
}

export function ResourceEditor({
  resource,
  createType,
  open,
  onClose,
  onSaved,
}: ResourceEditorProps) {
  const { labs } = usePortalData();
  const type = resource?.type ?? createType ?? "file";
  const isNew = !resource;

  const [title, setTitle] = useState(resource?.title ?? "");
  const [description, setDescription] = useState(resource?.description ?? "");
  const [tags, setTags] = useState((resource?.tags ?? []).join(", "));
  const [lab, setLab] = useState(resource?.lab ?? NO_LAB);
  const [permission, setPermission] = useState<ResourcePermission>(resource?.permission ?? "both");
  const [visibility, setVisibility] = useState<ResourceVisibility>(resource?.visibility ?? "library");
  const [thumbnail, setThumbnail] = useState(resource?.thumbnail ?? "");
  const [source, setSource] = useState<VideoSource>(resource?.source ?? "embed");
  const [embedUrl, setEmbedUrl] = useState(
    resource?.provider === "youtube"
      ? `https://www.youtube.com/watch?v=${resource.embedId}`
      : resource?.provider === "vimeo"
        ? `https://vimeo.com/${resource.embedId}`
        : resource?.provider === "loom"
          ? `https://www.loom.com/share/${resource.embedId}`
          : ""
  );
  const [duration, setDuration] = useState(
    resource?.duration ? String(Math.round(resource.duration / 60)) : ""
  );
  const [transcript, setTranscript] = useState(resource?.transcript ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const needsFile = type === "file" || (type === "video" && source === "upload");
  const existingFile = resource?.fileName;

  const labName = useMemo(
    () => (id?: string) => (id && id !== NO_LAB ? labs.find((l) => l.id === id)?.name ?? id : "All labs"),
    [labs]
  );

  const onThumbnail = async (f: File | undefined) => {
    if (!f) return;
    try {
      setThumbnail(await readPhoto(f, 640));
    } catch {
      toast.error("Could not read that image.");
    }
  };

  const save = async (publish?: boolean) => {
    if (!title.trim()) return toast.error("Give this resource a title.");
    if (needsFile && isNew && !file) return toast.error("Choose a file to upload.");
    if (type === "video" && source === "embed" && !embedUrl.trim())
      return toast.error("Paste a YouTube, Vimeo, or Loom link.");

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        lab: lab === NO_LAB ? "" : lab,
        permission,
        visibility,
        thumbnail: thumbnail || null,
        ...(isNew ? { type } : {}),
        ...(publish === undefined ? {} : { status: publish ? "Published" : "Draft" }),
      };
      if (type === "video") {
        payload.source = source;
        payload.transcript = transcript;
        payload.duration = duration.trim() ? Number(duration) * 60 : null;
        if (source === "embed") payload.embedUrl = embedUrl.trim();
      }
      if (needsFile && file)
        payload.file = { name: file.name, size: file.size, type: file.type || "application/octet-stream" };

      const saved = await api<ResourceItem & { uploadUrl?: string }>(
        resource ? `/resources/${resource.id}` : "/resources",
        { method: resource ? "PATCH" : "POST", body: JSON.stringify(payload) }
      );

      if (saved.uploadUrl && file) {
        const put = await fetch(saved.uploadUrl, {
          method: "PUT",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!put.ok) throw new Error(`Upload to storage failed (${put.status})`);
      }

      toast.success(`${saved.title} saved.`);
      onSaved(saved);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save this resource.");
    } finally {
      setSaving(false);
    }
  };

  /* Belt and braces for the withdrawn flow: `createType` is typed to exclude
     it, the menu that used to offer it is gone, and the API refuses it — but
     an untyped or stale caller asking for a brand-new post gets nothing rather
     than an empty composer. Placed after every hook so the hook order is
     unconditional. */
  if (isNew && type === "post") return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {isNew
              ? type === "file"
                ? "Upload a file"
                : "Add a video"
              : `Edit ${type === "file" ? "file" : type === "post" ? "post" : "video"}`}
          </DialogTitle>
          <DialogDescription>
            {visibility === "course-only"
              ? "Course-only: this won't appear in the Resource Library, only inside courses that use it."
              : "Published resources appear in the Resource Library for the audience you choose."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Client onboarding checklist" />
          </Field>
          <Field label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="One or two lines on what this is and when to use it."
            />
          </Field>

          {type === "post" && (
            <p className="rounded-lg border border-hair bg-paper p-3 text-xs text-ink-mute">
              This post was written before the library became upload-only. Its
              text is read-only and stays exactly as published — you can still
              change everything else here, or delete it. To publish something
              new, upload a file.
            </p>
          )}

          {type === "video" && (
            <>
              <Field label="Video source">
                <Select value={source} onValueChange={(v) => setSource(v as VideoSource)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="embed">Link to YouTube, Vimeo, or Loom</SelectItem>
                    <SelectItem value="upload">Upload a video file</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {source === "embed" && (
                <Field label="Video link">
                  <Input
                    value={embedUrl}
                    onChange={(e) => setEmbedUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=…"
                  />
                  <p className="mt-1 text-xs text-ink-mute">
                    YouTube and Vimeo tick the step off automatically at 95% watched. Loom doesn&apos;t
                    report progress, so those steps get a &ldquo;Mark as watched&rdquo; button instead.
                  </p>
                </Field>
              )}
              <Field label="Length in minutes (optional)">
                <Input
                  value={duration}
                  onChange={(e) => setDuration(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="10"
                  inputMode="numeric"
                />
              </Field>
              <Field label="Transcript (optional)">
                <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={4} />
              </Field>
            </>
          )}

          {needsFile && (
            <Field label={type === "file" ? "File" : "Video file"}>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                  {file ? "Choose a different file" : existingFile ? "Replace file" : "Choose file"}
                </Button>
                <span className="text-xs text-ink-mute">
                  {file?.name ?? existingFile ?? "No file chosen"}
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept={type === "file" ? DOC_ACCEPT : VIDEO_ACCEPT}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <p className="mt-1 text-xs text-ink-mute">
                {type === "file" ? "PDF, PPTX, or DOCX, up to 50 MB." : "MP4, WebM, or MOV, up to 500 MB."}
              </p>
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Audience">
              <Select value={permission} onValueChange={(v) => setPermission(v as ResourcePermission)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERMISSION_LABELS) as ResourcePermission[]).map((p) => (
                    <SelectItem key={p} value={p}>{PERMISSION_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Lab">
              <Select value={lab} onValueChange={setLab}>
                <SelectTrigger><SelectValue placeholder={labName(lab)} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LAB}>All labs</SelectItem>
                  {labs.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Where it appears">
              <Select value={visibility} onValueChange={(v) => setVisibility(v as ResourceVisibility)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="library">Resource Library and courses</SelectItem>
                  <SelectItem value="course-only">Inside courses only</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Thumbnail">
              <div className="flex items-center gap-3">
                {thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element -- local data URL
                  <img src={thumbnail} alt="" className="h-10 w-16 rounded border border-hair object-cover" />
                )}
                <Input
                  type="file"
                  accept="image/*"
                  className="text-xs"
                  onChange={(e) => onThumbnail(e.target.files?.[0])}
                />
                {thumbnail && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setThumbnail("")}>
                    Clear
                  </Button>
                )}
              </div>
            </Field>
          </div>

          <Field label="Tags">
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="onboarding, checklist, faith lab"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="outline" onClick={() => save(false)} disabled={saving}>
            {saving ? "Saving…" : "Save as draft"}
          </Button>
          <Button onClick={() => save(true)} disabled={saving}>
            {saving ? "Saving…" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs uppercase tracking-wide text-ink-mute">{label}</Label>
      {children}
    </div>
  );
}
