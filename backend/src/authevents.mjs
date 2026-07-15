/* OL Portal · Cognito PostAuthentication trigger (PRD 2.6 audit log).
   Fires on every successful password sign-in (not on token refresh) and
   records it in the portal table. Must return the event unchanged. */

import { writeAudit } from "./admin.mjs";

export const handler = async event => {
  try {
    const user = (event.userName || "unknown").toLowerCase();
    const newDevice = event.request?.newDeviceUsed ? " (new device)" : "";
    await writeAudit(user, "auth.signin", `successful sign-in${newDevice}`);
  } catch (err) {
    // Never block a sign-in because the audit write failed.
    console.error(JSON.stringify({ level: "error", message: "audit write failed", detail: err.message }));
  }
  return event;
};
