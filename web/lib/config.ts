export const CONFIG = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "",
  region: process.env.NEXT_PUBLIC_AWS_REGION ?? "us-east-1",
  clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "",
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? "",
};
