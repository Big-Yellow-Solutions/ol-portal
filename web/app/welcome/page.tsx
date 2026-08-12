"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/lib/auth";
import { PortalDataProvider, usePortalData, WELCOME_SKIPPED_KEY } from "@/lib/portal-data";
import { api } from "@/lib/api";
import { readPhoto } from "@/lib/photo";

export default function WelcomePage() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signedOut") router.replace("/login");
  }, [status, router]);

  if (status !== "signedIn") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-violet-deep text-white">
        Loading…
      </div>
    );
  }

  return (
    <PortalDataProvider>
      <WelcomeForm />
    </PortalDataProvider>
  );
}

function WelcomeForm() {
  const router = useRouter();
  const { loading, me, people, refresh } = usePortalData();
  const meRecord = me ? people[me] : undefined;

  const [blurb, setBlurb] = useState("");
  const [specialties, setSpecialties] = useState("");
  const [visible, setVisible] = useState(true);
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (meRecord) {
      setBlurb(meRecord.blurb ?? "");
      setSpecialties((meRecord.specialties ?? []).join(", "));
      setVisible(meRecord.visible ?? true);
      setPhoto(meRecord.photo);
    }
  }, [meRecord]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-violet-deep text-white">
        Loading…
      </div>
    );
  }

  const onPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(await readPhoto(file));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api("/profile", {
        method: "PATCH",
        body: JSON.stringify({
          blurb,
          specialties: specialties
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          visible,
          photo,
          onboarded: true,
        }),
      });
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    window.localStorage.setItem(WELCOME_SKIPPED_KEY, "1");
    router.replace("/");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-violet-deep px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Image src="/ol-mark.svg" alt="" width={32} height={32} />
          <h1 className="font-serif text-xl italic text-ink">Welcome to the Portal</h1>
          <p className="text-sm text-ink-mute">
            Add a few details so the rest of the team can find you in the Bench
            Directory. You can always edit this later.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2">
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" className="h-20 w-20 rounded-full object-cover" />
            )}
            <Input type="file" accept="image/*" onChange={onPhotoChange} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Engage me for…</Label>
            <Textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} rows={3} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Specialties (comma-separated)</Label>
            <Input value={specialties} onChange={(e) => setSpecialties(e.target.value)} />
          </div>

          <label className="flex items-center gap-2 text-sm text-ink">
            <Checkbox checked={visible} onCheckedChange={(c) => setVisible(!!c)} />
            List me in the Bench Directory
          </label>

          {error && <p className="text-sm text-red">{error}</p>}

          <div className="mt-2 flex gap-3">
            <Button onClick={save} disabled={saving} className="flex-1 bg-violet-deep hover:bg-violet">
              {saving ? "Saving…" : "Save & continue"}
            </Button>
            <Button variant="outline" onClick={skip} disabled={saving}>
              Skip for now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
