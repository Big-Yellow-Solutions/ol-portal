# Pipeline v2 — rollout notes

Rebuilds `/pipeline` from the `design_handoff_pipeline_v2` Claude Design
handoff, and introduces the **billing entity** model the design is built
around: the external Company and Contact records a deal invoices to.

Supersedes the tabbed Deal View UI (see the banner in
`docs/deal-view-rollout.md`) while keeping every nav, routing and backend
decision that feature made.

## What changed

**New entity pair.** `backend/src/contacts.mjs` owns `COMPANY` and `CONTACT`
records — organizations and individuals a deal bills to. These are
deliberately **not** `PERSON`, which is OL's own staff directory: a company
contact is not a portal user and must never appear in the bench. Routes:
`GET/POST /companies`, `PATCH /companies/{id}`, and the same three for
`/contacts`. Not lab-scoped (any deal in any lab can bill to any of them), so
visibility is a flat role check — the new `ctx.can.manageContacts()` in
`identity.mjs`, which both Lambdas share. Contributors get `[]`.

There is **no delete endpoint**: the design only ever exposes "remove from
this deal", which just clears the deal's `companyId`/`contactId`.

**Three data-quality gates** in `app.mjs`, which is the point of the design:

| Gate | Rule | Where |
|---|---|---|
| Billing entity | required from `Proposal Sent` onward | `createDeal`, `updateDeal` |
| Sent proposal | advancing to `Proposal Sent`+ needs a proposal with `sentAt` | `updateDeal` |
| Signed contract | closing needs `deal.contractSigned` | `updateDeal` |

The gates fire **only on the transition that crosses them** (or when the
billing link itself is edited), never as a blanket re-check on every save, so
a deal that reached a gated stage before this existed stays editable.

`contractSigned` is **not** in the `editable` allowlist — it is only ever set
by `execution.mjs::rollUpDeal()`, which writes the DEAL item directly with
`put()` when a contract is executed. So a client cannot forge it, and the
existing DocuSign/native signing path still auto-closes its deal exactly as
before (it bypasses `updateDeal` entirely, as does `proposals.mjs::advanceDeal()`).

**`SOURCES` widened** from `[Referral, Inbound, Outbound]` to add `Network`
and `Event`, in both `app.mjs` and `web/lib/types.ts`. Additive — existing
deals keep validating.

**Frontend.** `/pipeline` is now four query-string tabs (Board / Companies /
People / Proposals) plus one right-side drawer with two modes (deal, record).
New: `web/lib/pipeline.ts` (the gate rules, mirrored from the backend so
drag-and-drop can pre-empt a rejected save) and
`web/components/pipeline/{deal-drawer,billing-entity-panel,proposal-panel,invoices-panel,record-drawer,contacts-table,proposals-grid}.tsx`.

## Handoff revision (8/26)

A second cut of `design_handoff_pipeline_v2` landed after the first shipped.
Its changes, and what each became here:

**Proposals → Documents.** The fourth view is now every proposal, contract and
invoice in the pipeline rather than proposals alone, with kind chips (All /
Proposals / Contracts / Invoices), a sort select (newest / oldest / largest
amount / name), and nine cards a page with pagination.
`components/pipeline/documents-grid.tsx` replaces `proposals-grid.tsx`;
`?view=proposals` is gone, and an old link falls back to the board.

**The deal drawer has Details and Documents tabs.** Details is the form
(name, billing entity, lab/stage, owners, source, amount, close, recurring);
Documents is the proposal, contract, invoice and Assignment Notice panels. A
new deal has no documents, so it has no tabs. The board's proposal and
contract gates now open the drawer *on Documents*, because that is where the
thing blocking the drag actually is.

**Arriving at Closed clears the close date.** An expected close is a forecast
and a close date is a fact; the handoff will not let the first silently become
the second. Both entry points clear it — the stage select, and a drag that
lands on Closed — and the existing Save gate then asks for the real one. The
drag's toast is the design's: "Set the close date and add the signed contract."

**A read-only version viewer** (`version-viewer.tsx`), reached from a caret
list of earlier versions in the proposal panel. The prototype fills the page
with skeleton bars because it has no document behind a version; this app has
one, so the snapshot's own sections render. No Download button — a proposal
snapshot lives in DynamoDB, not as a file with a URL to hand over.

**Tweakable props** are constants in `lib/pipeline.ts`: `SHOW_BILLING_ON_CARDS`
and `SHOW_COLUMN_TOTALS`. `billingRequiredFrom` is `BILLING_GATE_STAGE`, which
unlike those two is *not* free to move — the backend enforces the same stage,
so changing it here alone would only make the board lie about what the server
will accept.

**Copy** — the per-view blurbs, the Documents search placeholder, and the
Companies/People footnote, which now links to the Directory. That is the
Community page's Members tab, so it points at `/community?tab=members`; the
Community page reads `?tab=` on arrival for exactly this.

Still not built, for the same reasons as the first pass: file-versioned
contracts and invoices (no backend model — judgment call 1), the
Monthly/Quarterly/Annually schedule builder (judgment call 3), and "Open full
record in Contacts →" (judgment call 4). The design's hand-rolled black pill
toast is also not adopted: toasts here come from the app-wide sonner Toaster,
and restyling it would change every page. The Optimist round-trip deep link
(`?deal=&saved=1&v=&name=`) has nothing to round-trip to — that surface is
parked in the design too.

