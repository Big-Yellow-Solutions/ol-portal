"use client";

import { createContext, useContext } from "react";

export type LoginStep =
  | "DONE"
  | "NEW_PASSWORD_REQUIRED"
  | "MFA_SETUP"
  | "MFA_CODE";

export interface TotpSetup {
  sharedSecret: string;
  setupUri: string;
}

/* The contract both auth backends satisfy, so nothing downstream of useAuth()
   knows which one the build is talking to.

   The credential half — startLogin, the password and TOTP steps, forgot
   password — only means anything under Cognito, where the portal renders those
   screens itself. AuthKit hosts them instead, so under WorkOS every one of
   those methods rejects and `hostedSignIn` is non-null. The login page branches
   on `hostedSignIn`, not on the provider name. */
export interface AuthContextValue {
  status: "loading" | "signedOut" | "signedIn";
  username: string | null;
  totpSetup: TotpSetup | null;
  /** Non-null when sign-in happens on a hosted page elsewhere. Calling it
   *  leaves the app. `optsReturnTo` comes back as `state.returnTo`. */
  hostedSignIn: ((returnTo?: string) => Promise<void>) | null;
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

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined
);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
