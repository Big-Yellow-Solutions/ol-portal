"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { fullName, initials } from "@/lib/data";
import { api, ApiError } from "@/lib/api";
import { readPhoto } from "@/lib/photo";
import { usePortalData } from "@/lib/portal-data";
import type { Person } from "@/lib/types";

type Filter =
  | { kind: "all" }
  | { kind: "lab-leaders" }
  | { kind: "contributors" }
  | { kind: "lab"; labId: string }
  | { kind: "tag"; tag: string };

function filterKey(f: Filter): string {
  switch (f.kind) {
    case "all":
      return "";
    case "lab-leaders":
      return "__ll";
    case "contributors":
      return "__sc";
    case "lab":
      return `__lab:${f.labId}`;
    case "tag":
      return f.tag;
  }
}

export default function BenchPage() {
  const { loading, error, labs, people, bench, role, me, refresh } = usePortalData();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const p of bench) for (const t of p.specialties ?? []) tags.add(t);
    return [...tags].sort();
  }, [bench]);

  const visiblePeople = useMemo(
    () =>
      bench.filter(
        (p) => (p.role === "Lab Leader" || p.role === "Contributor") && p.visible !== false
      ),
    [bench]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visiblePeople.filter((p) => {
      if (filter.kind === "lab-leaders" && p.role !== "Lab Leader") return false;
      if (filter.kind === "contributors" && p.role !== "Contributor") return false;
      if (filter.kind === "lab" && !(p.labs ?? []).includes(filter.labId)) return false;
      if (filter.kind === "tag" && !(p.specialties ?? []).includes(filter.tag)) return false;
      if (!q) return true;
      const name = fullName(p).toLowerCase();
      const blurb = (p.blurb ?? "").toLowerCase();
      const specialties = p.specialties ?? [];
      return (
        name.includes(q) ||
        blurb.includes(q) ||
        specialties.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [visiblePeople, filter, search]);

  const chips: { label: string; f: Filter }[] = [
    { label: "Everyone", f: { kind: "all" } },
    { label: "Lab Leaders", f: { kind: "lab-leaders" } },
    { label: "Contributors", f: { kind: "contributors" } },
    ...labs.map((lab) => ({ label: lab.name, f: { kind: "lab" as const, labId: lab.id } })),
    ...allTags.map((tag) => ({ label: tag, f: { kind: "tag" as const, tag } })),
  ];

  const editingPerson = editingKey ? people[editingKey] : null;

  if (loading) {
    return <p className="text-sm text-ink-mute">Loading…</p>;
  }

  if (error) {
    return <p className="text-sm text-red">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl italic text-ink">
          The <span className="italic">bench</span>
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-mute">
          Every Lab Leader and Contributor across OL: who&apos;s available and what to engage
          them for. Visible to everyone in the portal, unlike deals, which stay lab-scoped.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          placeholder="Search by name or what they do…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        {me && people[me] && (
          <Button
            className="shrink-0 bg-violet-deep hover:bg-violet"
            onClick={() => setEditingKey(me)}
          >
            Edit my profile
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {chips.map((c) => {
          const active = filterKey(c.f) === filterKey(filter);
          return (
            <button
              key={filterKey(c.f) || "all"}
              onClick={() => setFilter(c.f)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-violet-deep bg-violet-deep text-white"
                  : "border-hair bg-paper text-ink-mute hover:border-violet-deep hover:text-violet-deep"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-ink-mute">No one matches that filter.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <PersonCard
              key={p.username}
              person={p}
              labs={labs}
              mine={p.username === me}
              canEdit={p.username === me || role === "Admin"}
              onEdit={() => setEditingKey(p.username)}
            />
          ))}
        </div>
      )}

      <p className="max-w-3xl text-xs text-ink-mute">
        Everyone edits their own profile; admins can edit any. Contact visibility is per-person:
        your email shows unless you hide it, your phone stays private until you opt in — and the
        server enforces it, so hidden details never leave the API.
      </p>

      {editingPerson && (
        <EditProfileDialog
          person={editingPerson}
          mine={editingPerson.username === me}
          open={!!editingKey}
          onOpenChange={(open) => {
            if (!open) setEditingKey(null);
          }}
          onSaved={async () => {
            setEditingKey(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function PersonCard({
  person,
  labs,
  mine,
  canEdit,
  onEdit,
}: {
  person: Person;
  labs: { id: string; name: string }[];
  mine: boolean;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const labNames = (person.labs ?? [])
    .map((id) => labs.find((l) => l.id === id)?.name ?? id)
    .join(", ");

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-3">
        <Avatar size="lg">
          {person.photo && <AvatarImage src={person.photo} alt="" />}
          <AvatarFallback>{initials(person)}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h3 className="font-serif text-base text-ink">{fullName(person)}</h3>
          <div className="text-xs text-ink-mute">
            {person.role}
            {labNames ? ` · ${labNames}` : ""}
          </div>
        </div>
        {canEdit && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={mine ? "Edit my profile" : "Admin: edit profile"}
            onClick={onEdit}
          >
            ✎
          </Button>
        )}
      </div>

      <p className="text-sm text-ink">
        {person.blurb ? (
          <>
            <span className="text-ink-mute">Engage for: </span>
            {person.blurb}
          </>
        ) : (
          <span className="text-ink-mute">
            No profile yet{mine ? " — add what people should engage you for." : "."}
          </span>
        )}
      </p>

      {person.specialties && person.specialties.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {person.specialties.map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function EditProfileDialog({
  person,
  mine,
  open,
  onOpenChange,
  onSaved,
}: {
  person: Person;
  mine: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [blurb, setBlurb] = useState(person.blurb ?? "");
  const [specialties, setSpecialties] = useState((person.specialties ?? []).join(", "));
  const [visible, setVisible] = useState(person.visible ?? true);
  const [photo, setPhoto] = useState<string | undefined>(person.photo);
  const [saving, setSaving] = useState(false);

  const onPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await readPhoto(file));
    } catch {
      toast.error("Couldn't read that image");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const path = mine ? "/profile" : `/profile/${person.username}`;
      await api(path, {
        method: "PATCH",
        body: JSON.stringify({
          blurb,
          specialties: specialties
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          visible,
          photo,
        }),
      });
      toast.success("Profile saved");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save this profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mine ? "My profile" : fullName(person)}</DialogTitle>
          <DialogDescription>
            Shown to everyone in the portal on the bench directory.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Avatar size="lg">
              {photo && <AvatarImage src={photo} alt="" />}
              <AvatarFallback>{initials(person)}</AvatarFallback>
            </Avatar>
            <Input type="file" accept="image/*" onChange={onPhotoChange} className="max-w-56" />
            {photo && (
              <Button type="button" variant="outline" size="sm" onClick={() => setPhoto(undefined)}>
                Remove
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>&ldquo;Engage me for&rdquo; blurb</Label>
            <Textarea
              value={blurb}
              onChange={(e) => setBlurb(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="When and why should someone bring you in?"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Specialties (comma-separated tags)</Label>
            <Input
              value={specialties}
              onChange={(e) => setSpecialties(e.target.value)}
              placeholder="grant writing, faith-based orgs"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-ink">
            <Checkbox checked={visible} onCheckedChange={(c) => setVisible(!!c)} />
            Visible in the bench directory
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            className="bg-violet-deep hover:bg-violet"
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
