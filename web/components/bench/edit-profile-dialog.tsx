"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { api, ApiError } from "@/lib/api";
import { fullName, initials } from "@/lib/data";
import { readPhoto } from "@/lib/photo";

/* Unchanged by the Directory redesign: the same profile editor, lifted out of
   the page so the bench screen itself stays the design's. Contact visibility
   is per-person and enforced server-side, so what is toggled here is what the
   API will hand anybody else. */

export function EditProfileDialog({
  person,
  username,
  mine,
  open,
  onOpenChange,
  onSaved,
}: {
  person: import("@/lib/types").Person;
  username: string;
  mine: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [blurb, setBlurb] = useState(person.bench?.blurb ?? "");
  const [specialties, setSpecialties] = useState(
    (person.bench?.specialties ?? []).join(", ")
  );
  const [contactEmail, setContactEmail] = useState(person.bench?.email ?? "");
  const [phone, setPhone] = useState(person.bench?.phone ?? "");
  const [showEmail, setShowEmail] = useState(person.bench?.showEmail ?? true);
  const [showPhone, setShowPhone] = useState(person.bench?.showPhone ?? false);
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
      const path = mine ? "/profile" : `/profile/${username}`;
      await api(path, {
        method: "PATCH",
        body: JSON.stringify({
          blurb,
          specialties: specialties
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          email: contactEmail,
          phone,
          showEmail,
          showPhone,
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
            <Label htmlFor="bench-engage-me-for-blurb">&ldquo;Engage me for&rdquo; blurb</Label>
            <Textarea id="bench-engage-me-for-blurb"
              value={blurb}
              onChange={(e) => setBlurb(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="When and why should someone bring you in?"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bench-specialties">Specialties (comma-separated tags)</Label>
            <Input id="bench-specialties"
              value={specialties}
              onChange={(e) => setSpecialties(e.target.value)}
              placeholder="grant writing, faith-based orgs"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bench-contact-email">Contact email (shown on your card unless hidden below)</Label>
            <Input id="bench-contact-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bench-phone">Phone (hidden unless you opt in below)</Label>
            <Input id="bench-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>

          <label className="flex items-center gap-2 text-sm text-ink">
            <Checkbox checked={showEmail} onCheckedChange={(c) => setShowEmail(!!c)} />
            Show my email on the bench directory
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <Checkbox checked={showPhone} onCheckedChange={(c) => setShowPhone(!!c)} />
            Show my phone on the bench directory
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
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
