# Backfilling companies, contacts and deals

Admins: **Admin → Import data**. Upload the three CSVs (blank templates in
`docs/backfill-templates/`), press **Check files**, read the preview and any
errors, then **Import**. Checking writes nothing, and one bad row stops the
whole import. Don't commit filled-in CSVs — they hold real client details.

Any of the three files can be left out. Records are created under the Admin who
imports them (visible to Admins until a Lab Leader's deal points at them — see
`labScope` in `src/contacts.mjs`). The endpoint is `POST /admin/backfill`
(`src/backfill-api.mjs`); the matching and validation are in `src/backfill.mjs`.

## Columns

| File | Required | Optional |
|---|---|---|
| companies | `name` | `kind`, `website`, `address`, `phone`, `email`, `primary_contact_email` |
| contacts | `name` | `company`, `title`, `email`, `phone` |
| deals | `client`, `lab`, `stage`, `amount`, `source`, `owner_email` | `close`, `deal_owner_email`, `company`, `contact_email`, `recurring` |

- **Matching is by name or email, never by id.** `company` must match a company
  `name` (ignoring case, "The", punctuation). `lab` matches a lab's name or id
  ("Optimistic Democracy Lab", "Democracy Lab" and `democracy` all work).
  Owners are portal users, by email.
- **A contact belongs to one company.** The same person at three companies is
  three rows in `contacts.csv`; a deal's `contact_email` is looked up at the
  deal's own `company`.
- **Primary contact** of a new company: `primary_contact_email` if it matches a
  contact at that company, otherwise the first contact listed.
- **`stage`**: Lead, Discovery, Proposal & Negotiation, Contracted (Signed),
  Closed Won (Paid), Closed Lost. "Proposal Sent", "Contracted", "Contracted
  Won", "Closed" and "Closed Won" are accepted too. Anything else is an error.
- **`source`**: Referral, Inbound, Network, Event or Outbound.
- **`amount`**: `35000` or `$35,000.00`. **`close`**: `2026-04-22` or `4/22/2026`
  (month first); blank is fine for open deals.
- A deal at Proposal & Negotiation or later (not Closed Lost) needs a company
  or contact, the same rule as the portal.

## What it does and doesn't do

- Re-runs skip what exists (companies by name, contacts by company + email,
  deals by client + lab) and never overwrite; every write is conditional on the
  key not existing.
- Deals skip the stage gates on purpose: a Closed deal needs no invoice file.
  Upload documents to the deals afterwards.
- Nothing sends email or starts billing. `recurring` is off unless a row says
  `yes`; a recurring deal at Contracted or later makes the daily recurring
  engine generate monthly invoice instances, and the page warns about it.
- If an import stops partway (two people creating records at the same moment),
  it says how many records it wrote. Run it again: what was written is skipped.
