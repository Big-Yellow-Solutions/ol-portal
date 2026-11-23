# The Optimist's inbox: runbook (Phase 1 dry run, Phase 2 live for Admins)

Design: [email-intake-design.md](email-intake-design.md). Phase 1 receives real
forwards, authenticates the sender, extracts with Claude and replies with what
it *would* add to Pipeline. It writes only an `INBOUND` log row and an `AUDIT`
row: no Person, Company or Deal is ever created (`INBOUND_MODE=dry-run` is the
only mode the template allows).

## What the stack deploys

`ol-portal-inbound` Lambda, an S3 event on `inbound/`, a bucket policy letting
SES write there, a 90-day lifecycle rule on `inbound/`, and an SES receipt rule
set `ol-portal-inbound` (rule `optimist-inbox`, spam and virus scan on, TLS
required, store to `inbound/`).

## Steps outside the template (in order)

1. **SES account.** Confirm production access (not sandbox): in sandbox, replies
   reach only verified addresses. `aws sesv2 get-account --query ProductionAccessEnabled`.
2. **Check for an active rule set.** `aws ses describe-active-receipt-rule-set`.
   Only one set can be active per region; activating ours replaces it. If one
   exists, add the `optimist-inbox` rule to it instead.
3. **Subdomain MX.** On `in.optimisticlabs.com`: `MX 10 inbound-smtp.us-east-1.amazonaws.com`.
   Verify the subdomain as an SES identity if SES asks. Never publish
   `theoptimist@in.optimisticlabs.com`.
4. **Activate.** `aws ses set-active-receipt-rule-set --rule-set-name ol-portal-inbound`.
5. **Workspace routing.** Admin console, Gmail, Routing: for
   `theoptimist@optimisticlabs.com`, accept only senders inside the domain and
   add `theoptimist@in.optimisticlabs.com` as a recipient.
6. **DMARC.** Confirm `_dmarc.optimisticlabs.com` exists at `p=quarantine` or stricter.

## Verify the sender check against real mail (Phase 1 gate)

`inbound-auth.mjs` trusts only the first `Authentication-Results` header whose
authserv-id is `amazonses.com`, and requires `dkim=pass` signed by (and aligned
with) the From domain plus `dmarc=pass`. That header's exact shape was written
from SES's documented behaviour, **not** captured from this account. Before the
dry run counts for anything:

- Forward one real thread from a staff account. In CloudWatch, `inbound.auth`
  logs every check. It must show `ok: true` with `dkimSigner` set. If it shows
  `no-ses-authentication-results`, open the object in `inbound/` and adjust the
  header the code looks for.
- Send one message from a personal address and one with a forged
  `From: liz@optimisticlabs.com`. Both must log `rejected`, with no reply.

## Gate to Phase 2

Dry-run replies right on lab, person and company for at least 9 in 10 of 15 to
20 real forwards; DKIM passes after the routing hop; spoofed mail is dropped.

## Phase 2: going live (Admins only)

Live mode creates the company, the person and a Lead deal from a forward,
through the same handlers the browser uses (so lab scope and validation are
identical), in the forwarder's name. It is switched by one repository variable,
not by code.

**Turn on:** repository Settings, Secrets and variables, Variables: set
`INBOUND_MODE` to `live`, then re-run the *Deploy backend* workflow.
**Turn off (rollback):** set it to `dry-run` (or delete it) and re-run the
workflow. Records already created stay; nothing deletes them.

Who gets what in live mode:

| Forwarder / situation | Result |
| --- | --- |
| Admin, lab settled (note, then model hint) | Records created. Reply starts "Added to Pipeline" with a link to the deal. |
| Admin, no lab settled | Nothing written. Reply asks them to forward again with the lab in the note. (The "pick a lab" strip is Phase 3.) |
| Lab Leader | Nothing written. Reply shows what would have been added and says email intake is on for Admins first. Opened up in Phase 3 (`LIVE_ROLES` in `inbound.mjs`). |
| Contributor, spoofed or unknown sender | Unchanged from Phase 1. |

What a created deal carries: `origin` (via email, the INBOUND row id, who
forwarded it, when, the subject and a short summary) and `flags` (codes such as
`company-by-domain`, `possible-duplicate`, `lab-guessed`). A flagged deal also
rings the forwarder's bell and the reply lists what to address. There is no
banner or "Mark addressed" button yet; that is Phase 3, so for now the flags are
visible in the reply and the bell only. Every create writes an AUDIT row
(`pipeline.email-intake`, `dryRun: false`, with the ids).

**If something goes wrong:** a create that fails partway leaves what it already
made (there is no transaction). The reply says only part was added, and the
INBOUND row has `status: failed` and `created: { companyId, contactId, dealId }`
listing exactly what to clean up. Find it in DynamoDB under `pk = INBOUND`, or
by the `inbound.done` / `inbound.reply-failed` log lines.

**Ids can no longer collide.** `createDeal`, `createCompany` and `createContact`
now write with `attribute_not_exists` and move to the next number if an id is
taken, so two forwards landing together cannot overwrite each other's deal.

**Gate to Phase 3:** a week with no duplicate or wrong-lab records that needed
manual cleanup.

## Known limits

- **Reserved concurrency.** The design calls for 1. Lambda requires 10
  unreserved executions account-wide and the account quota is 10, so a
  reservation is rejected. `InboundReservedConcurrency` defaults to 0
  (unreserved). Id allocation no longer depends on it (see Phase 2), so live mode is safe without it; raise the quota when convenient.
- **Dedupe** uses a marker row (`INBOUND_MSG`, keyed by a hash of the
  Message-ID) because the `INBOUND` sort key is arrival time.
- **Model constant.** `models.mjs` is new; `optimist.mjs` and `guides.mjs` still
  carry their own copies of the same string.

## Bounce and complaint handling (for SES production access)

All outbound mail (sign-in codes, proposals, contract links, message and
assignment notices, intake replies) is sent with the `ol-portal-mail`
configuration set.

- SES publishes bounce, complaint, reject and delivery-delay events to an SNS
  topic; `ol-portal-mail-events` records each as a `MAILEVENT` row (90 days).
- A **permanent** bounce or a **complaint** adds the address to the
  `SUPPRESSION` list (no TTL). `email.mjs` checks it before every send and
  throws `SuppressedRecipientError`, so the person who triggered the mail sees
  the failure. Transient and undetermined bounces, rejects and delays are
  recorded, not suppressed. If the lookup itself fails, the mail still sends.
- CloudWatch alarms on the account's `Reputation.BounceRate` (2%) and
  `Reputation.ComplaintRate` (0.05%) notify `AlertEmail`. AWS reviews at 5% and
  0.1%.
- Clear an address once corrected: `node scripts/clear-suppression.mjs <email>`
  (and `aws sesv2 delete-suppressed-destination --email-address <email>` if it
  is on SES's own list too).

**Before deploying:** set the GitHub repository variable `ALERT_EMAIL`
(Settings, Secrets and variables, Variables). Unset, the alarms exist but have
no subscriber. After the first deploy, click the confirmation link SNS emails
to that address.