`deal-drawer.tsx` is 554 lines, over the repo's 500-line rule. It was 539
before this pass; `fee-split-editor.tsx` came out of it to claw back most of
what the tab strip added. Getting under the line means splitting the
Assignment Notice concern out, which is a refactor of code this pass did not
otherwise touch and cannot exercise behind auth — left alone deliberately.

## Judgment calls

1. **The design's file-attachment proposal model was not built.** The handoff
   draws a proposal as an ad hoc file with a version number and a couple of
   buttons. This app already has a real proposal system — structured sections,
   version snapshots, send-to-client, customer approve/revise loop. Building
   the design literally would have created a second, disconnected proposal
   system beside the real one. `proposal-panel.tsx` puts the *real* system into
   the design's compact layout instead. Same for the contract panel, which
   links out to `/contracts` rather than re-implementing signing.
2. **Proposal badge colors follow the codebase, not the design.** The design
   says violet-until-sent then green; this app maps seven real statuses through
   `PROPOSAL_VARIANT`, so `Sent` renders amber. Matching the design here would
   make Pipeline disagree with `/contracts` and `/deal-flow`.
3. **No recurring-schedule builder.** The design offers Monthly / Quarterly /
   Twice a year / Annually "for N cycles". `recurring.mjs` only does monthly.
   `cadenceOf()` describes what actually runs rather than a schedule the
   backend cannot honor.
4. **No "Open full record in Contacts →" link.** The design links to a
   `Contacts` page that does not exist in this app; these records live only
   inside Pipeline. A footnote on the Companies/People tabs says so instead.
5. **`/companies` and `/contacts` are the only two fetches in
   `portal-data.tsx` allowed to fail.** Every other request in that
   `Promise.all` is load-bearing — one rejection sets `error` and *every* page
   renders the error state. These two are new, so a pushed frontend can reach a
   Lambda that predates them; they `.catch(() => [])` so a partial deploy or an
   independent backend rollback degrades Pipeline's billing panel instead of
   taking down the whole portal.

## Deploy order — this one matters

The frontend is a static export that **auto-deploys on push to main**
(`enableAutoBuild: true`, `stage: PRODUCTION` on app `d2rvkunvze2ixv`); the
backend deploys separately via `sam deploy`. Neither order is free:

**Frontend first** — `+ New deal` with source `Network` or `Event` gets a 400
`invalid source` from the old Lambda, and worse, saving a billing entity
**silently discards it** (the old `updateDeal` `editable` allowlist has no
`companyId`/`contactId`, so the field is dropped and the user still sees
"Deal saved").

**Backend first** — the gates activate against the currently-live old
frontend. No existing deal has a billing entity yet, so any stage change into
`Proposal Sent`+ is refused, and the old UI has no way to attach one.

**Do backend first, then push immediately.** Backend-first fails as a *blocked
action with an explicit error message*; frontend-first fails as *silent data
loss*, which is strictly worse. The window is the Amplify build (~3-5 min).

```bash
cd backend && sam deploy          # then, immediately:
git push                          # auto-deploys the frontend
```

**Also note:** the live Lambda was last deployed 2026-08-20, which predates
the DocuSign commit (2026-08-22). So `sam deploy` will ship the **DocuSign
backend for the first time** — a deploy that was deliberately held pending
real credentials. Without SSM `/ol-portal/docusign-credentials`,
`/docusign/status` reports `configured: false` and the connect card shows its
not-configured state, so this is inert rather than broken — but it is a
separate decision, not a side effect to discover later.

## Rollout consideration (not a bug)

After both sides are live, **every in-flight deal at or past `Proposal Sent`
has no billing entity**, because the field is new. The gates mean such a deal
cannot change stage until someone opens it and links a company or contact. The
drawer makes this explicit — the Save button disables and the hint line names
the missing piece — and that is the data-quality behavior the design asks for.
It is worth telling Liz and the Lab Leaders before deploy day rather than
letting them discover it on a drag.

## Verification

`tsc --noEmit` clean. `next build` green (22 routes). `eslint` clean on every
new/changed file — the one remaining error in `portal-data.tsx` is the
pre-existing `set-state-in-effect` on `load()`, confirmed via `git stash`.
Backend `node --test tests/*.test.mjs` 53/53.

Visually verified against a **temporary** `app/design-check/page.tsx` harness
plus a one-line temporary `export` of `PortalDataContext` — **both reverted,
don't look for them.** Computed styles measured and corrected to the spec: h1
40px/1.06/−.015em (32px ≤760px), card 16px radius / 13px padding, lab chip
10px/700/.09em, billing tile 26px/9px, tabs 11px 16px 12px / 10px radius,
hairline `rgba(124,109,245,.16)`, page `#F8F6F2`. Exercised: the full gate
chain (unlinked deal → stage to Proposal Sent → red badge + disabled Save →
attach company → hint advances to the proposal gate), the primary-contact
suggestion row, all four tabs, the record drawer, and mobile at 375px with no
horizontal page overflow.

**Not verified:** anything behind real auth. The harness used seeded data, so
no real API call was exercised — the new routes, the gates' 400s, and inline
company/contact creation have never run against DynamoDB. Drag-and-drop
gating is verified as logic, not as an actual drag.
