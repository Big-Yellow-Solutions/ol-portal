# Forward to Pipeline: Email Intake Design

Nov 12, 2026 · @Liz

## Summary

A team member forwards an email to one Optimist address, and within a minute the portal creates (or reuses) a Person, a Company and a Lead-stage deal in their lab, then replies with what it did and a link to review. Recommendation: build it as the first "skill" of a general Optimist inbox, so the later email helper (calendar, expenses, drafting) plugs into the same intake instead of a second pipeline.

Three choices shape the design:

- **Add automatically, flag what needs attention.** Lead has no stage gates and a billing entity is optional until Proposal Sent, so a wrong guess costs little. Deals land on the board straight away; anything the forwarder must address is flagged on the deal and in the reply.
- **Reuse the existing handlers.** The intake calls `createContact`, `createCompany` and `createDeal` with a context built for the forwarder, the same pattern the Optimist tools use. Permissions, lab scope and validation cannot drift from what the UI enforces.
- **Claude extracts, the server decides.** The model only fills a fixed schema. Matching, scope checks and writes are ordinary code.

Scope for v1: Admins and Lab Leaders only, one external person per email, Pipeline intent only. Everything else is logged and answered with a polite "not yet".

## User experience

The whole interaction is: forward, get a reply, glance at the card later.

**1. Forward.** From their own `@optimisticlabs.com` account, the team member forwards the thread to `theoptimist@optimisticlabs.com`. They can add an optional note above the forward in plain words, for example:

```
Faith lab. Referral from Aliza. They mentioned ~$40k for a board retreat.
```

The note is the most reliable signal, so it wins over anything inferred from the thread.

**2. Get a reply** (target under 60 seconds), from the Optimist at `no-reply@`:

```
Added to Pipeline (Faith lab, Lead)
Person:  Dana Whitfield, dana@riverchurch.org  (new)
Company: River Church, riverchurch.org        (matched existing)
Deal:    River Church board retreat, $40,000, source Referral
Review it: https://portal.optimisticlabs.com/pipeline?deal=D-142
```

Anything the forwarder needs to address is listed under a "To address" line in the reply: no lab could be chosen, a possible duplicate, a company matched only by domain. If nothing is flagged, the reply says so and there is nothing more to do.

**3. Address flags in Pipeline.** Every deal from email carries a small "From email" chip. Only deals with something to address also get a "Needs attention" badge. Opening one shows a banner at the top of the Details tab:

- Who forwarded it and when, the original subject, and a 2 to 3 sentence summary of the thread.
- Each flag as a line to act on, such as "Pick a lab" or "Company matched by domain, confirm it's the same org".
- A **Mark addressed** button that clears the badge. Fixing the flagged field and saving also clears it.

A "Needs attention N" toggle sits next to the existing "Needs billing entity" toggle on the board, and the forwarder gets a bell notification for each flagged deal. Who else sees the deal follows today's permissions: an Admin sees everything, a Lab Leader sees deals in their labs or that they own.

**Discoverability.** The forwarding address appears on the Profile page ("Your Optimist address") and in a new help guide. A Contributor who forwards gets a reply explaining that Pipeline intake is for Admins and Lab Leaders.

**Out of scope for v1:** multiple external people per email, updating an existing deal from a reply-all, attachments filed to the deal, and BCC-to-log behaviour. Each is a natural next skill on the same inbox.

## Architecture

One new Lambda and an SES receipt rule, added to the existing `ol-portal-backend` stack; everything after the router reuses code that already runs in production.

&#91;embedded content: email intake · SES to Pipeline, with room for later skills\]

Mail never touches API Gateway or the WorkOS authorizer: the verified sender is the credential, and `buildContext` turns it into the same permissions the browser gets. Mail that fails sender checks stops at Verify sender with no reply.

