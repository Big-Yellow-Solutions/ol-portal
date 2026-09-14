"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  confirmResetPassword,
  confirmSignIn,
  fetchAuthSession,
  getCurrentUser,
  resetPassword,
  signIn,
  signOut as amplifySignOut,
  type ConfirmSignInInput,
} from "aws-amplify/auth";
import {
  AuthContext,
  type AuthContextValue,
  type LoginStep,
  type TotpSetup,
} from "@/lib/auth-context";
import { registerTokenSource } from "@/lib/session";

function nextStepToLoginStep(
  signInStep: string
): LoginStep {
  switch (signInStep) {
    case "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED":
      return "NEW_PASSWORD_REQUIRED";
    case "CONTINUE_SIGN_IN_WITH_TOTP_SETUP":
      return "MFA_SETUP";
    case "CONFIRM_SIGN_IN_WITH_TOTP_CODE":
    case "CONFIRM_SIGN_IN_WITH_SMS_CODE":
      return "MFA_CODE";
    default:
      return "DONE";
  }
}

export function CognitoAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [username, setUsername] = useState<string | null>(null);
  const [totpSetup, setTotpSetup] = useState<TotpSetup | null>(null);

  const refreshAuthState = useCallback(async () => {
    try {
      const user = await getCurrentUser();
      setUsername(user.username);
      setStatus("signedIn");
    } catch {
      setUsername(null);
      setStatus("signedOut");
    }
  }, []);

  useEffect(() => {
    refreshAuthState();
  }, [refreshAuthState]);

  /* Cognito's session lives in Amplify's own storage, so this is a thin
     forward rather than anything stateful — but api.ts and optimist.ts still
     have to reach it through the same seam the WorkOS provider uses.

     fetchAuthSession() only *resolves* with no idToken when Amplify has
     definitively decided the session is dead (an expired or revoked refresh
     token, a deleted user, and the like) — its token orchestrator clears the
     stored tokens itself in that case. It *throws* for everything else: a
     network blip, AWS throttling, a refresh racing another tab. Catching
     that throw and returning null here used to read every such hiccup as
     "signed out" — api()'s null branch would then end the session and hard-
     navigate to /login, which is what made background polling (notifications,
     messages) capable of blowing away an in-progress form over a transient
     error. Let it propagate instead, exactly like the WorkOS provider's
     `token` does — api() treats a rejection as retryable, not a sign-out. */
  useEffect(() => {
    registerTokenSource({
      getToken: async () => {
        const session = await fetchAuthSession();
        return session.tokens?.idToken?.toString() ?? null;
      },
      endSession: async () => {
        await amplifySignOut();
        if (typeof window !== "undefined") window.location.href = "/login";
      },
    });
  }, []);

  const startLogin = useCallback(
    async (user: string, password: string): Promise<LoginStep> => {
      const { isSignedIn, nextStep } = await signIn({
        username: user,
        password,
      });
      setUsername(user);
      if (isSignedIn) {
        setStatus("signedIn");
        return "DONE";
      }
      if (nextStep.signInStep === "CONTINUE_SIGN_IN_WITH_TOTP_SETUP") {
        const details = nextStep.totpSetupDetails;
        setTotpSetup({
          sharedSecret: details.sharedSecret,
          setupUri: details.getSetupUri("OL Portal", user).toString(),
        });
      }
      return nextStepToLoginStep(nextStep.signInStep);
    },
    []
  );

  const respond = useCallback(
    async (challengeResponse: string): Promise<LoginStep> => {
      const input: ConfirmSignInInput = { challengeResponse };
      const { isSignedIn, nextStep } = await confirmSignIn(input);
      if (isSignedIn) {
        setStatus("signedIn");
        return "DONE";
      }
      if (nextStep.signInStep === "CONTINUE_SIGN_IN_WITH_TOTP_SETUP") {
        const details = nextStep.totpSetupDetails;
        setTotpSetup({
          sharedSecret: details.sharedSecret,
          setupUri: details.getSetupUri("OL Portal", username ?? "").toString(),
        });
      }
      return nextStepToLoginStep(nextStep.signInStep);
    },
    [username]
  );

  const submitNewPassword = useCallback(
    (newPassword: string) => respond(newPassword),
    [respond]
  );
  const submitMfaSetupCode = useCallback(
    (code: string) => respond(code),
    [respond]
  );
  const submitMfaCode = useCallback((code: string) => respond(code), [respond]);

  const forgotPassword = useCallback(async (user: string) => {
    await resetPassword({ username: user });
  }, []);

  const confirmForgotPasswordFn = useCallback(
    async (user: string, code: string, newPassword: string) => {
      await confirmResetPassword({
        username: user,
        confirmationCode: code,
        newPassword,
      });
    },
    []
  );

  const logout = useCallback(async () => {
    await amplifySignOut();
    setUsername(null);
    setStatus("signedOut");
  }, []);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.idToken?.toString() ?? null;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      username,
      totpSetup,
      hostedSignIn: null,
      startLogin,
      submitNewPassword,
      submitMfaSetupCode,
      submitMfaCode,
      forgotPassword,
      confirmForgotPassword: confirmForgotPasswordFn,
      logout,
      getIdToken,
      refreshAuthState,
    }),
    [
      status,
      username,
      totpSetup,
      startLogin,
      submitNewPassword,
      submitMfaSetupCode,
      submitMfaCode,
      forgotPassword,
      confirmForgotPasswordFn,
      logout,
      getIdToken,
      refreshAuthState,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
