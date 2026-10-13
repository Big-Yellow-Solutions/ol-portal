# Backfilling companies, contacts and deals

`backend/scripts/import-backfill.mjs` loads three CSVs (blank templates in
`docs/backfill-templates/`) in one run, so contacts find their company and deals
find both. Don't commit filled-in CSVs — they hold real client details.

```
cd backend && npm ci
AWS_REGION=us-east-1 node scripts/import-backfill.mjs \
  --companies companies.csv --contacts contacts.csv --deals deals.csv \
  --as <an Admin's email>                 # dry run: prints the plan, writes nothing
... same command plus --confirm            # writes
```

Any of the three files can be left out. `--as` must be an existing Admin; the
records are created under that person (visible to Admins until a Lab Leader's
deal points at them — see `labScope` in `src/contacts.mjs`).

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

- Dry run by default. `--confirm` writes nothing if any row has an error.
- Re-runs skip what exists (companies by name, contacts by company + email,
  deals by client + lab) and never overwrite.
- Deals skip the stage gates on purpose: a Closed deal needs no invoice file.
  Upload documents to the deals afterwards.
- Nothing sends email or starts billing. `recurring` is off unless a row says
  `yes`; a recurring deal at Contracted or later makes the daily recurring
  engine generate monthly invoice instances, and the importer warns about it.