- **Address and routing.** People write to `theoptimist@optimisticlabs.com`. The domain's mail runs on Google Workspace, so SES cannot receive there directly. A Workspace routing rule (Admin console, Gmail routing) passes that address on to a hidden SES address, `theoptimist@in.optimisticlabs.com`, whose subdomain has its own MX record. Gmail for everyone else is untouched, and the rule accepts only senders inside the domain.
- **SES receipt rule** on `in.optimisticlabs.com`: scan for spam and viruses, store to `ol-portal-files-<acct>/inbound/`, nothing else. The S3 event triggers the Lambda, which gives a natural retry and keeps large messages out of the event payload.
- **`ol-portal-inbound`** (new, arm64, 512 MB, 120 s timeout, reserved concurrency 1). IAM: read `inbound/`, DynamoDB CRUD, SSM read for the Anthropic key, `ses:SendEmail`.
- **Shared code.** It imports `identity.mjs`, `contacts.mjs`, the deal handlers from `app.mjs` (moved into a `deals.mjs` module so both Lambdas can call them), `email.mjs`, `notifications.mjs` and the shared model constant.
- **Deciding what to do.** The Optimist reads the note and the email and picks from the jobs it knows (the "intent router" in the diagram). v1 knows one, adding a lead to Pipeline. Later jobs are added to that list, with no new infrastructure and no change for the people forwarding.

## Processing steps

Each inbound email runs through seven steps in the intake Lambda; any step can stop it with a logged reason.

1. **Dedupe.** Key on the `Message-ID` header. If an INBOUND record already exists, stop. SES can deliver the same message twice, and Gmail retries.
2. **Authenticate the sender.** Require a DKIM pass signed by `optimisticlabs.com` with DMARC alignment. SPF is not checked, because the Workspace routing hop changes the sending server. Then resolve the `From` address to an active PERSON with `identity.mjs` (`resolvePerson`, `active !== false`). Fail either check and the message is dropped silently, with no reply.
3. **Build the forwarder's context.** Call `buildContext` for that PERSON so `ctx.role`, `ctx.labs` and `ctx.can` are exactly what they would get in the browser. Contributors stop here with a short reply, since the portal gives them no Pipeline access today.
4. **Parse the MIME.** Separate the forwarder's note from the forwarded block, pull the original sender, date, subject, cc list and the signature block. Strip quoted history beyond the forwarded message and cap text at about 30,000 characters.
5. **Classify and extract with Claude.** One call, no tools, structured JSON output, using the shared model constant. It returns the intent (`pipeline.add` or `unknown`) and a fixed schema:
   - person: first and last name, email, phone, title
   - company: name, website (from the email domain unless it is a free-mail domain)
   - deal: short name, lab hint, amount if stated, source if the note names one, a 2 to 3 sentence summary
   - confidence per field and a list of anything ambiguous
6. **Match, then create.** Look up the CONTACT by email, then the COMPANY by website domain, then by normalized name. Reuse matches inside the forwarder's scope (`labScope`). Create whatever is missing through `createContact`, `createCompany` and `createDeal` with the forwarder's context. The deal is created at Lead, with `owner` and `dealOwner` set to the forwarder and source `Inbound` unless the note names another.
7. **Flag, record and reply.** Attach any flags to the deal, update the INBOUND record with the outcome and the ids touched, write an AUDIT row, send the forwarder a bell notification if anything is flagged, and send the confirmation through `sendSystemEmail`.

If extraction finds no usable person email, nothing is created. The reply asks the sender to forward the message that contains the contact, or to add their email in the note.

## Data model changes

One new entity and a few optional fields on existing ones; nothing existing is renamed or re-keyed.

