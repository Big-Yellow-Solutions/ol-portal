export const CONFIG = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "",
  region: process.env.NEXT_PUBLIC_AWS_REGION ?? "us-east-1",
  clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "",
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? "",
  /* The Optimist's streaming endpoint. A separate host from apiUrl on purpose:
     API Gateway buffers, so the chat runs behind its own Lambda Function URL
     (backend/template.yaml, output "OptimistUrl"). */
  optimistUrl: process.env.NEXT_PUBLIC_OPTIMIST_URL ?? "",
  /* Which auth stack this build talks to. Cognito remains the default until
     the WorkOS cutover ships.

     This is a *build-time* switch and cannot be anything else: next.config.ts
     sets `output: "export"`, so every NEXT_PUBLIC_* value is inlined at build
     time. Changing auth is therefore a rebuild and a deploy — there is no
     runtime toggle and no instant rollback. */
  authProvider:
    process.env.NEXT_PUBLIC_AUTH_PROVIDER === "workos" ? "workos" : "cognito",
  workosClientId: process.env.NEXT_PUBLIC_WORKOS_CLIENT_ID ?? "",
} as const;

/* Where AuthKit sends the browser back after a hosted sign-in.

   This must match a Redirect URI registered in the WorkOS dashboard verbatim.
   authkit-js only exchanges the ?code= when window.location.pathname equals
   this path (or this path with a trailing slash) — on any other route it
   ignores the parameter and the sign-in silently does nothing. */
export const WORKOS_CALLBACK_PATH = "/callback";
