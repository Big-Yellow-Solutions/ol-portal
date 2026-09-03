/* Reports what the WorkOS environment actually contains.

   The first thing to run once the API key is stored: it confirms the key
   works and reports what the environment holds. The key is read from Secrets
   Manager inside the process and is never printed, logged, or passed on the
   command line.

   Usage:
     AWS_PROFILE=ol-portal node scripts/workos-status.mjs

   Env: WORKOS_SECRET_ID (default "WorkOs"), WORKOS_SECRET_KEY (default
   "WorkOS"). */

process.env.AWS_REGION ||= "us-east-1";

const { isConfigured, environment, status, listUsers } = await import("../src/workos.mjs");

if (!(await isConfigured())) {
  console.error(`No WorkOS API key in secret "${process.env.WORKOS_SECRET_ID || "WorkOs"}".`);
  console.error("Store it yourself so its value never passes through a transcript.");
  process.exit(1);
}

try {
  console.log(`Key addresses the ${await environment()} environment.`);
  const s = await status();
  console.log(`WorkOS reachable · ${s.users} user(s), ${s.signedIn} of them have signed in at least once, ${s.pendingInvitations} invitation(s) pending`);
  console.log(`Organizations: ${s.organizations.length ? s.organizations.map(o => `${o.name} (${o.id})`).join(", ") : "none"}`);

  if (s.users) {
    console.log("\nUsers:");
    for (const u of await listUsers()) {
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "—";
      const seen = u.last_sign_in_at ? u.last_sign_in_at.slice(0, 10) : "never signed in";
      console.log(`  · ${u.email.padEnd(34)} ${name.padEnd(20)} ${seen}`);
    }
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