| Entity | Key | New fields | Notes |
| --- | --- | --- | --- |
| INBOUND (new) | pk `INBOUND`, sk `<received ISO>#<message-id hash>` | `from`, `personKey`, `subject`, `s3Key`, `intent`, `status` (received, ignored, rejected, held, done, failed), `reason`, `draft` (when held for a lab), `created{contactId, companyId, dealId}`, `matched{…}`, `ttl` | The shared inbox log for every future Optimist email skill. 90-day TTL to match AUDIT. Raw MIME stays in S3, not in the row. |
| DEAL | unchanged | `origin{via: "email", inboundId, forwardedBy, receivedAt, subject, summary}`, `flags[]` (codes such as `possible-duplicate`, `company-by-domain`, `lab-guessed`), `flagsAddressedBy`, `flagsAddressedAt` | `updateDeal` allowlist gains `flags`, and only to clear it, so Mark addressed works. |
| CONTACT, COMPANY | unchanged | `origin{via: "email", inboundId}` | `createdBy` is already set by the create handlers, which keeps new records inside the forwarder's `labScope` before the deal links them. |
| AUDIT | existing | action `pipeline.email-intake` | Gives deal creation its first audit trail. |

Raw emails go to a new S3 prefix, `inbound/`. The analyzer trigger fires only on `uploads/`, so inbound mail is never auto-sent to the analyzer, and it never becomes a FILE row (which would hit the untagged-file visibility issue).

## Rules and edge cases

Every case below resolves to "create", "create and flag", "hold and flag" or "stop and reply"; none asks the user a question mid-flow.

| Situation | Behaviour |
| --- | --- |
| Lab Leader with one lab | Deal goes in that lab. |
| Lab Leader with several labs | Lab named in the note wins; else the model's lab hint if it is one of theirs; else their first lab, flagged "lab guessed". |
| Admin | Note, then model hint. If neither settles it, hold the deal as a draft on the INBOUND record and show it in a "From email · pick a lab" strip at the top of the forwarder's board; picking a lab creates it. A deal can't exist without a lab, and guessing one would put it in front of the wrong Lab Leader. |
| Source not stated | `Inbound`. A source named in the note (Referral, Network, Event, Outbound) wins. |
| Contact email already exists in scope | Reuse it; update blank fields only (title, phone), never overwrite. |
| Contact exists but is outside the forwarder's scope | Treat as not found, as `labScope` does elsewhere (it returns 404, never confirms existence). A Lab Leader gets a new CONTACT; the possible duplicate is recorded where only Admins see it. |
| Company match by domain | Reuse in scope; flag "company matched by domain" since domains can be shared (a diocese and its parishes). |
| Free-mail sender (gmail.com, outlook.com and similar) | No company from the domain. Use a company named in the note or the signature; otherwise create the deal with the person only. Fine at Lead. |
| Several external people in the thread | v1 picks the original sender of the forwarded message; the others go in the deal summary by name. |
| An open deal the forwarder can see already links this contact | Still create the new deal, flagged "possible duplicate of D-0xx". Updating existing deals is a later skill. |
| Forwarder is the only external address (they wrote the email) | Use the first `To` recipient outside `optimisticlabs.com` as the person. |
| Amount stated as a range or "about" | Store the low end, note the range in the summary. |
| Deal name | `<Company> <short purpose>` from the model, capped at 80 characters; falls back to `<Company or person> (from email)`. |

## Security and privacy

The inbox is a public address that writes to the database, so it is treated like the existing unauthenticated routes: the credential is a verified sender, checked before anything else.

- **Spoofing.** A `From` header alone proves nothing. Two checks: the Workspace routing rule passes on only mail from senders inside the domain, and SES must see a DKIM pass for `optimisticlabs.com` with DMARC alignment. Confirm the domain's DMARC record exists and is at `p=quarantine` or stricter, and that the hidden SES address is never published.
- **Backscatter.** Unknown or failed senders get no reply. Replying would confirm the address and send mail to forged senders.
- **Prompt injection.** The email body is untrusted text written by an outsider. The model has no tools, can only fill the schema, and its output passes the same validation as a form submit. Nothing in the email can change the lab, owner, stage or role; those come from the forwarder's context and fixed rules.
- **Data sent to Anthropic.** Full email text goes to the Anthropic API under the portal's existing key, the same exposure as the file analyzer. Worth one line in the team guide, since forwarded threads can carry client details.
- **Retention.** Raw MIME in `inbound/` gets an S3 lifecycle rule (90 days suggested). The INBOUND row expires on the same TTL; the deal keeps only the short summary.
- **Act-as.** Not applicable. Intake always runs as the real forwarder; there is no header to impersonate.
- **Abuse limits.** Cap each sender at 30 intakes per hour and the inbox at 200 per day; excess messages are logged as `ignored` with no reply.

