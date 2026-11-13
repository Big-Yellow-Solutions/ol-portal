# The Optimist's inbox: Phase 1 runbook (dry run)

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

## Known limits

- **Reserved concurrency.** The design calls for 1. Lambda requires 10
  unreserved executions account-wide and the account quota is 10, so a
  reservation is rejected. `InboundReservedConcurrency` defaults to 0
  (unreserved). Dry run doesn't need it; raise the quota before Phase 2.
- **Dedupe** uses a marker row (`INBOUND_MSG`, keyed by a hash of the
  Message-ID) because the `INBOUND` sort key is arrival time.
- **Model constant.** `models.mjs` is new; `optimist.mjs` and `guides.mjs` still
  carry their own copies of the same string.
