# Deal View — rollout notes

> **SUPERSEDED — the tabbed Deal View UI described here no longer exists.**
> It shipped in the same commit as the Pipeline v2 rebuild, which replaced it
> with a single right-side deal drawer. `components/pipeline/deal-view.tsx`,
> `deal-view-proposal-tab.tsx` and `deal-view-invoice-tab.tsx` were deleted and
> their logic ported into `components/pipeline/{deal-drawer,proposal-panel,
> invoices-panel}.tsx`. See `docs/pipeline-v2.md`.
>
> What in this document IS still accurate and load-bearing: the **nav and
> routing decisions** (Proposals is Contributor-only, Invoice Requests is
> Admin-only, `/proposals` and `/invoices` redirect to `/pipeline`), the
> **backend additions** (`POST /events`, `Deal.created`/`Deal.updated`,
> `PATCH /contracts/{id} {deal}`), and the **migration note** about standalone
> client contracts with no linked deal. Pipeline v2 builds directly on all of
> those. The QA checklist's Deal View tab steps are obsolete; everything else
> in it still applies.

Consolidates per-deal Proposal and Invoice management into a tabbed Deal
View (Overview / Proposal / Invoice) opened from a Pipeline card. Pipeline
itself is unchanged.

## What changed

**New:** `components/pipeline/deal-view.tsx` (+ `deal-view-proposal-tab.tsx`,
`deal-view-invoice-tab.tsx`) — opened via `?deal=<id>&tab=overview|proposal|invoice`
on `/pipeline`, the same query-string deep-link pattern already used by
Community (`?post=`) and Resources (`?r=`/`?c=`). Clicking a Pipeline card now
opens this instead of the old edit-only dialog; "+ New deal" and the
drag-to-Closed Assignment Notice flow still open the original dialog
unchanged. "Edit deal details" inside the Overview tab reopens that same
dialog and returns you to the Deal View afterward.

**Nav** (`components/shell/top-nav.tsx`):
- "Proposals" (was primary, all roles) → now `Contributor`-only. Admin/Lab
  Leader manage proposals from the Deal View instead.
- "Invoice Requests" (was overflow, all roles) → now `Admin`-only. A Lab
  Leader's only action there (requesting an invoice) moved to the Deal
  View's Invoice tab; Admin keeps it for the admin-review queue and
  QuickBooks reconciliation, both inherently cross-deal.
- "Contracts" — **unchanged**. Contributor MSAs and Task Orders are never
  deal-scoped (`contracts-create.mjs` refuses a `dealId` on an MSA), so that
  management stays on its own page for everyone. The Deal View's Proposal
  tab links out to it for the heavier contract actions (send for signature,
  countersign, DocuSign) rather than re-implementing them.

**Routes:** `/proposals` now redirects Admin/Lab Leader to `/pipeline`
(`router.replace`); Contributor's page is unchanged — the dead admin/LL
table + share-dialog code was removed from that file rather than left
unreachable. `/invoices` redirects Lab Leader to `/pipeline`; Admin and
Contributor views are unchanged.

**Backend, additive only, nothing removed:**
- `POST /events` (`backend/src/app.mjs`) — first-party event log for tab
  switches and key Deal View actions, writing to its own `pk: "EVENT"`
  (30-day TTL) rather than a new table or vendor. Deliberately NOT the
  `AUDIT` pk the `/admin` security audit trail reads — routine navigation
  events would drown out invite/2FA/act-as records within hours. No
  analytics vendor existed before this; swap `web/lib/analytics.ts`'s
  `track()` body for one later if needed — every call site stays the same.
- `Deal.created` / `Deal.updated` (`backend/src/app.mjs` `createDeal`/
  `updateDeal`) — the Overview tab's timestamps didn't exist on the Deal
  record before. Stamped going forward only (see Migration below).
- `PATCH /contracts/{id} { deal }` (`backend/src/contracts.mjs`) — admin-only,
  lets a standalone client contract be linked to a deal after the fact.
  Refuses MSA/task-order (never deal-scoped) and unknown deal ids.
- **Proposal and Invoice create/edit/send endpoints were already there**
  (`POST /proposals`, `PATCH /proposals/{id}`, `POST /proposals/{id}/send`,
  `POST /invoices`, `PATCH /invoices/{id}`) — the frontend just had no UI
  calling most of them (the old proposal-interview flow was deleted 8/20;
  invoice requests only ever came from the Pipeline dialog). The Deal View
  is the first UI for creating and editing a proposal's sections since then.
