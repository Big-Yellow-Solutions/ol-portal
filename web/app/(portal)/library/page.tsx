"use client";

/* Resource Library (Resources & Courses PRD 4.1 and 4.3).

   One grid of everything an Admin has published, filtered by type, lab, and
   tag — the three axes section 8.4 settled on for v1. The search box narrows
   by title, description, and tag only; full-text search across post bodies is
   explicitly v2, so it deliberately doesn't reach into them.

   Admins see their own drafts and course-only items here (nobody else does),
   which is what makes this page the authoring surface as well as the reading
   one. Opening an item deep-links as ?r=RS-001 so a resource can be shared by
   URL — the same pattern the Optimist uses for proposals, and the only one
   that works under a static export. */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { usePortalData } from "@/lib/portal-data";
import { ResourceEditor } from "@/components/resource-editor";
import { ResourceViewer, fmtDuration } from "@/components/resource-viewer";
import { PERMISSION_LABELS, RESOURCE_TYPE_LABELS } from "@/lib/types";
import type { ResourceItem, ResourceType } from "@/lib/types";

const ALL = "__all__";

const TYPE_BADGE: Record<ResourceType, "secondary" | "outline" | "warning"> = {
  file: "outline",
  post: "secondary",
  video: "warning",
};

export default function LibraryPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-mute">Loading…</p>}>
      <Library />
    </Suspense>
  );
}

