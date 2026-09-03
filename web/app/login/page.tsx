"use client";

import { cloneElement, useEffect, useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth, type LoginStep } from "@/lib/auth";
import { passwordProblem, pwnedCount } from "@/lib/password";

type Step =
  | "signin"
  | "newpw"
  | "mfasetup"
  | "mfacode"
  | "forgot"
  | "forgotconfirm";

const BTN_LABEL: Record<Step, string> = {
  signin: "Sign in",
  newpw: "Set password",
  mfasetup: "Verify & continue",
  mfacode: "Verify",
  forgot: "Send reset code",
  forgotconfirm: "Reset password",
};

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pwnedWarning, setPwnedWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (auth.status === "signedIn") router.replace("/");
  }, [auth.status, router]);

  /* Under AuthKit the credential screens live on WorkOS's domain, so this page
     is a staging post rather than a form: bounce straight out to the hosted
     sign-in. The ref keeps a re-render — or React's development double-invoke —
     from starting a second authorization while the first is still navigating,
     which would leave a stale PKCE verifier behind and fail the exchange. */
  const { hostedSignIn, status } = auth;
  const redirecting = useRef(false);
  useEffect(() => {
    if (!hostedSignIn || status !== "signedOut" || redirecting.current) return;
    redirecting.current = true;
    hostedSignIn().catch(() => {
      redirecting.current = false;
    });
  }, [hostedSignIn, status]);

  const applyStep = (next: LoginStep) => {
    if (next === "DONE") {
      router.replace("/");
      return;
    }
    if (next === "NEW_PASSWORD_REQUIRED") setStep("newpw");
    if (next === "MFA_SETUP") setStep("mfasetup");
    if (next === "MFA_CODE") setStep("mfacode");
  };

  const checkPasswordAndWarn = async (pw: string): Promise<boolean> => {
    const problem = passwordProblem(pw);
    if (problem) {
      setError(problem);
      return false;
    }
    const count = await pwnedCount(pw);
    setPwnedWarning(
      count > 0
        ? "This password has appeared in known data breaches. Consider choosing a different one."
        : null
    );
    return true;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (step === "signin") {
        applyStep(await auth.startLogin(username, password));
      } else if (step === "newpw") {
        if (!(await checkPasswordAndWarn(newPassword))) return;
        applyStep(await auth.submitNewPassword(newPassword));
      } else if (step === "mfasetup") {
        applyStep(await auth.submitMfaSetupCode(code));
      } else if (step === "mfacode") {
        applyStep(await auth.submitMfaCode(code));
      } else if (step === "forgot") {
        await auth.forgotPassword(username);
        setStep("forgotconfirm");
      } else if (step === "forgotconfirm") {
        if (!(await checkPasswordAndWarn(newPassword))) return;
        await auth.confirmForgotPassword(username, code, newPassword);
        setStep("signin");
        setPassword("");
        setError("Password reset. Sign in with your new password.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const setupUriParts = useMemo(() => {
    if (!auth.totpSetup) return null;
    return { uri: auth.totpSetup.setupUri, secret: auth.totpSetup.sharedSecret };
  }, [auth.totpSetup]);

  if (hostedSignIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-violet-deep px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
          <div className="mb-6 flex flex-col items-center gap-2">
            <Image src="/ol-mark.svg" alt="" width={32} height={32} />
            <span className="font-serif text-lg italic text-ink">
              The Portal
            </span>
          </div>
          <p className="text-center text-sm text-ink-mute" aria-live="polite">
            Taking you to sign in…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-violet-deep px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Image src="/ol-mark.svg" alt="" width={32} height={32} />
          <span className="font-serif text-lg italic text-ink">The Portal</span>
        </div>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {step === "signin" && (
            <>
              <Field label="Email">
                <Input
                  type="email"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              <button
                type="button"
                className="self-end text-xs text-violet-deep underline underline-offset-2"
                onClick={() => {
                  setError(null);
                  setStep("forgot");
                }}
              >
                Forgot password?
              </button>
            </>
          )}

          {step === "newpw" && (
            <>
              <p className="text-sm text-ink-mute">
                Choose a new password to finish setting up your account.
              </p>
              <Field label="New password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </Field>
            </>
          )}

          {step === "mfasetup" && (
            <>
              <p className="text-sm text-ink-mute">
                Scan this QR code with an authenticator app, then enter the 6-digit
                code it generates.
              </p>
              {setupUriParts && (
                <div className="flex flex-col items-center gap-2">
                  <QRCodeSVG value={setupUriParts.uri} size={160} />
                  <code className="text-xs text-ink-mute">{setupUriParts.secret}</code>
                </div>
              )}
              <Field label="Authenticator code">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </Field>
            </>
          )}

          {step === "mfacode" && (
            <Field label="Authenticator code">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </Field>
          )}

          {step === "forgot" && (
            <>
              <p className="text-sm text-ink-mute">
                Enter your email and we&apos;ll send you a reset code.
              </p>
              <Field label="Email">
                <Input
                  type="email"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </Field>
            </>
          )}

          {step === "forgotconfirm" && (
            <>
              <Field label="Reset code">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </Field>
              <Field label="New password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </Field>
            </>
          )}

          {error && <p className="text-sm text-red">{error}</p>}
          {pwnedWarning && <p className="text-sm text-amber">{pwnedWarning}</p>}

          <Button type="submit" disabled={busy} className="mt-2">
            {busy ? "…" : BTN_LABEL[step]}
          </Button>

          {(step === "forgot" || step === "forgotconfirm") && (
            <button
              type="button"
              className="text-xs text-ink-mute underline underline-offset-2"
              onClick={() => {
                setError(null);
                setStep("signin");
              }}
            >
              Back to sign in
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

// The Label has to carry htmlFor and the control a matching id: a bare <label>
// sitting next to an input associates with nothing, which left every field on
// this page with an empty accessible name.
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, { id })}
    </div>
  );
}
