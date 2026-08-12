"use client";

/* Shared signature capture (Base Contract PRD 5.5, FR14).

   Both signing surfaces use this: the public customer page and the Admin
   countersign dialog. Sharing it is not just DRY — the ESIGN/UETA consent
   wording and the deliberate signing act have to be identical for both
   parties, or the audit certificate would be describing two different
   ceremonies. */

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* Must stay word-for-word identical to CONSENT_TEXT in
   backend/src/signing.mjs — the server stores its own copy alongside each
   signature and the audit certificate prints it. If the two drift, the
   certificate misquotes what the signer actually agreed to. */
export const CONSENT_TEXT =
  "I agree to sign this agreement electronically, I intend my electronic signature to be " +
  "the legal equivalent of my handwritten signature, and I consent to conduct this transaction " +
  "electronically with Optimistic Labs.";

export interface SignatureState {
  name: string;
  title: string;
  consent: boolean;
  mode: "typed" | "drawn";
  drawnData: string | null;
}

export const emptySignature = (name = "", title = ""): SignatureState => ({
  name,
  title,
  consent: false,
  mode: "typed",
  drawnData: null,
});

/** A signature is submittable only once every ESIGN requirement is satisfied. */
export const signatureReady = (s: SignatureState) =>
  !!s.name.trim() && s.consent && (s.mode === "typed" || !!s.drawnData);

export const signaturePayload = (s: SignatureState) => ({
  name: s.name.trim(),
  title: s.title.trim(),
  consent: s.consent,
  signatureType: s.mode,
  ...(s.mode === "drawn" ? { signatureData: s.drawnData } : {}),
});

export function SignatureCapture({
  value,
  onChange,
  accent,
  nameLabel = "Full name",
}: {
  value: SignatureState;
  onChange: (next: SignatureState) => void;
  accent?: string | null;
  nameLabel?: string;
}) {
  const set = (patch: Partial<SignatureState>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sig-name">{nameLabel}</Label>
          <Input
            id="sig-name"
            value={value.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sig-title">Title (optional)</Label>
          <Input
            id="sig-title"
            value={value.title}
            onChange={(e) => set({ title: e.target.value })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={value.mode === "typed" ? "default" : "outline"}
            onClick={() => set({ mode: "typed" })}
          >
            Type it
          </Button>
          <Button
            type="button"
            size="sm"
            variant={value.mode === "drawn" ? "default" : "outline"}
            onClick={() => set({ mode: "drawn" })}
          >
            Draw it
          </Button>
        </div>

        {value.mode === "typed" ? (
          <div className="flex h-24 items-end rounded-md border border-foreground/15 bg-paper px-4 pb-3">
            <span className="font-serif text-3xl italic text-ink">
              {value.name || "Your name"}
            </span>
          </div>
        ) : (
          <SignaturePad
            value={value.drawnData}
            onChange={(drawnData) => set({ drawnData })}
          />
        )}
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-md bg-paper p-3">
        <Checkbox
          checked={value.consent}
          onCheckedChange={(v) => set({ consent: v === true })}
          className="mt-0.5"
        />
        <span className="text-xs leading-relaxed text-ink-soft">{CONSENT_TEXT}</span>
      </label>

      <p className="text-xs text-ink-mute" style={accent ? { color: accent } : undefined}>
        Your name, the time you sign, and your IP address are recorded with the signature.
      </p>
    </div>
  );
}

/* Pointer events rather than separate mouse/touch handlers: one implementation
   covers trackpad, mouse and finger, and the PRD expects most customers to
   open this on a phone. */
export function SignaturePad({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Match the backing store to the device pixel ratio, or the mark is a
    // blurry upscale on a phone.
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1d1a16";
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange(null);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-24 w-full touch-none rounded-md border border-foreground/15 bg-paper"
      />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-ink-mute">
          {value ? "Signature captured" : "Draw your signature above"}
        </span>
        <button type="button" onClick={clear} className="text-xs text-violet-deep hover:underline">
          Clear
        </button>
      </div>
    </div>
  );
}