function Library() {
  const router = useRouter();
  const params = useSearchParams();
  const { role, labs } = usePortalData();
  const isAdmin = role === "Admin";

  const [items, setItems] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<string>(ALL);
  const [lab, setLab] = useState<string>(ALL);
  const [tag, setTag] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ResourceItem | null>(null);
  const [creating, setCreating] = useState<ResourceType | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ResourceItem | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setItems(await api<ResourceItem[]>("/resources"));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load the library.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const openId = params.get("r");
  const open = items.find((r) => r.id === openId) ?? null;
  const setOpen = (r: ResourceItem | null) =>
    router.replace(r ? `/library?r=${r.id}` : "/library", { scroll: false });

  const allTags = useMemo(
    () => [...new Set(items.flatMap((r) => r.tags ?? []))].sort(),
    [items]
  );

  const labName = (id?: string) => (id ? labs.find((l) => l.id === id)?.name ?? id : "All labs");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((r) => {
      if (type !== ALL && r.type !== type) return false;
      if (lab !== ALL && (r.lab ?? "") !== (lab === "__none__" ? "" : lab)) return false;
      if (tag !== ALL && !(r.tags ?? []).includes(tag)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.tags ?? []).some((t) => t.includes(q))
      );
    });
  }, [items, type, lab, tag, query]);

  const onSaved = (saved: ResourceItem) =>
    setItems((prev) =>
      prev.some((r) => r.id === saved.id)
        ? prev.map((r) => (r.id === saved.id ? { ...r, ...saved } : r))
        : [saved, ...prev]
    );

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await api(`/resources/${pendingDelete.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((r) => r.id !== pendingDelete.id));
      toast.success(`${pendingDelete.title} deleted.`);
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete this resource.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl italic text-ink">Resource Library</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-mute">
            Checklists, templates, walkthroughs, and written guides. Anything here can also be a
            step inside a course.
          </p>
        </div>
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>+ New resource</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setCreating("file")}>
                Upload a file
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setCreating("post")}>Write a post</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setCreating("video")}>Add a video</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title or tag"
          className="max-w-xs"
          aria-label="Filter by title or tag"
        />
        <Filter label="Type" value={type} onChange={setType} options={[
          { value: "file", label: "Files" },
          { value: "post", label: "Posts" },
          { value: "video", label: "Videos" },
        ]} allLabel="All types" />
        <Filter label="Lab" value={lab} onChange={setLab} options={[
          { value: "__none__", label: "All labs (untagged)" },
          ...labs.map((l) => ({ value: l.id, label: l.name })),
        ]} allLabel="Any lab" />
        {allTags.length > 0 && (
          <Filter label="Tag" value={tag} onChange={setTag}
            options={allTags.map((t) => ({ value: t, label: t }))} allLabel="Any tag" />
        )}
      </div>

      {loading ? (
        <p className="text-sm text-ink-mute">Loading resources…</p>
      ) : error ? (
        <p className="text-sm text-red">{error}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-ink-mute">
          {items.length === 0
            ? isAdmin
              ? "Nothing published yet. Add the first resource."
              : "Nothing has been shared with you yet."
            : "No resources match these filters."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((r) => (
            <Card key={r.id} className="overflow-hidden py-0">
              <button
                type="button"
                onClick={() => setOpen(r)}
                className="block w-full text-left"
                aria-label={`Open ${r.title}`}
              >
                {r.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element -- data URL on the record
                  <img src={r.thumbnail} alt="" className="h-32 w-full object-cover" />
                ) : (
                  <div className="flex h-32 w-full items-center justify-center bg-violet-pale">
                    <span className="font-serif text-lg italic text-violet-deep">
                      {RESOURCE_TYPE_LABELS[r.type]}
                    </span>
                  </div>
                )}
              </button>
              <CardContent className="flex flex-col gap-2 pb-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={TYPE_BADGE[r.type]}>{RESOURCE_TYPE_LABELS[r.type]}</Badge>
                  {r.status === "Draft" && <Badge variant="destructive">Draft</Badge>}
                  {r.visibility === "course-only" && <Badge variant="outline">Course only</Badge>}
                  {r.type === "video" && r.duration ? (
                    <span className="text-xs text-ink-mute">{fmtDuration(r.duration)}</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(r)}
                  className="text-left font-medium text-ink hover:text-violet-deep"
                >
                  {r.title}
                </button>
                {r.description && (
                  <p className="line-clamp-2 text-xs text-ink-mute">{r.description}</p>
                )}
                <div className="flex flex-wrap gap-1">
                  {(r.tags ?? []).map((t) => (
                    <span key={t} className="rounded-full bg-violet-pale px-2 py-0.5 text-[11px] text-violet-deep">
                      {t}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-ink-mute">{labName(r.lab)}</p>
                {isAdmin && (
                  <div className="mt-1 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(r)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => setPendingDelete(r)}>Delete</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Reading view */}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif text-xl italic">{open.title}</DialogTitle>
                <DialogDescription>
                  {[
                    RESOURCE_TYPE_LABELS[open.type],
                    labName(open.lab),
                    isAdmin ? PERMISSION_LABELS[open.permission] : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </DialogDescription>
              </DialogHeader>

              {open.description && <p className="text-sm text-ink-soft">{open.description}</p>}

              {/* PRD 4.3: if this item is part of a course, say so and link there. */}
              {(open.courses ?? []).length > 0 && (
                <div className="rounded-lg border border-hair bg-violet-pale/50 px-3 py-2 text-sm text-ink-soft">
                  Part of{" "}
                  {(open.courses ?? []).map((c, i) => (
                    <span key={c.id}>
                      {i > 0 && ", "}
                      <button
                        type="button"
                        className="font-medium text-violet-deep underline underline-offset-2"
                        onClick={() => router.push(`/courses?c=${c.id}`)}
                      >
                        {c.title}
                      </button>
                    </span>
                  ))}
                  .
                </div>
              )}

              <ResourceViewer
                resource={open}
                lookup={(id) => items.find((r) => r.id === id)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      {(editing || creating) && (
        <ResourceEditor
          key={editing?.id ?? `new-${creating}`}
          resource={editing}
          createType={creating ?? undefined}
          open
          onClose={() => {
            setEditing(null);
            setCreating(null);
          }}
          onSaved={onSaved}
        />
      )}

      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this resource?</DialogTitle>
            <DialogDescription>
              &ldquo;{pendingDelete?.title}&rdquo; and any uploaded file will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
