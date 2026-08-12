"use client";

import { Amplify } from "aws-amplify";
import { CONFIG } from "@/lib/config";

let configured = false;

export function configureAmplify() {
  if (configured) return;
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
