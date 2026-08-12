"use client";

import React, {
  createContext,
  useCallback,
  useContext,
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

export type LoginStep =
  | "DONE"
  | "NEW_PASSWORD_REQUIRED"
  | "MFA_SETUP"
  | "MFA_CODE";

interface TotpSetup {
  sharedSecret: string;
  setupUri: string;
}

interface AuthContextValue {
  status: "loading" | "signedOut" | "signedIn";
  username: string | null;
  totpSetup: TotpSetup | null;
  startLogin: (username: string, password: string) => Promise<LoginStep>;
  submitNewPassword: (newPassword: string) => Promise<LoginStep>;
  submitMfaSetupCode: (code: string) => Promise<LoginStep>;
  submitMfaCode: (code: string) => Promise<LoginStep>;
  forgotPassword: (username: string) => Promise<void>;
  confirmForgotPassword: (
    username: string,
    code: string,
    newPassword: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
  refreshAuthState: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
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

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