- `POST /contracts { proposalId }` (existing `generateContract`) is now also
  reachable from the Deal View once a proposal is Customer Approved.

## Migration / backfill

**Proposals and Invoices needed no backfill.** Both have always required a
`dealId` at creation (`proposals.mjs createProposal`, `app.mjs
createInvoice`) — every existing record already carries a `deal` reference,
so every one already surfaces in its deal's Deal View with no data changes.

**One real gap: standalone client contracts.** A contract created directly
(not generated from an approved proposal) can legitimately have no `deal`
(`contracts-create.mjs createStandalone`). Those won't appear in any Deal
View. Run, read-only:

```bash
AWS_PROFILE=ol-portal node backend/scripts/report-orphan-client-contracts.mjs
```

It lists any client contract with no linked deal — no auto-matching, since
guessing a deal from a client name risks linking the wrong one. Link one
manually with `PATCH /contracts/{id} { "deal": "D-..." }` (Admin only) if it
should show up in a Deal View.

**`Deal.created`/`Deal.updated`** are stamped only from this deploy forward.
A deal that existed before it shows "—" for both in the Overview tab until
it's next edited (which stamps `updated`; `created` stays unknown for those
— fabricating a historical creation date would be worse than admitting it's
unknown).

## Known follow-ups (not built this pass)

- The Proposal tab's "Edit sections" is a plain textarea-per-section editor
  — there's no rich/AI-assisted authoring UI since the old interview flow
  was deleted. Worth deciding if that's the permanent replacement.
- The Contract summary in the Proposal tab is read-only status + a "Generate
  contract" / "Manage on Contracts →" link — full contract actions (send for
  signature, countersign, DocuSign resend/void) were deliberately not
  duplicated into the Deal View.
- No frontend test runner exists in this repo (`web/package.json` has no
  `test` script, no `.test.*` files under `web/`) — see Tests below.
- Lab Leaders lose the flat, cross-deal Proposals/Invoices tables (sort by
  status, share-with-Contributor in one click) — the Deal View is
  deliberately per-deal only, matching the consolidation this feature asked
  for. If that's felt in practice, `/deal-flow` (Admin-only today) is the
  closest existing cross-deal view to extend.

## Self-review findings (found and fixed before shipping)

A structured review of this diff (8 independent angles: line-by-line,
removed-behavior, cross-file, reuse, simplification, efficiency, altitude,
CLAUDE.md conventions) caught several real issues in the first draft, all
fixed:

- **`backend/src/contracts.mjs` `updateContract`** — the new "link a
  contract to a deal" logic ran too late in the function: (1) the clause
  template re-merge read `next.deal` *before* the link was applied, so
  `{{...}}` placeholders wouldn't resolve until a second save; (2) linking
  wasn't blocked by `EDITABLE_STATUSES`, so an Admin could re-point a
  **Signed** contract's deal after the fact; (3) nothing stopped linking a
  second contract to a deal that already had one. Fixed by moving the block
  to the top of the function (added `"deal"` to `contentKeys` so the
  existing status guard covers it too) and adding a same-deal-already-linked
  check.
- **`web/app/(portal)/pipeline/page.tsx`** — `viewingDeal` was recomputed
  with an unmemoized `.find()` on every render (every keystroke in the
  search box); wrapped in `useMemo`. Separately, clicking "Edit deal
  details" could render the Deal View and the edit dialog stacked for a
  frame, since the URL param and local state update on different clocks;
  fixed by gating the Deal View's render on `!openDeal`.
- **`web/components/pipeline/deal-view-proposal-tab.tsx`** — sending a
  proposal did a full `refreshProposals()` (every proposal across every
  deal) just to update one record's badge; changed `sendProposal`
  (`backend/src/proposals.mjs`) to return the full updated proposal like
  every other proposal endpoint already does, and merge that locally
  instead. Also added a genuine read-only "Preview" action — the only way
  to read a proposal's sections before this was to open the mutable "Edit
  sections" form, risking an accidental save.
- **`backend/src/app.mjs`** — the new `/events` analytics writes originally
  reused `admin.mjs`'s `AUDIT` pk, which backs the `/admin` security audit
  trail; moved to their own `pk: "EVENT"` (30-day TTL) so routine tab
  clicks can't crowd out invite/2FA/act-as records.

