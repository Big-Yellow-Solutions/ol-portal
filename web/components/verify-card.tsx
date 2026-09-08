"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import {
  markVerified,
  sendVerifyCode,
  submitVerifyCode,
  verifyStatus,
  type VerifyStatus,
} from "@/lib/verify";

/* The card that asks for the emailed sign-in code.

   Mounted by /verify for real, and by /dev/verify against the dev API. It
   owns the whole exchange: find out where the session stands, mail a code if
   none is live, take the one typed in, and hand back to `onDone` once the
   API has accepted it. The API decides everything that matters — expiry,
   attempts, the resend interval — and this only says what it said. */

/* Matches RESEND_AFTER_MS in backend/src/verify.mjs; the API enforces it,
   this only keeps the button honest. */
const RESEND_AFTER_MS = 30_000;

export function VerifyCard({
  email,
  onDone,
  onSignOut,
}: {
  /** The address on the session, shown until the API confirms it. */
  email: string | null;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const [status, setStatus] = useState<VerifyStatus | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  /* One look at the session, and a code if it has none. The ref keeps
     Strict Mode's double-run from asking twice; the API would refuse the
     second anyway, but a 429 on first paint is not the welcome intended.
     No "still mounted" flag on purpose: Strict Mode's first cleanup would
     clear it while the ref stops the second run, and the answer would then
     never land. A state update after unmount is a no-op in React 18+. */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        let s = await verifyStatus();
        if (s.verified) {
          markVerified();
          onDone();
          return;
        }
        const expired = !s.expiresAt || Date.parse(s.expiresAt) < Date.now();
        if (!s.sentAt || expired) s = await sendVerifyCode();
        setStatus(s);
      } catch (err) {
        setError(describe(err));
      }
    })();
  }, [onDone]);

  // Keeps the resend countdown moving.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const sentAt = status?.sentAt ? Date.parse(status.sentAt) : null;
  const resendIn = sentAt ? Math.ceil((sentAt + RESEND_AFTER_MS - now) / 1000) : 0;
  const canResend = !busy && resendIn <= 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await submitVerifyCode(code);
      markVerified();
      onDone();
    } catch (err) {
      setError(describe(err));
      setCode("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const s = await sendVerifyCode();
      setStatus(s);
      setCode("");
      setNotice("A new code is on its way.");
      inputRef.current?.focus();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  };

  const address = status?.email ?? email;

  return (
    <div className="flex min-h-screen items-center justify-center bg-violet-deep px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Image src="/ol-mark.svg" alt="" width={32} height={32} />
          <span className="font-serif text-lg italic text-ink">The Portal</span>
        </div>

        <h1 className="text-base font-semibold text-ink">Check your email</h1>
        <p className="mt-1 text-sm text-ink-mute">
          {address ? (
            <>
              We sent a 6-digit code to{" "}
              <span className="font-medium text-ink">{address}</span>. Enter it
              to finish signing in.
            </>
          ) : (
            "Sending your sign-in code…"
          )}
        </p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={inputId}>Sign-in code</Label>
            <Input
              id={inputId}
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="123456"
              autoFocus
              required
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
              className="h-11 text-center text-2xl tracking-[0.4em] placeholder:tracking-[0.4em] placeholder:text-ink-mute/40"
            />
          </div>

          {error && (
            <p id={`${inputId}-error`} className="text-sm text-red" role="alert">
              {error}
            </p>
          )}
          {notice && !error && (
            <p className="text-sm text-ink-mute" aria-live="polite">
              {notice}
            </p>
          )}

          <Button type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : "Continue"}
          </Button>
        </form>

        <div className="mt-5 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={resend}
            disabled={!canResend}
            className="text-violet-deep underline-offset-2 hover:underline disabled:cursor-default disabled:text-ink-mute disabled:no-underline"
          >
            {resendIn > 0 ? `Send a new code (${resendIn}s)` : "Send a new code"}
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="text-ink-mute underline-offset-2 hover:underline"
          >
            Not you? Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function describe(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
