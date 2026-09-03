"use client";

import { Amplify } from "aws-amplify";
import { CONFIG } from "@/lib/config";

let configured = false;

export function configureAmplify() {
  if (configured) return;
  /* A WorkOS build has no user pool to point at, and configuring Amplify with
     empty ids makes its first call fail somewhere far from the cause. */
  if (CONFIG.authProvider !== "cognito") return;
  configured = true;
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: CONFIG.userPoolId,
        userPoolClientId: CONFIG.clientId,
        signUpVerificationMethod: "code",
      },
    },
  });
}

export function AmplifyConfig() {
  configureAmplify();
  return null;
}