Not fixed, and out of scope for this pass: a pre-existing ordering issue in
`updateContract` (a deviation gets audit-logged before *unrelated* later
validations — e.g. an invalid signer email — can still reject the whole
request) predates this diff; this pass only made sure its own new `deal`
validation doesn't add another way to trigger it.

## Tests

**Backend:** existing `node --test tests/*.test.mjs` (53 tests) still passes
unchanged — nothing here needed new pure-function tests; the new `/events`
and `deal`-link routes are thin DynamoDB wrappers, consistent with this
repo's existing test philosophy (`backend/tests/contracting.test.mjs`'s own
header: pure functions are unit tested, route handlers are verified live
against the deployed stack).

**Frontend:** `npx tsc --noEmit` clean, `npm run build` green (all 22 routes
prerender, including `/pipeline` with the new `useSearchParams` Suspense
boundary), `eslint` clean on every changed/new file (the 2 pre-existing
errors in `invoices/page.tsx`'s `QboCard` predate this change — confirmed via
`git stash`). No frontend test runner exists to add automated routing/
permission tests to; the QA checklist below is the real coverage for this
pass, matching how this app has been verified end-to-end before.

**Not yet verified live:** an authenticated click-through. No test Cognito
credentials were available this session (same limitation noted on several
past features in this repo). Everything below needs a real login.

## QA checklist (manual, needs a real login per role)

**Admin**
- [ ] Pipeline card click opens the Deal View on Overview; "Proposals" is
      gone from nav, "Invoice Requests" is still there (Admin-only).
- [ ] Overview shows lab, owner, deal owner (if different), amount, stage,
      close date, source, recurring info, deal id, created/updated (or "—").
- [ ] "Edit deal details" opens the existing deal dialog, saves, and returns
      to the Deal View (not the bare board).
- [ ] Proposal tab, no proposal yet: empty state + "Start a proposal"
      creates one and switches to the loaded view.
- [ ] Edit sections, save → version bumps, "Mark Final" → Send to client
      enabled → send (with and without "email the client") → proposal
      status becomes Sent.
- [ ] Share with a Contributor (name+email) saves and that Contributor can
      see it on their (now Contributor-only) `/proposals` page.
- [ ] After a customer-approved proposal (simulate via the public
      `/proposal-view` decision flow or direct API call), "Generate
      contract" appears and creates a contract; re-clicking doesn't
      duplicate it.
- [ ] Invoice tab: "+ Request invoice" creates one; "Mark sent to client" /
      "Mark paid" advance status; recurring deal shows pause/resume and it
      works.
- [ ] Deep link: paste `/pipeline?deal=<id>&tab=invoice` directly — opens on
      the Invoice tab with no console errors.
- [ ] Direct nav to `/invoices` still works (unredirected); direct nav to
      `/proposals` redirects to `/pipeline` (only Contributor is exempt).

**Lab Leader**
- [ ] Sees "Proposals" and "Invoice Requests" gone from nav.
- [ ] Direct nav to `/proposals` and `/invoices` both redirect to
      `/pipeline`.
- [ ] Can open the Deal View only for deals in their lab(s) or that they own
      (matches existing Pipeline card visibility — unchanged).
- [ ] Can start/edit/mark-final/send a proposal for their own deal; cannot
      mark a contract Signed or see the DocuSign connect card.
- [ ] Can request an invoice; does **not** see "Mark sent"/"Mark paid"
      buttons.

**Contributor**
- [ ] Nav still shows "Proposals" (unchanged) and no "Invoice Requests"
      (already empty for them before this change).
- [ ] `/proposals` renders their existing read-only card grid + Preview
      dialog exactly as before — Share/table code for other roles is gone
      from that file but nothing in the Contributor path changed.
- [ ] Has no Pipeline access at all (unchanged) — confirms they still have
      no path to a deal's Invoice tab, which is fine since invoices were
      always empty for them.

**Regression (all roles)**
- [ ] Pipeline drag-and-drop restaging still works; dropping on "Closed"
      still opens the Assignment Notice dialog, not the Deal View.
- [ ] "+ New deal" still opens the plain create dialog.
- [ ] Deleting a deal from the edit dialog does **not** try to reopen the
      Deal View afterward.

## Rollback

Every change here is additive or nav-only — no data was migrated or
deleted. Reverting the frontend commit restores the old Proposals/Contracts/
Invoices pages and nav immediately; the new backend routes (`/events`, the
`deal` patch on contracts, the `created`/`updated` deal fields) are inert if
unused and safe to leave deployed even if the frontend is rolled back.
