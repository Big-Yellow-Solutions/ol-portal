import { api } from "@/lib/api";
import type { FileKind, FileRecord } from "@/lib/types";

/* Shared client side of the portal's two-step upload: the API mints a FILE
   record and hands back a presigned PUT, and the browser sends the bytes
   straight to S3 (see backend/src/app.mjs's createFile, and the same pattern
   in app/(portal)/files/page.tsx and components/resource-editor.tsx). The one
   thing this adds over those two is byte progress, which needs XMLHttpRequest
   — fetch() cannot report how far a request body has got. */

/** Mirrors backend/src/app.mjs's MAX_FILE_BYTES. The server rejects anything
 *  larger, so checking here only saves the round trip. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "50 MB";

/* The business-document formats a deal's proposal, contract or invoice
   actually arrives in. The backend stores any type (the Files page takes screen recordings),
   so this is a deal-drawer rule, enforced by extension because browsers are
   inconsistent about the MIME type they attach to .doc and .xls. */
const ACCEPTED_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"];

export const UPLOAD_ACCEPT = ACCEPTED_EXTENSIONS.map((e) => "." + e).join(",");
export const UPLOAD_TYPES_LABEL = "PDF, DOC, DOCX, XLS, XLSX, PNG, JPG";

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The uppercase format shown on an uploaded row ("PDF", "DOCX"). */
export function formatOf(file: Pick<FileRecord, "name" | "type">): string {
  const ext = extensionOf(file.name);
  if (ext) return ext.toUpperCase();
  const sub = file.type?.split("/")[1];
  return sub ? sub.toUpperCase() : "File";
}

/** Null when the file is acceptable, otherwise the reason to show. */
export function validateUpload(file: File): string | null {
  const ext = extensionOf(file.name);
  if (!ACCEPTED_EXTENSIONS.includes(ext))
    return `${file.name} isn't a supported format — use ${UPLOAD_TYPES_LABEL}.`;
  if (file.size <= 0) return `${file.name} is empty.`;
  if (file.size > MAX_UPLOAD_BYTES)
    return `${file.name} is ${fmtBytes(file.size)} — the limit is ${MAX_UPLOAD_LABEL}.`;
  return null;
}

export function fmtBytes(n?: number): string {
  if (!n || n <= 0) return "—";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}

export function fmtUploadDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** PUT the bytes to the presigned URL, reporting 0–100 as they go. */
function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload to storage failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload to storage failed — check your connection."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.send(file);
  });
}

/** Create the FILE record for a deal document and upload its bytes.
 *  `lab` scopes who can see the file and must be one the caller can see —
 *  the server rejects any other (createFile's `ctx.can.seesLab` check). */
export async function uploadDealDocument({
  file,
  dealId,
  kind,
  lab,
  onProgress,
}: {
  file: File;
  dealId: string;
  kind: FileKind;
  lab?: string;
  onProgress?: (pct: number) => void;
}): Promise<string> {
  const { id, uploadUrl } = await api<{ id: string; uploadUrl: string }>("/files", {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      deal: dealId,
      kind,
      ...(lab ? { lab } : {}),
    }),
  });
  try {
    await putWithProgress(uploadUrl, file, onProgress ?? (() => {}));
  } catch (err) {
    /* The FILE record is minted before the bytes land, so a failed PUT would
       otherwise leave a record with nothing behind it — and on a deal, a
       `kind: "proposal"` record that clears the stage gate without a document
       actually being stored. Drop it and report the failure. */
    await api(`/files/${id}`, { method: "DELETE" }).catch(() => {});
    throw err;
  }
  return id;
}

/** A short-lived presigned URL for an uploaded file. `inline` opens it in a
 *  tab (View); the default pushes it to the downloads folder (Download). */
export async function fileUrl(id: string, inline = false): Promise<string> {
  const { url } = await api<{ url: string }>(
    `/files/${id}/download${inline ? "?disposition=inline" : ""}`
  );
  return url;
}
