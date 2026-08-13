"use client";

/* Admin course builder (PRD 4.2). A course is metadata plus an ordered list of
   steps, so this is really two editors stacked: the cover fields, and the step
   list underneath.

   Steps reorder by dragging, per the PRD, and also by a pair of move buttons —
   drag-and-drop is unreachable from a keyboard, and the portal already went
   through one accessibility pass to remove blockers like that. Both paths
   write the same array.

   Reordering is safe for learners: each step keeps the stable id the server
   minted for it, and progress is keyed on that id, so moving step 4 to the top
   moves its checkmark with it. */

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { PERMISSION_LABELS, RESOURCE_TYPE_LABELS } from "@/lib/types";
import type {
  Course,
  CourseStep,
  NavigationMode,
  ResourceItem,
  ResourcePermission,
} from "@/lib/types";

const NO_LAB = "__all__";

interface CourseEditorProps {
  course: Course | null;
  /** Every resource the Admin can pick from, drafts included. */
  library: ResourceItem[];
  open: boolean;
  onClose: () => void;
  onSaved: (c: Course) => void;
}

export function CourseEditor({ course, library, open, onClose, onSaved }: CourseEditorProps) {
  const { labs } = usePortalData();
  const [title, setTitle] = useState(course?.title ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [cover, setCover] = useState(course?.cover ?? "");
  const [minutes, setMinutes] = useState(
    course?.estimatedMinutes ? String(course.estimatedMinutes) : ""
  );
  const [lab, setLab] = useState(course?.lab ?? NO_LAB);
  const [permission, setPermission] = useState<ResourcePermission>(course?.permission ?? "both");
  const [navigation, setNavigation] = useState<NavigationMode>(course?.navigation ?? "free");
  const [steps, setSteps] = useState<CourseStep[]>(course?.steps ?? []);
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const dragFrom = useRef<number | null>(null);

  const byId = useMemo(() => new Map(library.map((r) => [r.id, r])), [library]);
  // Drafts are offered too: building a course and writing its pieces usually
  // happen together, and a step pointing at a draft is flagged rather than
  // hidden — publishing the course before its steps is the mistake worth
  // surfacing, not one worth preventing outright.
  const available = useMemo(
    () => [...library].sort((a, b) => a.title.localeCompare(b.title)),
    [library]
  );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= steps.length || from === to) return;
    const next = [...steps];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setSteps(next);
  };

  const addStep = (resourceId: string) => {
    if (!resourceId) return;
    // A blank id is fine: the server mints a stable one on save.
    setSteps((prev) => [...prev, { id: "", resource: resourceId, note: "" }]);
    setAdding("");
  };

  const save = async (publish?: boolean) => {
    if (!title.trim()) return toast.error("Give this course a title.");
    if (publish && steps.length === 0) return toast.error("Add at least one step before publishing.");

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        cover: cover || "",
        estimatedMinutes: minutes.trim() ? Number(minutes) : null,
        lab: lab === NO_LAB ? "" : lab,
        permission,
        navigation,
        steps: steps.map((s) => ({ id: s.id, resource: s.resource, note: s.note ?? "" })),
        ...(publish === undefined ? {} : { status: publish ? "Published" : "Draft" }),
      };
      const saved = await api<Course>(course ? `/courses/${course.id}` : "/courses", {
        method: course ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      toast.success(`${saved.title} saved.`);
      onSaved(saved);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save this course.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{course ? "Edit course" : "New course"}</DialogTitle>
          <DialogDescription>
            Steps run in the order below. A learner ticks each one off by opening it — or, for a
            video, by watching 95% of it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Contributor onboarding" />
          </Field>
          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </Field>

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
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LAB}>All labs</SelectItem>
                  {labs.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Navigation">
              <Select value={navigation} onValueChange={(v) => setNavigation(v as NavigationMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free — jump to any step</SelectItem>
                  <SelectItem value="linear">Linear — unlock steps in order</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Estimated time (minutes)">
              <Input
                value={minutes}
                onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="45"
                inputMode="numeric"
              />
            </Field>
          </div>

          <Field label="Cover image">
            <div className="flex items-center gap-3">
              {cover && (
                // eslint-disable-next-line @next/next/no-img-element -- local data URL
                <img src={cover} alt="" className="h-12 w-20 rounded border border-hair object-cover" />
              )}
              <Input
                type="file"
                accept="image/*"
                className="text-xs"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    setCover(await readPhoto(f, 800));
                  } catch {
                    toast.error("Could not read that image.");
                  }
                }}
              />
              {cover && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setCover("")}>Clear</Button>
              )}
            </div>
          </Field>

          <div className="flex flex-col gap-2">
            <Label className="text-xs uppercase tracking-wide text-ink-mute">
              Steps ({steps.length})
            </Label>
            {steps.length === 0 && (
              <p className="text-sm text-ink-mute">
                No steps yet. Add published resources below, in the order a learner should work
                through them.
              </p>
            )}
            <ol className="flex flex-col gap-2">
              {steps.map((step, i) => {
                const r = byId.get(step.resource);
                return (
                  <li
                    key={`${step.id || "new"}-${i}`}
                    draggable
                    onDragStart={() => (dragFrom.current = i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragFrom.current !== null) move(dragFrom.current, i);
                      dragFrom.current = null;
                    }}
                    className="flex flex-col gap-2 rounded-lg border border-hair bg-paper p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-xs font-medium text-ink-mute">{i + 1}.</span>
                        {r ? (
                          <>
                            <Badge variant="outline">{RESOURCE_TYPE_LABELS[r.type]}</Badge>
                            <span className="truncate text-sm font-medium text-ink">{r.title}</span>
                            {r.status === "Draft" && <Badge variant="destructive">Draft</Badge>}
                          </>
                        ) : (
                          <span className="text-sm text-red">Missing resource {step.resource}</span>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button size="sm" variant="ghost" aria-label={`Move step ${i + 1} up`}
                          disabled={i === 0} onClick={() => move(i, i - 1)}>↑</Button>
                        <Button size="sm" variant="ghost" aria-label={`Move step ${i + 1} down`}
                          disabled={i === steps.length - 1} onClick={() => move(i, i + 1)}>↓</Button>
                        <Button size="sm" variant="ghost" aria-label={`Remove step ${i + 1}`}
                          onClick={() => setSteps((prev) => prev.filter((_, x) => x !== i))}>
                          Remove
                        </Button>
                      </div>
                    </div>
                    <Input
                      value={step.note ?? ""}
                      onChange={(e) =>
                        setSteps((prev) =>
                          prev.map((s, x) => (x === i ? { ...s, note: e.target.value } : s))
                        )
                      }
                      placeholder="Step note (optional) — e.g. Watch this, then download the checklist below"
                      className="text-xs"
                    />
                  </li>
                );
              })}
            </ol>

            <div className="flex items-center gap-2">
              <Select value={adding} onValueChange={addStep}>
                <SelectTrigger className="max-w-md" aria-label="Add a step">
                  <SelectValue placeholder="Add a resource as the next step…" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {RESOURCE_TYPE_LABELS[r.type]} · {r.title}
                      {r.status === "Draft" ? " (draft)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-ink-mute">
              Drag a step to reorder it, or use the arrows. Course-only resources are fine here —
              they stay hidden from the Resource Library.
            </p>
          </div>
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
