/* OL Portal · in-app help content (contextual guide widget).

   One GUIDE record per portal page (pk="GUIDE", sk=<pageKey>, matching the
   sidebar's route segments — "dashboard" for the root page). Content is
   maintained by editing backend/scripts/seed-guides.mjs and re-running it,
   the same way sample data was originally loaded — there's no in-app editor
   for this, unlike the Knowledge Base (assist.mjs's /kb routes) which Liz/Seth
   curate directly; guide copy describes the software itself, not sales
   playbooks, so only a dev needs to touch it.

   Role-awareness lives at the section level rather than as separate records
   per role: most of a page reads the same for everyone who can reach it, and
   only a handful of sections are role-specific (e.g. "as an Admin you can
   also ..."). `roles` on the top-level record and on each section is an
   allowlist; omitting it means "everyone who can see this page at all". */

import { resp, listType } from "./util.mjs";

export async function listGuides(ctx) {
  const items = await listType("GUIDE");
  return resp(200, items
    .filter(g => !g.roles || g.roles.includes(ctx.role))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(({ pk, sk, order, roles, sections, ...rest }) => ({
      page: sk,
      ...rest,
      sections: (sections || []).filter(s => !s.roles || s.roles.includes(ctx.role))
    })));
}