## Prerequisites and risks

Five things in today's portal need handling before or alongside the build; the first two are blockers.

| Item | Why it matters | Mitigation |
| --- | --- | --- |
| Mail for `optimisticlabs.com` is on Google Workspace | SES cannot receive on the root domain without moving MX away from Gmail. | Keep `theoptimist@optimisticlabs.com` as the public address and route it in Workspace to `theoptimist@in.optimisticlabs.com`, a subdomain whose MX points at SES inbound in us-east-1. Check in phase 1 that DKIM survives the routing hop. |
| SES sandbox vs production is unverified | In sandbox, replies only reach verified addresses. Staff addresses on the verified domain should still work, but confirm. | Check the account status first; it was already flagged as a prerequisite for the email-capture work. |
| Account Lambda concurrency quota of 10 | The portal already batches data loads to stay inside it. A burst of forwards could starve the API and lock people out. | Reserved concurrency of 1 on the intake Lambda. Mail queues in S3 events and processes one at a time. |
| `nextId` is max+1 over the partition | Two creates at once can collide on the same `D-` or `CT-` id. | Concurrency of 1 removes the race for intake. Separately, a conditional put (`attribute_not_exists(sk)`) with retry in `nextId` is worth doing for everyone. |
| No staging stack, no tests in CI | A bad deploy would write junk records straight into production. | Dry-run phase first (below), a separate test address, and unit tests for the parser and matcher added to the deploy workflow. |

Cost is small: SES inbound is cents per thousand messages, and one extraction call per email at current volume should land well under a few dollars a month.

## Rollout

Four phases, each a separate pull request, each gated on the one before working with real forwards.

1. **Plumbing and dry run.** Subdomain MX, Workspace routing rule for `theoptimist@`, SES receipt rule, `inbound/` prefix, intake Lambda, INBOUND log, sender authentication and extraction. It writes nothing to Pipeline; the reply says what it *would* create and flag. Liz and Seth forward 15 to 20 real threads.
   - Gate: the dry-run replies are right on lab, person and company for at least 9 in 10, DKIM passes after routing, and spoofed test mail is dropped.
2. **Create.** Turn on matching and the create calls, `origin` and `flags` fields, AUDIT and bell notification. Admins only.
   - Gate: a week with no duplicate or wrong-lab records that needed manual cleanup.
3. **Flag UI and Lab Leaders.** "From email" chip, flag banner with Mark addressed, "Needs attention" board toggle, the "pick a lab" strip for held drafts, address on the Profile page, help guide. Open to Lab Leaders.
4. **Teach it more.** Each new job the Optimist can do from email is one more capability it can choose from, built on the same inbox, sender checks and reply. People keep forwarding to the same address with a note.

## Decisions

All six questions were settled on Nov 12.

| Question | Decision |
| --- | --- |
| Address | `theoptimist@optimisticlabs.com`, routed in Google Workspace to SES (see Architecture). |
| Auto-create or queue | Add to Pipeline automatically; flag anything the forwarder needs to address. |
| Who hears about it | The forwarder. Everyone else sees the deal under the portal's existing permissions. |
| Default source | Inbound, unless the note names another source. |
| Contributors | They have no Pipeline access in the portal today, so intake replies and stops. |
| How the Optimist knows what to do | One Optimist, one address. It reads the forwarder's note and the email and does whatever it has been set up to do; the forwarder gives enough context in the note. In v1 the only job is adding a lead to Pipeline. If an email asks for something it can't do yet, or it can't tell what's wanted, it replies saying so and changes nothing. |

Which job the Optimist learns next (expense receipts, scheduling, updating a deal from a client's reply) is a roadmap choice, not a design dependency: each one is added the same way, so nothing here has to change to make room for it.
