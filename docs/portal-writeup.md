# Optimistic Labs Portal: Product and Technical Write-up

**Scope.** This document describes the *live* portal: the Next.js app in `web/` (static export on AWS Amplify) and the serverless backend in `backend/` (AWS SAM: API Gateway, Lambda, DynamoDB, S3, SES). The top-level `frontend/` directory is a retired prototype and is not covered except in the dormant section.

**How to read it.** Each page has three parts: (1) what is on the page, (2) how it works for the end user, (3) how it works technically. Anything that has code but is not available to users (commented out, hidden, unreachable, unconfigured, or stubbed) is kept out of the page sections and collected in **Part 3: Not Live / Dormant**.

**Navigation reality.** The top nav shows only **Community** (also the landing page at `/`), **Pipeline** and **Resources**. Messages and Notifications are icons in the nav; Profile, Admin (Admin role only) and Sign out are in the avatar menu. Several routes (`/bench`, `/deal-flow`, `/files`, `/templates`, `/optimist`, `/invoices`, `/contracts`) have no nav link and are reached by URL or in-app links; they are documented as live because they work, with their reachability noted on each.

**Verification caveat.** Everything here was derived from reading the code. Facts that live only in the AWS, WorkOS, Amplify or DocuSign consoles (env vars, secrets, connected-account state) could not be checked and are marked as unverified or listed under Open Questions.

---

# Part 1: Platform and Architecture

## A. Architecture

### A1. Topology in one paragraph
Browser loads a Next.js static export (`web/`, hosted on AWS Amplify, custom domain `portal.optimisticlabs.com`) which authenticates against **WorkOS AuthKit**, then calls an **API Gateway HTTP API** (`PortalApi`) fronting one big Lambda router (`ol-portal-api`, `backend/src/app.mjs`) plus a Lambda authorizer. Data is one **DynamoDB** table (`ol-portal`), files are in one private **S3** bucket via presigned URLs, AI is the **Anthropic API** (key in SSM), mail is **SES**. The Optimist chat bypasses API Gateway through a streaming **Lambda Function URL**. One production stack (`ol-portal-backend`, us-east-1); there is no staging stack in the repo.

### A2. Frontend build and hosting
- `web/` = Next.js 16.3 / React 19 / Tailwind 4 / HeroUI+Radix, `output: "export"` (`web/next.config.ts:4`), images unoptimized. Fully static, no SSR, no Next server.
- `amplify.yml` (repo root): `cd web && npm ci && npm run build`; postBuild copies every `X.html` to `X/index.html` so `/pipeline` and `/pipeline/` both resolve (amplify.yml:11-17); artifacts from `web/out`.
- Deploys on push to `main` via Amplify's own git hook (stated in `.github/workflows/deploy-backend.yml:3-9`; the Amplify app config itself is not in the repo, UNVERIFIED). Default Amplify host `main.d2rvkunvze2ixv.amplifyapp.com` is in the API/S3/Function-URL CORS lists, so the Amplify branch is `main`.
- All config is `NEXT_PUBLIC_*`, inlined at build time (`web/lib/config.ts`): `API_URL`, `AWS_REGION`, `COGNITO_CLIENT_ID`, `COGNITO_USER_POOL_ID`, `OPTIMIST_URL`, `AUTH_PROVIDER`, `WORKOS_CLIENT_ID`, `WORKOS_API_HOSTNAME`. Amplify's actual values are not in the repo. `web/.env.example` still documents `NEXT_PUBLIC_AUTH_PROVIDER=cognito` as the default (line ~27) and ships a real-looking API URL and Cognito client id (public identifiers, not secrets).
- Only CI for the frontend is Amplify's build; **no lint/test step runs in CI for web or backend** (the only workflow is the backend deploy).

### A3. Backend: SAM stack `ol-portal-backend` (`backend/template.yaml`, 606 lines)
Globals: nodejs24.x, 10s timeout, 256MB. Every function sets `Architectures` explicitly; all arm64 except the PDF renderer (x86_64, Chromium has no ARM build, template.yaml:327-345). No `Conditions:` block exists, so "template conditions" do not gate auth; the provider switch is the `AuthProvider` parameter plus the hard-coded `DefaultAuthorizer` line (template.yaml:276).

| Function (FunctionName) | Handler | Trigger | Purpose / notable config |
|---|---|---|---|
| `ol-portal-api` (ApiFunction, tpl:418) | `app.handler` | HTTP API `/{proxy+}` GET/POST/PATCH/DELETE (WorkOS authorizer) plus 7 unauthenticated routes (below) | The entire REST API: deals, proposals, contracts/signing, contacts, files, resources/courses, community, messages, notifications, admin, QBO, DocuSign, help assistant. 28s timeout (HTTP API cap 29s), 256MB (default). Has IAM for DynamoDB, S3, Secrets Manager (WorkOs secret), SSM (3 params), Lambda invoke (PDF fn), Cognito admin APIs, SES send. |
| `ol-portal-authorizer` (tpl:222) | `authorizer.handler` | HTTP API Lambda authorizer on every authed route | Verifies WorkOS JWT (jose, JWKS at `api.workos.com/sso/jwks/<client id>`), writes once-per-session `SESSION` + `AUDIT` sign-in row, enforces the emailed-code gate (only `/auth/verify*` admitted until verified). 5s, no result caching (`ReauthorizeEvery: 0`, tpl:292) so it runs on every request. |
| `ol-portal-optimist` (tpl:375) | `optimist-stream.handler` | **Function URL**, `AuthType: NONE`, `RESPONSE_STREAM` | The Optimist chat (NDJSON stream). Verifies the token itself (WorkOS or Cognito per `AUTH_PROVIDER`), builds the same `ctx` via `identity.mjs`. 300s, 1024MB. CORS includes `localhost:3000`. |
| `ol-portal-contract-pdf` (tpl:327) | `pdf/index.handler` | HTTP API `POST /contracts/{id}/pdf`, `POST /proposals/{id}/pdf`; also direct Lambda invoke from the API fn on contract execution | Puppeteer-core + `@sparticuz/chromium` render to a FILE record in S3. 28s, 2048MB, x86_64, own `CodeUri: src/pdf/`. |
| `ol-portal-analyzer` (tpl:70) | `analyzer.handler` | S3 `ObjectCreated:*` on prefix `uploads/` only | Claude Haiku 4.5 classifies/summarizes uploaded files <=10MB and writes `analysis` onto the FILE record. 300s, 512MB. |
| `ol-portal-recurring` (tpl:301) | `recurring.handler` | EventBridge Schedule `cron(15 6 * * ? *)` daily | Generates monthly `RECUR` instances and opt-in invoice requests (Admin review) for recurring deals at Contracted/Closed. Only scheduled event in the stack. |
| `ol-portal-auth-events` (tpl:174) | `authevents.handler` | Cognito PostAuthentication trigger | Writes `auth.signin` audit rows. **Only fires on Cognito sign-ins, i.e. effectively dormant under WorkOS** (the authorizer writes the equivalent row instead). |

Unauthenticated HTTP API routes (`Authorizer: NONE`, all routed to `ol-portal-api`): `GET /qbo/callback`, `GET|POST /share/{proxy+}` (proposal share token), `GET|POST /sign/{proxy+}` (contract signing token), `GET /docusign/callback`, `POST /docusign/webhook` (HMAC-checked). Credentials are per-document tokens or provider signatures.

Other resources: `PortalApi` HttpApi (CORS origins: portal.optimisticlabs.com, the Amplify host, localhost:8761; headers `Authorization, Content-Type, X-Act-As`; **no `localhost:3000`**, so a local `next dev` cannot call the real API, which is why `backend/scripts/dev-api.mjs` exists). `AuthorizerInvokePermission` (tpl:~240). Cognito `UserPool`, `UserPoolClient`, groups Admin/LabLeader/Contributor (tpl:129-215) are retained but not the live auth path.
Outputs: `OptimistUrl`, `ApiUrl`, `UserPoolId`, `UserPoolClientId`, `TableName`. API Gateway id and redirect URIs for QBO/DocuSign are hard-coded in the template env (tpl:~436-446) because `!Sub` would be circular.

### A4. DynamoDB (`PortalTable`, tpl:106)
- Table `ol-portal`, on-demand, PITR on, `DeletionPolicy: Retain`, TTL attribute `ttl`.
- Key schema: **pk (S) HASH, sk (S) RANGE. No GSIs, no LSIs.** `util.mjs:55-` and `messages.mjs:41` / `util.mjs byToken` say so explicitly.
- Access pattern: single-table, **pk = entity type** for global entities (`DEAL`, `PERSON`, `CONTRACT`...) with sk = id (`D-001`, `C-001`, email...). "List" = `Query pk=:p` paginated over the whole partition (`util.mjs listType`), then filtered in Lambda by role/lab. Lookups by token (`byToken`) or by field are full-partition reads. `nextId` = max(existing)+1 over the partition (race-prone under concurrency, small-team assumption). Per-person partitions: `NOTIF#<key>`, `PROGRESS#<key>`, `CONV#<key>` (Optimist history), `MSG#<convo id>`.
- TTL'd types: `AUDIT` (90d, `util.mjs AUDIT_TTL_DAYS`), `SESSION` and `MFA` (90d), `EVENT` (30d, app.mjs `EVENT_TTL_DAYS`), `WEBHOOK_EVENT` (20d), notifications (`NOTIF_TTL_DAYS`), Optimist conversations (180d, `optimist.mjs CONV_TTL_DAYS`).

### A5. S3
One bucket, `ol-portal-files-${AccountId}` (`FilesBucket`, tpl:51): private, all public access blocked, CORS PUT/GET from the three origins (no :3000). Prefixes: `uploads/<FILE id>/<name>` (Files page + deal documents; triggers analyzer), `resources/...` (Resource Library files and post images; deliberately excluded from analyzer trigger, tpl:~86). All access is presigned URL (PUT 15 min, GET 5 min), 50MB cap enforced in `app.mjs createFile`. No other buckets; Amplify's artifact bucket is outside the repo.

### A6. Auth: which is live (verified)
**WorkOS AuthKit is live; Cognito is retained but vestigial.** Evidence:
1. `.github/workflows/deploy-backend.yml:77-85` passes `AuthProvider=workos WorkosClientId=client_01M10FCEF9TX4N3XTVRZYJV1NR WorkosSecretId=WorkOs WorkosTokenIssuer=https://auth.optimisticlabs.com/user_management/<client id>` on every push to main. `backend/samconfig.toml:19` pins the same ("a bare `sam deploy` cannot silently reset these ... AuthProvider falling back to cognito would take sign-in down").
2. `template.yaml:276` `DefaultAuthorizer: WorkosLambda` (the "cutover line"); `CognitoJwt` authorizer (tpl:278) is defined but unreferenced. Template parameter *default* is still `cognito` (tpl:6), which only matters for an unparameterised deploy.
3. samconfig comments document a Staging->Production WorkOS cutover and the custom Authentication API domain `auth.optimisticlabs.com` (`NEXT_PUBLIC_WORKOS_API_HOSTNAME`, "since #27"); portal code mentions the 9/3/26 cutover and a 9/3 outage (authz.mjs:22-31) and 9/15 issuer fix.
4. Frontend side is a **build-time** switch (`web/lib/config.ts`, `web/lib/auth.tsx:17-19`); the Amplify env value itself is UNVERIFIED, but the backend pinning and the frontend "verify" flow (`web/app/verify/page.tsx:21`, `web/lib/verify.ts:49`) only make sense with `workos`. Stale text: `web/lib/auth.tsx:10-12` and `web/lib/config.ts` comments still say "Cognito is still the default ... exercised against staging".

Identity model (backend `identity.mjs`):
- WorkOS path: authorizer returns a flat context `{email, role, sid, sub, verified}`; email comes from a WorkOS JWT-template claim `urn:olportal:email`. **PERSON sk = lowercased email** post-cutover; seven pre-cutover people keep first-name keys and are matched via an `email` attribute fallback (identity.mjs:133-159, backfilled by `link-person-emails.mjs`). The PERSON record's `role` is the source of truth; the token's `role` is only a fallback (identity.mjs:186). `active === false` blocks (offboarded) (identity.mjs:173).
- Emailed second factor (portal-owned, not WorkOS MFA): every WorkOS session must enter a 6-digit-style code emailed via SES before the authorizer admits it to anything except `/auth/verify*` (authz.mjs:88-129, verify.mjs). Rows `MFA/<sid>` store only a hash; 10 min TTL, 30s resend, 5 attempts max. Frontend gate: `useSessionVerified` in `web/app/(portal)/layout.tsx`.
- Cognito path (dormant): JWT authorizer, pool groups map to roles, TOTP optional (`MfaConfiguration: OPTIONAL`, tpl:160), invite flow via `AdminCreateUser`. `directory.mjs:251` picks `workos` vs `cognito` directory implementation by `AUTH_PROVIDER`. Frontend: `auth-cognito.tsx` (211 lines), `lib/amplify.ts`, the password/TOTP/forgot steps of `app/login/page.tsx`, `lib/password.ts` and the `aws-amplify` / `qrcode.react` dependencies are only used on the Cognito path.

### A7. Secrets and config (names only)
| Secret / config | Store | Used by |
|---|---|---|
| `/ol-portal/anthropic-api-key` | SSM SecureString | api, optimist, analyzer |
| `/ol-portal/qbo-credentials` (`{clientId, clientSecret}`) | SSM SecureString | api (`qbo.mjs`) |
| `/ol-portal/docusign-credentials` | SSM SecureString | api (`docusign.mjs`, JWT grant) |
| `WorkOs` (JSON key `WorkOS`; ids overridable via `WORKOS_SECRET_ID`/`WORKOS_SECRET_KEY`) | Secrets Manager | api (`workos.mjs`: invites, user directory) |
| `AWS_DEPLOY_ROLE_ARN` | GitHub repo secret | OIDC role assumed by deploy workflow (no long-lived AWS keys) |
| QBO OAuth tokens (`QBO/TOKENS`), DocuSign connection (`DOCUSIGN/CONFIG`) | DynamoDB rows | runtime state, not config |
Non-secret ids committed in repo: WorkOS client ids (staging and production), Cognito client id, API Gateway id, Amplify host. `backend/scripts/roster.json` is committed (2 Admin entries with real-looking emails; not printed here) - PII-in-repo flag.

### A8. Email (SES)
`backend/src/email.mjs`: SESv2 `SendEmail`. Domain identity `optimisticlabs.com`. Two senders: `sendClientEmail` (from the person's own `@optimisticlabs.com` address, else `hello@optimisticlabs.com` with Reply-To) and `sendSystemEmail` (`no-reply@optimisticlabs.com`). Callers: the sign-in code (verify.mjs), assignment approval notices (assignments.mjs), message notices (messages.mjs), contract send/countersign/executed mails (signing.mjs, execution.mjs, docusign-webhook.mjs) and proposal share email (proposals.mjs, no UI caller, see D). IAM: `ses:SendEmail/SendRawEmail` on `identity/*` (tpl:~486). Account-level SES sandbox/production status UNVERIFIED. In-app notifications are DB-only (no email). WorkOS sends its own invitation emails (`workos.sendInvitation`), and Cognito sent its own under the old path. Bell notifications: `notifications.mjs`.

### A9. CI/CD
- `.github/workflows/deploy-backend.yml` (only workflow): on push to `main` touching `backend/**` or the workflow, or manual dispatch -> OIDC assume `AWS_DEPLOY_ROLE_ARN` -> `sam build` (no container; arm64 functions built on x86 runner, Node 24) -> `sam deploy` to stack `ol-portal-backend`, us-east-1, `--resolve-s3`, `CAPABILITY_IAM`, `--no-fail-on-empty-changeset`, with a throwaway `ci-samconfig.toml` to dodge the local `profile`. No tests, no lint, no approval gate, no environment separation. PRs #37-#42 are the history of getting this to work.
- Frontend: Amplify only (see A2). Backend and frontend therefore deploy independently on the same push; the workflow header documents that skew as a past cause of contradictory stage-gate errors.
- Environments: effectively **one (production)**. WorkOS has Staging+Production environments; the AWS stack is single. Local dev = `backend/scripts/dev-api.mjs` + `web` `npm run dev` + `/dev/*` harness pages.

### A10. Third-party integrations: live / not-live
| Integration | Wiring | Status |
|---|---|---|
| **WorkOS AuthKit** (auth, invites, directory) | authorizer, `authz.mjs`, `workos.mjs`, `directory.mjs`, `web/lib/auth-workos.tsx`; deploy params pinned to Production client | **LIVE** (Production env, custom auth domain) |
| **Anthropic API** (not Bedrock; no Bedrock reference anywhere in repo) | Optimist `claude-sonnet-5` (`optimist.mjs:48`, adaptive thinking, effort medium, 6 tool rounds, prompt caching), Help widget `claude-sonnet-5` (`guides.mjs:88`), file analyzer `claude-haiku-4-5` (`analyzer.mjs:96`) | **LIVE** (needs SSM key; key presence UNVERIFIED) |
| **SES** | email.mjs | **LIVE** (code path required for sign-in); sandbox status UNVERIFIED |
| **DocuSign** | `docusign.mjs`, `docusign-webhook.mjs`, `/docusign/*` routes, connect card on Contracts page, embedded signing in `web/app/contract-sign` | **WIRED but pointed at demo**: `DOCUSIGN_ENV: demo` (tpl:444), redirect/webhook URLs hard-coded. Becomes the default signing method *only if* an Admin has connected it (`signing.mjs:159-178`, else native e-sign). Whether it is connected is DB state, UNVERIFIED. Treat as not in production use unless Liz confirms. |
| **QuickBooks Online** | `qbo.mjs`, `/qbo/*` routes, QboCard on `/invoices` (Admin) | **WIRED but sandbox**: `QBO_ENV: sandbox` (tpl:434). Read-only (lists invoices); no write-back (page footer admits "auto-drafting ... is the natural next step", `invoices/page.tsx:634`). Connection state UNVERIFIED. |
| **HubSpot** | only `backend/scripts/import-hubspot-companies.mjs` (one-time CSV import to COMPANY; stores `hubspotId/Owner/Type`) | **Not an integration**; offline script, no API/webhook |
| **Analytics (PostHog etc.)** | none. `web/lib/analytics.ts` is a first-party `POST /events` logger | **No vendor. And the logger is never called** (no importer). See D. No Sentry/Datadog/etc. either |
| **Cognito** | template resources + auth-cognito | Retained, vestigial (A6) |
| **GitHub OIDC -> AWS** | deploy workflow | LIVE |
| Pwned-passwords check | `web/lib/password.ts` (login page, Cognito flow) | Dormant under WorkOS |

---

## B. Role / permission model

Source of truth: `backend/src/identity.mjs` (`perms()` at line 65, `buildContext()` at 161). `web/lib/can.ts` is a UI-affordance mirror only; its header comment still says it mirrors `app.mjs perms()` (can.ts:3-4) - that function now lives in `identity.mjs`. can.ts omits `leadsDeal` and `seesEveryClientRecord`. Roles: **Admin, Lab Leader, Contributor** (WorkOS slugs `admin`, `lab-leader`, `contributor`; `member` deliberately unmapped = fails closed). A Lab Leader has `labs[]` on the PERSON record.

| Capability | Admin | Lab Leader | Contributor |
|---|---|---|---|
| See deals / invoices / recurrences | all | own labs + deals where they are `owner` (deal "originator") ; invoices they requested | none (empty list) |
| Add deal | yes | if they have >=1 lab (owner forced to self; lab must be theirs) | no |
| Edit deal | yes | own-lab deals or ones they own | no |
| Delete deal / change lab | yes | no | no |
| Review invoices (status), QBO connect/status/invoices | yes | no (can request invoices on editable deals) | no |
| Proposals (API) | all; approve statuses | own-lab / own; limited statuses | read those they're named on |
| Contracts | all; countersign for OL is Admin-only (`signing.mjs:412`) | own-lab or owned; create/send | see only contracts naming their email |
| Companies / contacts (billing entities) | all | create/edit; visibility derived from deals they can see (`contacts.mjs labScope`) | none |
| Files | all | own labs + own uploads | own uploads + contract PDFs tagged to their email |
| Delete file | any | own uploads | own uploads |
| Templates, Knowledge Base, DocuSign connect, recurrences/run | Admin only | templates: read lab-scoped via proposals/contract dialogs; no KB | no |
| Resources / Courses | create/edit/delete, see drafts; per-resource `permission` (all/lab_leaders/contributors) | read where permitted | read where permitted |
| Community posts / messages / notifications / profile | all; can edit any post, any profile | own; labs-scoped posts | own |
| Admin console, invites, offboard/restore, MFA reset, audit | yes | invite **Contributors only**, only for own labs and only if a *signed contract in their lab names that email* (`admin.mjs:92-99`) | no |
| Act as another user | yes (not another Admin, not offboarded) | no | no |
| The Optimist | all data | scoped | tools return nothing for pipeline/agreements (UI shows an "available to staff" message) |

**Act-as**: Admin sends header `X-Act-As: <person key>` (`web/lib/api.ts:61`, also on the Optimist stream); `buildContext` swaps `me/role/can` to the target while keeping `realMe/realRole`; admin-only routes therefore lock out for the duration; start/stop routes check `realRole`; every mutating request while acting is audited as `admin.act-as-mutation` (`app.mjs` handler tail). Frontend sets it then hard-reloads (`web/lib/act-as.ts`), `ActAsBanner` shows state.

Server enforces everything; the client never supplies identity.

---

## C. Data model (overview)

Single table, entity = `pk`:
- **PERSON** (sk = email or legacy first name): firstName/lastName, role, labs[], email, active, profile/bench fields, photo. **LAB** (sk = lab key): name etc. (seeded; no create route).
- **COMPANY** and **CONTACT** (billing entities, Pipeline v2): contact belongs to company; neither has a lab.
- **DEAL** (D-nnn): lab, owner (originator), dealOwner, stage (Lead, Discovery, Proposal Sent, Negotiating, Contracted, Closed [=paid], Closed Lost), amount, recurring flags, `companyId`/`contactId`, `contractSigned`, embedded `assignment` (fee-share filing + approval; `assignments.mjs`). Stage gates (billing entity, uploaded proposal, signed/uploaded contract, uploaded invoice) enforced in `app.mjs updateDeal`.
- **FILE** (F-nnn): deal?, lab?, kind (proposal/contract/invoice), version, uploader, S3 key, analysis. **INVOICE** (INV-R-nnn): deal. **RECUR** (R-deal-YYYY-MM): generated by cron.
- **PROPOSAL** (deal; sections, versions, shareToken, sentAt, decision) and **CONTRACT** (`docKind` client | msa | task-order; deal?, proposal?, `parentId` for task orders, signToken, signatures.client/OL, envelopeId, signMethod native|docusign). **TEMPLATE** (contract/msa/task-order clause bodies with `{{placeholders}}`). **ENVELOPE** (DocuSign envelope pointer), **DOCUSIGN/CONFIG**, **QBO/TOKENS + STATE#**, **WEBHOOK_EVENT** (dedupe).
- Learning/community: **RESOURCE**, **COURSE**, **PROGRESS#<person>**, **POST** (with likes/comments), **KB** (admin-only knowledge entries), **GUIDE** (help-widget docs, seeded by script).
- Comms: **CONVO** + **MSG#<id>** (direct/group messages), **NOTIF#<person>**, **CONV#<person>** (Optimist transcripts).
- Security/ops: **AUDIT**, **SESSION**, **MFA**, **EVENT**.
Relationships: Lab 1-N Person (via labs[]) and Lab 1-N Deal; Deal N-1 Company/Contact; Deal 1-N Proposal/Contract/File/Invoice/Recur; Contract(task-order) N-1 Contract(msa); Person 1-N Notification/Progress/Conversation. No foreign-key enforcement; references are string keys checked in handlers.

---

## D. Ops scripts (`backend/scripts/`)
| Script | What it does |
|---|---|
| `dev-api.mjs` | Local stand-in API (port 8788): runs the real `app.mjs` handler against an in-process DynamoDB emulator persisted to a JSON file, injects identity via `POST /__dev/as/<key>`; used by the `/dev/*` web harnesses. |
| `seed.mjs` | One-time: loads sample data from `frontend/assets/data.js` into the table (`--dry-run`). Legacy. |
| `seed-roster.mjs` | Replaces PERSON records with the real roster from `roster.json` (email-keyed); dry-run default, `--confirm` writes. |
| `roster.example.json` / `roster.json` | Roster input (example vs the real committed one). |
| `seed-guides.mjs` | Upserts the in-app help widget content (GUIDE records) into DynamoDB; `--dry-run`. Help content lives in this script, not in the web app. |
| `link-person-emails.mjs` | One-time backfill: adds `email` to pre-WorkOS PERSON records (from Cognito) so identity.mjs can link accounts without re-keying. |
| `repoint-person-refs.mjs` | Rewrites person references (deal owner, file uploader, post author...) after a PERSON key changed; `--map old=new --confirm`; leaves AUDIT alone. |
| `migrate-users.mjs` | Older one-time Cognito username=email migration (delete+recreate users; forces reset + MFA re-enrol). Superseded by the WorkOS move; npm script `migrate-users` still exists. |
| `import-hubspot-companies.mjs` | Loads a HubSpot Companies CSV export into COMPANY records (dedupe by hubspotId/name; placeholder "Main line" contact for phones). |
| `report-orphan-client-contracts.mjs` | Read-only report of client CONTRACTs with no `deal`. |
| `workos-status.mjs` | Checks the WorkOS API key (from Secrets Manager) and reports environment, users, orgs. |
Most require `AWS_PROFILE=ol-portal` (OL's own AWS account). None are run by CI. Tests: `backend/tests/*.test.mjs` (14 files, `npm test`) and `web/tests` (2 files) are manual; CI does not run them.

---


---
# Part 2: Pages and Features

## 01 - Auth, Shell and Messaging

Scope: `/login`, `/callback`, `/welcome`, `/verify`, the `(portal)` layout gate, the shell (top-nav, portal-shell, notification bell, help widget, act-as banner), `/notifications`, the Messages drawer, `/profile`, plus the backend modules behind them.

Paths are relative to `/home/user/ol-portal`. `web/` is the live frontend and `backend/` the live backend. The top-level `frontend/` directory is a legacy prototype and was not read.

Live auth stack: WorkOS AuthKit. `.github/workflows/deploy-backend.yml:87` deploys with `AuthProvider=workos`, and `backend/template.yaml:276` sets `DefaultAuthorizer: WorkosLambda`. See open question 1 about the frontend build flag.

---

### 0. Architecture in one page

| Layer | Piece | Role |
|---|---|---|
| Browser | `@workos-inc/authkit-react` (`web/lib/auth-workos.tsx`) | Hosted sign-in on WorkOS's domain. The browser holds an access token (JWT) and refreshes it. |
| Browser | `web/lib/api.ts` | Every call adds `Authorization: Bearer <access token>` and, while impersonating, `x-act-as: <person key>`. |
| API Gateway | HTTP API `PortalApi` with Lambda authorizer `WorkosLambda` (`template.yaml:276-290`) | Runs in front of every route except those marked `Authorizer: NONE` (QBO/DocuSign callbacks, `/share`, `/sign`, DocuSign webhook). Not cached. |
| Lambda | `backend/src/authorizer.mjs` | Verifies the token, requires the emailed code, passes `{email, role, sid, sub, verified}` as context. |
| Lambda | `backend/src/app.mjs` | Router. Calls `identity.mjs` `buildContext` to resolve the PERSON record, role and permissions, then dispatches. |
| DynamoDB | single table (`TABLE_NAME`), keys `pk`/`sk`, `ttl` attribute | All entities below. No GSIs. |
| Outside AWS | WorkOS AuthKit and Management API, SES, Secrets Manager (`WorkOs` secret), Anthropic API (help widget) | |

The rest of `/auth/verify` (route list, DynamoDB entity `MFA`) is in section 4.

---

### 1. Sign-in flow: `/login`, `/callback`, hosted AuthKit

#### 1.1 `/login` (`web/app/login/page.tsx`)

**On the page (live):** a violet screen with the OL mark, "The Portal", and the text "Taking you to sign in…". There is no form. Under WorkOS the page is only a staging post.

**End user, step by step**
1. A signed-out visitor hits any portal URL. The `(portal)` layout redirects them to `/login?returnTo=<path+query>` (`web/lib/return-to.ts` `loginPath`).
2. `/login` waits for auth status `signedOut`, then calls `hostedSignIn(returnTo)` once (guarded by a ref so it never starts two authorizations). That calls AuthKit `signIn({state:{returnTo}})`, which navigates the browser to the WorkOS hosted page. Email, password, invitation acceptance, and password reset all happen there, not in the portal.
3. If the user is already `signedIn`, the page does `router.replace(returnTo)`.

**Technical**
- `returnTo` is attacker-controllable (URL and OAuth `state`). `safeReturnTo` accepts only a path on the same origin. It rejects absolute URLs, `//host` and `javascript:`, and maps `/login` and `/callback` to `/`.
- `useAuth()` comes from `web/lib/auth.tsx`, which picks `WorkosAuthProvider` or `CognitoAuthProvider` from `CONFIG.authProvider`. That is a build-time `NEXT_PUBLIC_AUTH_PROVIDER` switch (`web/lib/config.ts`).
- WorkOS provider details (`web/lib/auth-workos.tsx`):
  - `redirectUri = <origin>/callback`.
  - `apiHostname = NEXT_PUBLIC_WORKOS_API_HOSTNAME` (production: `auth.optimisticlabs.com`). This is a same-site custom domain, so the refresh cookie survives Safari ITP and third-party-cookie blocking.
  - On load it probes `getAccessToken()` once to recover a session from the refresh cookie. Status stays `loading` until the probe answers, so nothing redirects early.
  - `registerTokenSource` (`web/lib/session.ts`) hands `api.ts` a token getter and an `endSession`. `getToken` returns a token, returns `null` when the session is gone (a re-auth is already navigating), or throws on transient failure (429, 5xx, network). A transient failure never signs the user out.
  - `onRefreshFailure` and `LoginRequiredError` both call a single `reauthenticate()`. It is guarded by `reauthInFlight` and carries the current page as `state.returnTo`.
  - `username` is `user.email.toLowerCase()`. This is the PERSON key everywhere.
  - Sign out calls AuthKit `signOut({returnTo: origin})`. The origin must be registered as a Sign-out URI in WorkOS.
- A 401 from the API makes `api()` call `endSession()` and throw `ApiError("Unauthorized",401)`.
- An optional auth trace is written to the console when `localStorage["olportal.authTrace"]==="1"`.

#### 1.2 `/callback` (`web/app/callback/page.tsx`)

**On the page:** "Signing you in…". If the WorkOS redirect carried `error` or `error_description`, the page shows that text with a "Back to sign in" button. After 10 seconds without completion it shows "That sign-in couldn't be completed. It may have been started in a different browser tab, or taken too long. Try signing in again."

**End user:** WorkOS sends the browser here with `?code=&state=`. Nothing needs doing. After a successful exchange the user lands on the page they originally wanted.

**Technical**
- The code-for-session exchange is done by the `AuthKitProvider` mounted in the root layout. authkit-js only exchanges when `pathname == /callback`.
- `onRedirectCallback` reads `state.returnTo`, runs it through `safeReturnTo`, and calls `router.replace(to)` inside `setTimeout(0)`. The delay is needed because authkit-js strips `?code` with `history.replaceState`, which Next treats as a competing navigation.
- The page itself never routes on success. An earlier version did, and it caused a bug where everyone landed on `/`.
- Without a `code` it redirects to `/login`. If the build is not WorkOS it redirects to `/login`.
- A missing PKCE verifier (sign-in finished in a different tab) is the usual cause of the "stuck" message.

---

### 2. The `(portal)` layout gate (`web/app/(portal)/layout.tsx`)

**What it does:** every portal route (everything under `app/(portal)/`) renders inside this layout. The gate runs in this order.
1. Auth status is `loading`: show "Loading…".
2. `signedOut`: `router.replace(/login?returnTo=…)`.
3. `signedIn`: `useSessionVerified(status)` (`web/lib/verify.ts`) calls `GET /auth/verify`.
   - `verified:false` makes the layout `router.replace(/verify?returnTo=…)`.
   - A 404 from that endpoint counts as "ok". This is the window where the frontend has shipped but the backend has not.
   - Any other error maps to `needed`, so the user lands on the verify page with a retry instead of a broken shell.
4. Only when verified does it mount `PortalDataProvider > NotificationsProvider > MessagesProvider > PortalShell`. No data request is made before then.

**Technical**
- `sessionVerified()` returns true immediately when the build is not WorkOS. It caches a positive answer in module memory for the page load only.
- `PortalDataProvider` (`web/lib/portal-data.tsx`) boots the portal with 10 calls, 3 at a time (`BOOT_BATCH=3`) because the AWS account's Lambda concurrency quota is 10:
  - `GET /bootstrap`, `/deals`, `/proposals`, `/invoices`, `/files`, `/contracts`, `/recurrences`, `/guides`
  - `/companies` and `/contacts`, which fall back to `[]` on error
  - Any other failure sets `error` and `errorStatus`.
  - If an act-as target is set and the load fails, it clears the target and retries once.
- Role gating is not done in the layout. Each page and the API enforce their own roles. The layout enforces only signed-in plus code-verified.

---

### 3. The shell

#### 3.1 `PortalShell` (`web/components/shell/portal-shell.tsx`)

**On screen:** a column of act-as banner, sticky top nav, a 1420px content area, the help widget (bottom-right), and the Messages drawer.

**End user**
- While data loads: "Loading…".
- If bootstrap fails, a full-screen error card. HTTP 403 shows "Your account cannot open the portal ... no profile record for this address. An Admin can link or create one under Admin & invites", with only a Sign out button.
  - 403 comes from `buildContext` when there is no PERSON record, an ambiguous email match, a deactivated account, or no portal role.
  - Other errors show "Try again" and "Sign out", plus a collapsible "Technical details".
- First-run redirect: when data has loaded and `needsWelcome()` is true, it redirects to `/welcome` (section 5).

#### 3.2 Top nav (`web/components/shell/top-nav.tsx`)

- **Left:** OL logo linking to `/`.
- **Pills:** Community (`/`, also active on `/community`), Pipeline (`/pipeline`), Resources (`/resources`). The `roles?` field exists on nav items but no item uses it, so all three show for every role.
- **Right, 3 controls**
  - **Messages icon.** Calls `openList()` to open the Messages drawer (section 8). The violet dot on it is hard-coded decoration (`top-nav.tsx:174-178`) and is not driven by unread data.
  - **Notification bell** (`NotificationButton`).
  - **Avatar menu.** It shows the photo or initials, and the full name on `lg` screens. The menu contains a header (name and role), "Your profile" (`/profile`), "Admin" (`/admin`, only when `role==="Admin"`; it disappears while an Admin is acting as a non-Admin), and "Sign out".
- Every other page is reachable only by URL or in-app links. The API and each page enforce their own roles.

#### 3.3 Notification bell (`web/components/shell/notification-button.tsx`)

- **Badge:** unread count, shown as "9+" above 9, with an accessible label ("Notifications, N unread").
- **Popover (380px):** header "Notifications" with a "Mark all read" link while anything is unread.
  - It shows the newest 5 rows (compact `NotificationRow`), or "Loading…", an error, or "Nothing yet. You are all caught up."
  - Footer: "See all notifications →" goes to `/notifications`.
- **Clicking a row:** closes the popover, calls `markOneRead(id)`, and does `router.push(n.href)`. Message links look like `/community#messages/<convoId>`. The Messages panel's hash listener, which also reacts to pathname changes, opens that thread. Whether a push to the same pathname with only a new hash opens the thread is unverified. The `/notifications` page handles `#messages` links itself.
- Data comes from `NotificationsProvider` (section 7).

#### 3.4 Help widget (`web/components/shell/help-widget.tsx`)

- **What:** a round "?" button fixed bottom-right on every portal page. It opens a right-side Sheet titled "Portal Help" holding a chat with a welcome bubble, a "Thinking…" indicator and an input "How do I…?".
- **Header line:** "You're on the {guide title} page..." when the current first path segment matches a loaded GUIDE record.
  - The key is the first path segment, or `"dashboard"` for `/`. The seeded keys follow `backend/scripts/seed-guides.mjs`. Whether a `dashboard` guide still exists for the Community landing page was not verified.
- **User flow:**
  1. Open the sheet.
  2. Type a question and press Enter.
  3. The widget POSTs the whole transcript (without the welcome bubble) to `/help/assist`.
  4. The reply is appended.
  5. Chat history lives in component state only and is lost on reload.
- **Backend:** `POST /help/assist` goes to `guides.helpAssist` (`backend/src/guides.mjs:60`).
  - It keeps the last 20 turns and truncates each to 2000 characters. It requires at least one user turn.
  - It loads all `GUIDE` records (pk `GUIDE`, sk page key), filtered by role (`roles` allowlist on the record and on each section).
  - It calls the Anthropic Messages API (model `claude-sonnet-5`, 1000 max tokens, JSON-schema output `{reply}`, prompt-cached system prompt). The system prompt restricts answers to the guide text for the caller's role.
  - A refusal or empty reply returns 502. A Claude client is created via `client()` in `optimist.mjs`.
- `GET /guides` (`guides.listGuides`) is used by portal-data for the header line.

#### 3.5 Act-as banner and act-as admin impersonation

**Who/where:** Admins only. Entry points are the Admin page user table (`web/app/(portal)/admin/page.tsx:394`) and the person-card menu on Community's Members tab (`web/components/community/members.tsx:48`). Both call `startActingAs()` in `web/lib/act-as.ts`.

**End user flow (Admin)**
1. Click "act as" on a person.
2. A browser `confirm()` says: "View and act as X? You'll see exactly what they see and can make changes as them until you exit - every action is logged."
3. After confirming, `POST /admin/act-as {target}`, then `setActingAs(target)` (stored in `sessionStorage["olportal.actingAs"]`, so it does not survive closing the browser). Then a hard `window.location.href="/"` so all providers re-bootstrap as the target.
4. A red banner shows across the top: "{Admin name} is viewing the portal as {Person}." with "Stop acting as".
5. All data and permissions are now the target's. Admin-only items vanish, for example the avatar-menu "Admin" entry and any admin routes.
6. "Stop acting as" calls `POST /admin/act-as/stop`, clears the sessionStorage key, refreshes portal data, and goes to `/admin`.

**Technical**
- `api()` adds `x-act-as: <target>` to every request unless `skipActAs` is set. The verify calls always skip it.
- If any request fails while a target is set, `api()` clears the target and retries once without it. Portal-data does the same on a bootstrap failure.
- Backend, `app.mjs` handler: reads `x-act-as` and passes it as `actAsTarget` to `buildContext` (`identity.mjs`).
  - The real caller (resolved from the JWT) must have role Admin: "Only Admins can act as another user".
  - The target must exist (404), must not be an Admin ("Can't act as another Admin"), and must not be offboarded.
  - The resulting `ctx.me` and `ctx.role` and `ctx.can` are the target's, and `ctx.realMe` and `ctx.realRole` stay the Admin's. Every route's permission checks therefore run as the target.
  - `bootstrap` returns `actingAs:{by,byName}`, which drives the banner.
- `POST /admin/act-as` (`admin.startActingAs`) validates with `ctx.realRole`, rejects acting as yourself, and writes the audit row `admin.act-as-start`. It returns `{username,name,role}`.
- `POST /admin/act-as/stop` writes `admin.act-as-stop`.
- Every successful mutating request made while acting as someone (POST, PATCH, PUT or DELETE, status < 300, except the two act-as routes) writes an `AUDIT` row `admin.act-as-mutation` with `METHOD path (as target)`, actor = the real Admin (`app.mjs:688-691`).
- Reads while acting as someone are not individually audited.
- CORS allows the `X-Act-As` header (`template.yaml:268`).
- While acting as a user, notifications and messages are read as that user (`notifications.mjs:216-223`). "Mark read" while acting writes that user's state.
- Edge: after "Stop acting as", the notifications and messages providers are not remounted. They show the target's data until their next poll (up to 60s and 45s respectively) or a focus event.

---

### 4. `/verify`: emailed sign-in code (second factor)

**Why:** AuthKit's only factor is TOTP, but the portal's rule (dated 9/8/26 in the code comments) is that every sign-in is confirmed by a 6-digit code emailed to the account. The portal runs this step itself.

#### 4.1 On the page (`web/app/verify/page.tsx` + `web/components/verify-card.tsx`)
- Card titled "Check your email".
  - Text: "We sent a 6-digit code to {email}. Enter it to finish signing in."
  - A large centred 6-digit numeric input (digits only, max 6, `autocomplete=one-time-code`) and a "Continue" button, disabled until 6 digits are entered.
  - A "Send a new code" link with a 30-second countdown (`Send a new code (Ns)`).
  - A "Not you? Sign out" link.
- Inline errors and a "A new code is on its way." notice.

#### 4.2 End user, step by step
1. After hosted sign-in, the layout (or `/welcome`) sees `verified:false` and redirects to `/verify?returnTo=…`.
2. On mount the card calls `GET /auth/verify`.
   - If `verified` is true it marks the page verified and goes on.
   - If no code was sent, or the last one expired, it calls `POST /auth/verify/send` to email a code.
3. The user types the code from the email "123456 is your portal sign-in code" (from `Optimistic Labs Portal <no-reply@optimisticlabs.com>`).
4. `POST /auth/verify {code}`. On success the page `router.replace(returnTo)`. The `returnTo` is sanitized, and `/verify` itself is never a valid return target.
5. Wrong code: "That code isn't right. N tries left." and the field clears.
   - 5 wrong attempts: "Too many wrong codes. Send a new one."
   - Expired after 10 minutes: "That code has expired. Send a new one."
   - Resend before 30s: 429 "A code was sent a moment ago. Give it a minute...".
   - Email send failure: 502 "We couldn't email a code to {email}. Ask an admin to check the address on your account." The row is deleted so a retry works. A likely cause is the SES sandbox refusing an unverified address.
6. Role differences: none. Every role, including Admins, must enter a code on every new sign-in.
7. The verify page redirects to `/` if the build is not WorkOS, and to `/login` when signed out.

#### 4.3 Technical
- API routes. All three are authorized by the authorizer but run before the portal context exists (`app.mjs:656-672`).
  - They use only `{email, sid}` from the authorizer context. If either is missing the answer is 400 "This sign-in has no session to confirm".
  - Routes:
    - `GET /auth/verify` returns `{email, verified, sentAt, expiresAt}`.
    - `POST /auth/verify/send`.
    - `POST /auth/verify` with body `{code}`.
- Handler: `backend/src/verify.mjs`.
  - **DynamoDB:** `pk="MFA"`, `sk=<WorkOS session id (sid from the token)>`.
    - Fields: `actor` (email), `codeHash` (`sha256(sid:code)`, dropped on success), `sentAt`, `expiresAt` (+10 min), `attempts`, `verified`, `verifiedAt`, `ttl`.
    - TTL is 90 days (`AUDIT_TTL_DAYS`).
  - **Send claim:** conditional Put, `attribute_not_exists(pk) OR sentAt < :cutoff` with a 30s cutoff. This guarantees a single code on double-clicks.
  - **Code:** `randomInt(0,1_000_000)` zero-padded to 6 digits. It is sent through SES (`email.mjs` `sendSystemEmail`, from `no-reply@optimisticlabs.com`).
  - **Check:** digits are extracted, so spaces are tolerated. The hash comparison uses `timingSafeEqual`. A wrong guess increments `attempts` with a conditional write. Success writes `verified:true` and an audit entry `auth.verify "sign-in confirmed by emailed code"`.
- Enforcement: `authorizer.mjs:116-131`.
  - After the token is verified it calls `sessionVerified(sid)` (`authz.mjs`). If the session is unverified and the path is not `/auth/verify[/...]`, it returns `{isAuthorized:false}`. This is a deny at the authorizer, so any future route is automatically covered. API Gateway turns that into a 403.
  - The frontend asks `GET /auth/verify` first so a normal user never sees the bare 403.
  - Verified sids are cached per container. Negative answers are always re-read from DynamoDB.
  - A token refresh keeps its `sid`, so the session stays verified. A new sign-in means a new `sid` and a new code.
  - The Optimist's Function URL (`optimist-stream.mjs`) uses the same `authz.mjs` helpers because it has no authorizer. This is outside my scope but is a consumer.
- Tests (`backend/tests/verify.test.mjs`): gating, hash only, 5 attempts, resend throttle, expiry, per-session isolation, SES failure drops the claim, issuer list.

---

### 5. `/welcome` (first-run profile setup) (`web/app/welcome/page.tsx`)

**On the page:** a card "Welcome to the Portal - Add a few details so the rest of the team can find you in the Bench Directory. You can always edit this later." Fields: photo upload, "Engage me for..." (textarea), "Specialties (comma-separated)". Buttons: "Save & continue" and "Skip for now".

**End user flow**
1. The page is not in the nav. The portal shell redirects there when `!people[me].onboarded` and `localStorage["olportal.welcomeSkipped"] !== "1"`.
2. The same signed-in plus verified gate as the layout applies. It has its own `PortalDataProvider`. It redirects to `/login?returnTo=/welcome` or `/verify?returnTo=/welcome`.
3. Fields pre-fill from the person's bench record.
4. Save & continue: `PATCH /profile` with `{blurb, specialties[], photo, onboarded:true}`, then `refresh()` and go to `/`.
5. Skip for now: sets `localStorage` to "1" and goes to `/`. This is per-browser, so on another browser or after clearing site data the gate fires again until the profile is saved.
- All roles are the same.

**Technical**
- Backend: `profile.updateProfile` (section 10). `onboarded` is only honored when `target === ctx.me.sk`.
- Photo: `readPhoto()` (`web/lib/photo.ts`) produces a compressed `data:image/...;base64` string. The server limits it to 80,000 characters (about 60KB) and to jpeg/png/webp.
- `onboarded` is stripped from the public view of a person for non-admin, non-self viewers.
- Edge: an Admin acting as a not-yet-onboarded user will be redirected to `/welcome` as that user. Saving writes that user's `onboarded=true`, because `ctx.me` is the target.

---

### 6. Backend auth plumbing (reference)

#### 6.1 `authorizer.mjs` (Lambda `ol-portal-authorizer`)
1. Reads `Authorization: Bearer`. A missing token returns deny.
2. `verifyWorkosToken` (`authz.mjs`) does `jose` `jwtVerify` against the JWKS `https://api.workos.com/sso/jwks/<WORKOS_CLIENT_ID>`.
   - It accepts these issuers: `https://api.workos.com/user_management/<clientId>` plus `WORKOS_TOKEN_ISSUER` (comma-separated, production `https://auth.optimisticlabs.com/user_management/<clientId>`).
   - Clock tolerance is 5s. There is no audience check.
   - A rejection logs the issuer seen versus expected.
3. Email = claim `urn:olportal:email` (from a WorkOS JWT template) or `email`, lowercased. A missing email is denied.
4. `role` claim is passed through. A token with no role is still authorized on purpose, so the user gets a 403 "No portal role" rather than a 401 sign-out loop.
5. `recordSignIn(email, sid)`: conditional put `pk="SESSION"`, `sk=<sid>` with a 90-day TTL, then `writeAudit(actor,"auth.signin","successful sign-in")`. This gives one audit row per session. Failures never block the request.
6. Verified-session check (section 4).
7. Returns `{isAuthorized:true, context:{email, role, sid, sub, verified}}` (simple-response mode).

#### 6.2 `identity.mjs`: who is the caller
- `identityFromClaims` is chosen by `AUTH_PROVIDER`.
  - For WorkOS, username = email claim. Role comes from slug `admin`, `lab-leader` or `contributor`. The seeded `member` slug is deliberately unmapped.
- `buildContext({username, role, actAsTarget})`, in order:
  - No username: 403 "No portal profile for this user".
  - `resolvePerson`:
    - First `get(PERSON, email)`.
    - Else scan the `PERSON` partition for a legacy record whose `email` attribute matches. Exactly one match is linked (and the record keeps its original key). Two matches are a 403 "More than one portal profile uses this email address. An Admin needs to merge them."
  - `active === false` gives 403 "This account has been deactivated". Absent `active` means active.
  - Role = `PERSON.role || token role`. The PERSON record is the source of truth. No role gives 403 "No portal role on this account".
  - Act-as (section 3.5).
- `perms(role, labs, key)`: the permission matrix (`seesLab`, `editDeal`, `manageContacts`, ...), used across other areas.

#### 6.3 `workos.mjs` (WorkOS Management API client)
- Outbound calls to `https://api.workos.com`.
  - The API key is read at runtime from AWS Secrets Manager (secret id `WorkOs`, key `WorkOS`, overridable by env vars) and cached in memory.
  - Functions used by live code, through `directory.mjs`: `listUsers`, `findUserByEmail`, `updateUser`, `deleteUser`, `listAuthFactors`, `deleteAuthFactor`, `listInvitations`, `findPendingInvitation`, `sendInvitation` (7 days), `resendInvitation`, `revokeInvitation`.
  - These are used by the admin routes (`/admin/users`, `/admin/invites` ...) in `app.mjs` and `admin.mjs`, which belong to another section.

#### 6.4 `directory.mjs` (sign-in directory abstraction)
- `directory = PROVIDER==="workos" ? wos : cognito`. The live branch is `wos`.
- Statuses are reported in Cognito vocabulary: `CONFIRMED`, `FORCE_CHANGE_PASSWORD` (invitation pending), `NO_ACCOUNT`.
- `createAccount` sends a WorkOS invitation and does not send the role. The role and labs live on the PERSON record. `resetMfa` deletes all the user's auth factors so they re-enrol at next sign-in.

#### 6.5 `util.mjs`
- Shared helpers, called throughout: `doc` (DynamoDB DocumentClient), `resp`, `get`, `put`, `listType` (paginated Query on `pk`), `writeAudit` (pk `AUDIT`, sk `<ISO>#<rand>`, 90-day TTL), `fullName`, `esc` (HTML escape for email bodies), `nextId`, contract document-kind helpers (not relevant here).

#### 6.6 `email.mjs`
- SES v2. `sendSystemEmail` sends from `Optimistic Labs Portal <no-reply@optimisticlabs.com>`.
  - `sendClientEmail` sends from the sender's own address if it is `@optimisticlabs.com`. Otherwise it sends from `Optimistic Labs <hello@optimisticlabs.com>` with Reply-To set to the sender.
  - Lambda IAM allows `ses:SendEmail` and `ses:SendRawEmail` on `identity/*`.
  - Used here by `verify.mjs` (system) and `messages.mjs` (client style).

---

### 7. `/notifications` page and notifications provider

#### 7.1 The bell and provider (`web/lib/notifications.tsx`)
- `NotificationsProvider` is mounted in the portal layout. It holds `items`, `unread`, `loadedAt`, `loading` and `error`.
  - It calls `GET /notifications` on mount, every 60s, and on window focus.
  - `markAllRead` and `markOneRead` update locally first and then POST `/notifications/read` with `{all:true}` or `{ids:[id]}`. The server's `unread` count reconciles. On error it refetches.
  - A generation counter drops stale poll results that raced a local change.
- Presentation helpers: relative age ("just now", "22m", "3h", weekday, "4 Mar"), Today/Yesterday/Earlier grouping, a chip label per `kind`, an action word per kind (Reply, RSVP, Review, Open), and a tone (amber for signature and approval, green for executed, violet otherwise).

#### 7.2 `/notifications` page (`web/app/(portal)/notifications/page.tsx`)

**On the page**
- Eyebrow "Notifications" and the heading "Everything waiting *on you*".
- A "Mark all as read" button (visible only when unread > 0).
- Tabs, rendered only when there is more than one tab with content. "All" always exists. Mentions, Messages, Community and Work appear only if at least one notification of that tab exists. Each shows an unread-count chip.
- The list is grouped Today / Yesterday / Earlier. Each row (`web/components/notifications/row.tsx`) shows an avatar (the person's photo or initials from the live roster, or a tinted glyph for system items), "actor verb", an optional snippet, the meta line, a kind chip, age, an unread marker and an action word.
- A "Blocked on you" side rail lists unread `signature` and `approval` items. It is hidden when there are none.
- Empty states: "Nothing has been addressed at you yet." or "You are caught up on this one."

**End user flow**
1. Open the bell, then "See all notifications", or visit `/notifications` directly. It is not in the nav.
2. Click a row. The row is marked read, then:
   - an `href` with `#messages/<id>` opens that conversation in the Messages drawer in place;
   - `#messages` alone opens the drawer list;
   - anything else is `router.push(href)`.
3. "Mark all as read" clears everything.
- Same for every role. Each person only ever sees their own notifications.

#### 7.3 Backend (`backend/src/notifications.mjs`)
- Routes:
  - `GET /notifications` calls `listNotifications`. It returns `{items (newest first, max 200), unread, total}`.
  - `POST /notifications/read` calls `markRead` with body `{all:true}` or `{ids:[...]}`. It returns 400 if neither is given. It returns `{marked, unread}`.
- Entity: `pk="NOTIF#<person key>"`, `sk="<ISO>#<rand4>"`.
  - Fields: `kind`, `tab`, `actor?`, `actorName?`, `verb`, `snippet?`, `meta?`, `href?`, `read`, `created`, `ttl` (90 days).
  - The partition comes from the resolved identity (never a parameter), so only your own rows are reachable. Another person's id marks nothing.
- There is no create route. Rows are written only by server code through `notify({to[], kind, actor, ...})`.
  - It drops the actor (no self-notification) and duplicates, and is best-effort (it logs and returns on failure).
  - It emits CloudWatch EMF metrics in the namespace `OLPortal/Notifications`.
- Kind-to-tab map: `mention` goes to mentions; `message` to messages; `signature`, `executed`, `assignment`, `approval`, `proposal`, `invoice` to work; `comment`, `post`, `event`, `join` to community.

**Emitters that are wired today**

| Kind | Where | Trigger |
|---|---|---|
| `mention` | `community.mjs:205` | An @name in a community post. The recipient must be able to see the post (lab-scoped). |
| `mention`, `message` | `messages.mjs:248,253` | A chat message. Recipients are the other members. |
| `assignment` | `assignments.mjs:184` | Filing an assignment names a leader. |
| `approval` | `assignments.mjs:204,301` | Assignment approved or related. |
| `signature` | `signing.mjs:221,386` | A contract is sent to a contributor to sign, or a client signs and the countersigner is notified. |
| `executed` | `signing.mjs:464` | Countersignature completes the contract. The owner is notified. |

- `mentionKeys(text, people)` is the server-side mirror of the browser's mention parser (longest name first, with a negative lookahead for longer words).
- `personByEmail` is used by `signing.mjs` to find a contributor.
- Tests: `backend/tests/notifications.test.mjs`.

---

### 8. Messages drawer

**What it is:** a right-hand slide-over (max 420px) mounted once by `PortalShell` (`web/components/messages/panel.tsx`). It is opened by the top-nav Messages icon, by "Message" buttons (bench cards `bench/page.tsx`, community members `components/community/members.tsx`, community page `community/page.tsx:196`, profile page `profile/page.tsx:215,379`), the Optimist turn component (`components/optimist/turn.tsx`), the notification page and any `#messages` or `#messages/<id>` link in the URL.

**Modes**
- **List:** header "Messages" with a conversation count, "+" (New chat) and close.
  - Rows show an avatar (initials for a DM, a squared tile with the member count for a group), the title, an "@" badge if an incoming message mentions you, the time and the preview ("You: ..." or "First: ...").
  - Empty: "No conversations yet. Start one with anyone on the bench." with a "Start chat" button.
- **New chat** (`new-chat.tsx`):
  - Search box, a multi-select list of active bench members (not yourself, all roles) and chips for the picked people.
  - One person means a DM. Two or more shows an optional "Group name" and the CTA changes from "Start chat" to "Start group".
- **Thread** (`thread.tsx`):
  - Bubbles (yours are violet and right-aligned; others have a sender name in groups), the time, and a "Today" divider.
  - @name tokens are highlighted. A line under a bubble says "Dana was notified" or "You, Dana were notified", derived client-side from the mentions in the text.
  - An incoming message that mentions you gets a ringed bubble.
  - Composer: typing "@" opens a "Notify someone" picker (whole roster, people already in the thread first, with an "In chat" tag). Enter or Tab inserts the first match and Esc closes it.
  - Groups have a pencil to rename. A blank name reverts to member names.
  - Pending messages are shown dimmed until the server acknowledges them.

**End user flow**
1. Click the Messages icon, then "+", pick people, and press Start. The conversation opens immediately (optimistic).
2. Type and send. The message appears at once and is replaced by the server copy.
3. The recipient gets an in-portal bell row ("sent you a message" or "mentioned you ...") and an email (below).
4. The drawer polls every 5s while open and every 45s while closed, and also on window focus. A message from the other side appears without reload.
5. Opening a chat with the same set of people from either side lands in the same conversation.
- All roles are the same. There is no role gate beyond conversation membership. The people list is the active bench.

**Technical (frontend)**
- `web/lib/messages.tsx`: `MessagesProvider` merges the server state (`GET /messages`) with pending conversations (key `pending:<sorted ids>`) and pending messages. It maps member keys to "ME" or a person card from the live roster (bench plus offboarded people, so old threads keep names). Threads whose members cannot be named are hidden.
  - A `#messages/<id>` for an unknown thread falls back to the list.
- API calls:
  - `GET /messages` returns `{items:[{id,members,name?,updated,lastText?,lastFrom?,created,msgs[]}]}`. The newest 200 messages per thread are returned in this single call.
  - `POST /messages` with `{members:[...], name?}` creates or returns the conversation.
  - `POST /messages/{id}/send` with `{text}`.
  - `PATCH /messages/{id}` with `{name}` renames a group.

**Technical (backend, `backend/src/messages.mjs`)**
- Entities:
  - `CONVO`: `pk="CONVO"`, `sk="c_"+sha256(sorted member keys joined by "|")[0..24]`.
    - Fields: `members[]` (including the writer), `name?`, `createdBy`, `created`, `updated`, `lastText`, `lastFrom`, `emailed{personKey: ISO}`.
    - The id is derived from members, so creation is idempotent and the same from either side. `emailed` is hidden from clients.
  - `MSG`: `pk="MSG#<convoId>"`, `sk="<ISO>#<rand4>"`, fields `from` (from the JWT, never the body), `text`, `created`.
  - There are no TTLs on these items.
- Rules:
  - `createConversation`: needs at least 1 other person and at most 20, and each must exist and be active (`unknown is not on the bench`). The group name (only if more than 2 members) is capped at 80 characters.
  - `sendMessage`: 404 if the conversation is missing, 403 if you are not a member, 400 if the text is blank. Text is trimmed to 4000 characters.
  - `renameConversation`: only for members, and only for groups of 3 or more (400 "Only a group can be renamed").
  - `listConversations` scans the whole `CONVO` partition and filters by membership (there are no GSIs).
- Notification fan-out (`tell`), best-effort: @named members get a `mention` bell row, everyone else gets a `message` row. Links are `/community#messages/<id>`.
- Email fan-out: one email per recipient per conversation per 15 minutes (`EMAIL_COOLDOWN_MS`), tracked in `CONVO.emailed`.
  - It goes through `sendClientEmail`, so it comes from the writer's own `@optimisticlabs.com` address if they have one. Otherwise the sender is `hello@optimisticlabs.com` with Reply-To set to the writer.
  - The recipient address is `PERSON.email` or the person key if that is an email. A person with neither gets only the bell.
  - Subject examples: "X sent you a message", "New message in {group} from X", "X mentioned you in ...".
  - A bounce never fails the send.
  - The bell rings on every message. Only the email is rate-limited.
- Tests: `backend/tests/messages.test.mjs`.

---

### 9. `/profile` (`web/app/(portal)/profile/page.tsx`)

**On the page**
- Header: photo (or initials), "Your profile" (or "Profile"), name in serif italics, and the role line (role plus labs). Buttons depend on who is viewing.
  - Self or Admin: "Edit profile" and "Change photo".
  - Anyone else: "Message {first}".
- Main column:
  - "Engage me for" card: blurb and specialty tags.
  - "Contact & visibility" card: contact email and phone, each with a Visible/Hidden switch.
  - "Account" card (self only): "Signed in as" (`person.email || key`), Role plus lab chips, a "Sign out" button, and the text "Roles and labs are set by an Admin."
- Side column: "On the bench" shows the person's Directory card as colleagues see it, with a link to `/bench`. If the person was offboarded it says so instead.
- `?u=<username>` shows someone else's profile. It is read from `window.location` after mount. An unknown username gives "No one in the portal has that username." If your own record is missing it says "We could not find your profile record..." with "Go to the Directory" and "Try again".

**End user flow**
- **Own profile:**
  1. Avatar menu, then "Your profile".
  2. "Edit profile" opens `EditProfileDialog` (`web/components/bench/edit-profile-dialog.tsx`). It edits the photo, the "Engage me for" blurb (500 characters), specialties (comma-separated), contact email, phone and the two visibility checkboxes. Save does `PATCH /profile`.
  3. The photo button and the visibility switches PATCH one field each, show a toast, and refresh the data.
- **Another person's profile:** a read-only view with a "Message" button, via `?u=`. The server hides anything the owner did not opt in to show.
- **Admin:** can open any profile (`?u=`) and edit it. Edits go to `PATCH /profile/{username}`.
  - The server writes an audit row `profile.admin-edited`.
  - While acting as a user, "mine" means the target's profile.

**Technical**
- Data comes from `people[...]` in `GET /bootstrap`. The server filters each person for the viewer through `profile.publicView`.
  - For a non-Admin viewer looking at someone else, it removes root `email`, `onboarded`, `offboardedAt` and `offboardedBy`.
  - It also removes `bench.email` when `showEmail === false`, removes `bench.phone` unless `showPhone === true`, and strips the `show*` flags.
  - Admins and the person themselves get the full record.
  - The UI defaults to showEmail=true and showPhone=false when unset.
- Routes (`app.mjs:580-581`): `PATCH /profile` and `PATCH /profile/{username}`. The handler is `profile.updateProfile(ctx, username, body)` (`backend/src/profile.mjs`).
  - It reads the `PERSON` record. Another person's profile is allowed only if `ctx.role === "Admin"`, otherwise 403 "You can only edit your own profile". 404 if there is no such person.
  - It updates only the keys present in the body.
  - Validation:
    - `specialties`: an array, up to 10 tags of 40 characters each, deduplicated.
    - `blurb`: a string, up to 500 characters.
    - `linkedin`: must start with `https://` (accepted by the API, but no UI field was found in the profile page or dialog).
    - `email`: regex-validated.
    - `phone`: digits and `()+.-` and spaces, up to 40 characters.
    - `showEmail` and `showPhone`: booleans.
    - `onboarded`: honored for self only.
    - `photo`: a `data:image/(jpeg|png|webp);base64,...` URI of at most 80,000 characters. An empty string removes the photo.
  - Stored as `PERSON.bench{specialties, blurb, linkedin, email, phone, showEmail, showPhone}` plus the top-level `photo` and `onboarded`. The key is `pk="PERSON"`, `sk=<email>`.
  - It returns the full record, minus the keys.
- The "Sign out" button on the page calls `logout()`, which ends the AuthKit session.

---

## 02 — Community (`/`, `/community`) and The Bench (`/bench`)

Paths are relative to `/home/user/ol-portal`. `web/` = live frontend, `backend/` = live backend. "Page" below means the file in `web/app/(portal)/`.

### Reality summary (read this first)

| Feature | Status |
|---|---|
| Feed: list, create, edit, delete posts | REAL — persisted in DynamoDB via `/posts` |
| Likes (toggle) | REAL — persisted (`likedBy` on the POST item) |
| Comments (add only) | REAL — persisted (`comments` array on the POST item) |
| Post detail dialog / `?post=` deep link | REAL |
| @mention notifications on post create/edit | REAL (backend only; no composer autocomplete) |
| Lab filter chips, Groups tab, Members tab, rail lab list | REAL — derived from live labs/people in `/bootstrap` |
| Message author / message lab / Start chat | REAL hooks into the messages drawer (owned by another section) |
| **Events tab, rail "Upcoming", event detail, RSVPs** | **NOT LIVE** — `COMMUNITY_EVENTS = []`, RSVPs are local React state only, no API. Users only ever see empty states. |
| Pinned announcement, digest, presence dots, link cards, photos, Member-created groups | NOT LIVE (see last section) |
| `/bench` directory, person cards, edit-profile, search, tag filter | REAL — roster comes from `GET /bootstrap`; edits via `PATCH /profile[/{username}]` |

`docs/community-posts.md` is STALE in places: it says likes/comments have no routes and are client-side, and that Home has a digest/presence card. Both are wrong now (likes and comments are real; Home is just Community).

---

## 1. Community — `/` and `/community`

### 1.1 Routing and shell

- `web/app/(portal)/page.tsx:13` is just `export { default } from "@/app/(portal)/community/page"`. `/` and `/community` render the identical component. The old dashboard was deleted, not hidden (comment, lines 1-12).
- Top nav (`web/components/shell/top-nav.tsx:44`) has `{ href: "/", label: "Community", also: ["/community"] }` — both URLs highlight Community. Bench is NOT in the nav; it is reached by URL, the profile page's "Directory →" / "Go to the Directory" links (`web/app/(portal)/profile/page.tsx:92,365`), or the Members tab inside Community.
- Everything under `(portal)` is wrapped by `web/app/(portal)/layout.tsx`: requires a signed-in, verified session (otherwise redirect to login/verify), then mounts `PortalDataProvider` -> `NotificationsProvider` -> `MessagesProvider` -> `PortalShell`. `PortalDataProvider` calls `GET /bootstrap` plus other lists on mount; the community page reads `labs, myLabs, people, bench, me, role` from it.
- Static export (`next.config` `output: "export"`); query params are read client-side via `useSearchParams` inside a `Suspense` boundary (`community/page.tsx:43-49`).
- `/dev/community` and `/dev/bench` are click-test harnesses; `DevHarness` calls `notFound()` when `NODE_ENV === "production"` (`web/app/dev/_harness.tsx`), so they are not reachable in the live build.

### 1.2 Page layout (what is on the page)

`web/app/(portal)/community/page.tsx` (576 lines):

1. Header: "COMMUNITY" eyebrow with star glyph, H1 "What is happening *across the labs*".
2. Tab bar with counts: **Feed** (number of visible posts), **Events** (always 0), **Groups** (number of labs), **Members** (number of roster members). Active tab is local state; initial tab from `?tab=feed|events|groups|members` (read once on arrival; invalid value falls back to feed).
3. Two-column grid (`lg`: main + 340px right rail). Main column shows the active tab; the right rail (`CommunityRail`) is always shown.
4. Two modal dialogs (`CommunityDialog`, a styled wrapper over the app's `Dialog`): post detail, and event detail (event detail can never open since there are no events).

#### Feed tab (`components/community/feed.tsx`)
- **Composer**: avatar with the viewer's initials, 3-row textarea ("Share a win, a link, or an ask with the network…"), "Posting to" select, Post button. No kind picker, no tags, no attachments, no @-autocomplete — plain text only.
- **Lab chips**: "Everyone" + one chip per lab, each toggles the feed filter.
- **Post cards** (`post-card.tsx`): avatar, author name (button -> opens a DM), meta line "`<Lab or Everyone> · <relative time>[ · edited]`", kind chip (Update/Ask/Win/Link/Introduction), body text, a Like pill ("N" or "N · you"), a comments pill ("N comments") that opens the post detail, and for author/Admin an "Edit" and "Delete" text action.
- States: loading ("Loading the feed…"), error (red message plus "Nothing has been lost — reload the page to try again."), empty ("Nothing has been posted yet…" / "Nothing in <lab> yet." with "See every lab" button).

#### Events tab — see NOT LIVE. Visible UI: explanatory line "Admins and Lab Leaders can create events.", disabled "Manage events →" and "New event" buttons for Admin/Lab Leader only (tooltip "Events admin is designed but not built yet"), and the empty state "Nothing on the calendar yet."

#### Groups tab
- Text: "Groups follow your lab affiliation, so membership stays in sync with the Portal. Nothing to join or manage."
- One card per lab: name, "`N members · M posts`" (members = roster people whose lab list includes it; posts = posts currently loaded whose lab equals it — only the posts the viewer is allowed to see), "View feed →" (sets the feed lab filter and switches to Feed), "Message the group" (opens a group chat with that lab's other members; if there is nobody else it just opens the messages list).
- A dashed "Member-created groups — Coming later" placeholder card (static text, not a feature).

#### Members tab (`components/community/members.tsx`)
The bench roster rendered inside Community (same `PersonCard` + `EditProfileDialog` as `/bench`; see section 2). Adds a lab-chip filter row (own filter state, independent from the Feed's), search box, "Start chat" button, "Clear" and an empty state. Admin-only "Impersonate" menu on cards (see 2.5).

#### Right rail (`components/community/rail.tsx`)
- **Upcoming**: always "Nothing scheduled yet." plus "All events →" (switches to Events tab).
- **Your labs**: titled "Your labs" but lists EVERY lab plus "Everyone" with member counts (it is `labList`, not the viewer's own labs). Clicking sets the Feed lab filter and jumps to the Feed tab. "Browse groups →" switches to Groups.
- **"Need a real conversation?"** card with "Open messages" button -> `openList()` from `useMessages()` (messages drawer, other section).

### 1.3 How it works for the end user

#### All roles (Admin, Lab Leader, Contributor) — Community is intentionally role-blind for reading/writing
1. Open `/` (or `/community`). The feed loads (`GET /posts`) and shows posts newest first. Timestamps read "just now / Nm / Nh / Nd ago" within a week, then a date like "12 Sep".
2. **Post**: type in the composer, choose "Posting to", click Post. Button disabled when empty or while posting. On success a toast "Posted to the network." / "Posted to <Lab>." and the feed re-reads; the draft clears. On failure a toast shows the server message and the draft is kept. The "Posting to" default follows the currently selected lab chip if the viewer may post there, else falls back to Everyone.
   - Options in "Posting to": Everyone plus labs the viewer belongs to (Admin: all labs). Server enforces the same rule.
   - Kind is not chosen in the UI, so every post created from the UI is kind "Update" (server default). Other kinds exist only if set via API.
3. **Filter**: click a lab chip. The filter shows posts for that lab PLUS all "Everyone" posts (`page.tsx:151-154`). Note posts in labs the viewer is not in are not returned by the server at all (see 1.4 visibility), so chips for other labs can only show network-wide posts for non-members.
4. **Like**: click the heart pill on a card or in the detail. It toggles (like/unlike), the app re-reads the feed so the count is the server's. Label shows "N · you" when you have liked. No optimistic update; errors toast "Could not update your like."
5. **Open a post**: click the comments pill (or arrive via `/community?post=PS-001`). A dialog titled "Post by <name>" opens (kicker = the post kind) with the full text, like pill, all comments (initials, name, relative time, text, oldest first) and an "Add a comment" input with a "Reply" button. Closing the dialog clears `?post=` from the URL (`router.replace("/community")`). An unknown/inaccessible id in `?post=` simply opens nothing.
6. **Comment**: type and click Reply. Draft is kept on failure (toast). Comments cannot be edited or deleted by anyone through the UI or API. Comment text is plain; max 2000 chars; max 500 comments per post (then 409 "This post has reached its comment limit").
7. **Edit** (author, or Admin): click "Edit" on the card or in the detail; textarea replaces the text; Save (disabled until text is non-empty and changed), Cancel, Cmd/Ctrl+Enter saves, Esc cancels. Only the text can be edited in the UI (lab/kind/tags are API-capable but have no UI). Edited posts show "· edited".
8. **Delete** (author, or Admin): "Delete" -> browser `window.confirm("Delete your post? This cannot be undone.")` (or "<Name>'s post" for an Admin deleting another's) -> post removed, dialog closed if open, feed re-read.
9. **Message an author**: click the author name on a card/detail -> closes the post dialog and opens the messages drawer with that person (matched by display name against the messages roster; if not found, opens the list).
10. **Groups / rail**: "View feed", "Message the group", "Open messages" as above.
11. **Members**: see section 2 behaviours; "Message" on a card opens a DM, "Start chat" opens the new-conversation picker.

#### By role differences
- **Admin**: can post to any lab; sees every post regardless of lab; can edit/delete anyone's post (the delete of someone else's post writes an audit entry `community.post.removed`); on Members sees "Edit" pencil on every card and an Impersonate menu on non-Admin, non-self cards; sees disabled Events admin buttons.
- **Lab Leader**: same as Contributor for posts (no moderation rights — explicitly cannot edit/delete others' posts, `community.mjs:101-105`; `web/lib/community.ts:172-180`); sees disabled Events admin buttons.
- **Contributor**: can post, like, comment on what they can see; only edit/delete own.
- Everyone can edit their own profile on Members/Bench cards; only Admins can edit others'.

### 1.4 How it works technically

#### Frontend files
| File | Role |
|---|---|
| `web/app/(portal)/community/page.tsx` | Owns all state: tab, per-tab lab filters, `records` (posts), loading/error, `loadedAt` clock, open post/event id, local `rsvps`. Composes the pieces; every write is "call API -> `loadPosts()` re-read" (no optimistic updates). |
| `web/lib/community.ts` | API client (`listPosts`, `createPost`, `updatePost`, `deletePost`, `toggleLike`, `addComment`), `canEditPost` (mirror of server `canEdit`), `toCommunityPost`/`toCommunityComment` (join stored record to display card using live roster + labs), `postTime`, `initialsOfName`, `POST_KINDS`, plus the empty/legacy constants listed under NOT LIVE. |
| `web/components/community/feed.tsx` | Composer, lab chips, list/empty/error states. Draft state local; `onPost` awaited so a rejection keeps the draft. |
| `.../post-card.tsx` | `PostCard`, `PostEditor`, `OwnerActions`, label helpers, `PhotoSlot`. |
| `.../post-detail.tsx` | `PostDetail` (full post, comments, reply form). |
| `.../members.tsx` | Members tab (reuses `components/bench/*`). |
| `.../rail.tsx` | `CommunityRail`, `LabList`, `EventDateBlock`. |
| `.../community-dialog.tsx` | Styled wrapper over `components/ui/dialog` (focus trap/Esc from primitive). |
| `.../primitives.tsx`, `icons.tsx` | `Panel`, `TogglePill`, `Initials`, `AvatarWithPresence`, `KindChip`, `Eyebrow`, `FIELD` styles; icon set. |
| `web/lib/portal-data.tsx` | Provides `labs`, `people`, `role`, `me`, `myLabs`, `bench` (people minus offboarded), loaded from `GET /bootstrap`. |
| `web/lib/messages.tsx` | `useMessages()` -> `openWith(ids, name)`, `openList()`, `openNew()`, `roster`. (Other section.) |
| `web/lib/api.ts` | `api()` wrapper and `ApiError` (error `.message` is surfaced in toasts). |

#### Key frontend logic
- `labList` = `[Everyone, ...labs]` with member counts computed from `benchRoster(bench, labs)` (`page.tsx:132-141`).
- `postLabs` = Everyone + (Admin: all labs; else labs whose id is in `myLabs`) (`page.tsx:146-149`).
- `visiblePosts` = posts where filter is Everyone, or `p.lab === filter`, or `p.lab === Everyone` (`page.tsx:151`).
- Author display: live roster name wins over the stored `authorName` snapshot; falls back to snapshot (and initials from it) for an author no longer in the roster. Lab id -> lab name; unknown lab id renders as "Everyone".
- `online` is never set -> no presence dots are drawn on avatars.
- `likedByMe` and `likes` come from the server; the browser never computes them.
- Deep link `?post=<id>`: opens the dialog from the loaded post list (`allPosts.find`), so it only works if `GET /posts` returned that post for this viewer. `GET /posts/{id}` exists but the frontend never calls it.
- Notifications link to `/community?post=<PS-id>` (`community.mjs:213`).

#### API endpoints (all behind the HTTP API authorizer; Lambda `ApiFunction`, `/{proxy+}` GET/POST/PATCH/DELETE routes in `backend/template.yaml`; routing in `backend/src/app.mjs:548-556`)
| Method + path | Handler (`backend/src/community.mjs`) | Used by UI? | Notes |
|---|---|---|---|
| `GET /posts` | `listPosts` (:227) | Yes (page mount and after every write) | Scans partition `POST`, filters with `canSee`, sorts `created` desc then `sk` desc. Returns `publicView` records. |
| `GET /posts/{id}` | `getPost` (:242) | No | 404 not found / 403 not visible. |
| `POST /posts` | `createPost` (:252) | Yes | Body `{text, lab?, kind?, tags?}`. 201. UI sends only `text` and optional `lab` (lab id). |
| `PATCH /posts/{id}` | `updatePost` (:280) | Yes (text only) | Author or Admin, else 403 "Only the author can edit this post". Sets `updated`. |
| `DELETE /posts/{id}` | `deletePost` (:298) | Yes | Author or Admin, else 403. Admin deleting another's post -> `writeAudit(..., "community.post.removed", "<id> · by <author>")`. Hard delete. |
| `POST /posts/{id}/like` | `toggleLike` (:325) | Yes | Toggle; requires only `canSee`. Returns the updated record. |
| `POST /posts/{id}/comments` | `addComment` (:343) | Yes | Body `{text}`; 201 with the whole post. Requires `canSee`. |
| `GET /bootstrap` | `bootstrap` in `app.mjs:127` | Yes (via PortalDataProvider) | Supplies `labs` and `people` (run through `profile.publicView`). |

Route ordering in `app.mjs`: `/posts/{id}/like` and `/posts/{id}/comments` are matched before the bare `GET|PATCH|DELETE /posts/{id}`.

#### DynamoDB (single table `ol-portal`, `TABLE_NAME` env)
POST item: `pk="POST"`, `sk="PS-001"…` (id from `nextId("POST","PS-")` in `util.mjs:76`), plus `author` (PERSON sk from the identity, never from body), `authorName` snapshot, `text` (trimmed, <=5000), `kind` (Update/Ask/Win/Link/Introduction; default Update), `lab` (LAB key, absent = whole network), `tags` (lowercased, deduped, <=10, <=30 chars), `likedBy` (array of PERSON keys), `comments` (array of `{id:"cN", author, authorName, text(<=2000), created}`), `created`, `updated`. `publicView` strips `pk/sk/likedBy`, renames `sk`->`id`, and adds `likes` (count) and `likedByMe`. Related reads: `LAB` items (existence check), `PERSON` items (mentions).

#### Access rules (`community.mjs`)
- **canSee** (:93): Admin sees all; author sees own; no `lab` = everyone; else viewer's `me.labs` must include the lab.
- **canPostToLab** (:109): no lab, or Admin, or viewer in that lab. Create/update returns 400 "unknown lab" or "You are not in that lab".
- **canEdit** (:105): Admin or author. Lab Leader gets no extra rights.
- Likes/comments: just `canSee`. Role otherwise irrelevant ("Community is the one surface where role decides nothing").
- Validation errors are 400 (`a post needs something to say`, `invalid kind`, `tags must be a list`, `at most 10 tags`).

#### External services / side effects
- **Notifications (mentions)**: on create and on edit, `tellMentioned` (:187) looks for `@Full Name` or `@FirstName` in the post text (`notifications.mjs mentionKeys`, longest name first, not followed by a letter), notifies only newly added mentions, and only people who `canSee` the post. Notification kind `mention`, verb "mentioned you in a post", href `/community?post=<id>`. Best-effort (errors swallowed). Comments do NOT trigger mentions. The composer has no @-autocomplete and mentions are not highlighted in the feed; it only works if the author types the name exactly. (Notification UI belongs to another section.)
- **Audit log**: `admin.mjs writeAudit` for Admin moderation deletes only.
- **Observability**: JSON log lines `community.post.created|rejected|updated|deleted`, `community.posts.listed`, `community.comment.created`; CloudWatch EMF metrics in namespace `OLPortal/Community` (`PostCreated`, `PostRejected`, `PostsListed`, `PostUpdated`, `PostDeleted`, `PostLiked`, `PostUnliked`, `CommentCreated`). Likes do not write a log line, only a metric.
- No email/S3/third-party calls.

#### Technical caveats worth knowing (verified in code)
- Likes and comments are read-modify-write `PutCommand` of the whole POST item with no condition/version check (`util.mjs` `put`; `community.mjs:336,364`). Two people liking/commenting on the same post at the same instant can overwrite each other (last write wins).
- `nextId` is "max existing numeric suffix + 1" over a partition scan. Deleting the highest-numbered post makes its id (e.g. `PS-007`) be reused by the next post, so an old `?post=PS-007` link (or notification) could point at a different, newer post. Concurrent creates can also collide on the same id.
- `listPosts` scans the entire `POST` partition each request and filters in Lambda; fine at current scale, not paginated.
- Comment React keys are `${who}-${i}`; comments have ids server-side but the UI does not use them.
- Edit permission in the UI uses `post.author === me`; while an Admin is "acting as" someone, `me` is the target person so the UI/server treat them as that person.
- Post photos/links/headlines are never populated (see below), so cards never show them.

### 1.5 Tests
`backend/tests/community.test.mjs` (375 lines, in-memory table, real handlers) covers persistence across callers, deletion, post model/defaults, author from caller not body, id sequencing, validation (empty, over-length, kind, tags, unknown lab, lab membership), lab scoping and author-keeps-own-post, 404/403s, edit/author-only (Lab Leader refused), moving between scopes, delete rules, likes (toggle, per-caller `likedByMe`, scope check, 404), comments (order, validation, truncation, author from caller, scope check, 404). Not covered by the file: mention notifications, audit write on moderation delete.

---

## 2. The Bench — `/bench`

### 2.1 What is on the page (`web/app/(portal)/bench/page.tsx`)
- Header: serif italic H1 "The bench", subtitle "Everyone across Optimistic Labs".
- Buttons: **Start chat** (opens the messages drawer in "new conversation" mode) and **Edit my profile** (only if the viewer's PERSON record exists).
- **Search** box "Search by name, lab, or what they do…" (client-side substring match over name, role line, engage blurb, tags — the role line includes lab names, e.g. "Lab Leader · Faith Lab").
- When filtering: "`N people · <tag>`" and a Clear button; empty state "No one on the bench matches that yet. Clear the search."
- Responsive grid of **person cards**.
- Footnote: "Everyone edits their own profile; admins can edit any. Contact visibility is per-person: your email shows unless you hide it, your phone stays private until you opt in — and the server enforces it, so hidden details never leave the API."
- Loading ("Loading…") and error states come from the shared `usePortalData`.
- No lab/role filter chips on `/bench` (the Members tab in Community does have lab chips). No presence dots (by design, comment at top of page).

#### Person card (`web/components/bench/person-card.tsx`)
- Avatar (profile photo via `next/image`, else initials), name, role line (`"<Role> · <Lab names>"`).
- "Engage for: <blurb>" — or "No profile yet" ("— add what people should engage you for." on your own card).
- Specialty tag chips (click toggles the tag filter; only one tag at a time).
- Footer: contact (email, or phone if no email — whatever the server let through), then actions:
  - Own card: "Edit profile" button (no message button).
  - Others: pencil edit icon (only if Admin) and "Message" button. The Message button's overlay makes the whole card clickable for pointer users.
  - Admin-only `...` menu "Impersonate <first name>" — rendered only on the Members tab (the `/bench` page does not pass `onImpersonate`).

#### Edit profile dialog (`web/components/bench/edit-profile-dialog.tsx`)
Title "My profile" (own) or the person's name; description "Shown to everyone in the portal on the bench directory." Fields: photo (file input + Remove), "Engage me for" blurb (max 500), specialties (comma-separated tags), contact email, phone, checkboxes "Show my email on the bench directory" and "Show my phone on the bench directory". Buttons Cancel / "Save profile".

### 2.2 How it works for the end user
1. Navigate to `/bench` (no nav item; via URL, the Profile page's "Directory" links, or use Community > Members which is the same roster).
2. Browse cards (one card per active person, ordered by username). Everyone with a portal account who has not been offboarded is shown, any role including Admin; people who never filled in a profile show "No profile yet".
3. Search by typing; click a tag chip on any card to filter by that specialty (click again to clear); Clear resets both.
4. Message someone: click Message (or the card) -> messages drawer opens a thread with that person (existing conversation reused, else created on first open via `POST /messages`). "Start chat" opens the new-conversation picker.
5. Edit own profile: "Edit my profile" or "Edit profile" on your card -> dialog -> Save. Toast "Profile saved", dialog closes, `refresh()` re-bootstraps all portal data so the card updates.
6. Photo: choose an image; it is downscaled client-side to max 256px JPEG (q 0.85) via `web/lib/photo.ts readPhoto` and embedded as a base64 data URL in the PATCH body. Server limit ~80,000 chars (~60KB); too big -> toast with server message "photo too large — it should compress under 60KB".
7. Privacy: email shows unless the owner un-ticks "Show my email" (default true); phone hidden unless they tick "Show my phone" (default false). Hiding is enforced server-side for everyone but the owner and Admins.
8. **Admin**: sees an edit pencil on every card, can edit anyone's profile (saved via `PATCH /profile/{username}`, audit-logged as `profile.admin-edited`). Admins also see all hidden contact data in bootstrap. (An admin editing another person does not flip that person's `onboarded` flag.)
- Lab Leader and Contributor have identical bench permissions: view all, message all, edit self only.

### 2.3 How it works technically
- **Data source**: no dedicated bench endpoint. The roster is built client-side from `GET /bootstrap` (`people` map). `usePortalData().bench` = people with `active !== false` (`portal-data.tsx:239`); `benchRoster(bench, labs)` (`web/lib/data.ts:207`) filters by `isMember` (not offboarded) and maps to `BenchPerson` `{id=username, name, initials, role = roleLine (role · lab names), labs (names), engage = bench.blurb, tags = bench.specialties, contact = bench.email || bench.phone, photo}`. The same function feeds Community's Members tab, so both screens show the same roster.
- **`GET /bootstrap`** (`app.mjs:127`): returns `me, role, assignmentApprover, actingAs?, labs, people`. Each person passes through `profile.publicView(person, viewerKey, viewerRole, personKey)` (`profile.mjs:77`): for non-Admin viewers looking at someone else it removes root `email`, `onboarded`, `offboardedAt`, `offboardedBy`, and within `bench`: deletes `email` if `showEmail === false`, deletes `phone` unless `showPhone === true`, and removes both show flags. Admin viewers and the person themself get the full record. (Unfiltered PERSON also holds `firstName, lastName, role, labs, photo, active, bench{blurb, specialties, email, phone, showEmail, showPhone, linkedin}`.)
- **Edit**: `EditProfileDialog` -> `api("/profile")` (own) or `api("/profile/{username}")` (Admin editing another), method `PATCH`, body `{blurb, specialties[], email, phone, showEmail, showPhone, photo}`. Routes `app.mjs:580-581` -> `profile.updateProfile(ctx, username|null, body)`:
  - Target defaults to caller; editing another requires role Admin (else 403 "You can only edit your own profile"); 404 if no PERSON.
  - Validation: `specialties` must be an array (deduped, max 10, each <=40 chars); `blurb` string <=500; `email` must match a basic email regex or be empty; `phone` only digits/space/()+.- <=40; `photo` must be `data:image/(jpeg|png|webp);base64,...`, <=80,000 chars, empty string removes it; `linkedin` accepted by the API (https only) but the Bench dialog has no field for it; `onboarded` can only be set for yourself (used by welcome flow, not by this dialog).
  - Persists by `put` of the PERSON item (`pk="PERSON"`, `sk=<username>`; username is the lowercased email under WorkOS) with updated `bench` map and `photo`. Admin edit of another person writes audit `profile.admin-edited`.
  - Note: the dialog always sends all fields, so saving overwrites the stored values with whatever is in the form (including blank).
- **Search/filter**: pure client-side `useMemo` filtering on the already-loaded roster; no server search.
- **Messaging hooks**: `openWith([personId])`, `openNew` from `useMessages()` (`web/lib/messages.tsx`) — the messages backend (`/messages…`) belongs to another section.
- **Impersonation (Members tab only)**: `startActingAs` (`web/lib/act-as.ts`) confirms, calls `POST /admin/act-as` `{target}` (rules enforced in `backend/src/admin.mjs`: real caller must be Admin, not self, not another Admin), stores the target, hard-navigates to `/`. Shown only if viewer role is Admin and target is neither self nor Admin.
- **`backend/src/directory.mjs`**: NOT the people directory despite the name. It is the sign-in directory adapter used by `admin.mjs` for invites/offboarding/MFA reset (WorkOS when `AUTH_PROVIDER=workos`, which the live deploy sets; the Cognito half is kept for rollback). It matters to the Bench only indirectly: an invited account creates the PERSON record that then appears on the roster; offboarding sets `active:false` which removes the person from the roster. Covered by the Admin section.
- **Welcome flow touchpoint**: `portal-shell.tsx` redirects users with `onboarded` false to `/welcome` (reuses the same profile fields). Covered elsewhere.

---

## 03 — Pipeline, Deal Flow, Files

Scope: `/pipeline` (stage board, Companies, People, Documents views, deal drawer, record drawer, assignment tab, document upload), `/deal-flow` (admin board), `/files`.
Everything below was verified against code in `web/` and `backend/` at HEAD (`017389f`). Design docs (`docs/pipeline-v2.md`, `docs/deal-view-rollout.md`) are partly stale; see section 7.

### 0. Cross-cutting facts used by all three pages

**Roles (actual names).** `Admin`, `Lab Leader`, `Contributor` (`web/lib/types.ts` `Role`; `backend/src/identity.mjs` `ROLE_OF_GROUP` / `ROLE_OF_WORKOS` map Cognito groups `Admin`/`LabLeader`/`Contributor` and WorkOS slugs `admin`/`lab-leader`/`contributor`). The live deploy uses WorkOS (`AuthProvider=workos`). The **PERSON record's `role` is the source of truth**, the token claim is only a fallback (`identity.mjs` `buildContext`, ~line 140). A PERSON has `labs: []`; a Lab Leader's labs live there.

**Permission matrix** (`identity.mjs` `perms()`, mirrored client-side in `web/lib/can.ts`; client checks are UI affordances only, the server re-checks every call):

| Capability | Admin | Lab Leader | Contributor |
|---|---|---|---|
| See a deal (`GET /deals`) | all | deals whose `lab` is in their labs, plus any deal where `deal.owner` is them (the "deal you lead in another lab" rule, PRD 3.3) | none: `listScoped` returns `[]` |
| Add a deal | yes | yes, if they have at least one lab; only into their own labs | no |
| Edit / move a deal, upload docs on it (UI), file an assignment | yes | same set they can see | no |
| Delete a deal | yes | no | no |
| Change a deal's lab | yes | no (403 "Lab reassignment is admin-only") | no |
| Companies / People (read, create, edit, delete a person) | all records | only a derived slice (see 2.8) | `[]` / 403 |
| Approve / reopen an assignment | only the single named approver (a person, not a role) | only if they are the approver | no |
| `/deal-flow` page | yes | page shows "The deal flow board is for Admins." | same message |

Contributors can open `/pipeline` by URL or nav (nothing hides it), but get an empty board with no "+ New deal" button (all lists come back `[]`). The Optimist's pipeline tools also refuse Contributors.

**The Assignment Approver** is one named person: `ASSIGNMENT_APPROVER` env var, defaulting to `liz@optimisticlabs.com` (`assignments.mjs:40`). The env var is not set in `backend/template.yaml`, so the default is what runs. Matching is against a PERSON's key or `email` attribute (`isApprover`). `/bootstrap` returns `assignmentApprover` (that person's key) so the UI knows whom to name and whether to show Approve.

**Admin "act as".** An Admin can act as a non-Admin: the `x-act-as` header (set by `web/lib/api.ts` from sessionStorage) makes `buildContext` swap `ctx.me`/`ctx.role`, so all checks run as the target. Mutations made while acting-as are audited (`admin.act-as-mutation`, `app.mjs:689`). Side effect worth knowing: `api()` on any non-2xx while acting-as clears the act-as target and retries the same request as the real Admin (`web/lib/api.ts`, "stale act-as" branch).

**Data load.** `PortalDataProvider` (`web/lib/portal-data.tsx`) fetches in batches of 3 (to stay inside the account's Lambda concurrency quota of 10): `/bootstrap`, `/deals`, `/proposals`, `/invoices`, `/files`, `/contracts`, `/recurrences`, `/guides`, `/companies`, `/contacts`. `/companies` and `/contacts` are the only two allowed to fail (`.catch(() => [])`) so a frontend ahead of the backend degrades instead of breaking the portal. Every page reads this one in-memory store (`deals`, `files`, `companies`, ... plus setters). `refreshFiles()` re-pulls `/files`.

**Storage.** One DynamoDB table `ol-portal` (`pk`/`sk`), pay-per-request, retained. S3 bucket `ol-portal-files-<acct>` (private; CORS allows PUT/GET from `portal.optimisticlabs.com`, the Amplify domain and localhost:8761). Entities used here:

| Entity | pk | sk | Written by |
|---|---|---|---|
| Deal | `DEAL` | `D-001`, `D-002`... (`nextId` = max numeric suffix + 1 over a full partition query) | `createDeal`/`updateDeal`, assignments, `execution.rollUpDeal`, `proposals.advanceDeal` |
| Company | `COMPANY` | `CO-001`... | `contacts.mjs` |
| Contact (person) | `CONTACT` | `CT-001`... | `contacts.mjs` |
| File | `FILE` | `F-001`... (S3 key `uploads/<id>/<sanitized name>`) | `createFile`, `analyzer.mjs`, contract PDF renderer |
| Recurrence | `RECUR` | `R-<dealId>-<YYYY-MM>` | `recurring.mjs` |
| Notification | `NOTIF#<person key>` | `<ISO>#<rand>` | `notifications.notify()` |

There is no audit-trail write for deal/contact/file/assignment changes (only act-as mutations are audited).

**Front-end routing.** Static export (`next.config.ts` `output: "export"`); `amplify.yml` copies every `x.html` to `x/index.html` so `/pipeline` and `/pipeline/` both resolve.

**Reachability of the three pages.**
- **/pipeline**: in the top nav (`web/components/shell/top-nav.tsx`, `PRIMARY` = Community `/`, Pipeline `/pipeline`, Resources `/resources`; there is no "More" menu). Also reached from deep links: assignment emails and bell notices go to `/pipeline?deal=<id>&tab=assignment`; `/proposals` redirects every non-Contributor to `/pipeline`; `/invoices` redirects Lab Leaders to `/pipeline`.
- **/deal-flow**: **URL only.** No nav entry and no `href`/`router.push` to it anywhere in `web/` outside its own file (grep confirms; the only other mentions are the `/dev/deal-flow` harness and the seeded help guide with `page: "deal-flow"`). An Admin has to type the URL.
- **/files**: **URL only.** No nav item, no in-app link. (`web/lib/uploads.ts` and `portal-data.tsx` mention the path only in comments / API calls.) The help widget would show the seeded "files" guide if someone is on that URL.

---

### 1. /pipeline — page shell (`web/app/(portal)/pipeline/page.tsx`)

#### 1.1 What's on the page
- Heading "Pipeline" (or "`<Lab name(s)>` Pipeline" for a scoped Lab Leader) plus a per-view blurb.
- **+ New deal** button (Admin, or Lab Leader with at least one lab).
- Four view tabs with live counts: **Deals** (board, `deals.length`), **Companies**, **People**, **Documents** (`buildDocCards(...).length`, the same list the grid draws). The tab is the `?view=` query param (`companies|people|documents`; absent = board; an unknown value falls back to board).
- Toolbar: a search box (placeholder changes per view); for **Admins only**: a "All labs" select (board and Documents), "All originators" (board; filters `deal.owner`) and "All owners" (board; filters `deal.dealOwner`); for a scoped Lab Leader a violet pill naming their lab(s); on the board, a red "Needs billing entity N" toggle appears when any deal at/after Proposal Sent has no company or person, and filters to those.
- **Board**: 7 columns in order Lead, Discovery, Proposal Sent, Negotiating, Contracted, Closed Won (stored value `Closed`), Closed Lost. Each column header shows a count and the dollar total of its (filtered) deals (`SHOW_COLUMN_TOTALS = true`, a build constant in `lib/pipeline.ts`). Empty column: "Nothing here" / "Drop here" while dragging.
- Companies and People tables (2.7), Documents grid (2.9), deal drawer (2.3–2.6), record drawer (2.8).

#### 1.2 How it works for the end user
1. Open Pipeline. The board shows only the deals the server returned for your role (table in section 0). Admin sees all labs; a Lab Leader sees their lab(s)' deals plus any deal they own elsewhere (the blurb then adds "plus any deal you lead in another lab").
2. A Lab Leader whose PERSON has no lab (or whose lab no longer exists) sees a red "No lab is assigned to your account" notice instead of a board (`page.tsx:283`).
3. Search matches client name, billing-entity name and owner key (a lowercase substring match on `client + billing name + owner`).
4. **Open a deal**: click a card. The drawer opens and the URL becomes `?deal=<id>`; closing removes it. A pasted `?deal=<id>` link opens the drawer on load; `&tab=assignment|documents` selects the tab.
5. **Move a deal**: drag a card to another column (only if you can edit it; the card gets a grip handle). Drops are optimistic (card moves, then `PATCH /deals/{id} {stage}`; failure rolls back with a toast). Before sending, the board runs the same gate chain the server enforces (section 3), in this order, and **opens the deal drawer instead of moving** if one is unmet, with the drawer pre-set to the target stage:
   1. billing entity (target at/after Proposal Sent) -> drawer Details tab, toast "needs a billing entity"
   2. proposal (target at/after Proposal Sent) -> Documents tab
   3. signed contract (target at/after Contracted) -> Documents tab
   4. invoice (target Closed Won) -> Documents tab
   5. Dropping on **Contracted** with no assignment on the deal: the move goes through, a toast says "Contracted — a Lab Leader Assignment form is needed", and the drawer opens on Details (where the amber "Go to the assignment form" card is).
   6. Dropping on **Closed Lost**: no gates, moves straight away.
   After fixing the blocker in the drawer, **Save** completes the move (the drawer's stage select was pre-set to the target).
6. Dropping directly on Closed Won with all documents already on file moves the deal immediately and does **not** prompt for a close date (the "clear the expected close and ask for the real one" behaviour only happens when the drawer was opened by a failed gate or when someone changes the stage select to Closed Won in the drawer; `page.tsx:209-259` vs `deal-drawer.tsx:116, 414`). The server does not require a close date either.

#### 1.3 Technically
- Components: `PipelineBoard` in `page.tsx` (client component inside `<Suspense>` for `useSearchParams`), `DealCard`, `DealDrawer`, `RecordDrawer`, `ContactsTable`, `DocumentsGrid`.
- State: all data from `usePortalData()`; drag state in local `useState`; HTML5 drag-and-drop (`draggable`, `dataTransfer` carries deal id). `framer-motion` card animations respect reduced motion.
- Role-derived filters: `isAdmin = role === "Admin"`; for non-admins the lab/owner filter values are forced to `"all"` regardless of stale state. The page comment is explicit that the real scope is server-side (`/deals`, `/companies`, `/contacts`, `/proposals`, `/contracts`, `/invoices` each return scoped data).
- Gate helpers: `web/lib/pipeline.ts` (`billingRequiredAt`, `proposalRequiredAt`, `contractRequiredAt`, `invoiceRequiredAt`; each is "not Closed Lost and stage index >= gate stage index"; gate stages `Proposal Sent`, `Proposal Sent`, `Contracted`, `Closed`). Gate-clearing evidence on the client:
  - proposal: any `files` row with `kind==="proposal"` and that `deal`, **or** a legacy PROPOSAL record for the deal with `sentAt`
  - contract: `deal.contractSigned` **or** a `kind==="contract"` file
  - invoice: a `kind==="invoice"` file
- API: `PATCH /deals/{id}` (`api<Deal>`), handled by `updateDeal` in `backend/src/app.mjs:198`.
- No emails or notifications are sent for deal create/move/delete.

---

### 2. /pipeline — features in detail

#### 2.1 Deal card (`web/components/pipeline/deal-card.tsx`)
**What:** lab chip, "Won"/"Lost" badge (at Closed / Closed Lost), an amber "Assignment" badge when an assignment is owed (stage Contracted or Closed with none filed), a repeat icon if recurring, deal name, a recurring cadence line ("Monthly", "Monthly · paused", "Monthly · until <date>"), the **billing entity tile** (initials, name, sub-line: "<contact> · primary contact", "No primary contact", "Billing entity needed" in red when required and missing, or "Fine until Proposal Sent"), close date ("Aug 31", parsed by parts so time zones don't shift it), amount, owner name.
**How:** click to open; drag if you can edit. Red border when the billing entity is overdue.
**Tech:** pure presentational; `billingOf()` in `lib/pipeline.ts` builds the tile; `assignmentState()` decides the badge. `SHOW_BILLING_ON_CARDS = true`.

#### 2.2 Drawer shell and footer (`deal-drawer.tsx`, `deal-drawer-footer.tsx`)
- Right-hand `Sheet`, 520px max. Header: deal name (or "New deal") and "`<Lab>` · `<Stage>`". Close "X".
- Tabs **Details / Documents / Assignment** exist only for an existing deal. The Assignment tab turns amber with a "Needs you" tag while an assignment is owed. A **new deal has no tabs** (details form only).
- **Footer**: Delete (left; Admin only and only on an existing deal; native `window.confirm`), a live **hint line** that names the first unmet requirement, and the primary button ("Create deal" / "Save", disabled until `canSave`). If the user cannot edit the deal, no Save button. The footer is a CSS container query: under ~340px the hint drops above the buttons.
- **Hint / Save gate (client)**, evaluated in this order: deal name required; billing entity linked if stage is Proposal Sent or later; proposal on file if Proposal Sent or later; signed contract on file if Contracted or later; invoice on file if Closed Won; close date set if Closed Won; otherwise "Unlinked — fine at <stage>, required at Proposal Sent" or "Ready to save". (`deal-drawer.tsx:173-195`.) Note "Closed Won" gate uses the literal stage `Closed`; Closed Lost bypasses all of it.

#### 2.3 Details tab
**Fields:** Deal name; Billing entity panel (2.4); Lab (select of all labs); Stage (select of all 7, labels "Closed Won"/"Closed Lost"); **Originator** (= stored `owner`) and **Deal owner** (= `dealOwner`), both limited to active Admins and Lab Leaders; Source (Referral, Inbound, Network, Event, Outbound); Amount (shown as `$1,234`, stored as a number); Expected close (relabelled "Close date" at Closed Won, turns red if empty there); "Recurring engagement — bills monthly until paused or ended" checkbox, plus a Pause/Resume button for an existing recurring deal.
Cards above the form: amber **"Lab Leader Assignment needed"** (when owed; says to add the signed contract first if none; otherwise a "Go to the assignment form" button) or green **"Assignment form on file"** (Approved / Awaiting approval + leaders + View).
When the stage selected needs a document the deal lacks, an **inline upload box** for that document appears in Details (for an unsaved new deal it is a "Save deal to attach a proposal/contract/invoice" button, which creates the deal early via `POST /deals`; the later Create click `PATCH`es that same record, so no duplicate).
**Role differences:** UI shows all labs in the Lab select to a Lab Leader, but the server rejects a create into a lab they do not lead (403 "lab not assignable") and a lab change on update (403 "Lab reassignment is admin-only"). The client only sends `lab` when it differs from the stored one (or on create), so a Lab Leader saving unrelated fields does not trip the admin-only check. On **create**, the server forces `owner` to the Lab Leader themselves regardless of what the form sent; on update a Lab Leader can change `owner`/`dealOwner` to any valid person. Delete is Admin-only.
**Tech:** `POST /deals` -> `createDeal` (`app.mjs:151`), `PATCH /deals/{id}` -> `updateDeal` (`app.mjs:198`), `DELETE /deals/{id}` -> `deleteDeal` (`app.mjs:292`; removes only the DEAL row; it does **not** delete the deal's FILE/PROPOSAL/CONTRACT/INVOICE rows). Pause/resume sends `PATCH {recurPaused}`. `buildBody()` always sends `client, owner, dealOwner, stage, amount, close, source, recurring, companyId, contactId`.
**Server validation:** create validates client non-empty, lab exists and is assignable, stage and source in lists, amount finite >= 0, close matches `YYYY-MM-DD`, owner and dealOwner exist (dealOwner must be Admin/Lab Leader), company/contact exist **and are in the caller's scope**. Update validates only stage, amount, owner, dealOwner, lab, `recurEnd`, and company/contact scope. **It does not re-validate `client`, `close` or `source` on PATCH** (anything the editable allowlist accepts is stored).
**Record shape (DEAL):** `client, lab, owner, dealOwner, stage, amount, close, source, recurring, companyId, contactId, created, updated, outcome` (derived: `Won` at Closed, `Lost` at Closed Lost, removed otherwise), plus fields written elsewhere: `contractSigned, contractSignedAt, contract` (set only by `execution.rollUpDeal`, not in the PATCH allowlist so a client cannot forge them), `assignment` (set only by assignment routes), `recurPaused, autoInvoice, recurEnd`.

#### 2.4 Billing entity panel (`billing-entity-panel.tsx`)
**What:** a deal links a **Company**, a **Person** (contact), both, or neither. Badge states: linked (violet), required-and-missing (dashed red, from Proposal Sent), optional (dashed). Search companies / people (top 4 matches, by name or website / name or email), click to attach, "x" to detach, name click opens the record drawer (2.8). "Add a new company" / "Add a new person" inline forms (company: name, website, address; person: name, email, phone). If the chosen company has a primary contact not yet attached, a "Primary contact — tap to attach" suggestion row appears. Read-only users see "No company linked".
**User flow:** type to filter, or click the dashed "Add a new ..." row (pre-filled with what you typed), fill, "Save & attach". The new record is saved to the shared Companies/People lists immediately and attached to the (unsaved) form; the deal's link itself is persisted on the drawer's Save.
**Tech:** `POST /companies` / `POST /contacts` (`contacts.mjs createCompany`/`createContact`). A new contact created with a company becomes that company's primary contact if it has none (server writes it; client mirrors it). A contact created with a company gets title "Primary contact", without one "Individual". Client validation mirrors server (`websiteError`, `phoneError`).

#### 2.5 Documents tab (`DocumentUploadPanel` x3)
**What:** three boxes: **Upload Proposal**, **Upload Contract**, **Upload Invoice**. Each has a drag-and-drop zone ("choose a file"), accepted types **PDF, DOC, DOCX, XLS, XLSX, PNG, JPG** up to **50 MB** (extension check, client-side only), a progress bar per upload with a Dismiss on failure, and rows for uploaded documents with **View** (opens inline in a new tab), **Download**, **Upload new version** (proposal/contract) or **Replace** (invoice), and **Remove**.
- Proposal and contract are *versioned slots*: a second upload is v2 etc.; the newest is shown, earlier ones fold under "Show N earlier versions" (viewable and removable, not supersedable); one file per gesture. A "vN" badge appears once there is a chain.
- Invoice is a *flat list*: each upload is its own row; multiple files allowed; Replace uploads the new file then deletes the old record.
- Below the three boxes, once the stage is Contracted or later, a "Signed contract" note says whether a signed contract is on file (via portal signing or an upload) and links to **/contracts** ("Manage on Contracts").
**Who:** upload/replace requires `editable` (can edit the deal); Remove is shown to Admin or the uploader. A Lab Leader uploading to a deal outside their labs (one they own) uploads **untagged** (no `lab`), because the server refuses tagging to a lab they cannot see.
**Tech (upload is 2-step, S3 presigned):**
1. `POST /files {name,size,type,deal,kind,lab?}` -> `createFile` (`app.mjs:340`): validates name, size 1 B–50 MB, type present, lab exists and `ctx.can.seesLab(lab)`, `kind` in `proposal|contract|invoice`; for kind proposal/contract with a deal it computes `version = max(existing versions on that deal+kind, defaults 1) + 1`; writes FILE `{name,key,size,type,lab?,deal?,kind?,version?,uploader,date,status:"Uploading"}`; returns `{id, uploadUrl}` (presigned S3 **PUT**, 15 min, content type and length pinned).
2. Browser `XMLHttpRequest PUT` to S3 (`web/lib/uploads.ts putWithProgress`, for byte progress). If the PUT fails the client `DELETE /files/{id}` so a record with no bytes cannot clear a stage gate.
3. S3 `ObjectCreated` under `uploads/` triggers `AnalyzerFunction` (`analyzer.mjs`): PDFs/images/text up to 10 MB are sent to **Claude Haiku 4.5** (Anthropic API key from SSM `/ol-portal/anthropic-api-key`), result written to the FILE row (`status: Analyzed`, `analysis:{docType,summary,keyPoints}`); DOC/DOCX/XLS/XLSX and >10 MB become `Stored` with a "not supported / too large" note; failures `Analysis failed`. **Deal-drawer uploads go through this too**, so uploaded proposals/contracts/invoices are sent to the Anthropic API. The deal drawer does not display the analysis; it appears on /files.
4. View/Download: `GET /files/{id}/download[?disposition=inline]` -> `downloadFile` returns a presigned S3 GET (5 min) with `Content-Disposition` inline or attachment; 403 unless `canSeeFile`.
5. Remove: `DELETE /files/{id}` -> `deleteFile`: Admin or the uploader only; deletes the S3 object (errors swallowed) and the FILE row. A removed version number is not reused.
6. After each upload `refreshFiles()` reloads `GET /files`.
**File visibility** (`canSeeFile`, `app.mjs:327`): Admin sees all; **anyone** sees a file with no `lab`; a Lab Leader sees files tagged with one of their labs; the uploader sees their own; a Contributor also sees files whose `contributorEmail` matches theirs (contract PDFs). Consequence: **untagged files are readable by every signed-in user, Contributors included**, which is also what an out-of-lab Lab Leader's deal uploads become.
**Gate evidence on the server:** the stage gates look for any FILE row with `deal === id && kind === "<kind>"` (`app.mjs:252, 270, 280`). They do not check the row's `status`, the uploader, or that the bytes landed, and `createFile` does not verify that `deal` exists or that the caller may edit it.

#### 2.6 Assignment tab (`assignment-tab.tsx`; server `assignments.mjs`)
Three faces driven by `assignmentState(deal)` (`lib/pipeline.ts`): **locked** (stage before Contracted, or Closed Lost: "Not needed yet"/"A lost deal is never assigned"), **needed** (Contracted or Closed with none filed: the form), **filed**/**approved** (receipt).
**Form fields:** client agreement reference (default "`<deal>` — signed agreement"), client name (default billing company, else person, else deal name), contract value (default deal amount), date issued (today), **lab leaders** (multi-select popover of active Admins/Lab Leaders; deal owner pre-selected and tagged "Deal owner"; seeded from a legacy `assignmentNotice` if the deal has one), **share of the pool** per leader (integer %, must total exactly 100; "Split evenly" gives remainder to the earliest leaders), hard costs, subcontractor costs, auto **soft reserve = 5%** of contract value, payment cadence (On signature, Monthly, Quarterly, Annually, On milestones, 50% up front / 50% on delivery; default "Monthly" for a recurring deal), optional notes for finance. A live preview shows: contract value, minus hard, sub and soft costs = net; **lab leader pool = 70% of net**; each leader's payout = pool x share. All rounded to whole dollars. The File button reads "Finish the required fields" until leaders exist, shares total 100, ref and client are non-empty and value > 0.
**Flow by role:**
- *Anyone who can edit the deal* (Admin / Lab Leader): fill and **File the assignment**. Toast says the approver was emailed (or that email failed but the bell notice went out; or just "Assignment filed" if the filer is the approver). Receipt turns amber "Filed · Awaiting approval". The filer can **Edit the assignment** and **Re-file** any number of times until approved (each re-file re-notifies and re-emails the approver; there is no de-duplication).
- *The approver* (Liz by default): sees "This is waiting on your approval" and **Approve assignment**; once approved, **Reopen and edit** (returns it to an unapproved draft, figures kept, `reopenedAt` stamped). Everyone else sees "Approved figures are locked. Ask <approver> to reopen it."
- Filing does **not** move the stage, and closing a deal does not wait on an assignment (a nudge, not a gate).
**Endpoints** (router `app.mjs:487-492`):
- `POST /deals/{id}/assignment` -> `fileAssignment`: needs `ctx.can.editDeal`; deal stage must be `Contracted` or `Closed` (else 400); 409 if already approved; `cleanAssignment` validates (ref, client, value > 0, costs >= 0, `YYYY-MM-DD`, cadence in list, >= 1 leader, unique leaders, each share >= 0, sum = 100 within 0.01); each leader must be an existing Admin/Lab Leader PERSON; money (`softReserve, net, pool, payouts[]`, `poolPct:70`) is **recomputed server-side**; stored on the DEAL as `assignment` with `filedBy, filedAt, updatedAt, approved:false`.
- `POST /deals/{id}/assignment/approve` -> `approveAssignment`: only `isApprover(ctx.me)` (403 otherwise; another Admin or the filer cannot); 400 if none filed; 409 if already approved; stamps `approved, approvedBy, approvedAt`. No stage check.
- `POST /deals/{id}/assignment/reopen` -> `reopenAssignment`: approver only.
**Notifications and email** (all best-effort; a failure never fails the request):
- On file: bell notice kind `assignment` ("filed an assignment naming you on <deal>") to the named leaders except the approver and the actor; bell notice kind `approval` ("filed an assignment on <deal> that needs your approval") to the approver, plus an **SES email** to the approver from `Optimistic Labs Portal <no-reply@optimisticlabs.com>`, subject "Assignment filed for <deal> · needs your approval", body listing contract value and each leader's %, notes, and a "Review and approve" link. Skipped if the approver filed it. If no PERSON matches the approver, a warning is logged and nobody is notified.
- On approve: bell notice (`approval`, "approved the assignment on <deal>") and an SES email ("Assignment approved for <deal>", "View the assignment") to the deal owner, every named leader and the filer, each once, excluding the approver.
- Links: `/pipeline?deal=<id>&tab=assignment` (`assignments.mjs:63`; email uses `FRONTEND_URL` = `https://portal.optimisticlabs.com`). Bell items `router.push(href)` straight to it.
- Mail goes through `email.mjs sendSystemEmail` (SESv2); the notification store is `notifications.mjs` (90-day TTL, `NOTIF#<person>` partition).

#### 2.7 Companies and People views (`contacts-table.tsx`)
**What:** two sortable-by-deal-count tables. *Companies*: name + industry/"kind", Website (clickable), Primary contact, Open deals count, Value. *People*: name + title, Company (own company, else the company on a deal they are the contact for, else "Individual — no company"), Email, Phone, deals, value. Search matches name, sub-line and link column. Rows sorted by deal count then name. Footnote links to `/community?tab=members` (OL staff live in the Directory, not here). Counts and values are over **all** deals linked (including closed ones), despite the "Open deals" column label.
**How:** click a row (or Enter/Space) -> record drawer.
**Tech:** pure client derivation from `companies`, `contacts`, `deals` in the store; `companyForContact()` in `lib/pipeline.ts`.

#### 2.8 Record drawer (`record-drawer.tsx`; server `contacts.mjs`)
**What:** edit a company (name, industry/`kind`, website with live validation and open-link, address textarea) or a person (name, title, email, phone with validation); shows the linked company/primary contact; "Make primary contact" / "Remove" for a person (sets `companies/{co}.contactId`); list of **All deals** for the record (click to open that deal in the deal drawer); "Back to deal" if opened from a deal. Reset/Save footer. **Delete person** (not companies) with a confirm; blocked with an explanatory note when deals still name them. Opened from Companies/People rows or from a deal's billing panel.
**Who:** anyone with `can.manageContacts` (Admin, Lab Leader). Contributors have no access.
**Endpoints:** `GET/POST /companies`, `PATCH /companies/{id}`, `GET/POST /contacts`, `PATCH /contacts/{id}`, `DELETE /contacts/{id}` (`app.mjs:475-481`). **There is no company delete route.**
**Validation (`contacts.mjs`):** name required (<= 200); email must match a basic pattern; website must parse as a URL with a dotted host once `https://` is assumed (stored as typed); phone optional, `+` and digits/space/dash/dot/paren only, 10–15 digits; address free text <= 500. Company also accepts `phone`/`email` on the API, but no form shows them (HubSpot-import remnants; `companyView` falls back to `city, country` for `address`).
**Tenant boundary (`labScope`, `contacts.mjs:102`).** Companies and contacts carry no lab, so a non-Admin's visible set is *derived*: seed = every company/contact on a deal the caller can see (same predicate as `/deals`), plus one hop (a visible company's primary contact; a visible contact's company), plus records the caller **created** (`createdBy`) that no deal points at yet. Admin = everything. Reads filter by scope; PATCH/DELETE on an out-of-scope id return **404 "not found"** (not 403) so existence is not confirmed; attaching an out-of-scope entity to a deal returns 400 "unknown company/contact". Records created before `createdBy` existed are reachable only via a deal.
**Delete person:** 409 with a message and the names of the blocking deals the caller can see (count includes deals they cannot see); otherwise clears any company `contactId` pointing at them, then deletes. 
**Primary contact rule:** creating a contact under a company that has none auto-sets it; deleting clears it.

#### 2.9 Documents view (`documents-grid.tsx`)
**What:** a paginated (9 per page) card grid, chips **All / Proposals / Contracts / Invoices / Assignments** with counts, sort (Newest, Oldest, Largest amount, Name A–Z), plus the page search and (Admin) lab filter. Each card: tag, status badge (+ version), when, name, client, deal sub-line, amount, "N earlier versions on record", and a button that opens the deal drawer (on Documents tab for raw uploaded files) or, for a contract or invoice with no deal, links to `/contracts` or `/invoices`.
**Card sources** (all from the already-loaded store, scoped by the server):
- PROPOSAL records, **one per deal** (latest `updated`) with proposal status (legacy; see section 6).
- Uploaded `proposal` files, one per deal (newest version), **only for deals that have no PROPOSAL record**; status "On file".
- CONTRACT records (client contracts, MSAs, task orders; kind tag from `docKindOf`); uploaded `contract` files only for deals with **no** CONTRACT record.
- INVOICE (billing-request) records; plus **every** uploaded `invoice` file (always additive).
- One card per deal that has an `assignment` ("Filed · leaders" amber / "Approved · leaders" green; amount = contract value; sub-line shows the pool).
The Documents **tab count** uses the same `buildDocCards`, so the number and the grid agree.
**Touchpoints with others' areas:** contracts/proposals/invoices internals (signing, DocuSign, QuickBooks, review) live on `/contracts`, `/proposals`, `/invoices`; here they are display only. Lab filter excludes cards that have no deal.
**Tech:** no API call of its own.

#### 2.10 Recurring engagement (touchpoint)
The drawer's checkbox sets `deal.recurring`; Pause/Resume sets `recurPaused`. A daily EventBridge Lambda (`recurring.mjs`, `cron(15 6 * * ? *)`) writes a `RECUR` row per month for each recurring, unpaused deal at **Contracted or Closed** (annual `amount / 12`), and, only if `deal.autoInvoice`, an INVOICE request in "Admin review". `autoInvoice` and `recurEnd` can only be set through the API; the drawer has no control for them (the card cadence line does display `recurEnd` if present). Admins can trigger `POST /recurrences/run` (no UI caller found on these pages).

---

### 3. Stage rules, exactly as enforced (server: `app.mjs` `updateDeal` 237–282, `createDeal` 182)

Stages (`STAGES`): `Lead, Discovery, Proposal Sent, Negotiating, Contracted, Closed, Closed Lost`. `Closed` = **Closed Won / paid**, `Closed Lost` = lost. `outcome` is derived, never chosen.
| Gate | Required to enter | Evidence accepted | When checked |
|---|---|---|---|
| Billing entity | Proposal Sent or later (not Closed Lost) | `companyId` or `contactId` | create; and on any update that touches stage, companyId or contactId |
| Proposal | Proposal Sent or later | a `FILE` with `kind=proposal` for the deal, **or** a legacy PROPOSAL with `sentAt` | only when moving **forward** (current stage index < target index) |
| Signed contract | Contracted or later | `deal.contractSigned` (set by contract execution), **or** a `FILE` `kind=contract` | forward moves only |
| Invoice ("paid" stand-in) | Closed | a `FILE` `kind=invoice` | forward moves only |
| Assignment | none (nudge only) | n/a | n/a |
Closed Lost bypasses every gate. Backward moves are never gated; leaving Closed/Closed Lost drops `outcome`. Documents are checked only on the crossing, so deals already past a gate stay editable.
**Known server gap:** the forward test compares `STAGES.indexOf(deal.stage) < indexOf(target)`, and `Closed Lost` is index 6, so a deal currently in Closed Lost moved by API straight to Contracted or Closed skips the proposal/contract/invoice gates (billing entity still applies). The UI drag path and drawer Save enforce the gates regardless of current stage, so only a direct API call exposes this.
**Automatic stage changes (not from this page):** sending a proposal advances a deal to Proposal Sent, a customer approving it to Negotiating (`proposals.advanceDeal`, never moves a Closed/Closed Lost deal and never backwards); executing a client contract (portal or DocuSign) sets `contractSigned`, `contract`, `contractSignedAt` and moves the deal to **Contracted** (not Closed; leaves Closed/Closed Lost alone) (`execution.rollUpDeal`).

---

### 4. /deal-flow — Admin board (`web/app/(portal)/deal-flow/page.tsx`)

**Reachability:** URL only (see section 0).
#### 4.1 What's on the page
Title "Deal flow"; four stat tiles: **Live deals** (stage not Closed/Closed Lost), **Out for signature** (contract status "Out for Signature"), **Signed**, **Needs a nudge** (amber when > 0); a search box (client or proposal title) and lab select; a table, one row per deal: Client (+ deal id), Lab, "Lab Leader" (= `deal.owner`), Value, **Proposal** (status badge, `vN`, "opened N×" or "not opened yet"), **Contract** (status badge, "Deviates" badge), **Waiting on**; stalled rows shaded amber and sorted first. Buttons "Go to contracts" and "Go to pipeline" (page-level, not per row). Read-only.
#### 4.2 How it works
Admin only: others see "The deal flow board is for Admins." (client-side check only; the data comes from the ordinary scoped endpoints so a non-Admin would only ever have their own scope anyway). Rows are computed in the browser from `deals`, `proposals`, `contracts` in the store: the deal's latest-updated PROPOSAL and the **first** CONTRACT whose `deal` matches. Value = `pricingTotal(contract.pricing ?? proposal.pricing) ?? deal.amount`.
"Waiting on / stalled" rules (`waitingOn()` in the file):
- Signed contract: stage Closed -> "Done"; Contracted -> "Contracted — awaiting payment"; otherwise "Signed — not marked Contracted yet" (stalled).
- Out for Signature: no client signature -> "Client signature · Nd" (stalled at >= 7 days since `sentForSignatureAt`); client signed -> "<OL signatory> to countersign" (stalled >= 2 days).
- Other contract state -> "Lab Leader to send it out".
- No contract: proposal with `approvedVersion` -> "Generate the contract" (stalled); Revision Requested (stalled); Sent -> "Client hasn't opened it · Nd" (stalled >= 3d) or "Client decision · Nd" (stalled >= 7d); other proposal -> "Proposal in draft"; none -> "No proposal yet".
No endpoints of its own; no emails.
#### 4.3 Caveats (verified)
- It reads only PROPOSAL and CONTRACT **records**, never uploaded `FILE` documents. Since proposals are now uploaded as files, a deal whose proposal is an upload shows **"No proposal yet"** here. The board is accurate only for deals handled in the legacy proposal system or with a portal contract.
- A Closed Lost deal with a signed contract is labelled "Signed — not marked Contracted yet" and flagged stalled.
- The seeded help guide for this page (`backend/scripts/seed-guides.mjs`, page `deal-flow`) still mentions an "Assignment Notice"; that concept was replaced by the Assignment.

---

### 5. /files — "Files & analysis" (`web/app/(portal)/files/page.tsx`)

**Reachability:** URL only. 
#### 5.1 What's on the page
Heading "Files & analysis", one card "All files" with: a lab select ("Everyone (no lab)" default, plus labs: all labs for an Admin, your own labs otherwise) and **+ Upload file**; a table (Name with one-line analysis summary, Status badge, Lab, Uploaded date + uploader, Size, Download / Delete); an empty state; a footnote ("Lab-tagged files are visible to that lab's leader and admins; untagged files are visible to everyone signed in"); a detail dialog (docType, status, summary, key points, Download); a delete confirmation dialog.
#### 5.2 How it works for the user
1. (Optional) choose a lab for the upload; default is **no lab = visible to everyone signed in**.
2. Click + Upload file, pick any file (no extension filter on this page; server limit 50 MB; no client size check, a too-large file fails with the server's 400). A toast "uploaded — analysis will appear shortly".
3. The row appears with status Uploading -> Analyzing -> Analyzed (or Stored / Analysis failed). While any file is Uploading or Analyzing the page polls `GET /files` every 4 s.
4. Click a filename for the analysis detail; Download opens a 5-minute presigned link in a new tab; Delete (Admin or the uploader only) confirms and removes the S3 object and the record.
**Role scope:** same `canSeeFile` rule as 2.5. The list includes **every** file the user can see, so deal-drawer uploads (proposal/contract/invoice, which the page shows without a deal or kind column), executed-contract PDFs, and general uploads are intermixed. A Contributor can open the page and upload; they can only upload untagged (a lab selection would 403 because `seesLab` is false for them) and see untagged files, their own, and PDFs of contracts that name their email.
#### 5.3 Technically
`GET /files` -> `listFiles` (sorted newest first; strips `key`); `POST /files` -> `createFile`; browser `fetch PUT` to presigned URL (no progress, no cleanup if the PUT fails, so a failed upload leaves a record stuck at "Uploading" that keeps the 4-second polling alive while the page is open); `GET /files/{id}/download` -> `downloadFile`; `DELETE /files/{id}` -> `deleteFile`. Analysis by `analyzer.mjs` as in 2.5 step 3 (Claude Haiku 4.5, 10 MB cap, PDF/images/text only). Contract PDFs rendered by a separate PDF Lambda also create FILE rows with `contributorEmail`.

---

## 04 · Proposals, Contracts, Signing, Templates, Pricing, Invoices

Scope: `web/` (live Next.js static export) and `backend/` (SAM, `AuthProvider=workos`). The legacy `frontend/` directory is ignored, except where it is the only place a file named `qbo.js` exists.

Everything below was checked against code. Anything that is a runtime/data fact I could not see (SSM parameters, DynamoDB contents) is flagged as such.

---

### 0. Executive summary: what is actually live

| Piece | State |
|---|---|
| Nav | Only Community, Pipeline, Resources (`web/components/shell/top-nav.tsx:44-46`). `/proposals`, `/contracts`, `/templates`, `/invoices` are reached by URL or in-app links only (e.g. Pipeline drawer "Manage on Contracts →", `components/pipeline/deal-drawer.tsx:626`). |
| Proposal authoring (create / edit / mark Final / send) | **Backend only. No UI calls it.** The Deal-View proposal tab was deleted (see `docs/deal-view-rollout.md` banner). Proposals in the Pipeline are now **uploaded files** (`FILE` with `kind: "proposal"`). |
| Public proposal page `/proposal-view` | Live code and routes, but only reachable for proposals that were already sent (legacy) or sent via a direct API call. |
| Contracts (`/contracts`) | **Live and the real working surface.** Create from approved (legacy) proposal, create directly (client contract / contributor MSA), task orders, send, countersign. |
| Native signing (`/contract-sign`) | **Live; the default.** |
| DocuSign | Code deployed and an admin card is visible on `/contracts`, but it is **opt-in and configured as sandbox** (`DOCUSIGN_ENV: demo`). Whether it is on in production depends on SSM + a DynamoDB flag I cannot see. See section 9. |
| Countersign, executed PDF, delivery, deal roll-up | Live (native Admin countersign). |
| Templates (`/templates`) | Live for Admin. Only the three clause kinds (contract, msa, task-order) are consumed by anything. Proposal-start and content-block tabs are orphaned. |
| Pricing | Live inside contracts / MSA-free task orders (`PricingEditor`). No proposal pricing editor exists in the UI any more. |
| Invoices (`/invoices`) | Live as an **Admin review queue** for `INVOICE` rows, but **nothing in the UI creates those rows**. The QuickBooks card renders for Admin but is inert (not configured). |
| `recurring.mjs` | Scheduled daily and runs, but its visible output is nil (see section 10). |
| **Likely bug** | The interactive PDF buttons on `/contracts` call a Lambda whose auth parsing is Cognito-only; under WorkOS they probably 403. See "Known issues". |

---

### 1. End-to-end lifecycle (as it really works today)

```
(A) PROPOSAL        Deal in Pipeline -> proposal document UPLOADED to deal (FILE kind=proposal)
                    [structured PROPOSAL record + share link + client approval still exist in the API,
                     but nothing in the UI creates or sends one; only legacy records flow through it]
       |
(B) SHARE/APPROVE   (legacy/API path) POST /proposals/{id}/send -> /proposal-view?token=... ->
                    customer Approve / Request changes -> PROPOSAL.approvedVersion set
       |
(C) CONTRACT        /contracts:  "Approved and ready for a contract" -> Generate contract (POST /contracts {proposalId})
                    OR "New contract" (no proposal)  OR "New MSA" (contributor)  OR "New task order" under a signed MSA
       |
(D) EDIT            Contract editor: payment schedule, dates, signers, scope/deliverables/timeline, pricing,
                    (client paper) deviation acknowledgement. Standard terms (clauses) come from a TEMPLATE at creation.
       |
(E) SEND            "Send for signature" -> freezes executionCopy + SHA-256 documentHash, mints signToken,
                    emails /contract-sign?token=...   [native; or DocuSign embedded if connected]
       |
(F) CLIENT SIGNS    /contract-sign: consent checkbox + typed/drawn signature -> signatures.client
       |
(G) COUNTERSIGN     Admin (the named olSignatory) clicks "Countersign" on /contracts -> CountersignDialog
       |
(H) EXECUTION       status Signed; PDF Lambda renders executed copy + audit certificate; deal -> "Contracted";
                    copies emailed to client/OL signatory/owner; executed MSA auto-invites the Contributor
       |
(I) INVOICES        Deal at "Closed" requires an uploaded invoice FILE (kind=invoice). The INVOICE-request queue on
                    /invoices (Admin) exists but is only fed by legacy rows / the recurring job when autoInvoice is set.
```

Customer vs contributor split:

* **Customer paper** = `docKind: "client"` (record id `C-nnn`). May inherit from a proposal. May be tied to a deal. Counterparty is the client.
* **Contributor paper** = `docKind: "msa"` (`MSA-nnn`, no deal, no proposal, no price) and `docKind: "task-order"` (`TO-nnn`, requires a **Signed** MSA parent, carries compensation/timeline). Counterparty is the Contributor (same stored field `client`, shown as "Contributor").
* All three are the same `CONTRACT` record type with the same signing flow, hash, PDF, audit trail. Absent `docKind` means `client`. Source of truth: `backend/src/util.mjs:83-138` (`DOC_KINDS`, `DOC_META`, `docKind`, `isContributorDoc`).

---

### 2. Page: `/proposals` (Contributor-only list; others redirected)

File: `web/app/(portal)/proposals/page.tsx`

**1. What's on the page**
* Title "Proposals", subtitle "Proposals shared with you." A card grid (title, client, status badge, **Preview** button). Preview opens a read-only dialog listing the six sections (`SECTION_LABELS`).
* Empty state "You have no proposals shared with you yet."

**2. How it works by role**
* **Admin / Lab Leader**: the page immediately does `router.replace("/pipeline")` (lines 31-33). It renders nothing for them.
* **Contributor**: sees only proposals whose `contributorEmail` matches their account email. Click Preview to read sections. No actions.
* Practical note: `contributorEmail` can only be set by `PATCH /proposals/{id}` and no UI does that, so this page is effectively empty except for legacy data.

**3. How it works technically**
* Data comes from `PortalDataProvider` (`web/lib/portal-data.tsx:145`, `GET /proposals`, loaded once for every role).
* Backend `proposals.listProposals` (`backend/src/proposals.mjs:129-136`): Contributor -> `p.contributorEmail == me.email`; others -> `ctx.can.seesLab(p.lab)` or (Lab Leader and `p.owner == me.sk`). Sorted by `updated` desc. Strips `pk/sk`, returns `id`.
* Note: the response includes the raw record, including `shareToken` (see Known issues).

#### 2a. Proposal backend (API-only; no live UI) — documented because the API is deployed and the public page depends on it

All routes on the main `ApiFunction` (`/{proxy+}` GET/POST/PATCH/DELETE with the WorkOS Lambda authorizer), router in `backend/src/app.mjs:474-501`.

| Method + path | Handler | Rule |
|---|---|---|
| `GET /proposals` | `listProposals` | see above |
| `POST /proposals` `{dealId,title,templateId?}` | `createProposal` (`proposals.mjs:92`) | `ctx.can.editDeal(deal)`; optional `proposal` template seeds sections/pricing; id `P-nnn` |
| `PATCH /proposals/{id}` | `updateProposal` (`:138`) | `ctx.can.editProposal`; sections/pricing/status/`final`/contributor share; commits version snapshots (max 20 kept); Admin-only statuses beyond Draft/In Review/Sent |
| `POST /proposals/{id}/send` `{clientEmail?, sendEmail?}` | `sendProposal` (`:209`) | requires a Final version; mints 32-hex `shareToken`; freezes `sentSections/sentPricing`; advances deal to Proposal Sent; optional SES email |
| `POST /proposals/{id}/pdf` | `ContractPdfFunction` (`template.yaml:358`) | Admin / owning Lab Leader |
| `GET /share/{token}` (public) | `shareView` (`:294`) | token is the credential; open tracking |
| `POST /share/{token}/decision` (public) | `shareDecision` (`:388`) | one decision per sent version |

DynamoDB: `pk="PROPOSAL"`, `sk="P-nnn"` (no GSI; token lookup is a full-partition scan, `proposals.mjs:280-283`).

---

### 3. Page: `/proposal-view?token=…` (public customer proposal page)

File: `web/app/proposal-view/page.tsx`. Outside the `(portal)` layout, so **no login**; uses `publicApi` (`web/lib/public-api.ts`), which never attaches an auth token.

**1. What's on the page**
* Brand strip coloured by the lab accent, "Optimistic Labs · {Lab}", title, "Prepared for {client}", version, sent date, preparer name.
* If this is a revised version after a "Request changes", a callout quoting the customer's last request.
* The six sections (`SECTION_LABELS`), with Pricing rendered by `PricingTable`. Tiered pricing shows selectable packages (the recommended one is preselected).
* Buttons: **Approve this proposal**, **Request changes**. After a response, a confirmation box.
* Footer: "Questions? Just reply to the email that brought you here."

**2. How it works for the customer**
1. Opens the emailed link (`{FRONTEND_URL}/proposal-view.html?token=…`).
2. Reads. If pricing is tiered, picks a package.
3. Clicks Approve (name required; comment optional; package required if tiered) or Request changes (name and comment required).
4. Page re-reads and shows "Approved/Changes requested by {name}". One decision per sent version; after a revision is re-sent they can decide again.
5. **There is no Reject button** in the UI. The API accepts `action: "reject"` but the page never sends it.

**3. Technically**
* `GET /share/{token}` and `POST /share/{token}/decision`: routes declared `Auth: Authorizer NONE` in `template.yaml:537-555` (`ShareGetRoute`/`SharePostRoute`); dispatched in `app.mjs:638-643` before any identity work.
* Open tracking `recordView` (`proposals.mjs:322`): stores up to 50 views `{at, ip, ua, version}`, 60 s de-dupe on same ip+ua, first view emails the proposal `owner` ("opened your proposal").
* Decision (`shareDecision`): writes `decision`/`decisions[]` (`action, comment, name, at, version, ip, selectedTier`), sets `status` (`Customer Approved` / `Customer Rejected` / `Revision Requested`), for approve sets `approvedVersion`/`approvedAt` and, for tiered pricing, freezes the chosen tier into `sentPricing`/`pricing`. Approve advances the deal to Negotiating (`advanceDeal`, forward only, never touches Closed/Closed Lost). Emails the owner (`notifyOwner`, link `/proposals.html`, which redirects Admin/LL to `/pipeline`).
* Audit: `proposal.sent|resent|emailed|approve|reject|revision`.
* Response omits IPs; includes `history` of earlier rounds.

---

### 4. Page: `/contracts` (the core contracting workspace)

File: `web/app/(portal)/contracts/page.tsx` (529 lines). Components: `contract-editor.tsx`, `new-contract-dialog.tsx`, `new-task-order-dialog.tsx`, `countersign-dialog.tsx`, `signature-capture.tsx`, `invite-contributor-dialog.tsx`, `pricing-editor.tsx`, `pricing-table.tsx`, `docusign/connect-card.tsx`.

**1. What's on the page**
* Header "Contracts" (Contributor sees "Your agreements"), and a **New contract / New MSA** button (non-Contributor).
* **Admin only**: the DocuSign connect card (see section 9).
* Tabs **Client contracts** / **Contributor agreements** (non-Contributor).
* On the Client tab, a green card **"Approved and ready for a contract"** listing proposals with `approvedVersion` that have no contract yet, each with **Generate contract**. (Only legacy approved proposals will appear, since no UI sends new ones.)
* A table: Client/Contributor (name, id, "under MSA-…", kind badge, "Deviates from proposal" badge), Lab, Owner, Value ("per task order" for an MSA), Status (plus "via DocuSign" if an envelope exists, executed date), **Next** (one action), **PDF**.
* Contributor tab groups task orders directly beneath their MSA.
* Contributors get a read-only card grid of what they have signed with a **Download PDF** button.

**2. How it works by role**

*Lab Leader (own labs, or deals they own) and Admin*
1. **Generate contract** from an approved proposal -> creates `C-nnn` pre-filled with the approved scope/pricing (frozen copy in `inherited`), merges the lab's contract template, opens the editor. Toast warns if the lab has no contract template. Pressing twice returns the existing contract.
2. **New contract** (no proposal): choose Client contract; optional deal (auto-fills client + lab); client name; lab; template (auto = lab's own, else OL-wide); pricing. Opens editor.
3. **New MSA**: choose Contributor MSA; contributor name, lab, signer name + email (required), template; no deal, no pricing. If that email already has a Signed/Out-for-Signature MSA the server refuses once with an amber "They already have an MSA" box and a "Create a second MSA anyway" override.
4. **Editor** (click the client name): payment schedule, start/end, signer name/title/email, OL countersigner (Admins only), scope/deliverables/timeline, pricing (not for MSA), Admin-only "Contributor" name/email on client paper. Saving a change to inherited scope/pricing returns 409 `needsDeviationAck`; the editor then shows what differs, asks "Why", and "Save as a declared deviation". Everything locks once Out for Signature or Signed.
5. **Send for signature** (the row's Next action). Toast says whether the email went. Server blocks with a plain-English "Before sending, add …" list (signer name, valid signer email, terms present, payment schedule for client paper, compensation + timeline for task orders, no unfilled `{{placeholders}}`). There is **no in-page readiness panel**; `signingReadiness()` exists but is only used by tests.
6. After send the row shows "Waiting on client". When the client has signed it shows **Countersign** to the named Admin, or "Waiting on {name}" to everyone else.
7. **Draft PDF / Executed copy** button (see Known issues re: auth).
8. **Invite contributor** (client paper, Signed, contributor email set): one-click invite via `POST /admin/invites`.
9. **New task order** appears on a Signed MSA row.

*Admin extras*: countersign; DocuSign card; naming a Contributor on client paper; linking a standalone contract to a deal is API-only (`PATCH /contracts/{id} {deal}`, no UI).

*Contributor*: read-only list of executed documents that name their email; Download PDF.

**3. Technically**

Frontend data: `PortalDataProvider` loads `GET /contracts` and `GET /proposals` (`lib/portal-data.tsx:145-148`).

Endpoints (router `app.mjs:502-517`):

| Method + path | Handler | Authorization |
|---|---|---|
| `GET /contracts` | `contracts.listContracts` | Contributor: only **Signed** docs where `clientSignerEmail` or `contributorEmail` == their email, plus task orders whose parent is theirs (`contributorVisible`). Others: `seesLab(lab)` or LL who is `owner`. |
| `POST /contracts` | `contractsCreate.createContract` | routes to `generateContract` (with `proposalId`), `createTaskOrder` (`docKind:"task-order"`), or `createStandalone` |
| `PATCH /contracts/{id}` | `contracts.updateContract` | Admin, or LL with lab/owner access (`canEdit`) |
| `POST /contracts/{id}/send-for-signature` | `signing.sendForSignature` | Admin, or LL with lab/owner |
| `POST /contracts/{id}/countersign` | `signing.countersign` | **Admin only**, and only the named `olSignatory` |
| `POST /contracts/{id}/pdf` | `ContractPdfFunction` (own Lambda) | Admin; LL with lab/owner; Contributor party (see Known issues) |
| `POST /contracts/{id}/docusign/resend`, `/void` | `docusign.*` | Admin / LL with lab/owner |

Creation details (`backend/src/contracts-create.mjs`):
* `generateContract` (`:406`): needs `ctx.can.editProposal`; `approvedSnapshot(p)` (409 if not customer-approved); one contract per proposal; `collapseToSelected` turns a chosen tier into a single flat line; stores `inherited {version, approvedAt, sections, pricing}` (frozen) plus live `sections`/`pricing`; template via `templateFor(lab,"contract")`; merges clauses; audit `contract.generated`.
* `createStandalone` (`:196`): Contributor refused (403); MSA with `dealId` refused; lab defaults from deal or the LL's first lab; soft duplicate-MSA block (409 `needsSecondMsaAck`); template by explicit `templateId` (kind-checked) else lab then OL-wide; an MSA also writes `contributorName/contributorEmail` from the signer; audit `msa.created`/`contract.created`.
* `createTaskOrder` (`:328`): parent must be a Signed `msa` you can edit (409 otherwise); copies counterparty and signer from the MSA; terms = a synthetic "Governing Agreement" clause referencing `{{msaId}}`/`{{msaDate}}` (MSA terms are incorporated by reference, not copied) plus the `task-order` template if any; audit `task-order.created`.

Update rules (`contracts.mjs:146-319`):
* Content keys (`sections, pricing, clauses, paymentSchedule, startDate, endDate, signer fields, olSignatory, deal`) are rejected with 409 unless status is Draft or Internal Review.
* `olSignatory` must be an `Admin` PERSON (FR13).
* `clauses` edit is Admin-only server-side, but **no UI edits clauses** (terms come only from templates).
* Status: LL may only set Draft/Internal Review; Admin may set any including `Signed` (manual wet-ink fallback; no UI for it). `Out for Signature` can only be reached via send.
* Deviations are computed on read (`deviationsOf`) and logged append-only (`deviationLog`, audit `contract.deviation`).
* Re-merges `{{placeholders}}` on every save via `templateVars`; unresolved list stored in `unresolvedVars`.

Records: `pk="CONTRACT"`, `sk` = `C-nnn` / `MSA-nnn` / `TO-nnn` (separate counters per kind). Key fields: `status` (`Draft`, `Internal Review`, `Out for Signature`, `Signed`, legacy `Sent`), `docKind`, `parentId`, `proposal`, `deal`, `lab`, `owner`, `inherited`, `sections`, `pricing`, `amount`, `clauses`, `unresolvedVars`, `paymentSchedule`, `startDate`, `endDate`, `clientSigner{Name,Title,Email}`, `contributor{Name,Email}`, `olSignatory`, `olSignatoryName`, `signToken`, `executionCopy`, `documentHash`, `signatures{client,ol}`, `signMethod`, `envelopeId`, `executedAt`, `executedFileId`, `pdfFileId`.

---

### 5. Pricing (components + `web/lib/pricing.ts` + `backend/src/pricing.mjs`)

**What it is**: structured pricing replaced free-text. Three shapes: `flat {amount,label,notes}`, `tiered {tiers[{id,name,amount,summary,recommended}],selected}`, `itemized {items[{description,qty,rate}],discount,notes}`; `null` = "not priced yet".

**Where it appears (live)**
* `PricingEditor` (`components/pricing-editor.tsx`): used in `NewContractDialog`, `NewTaskOrderDialog`, `ContractEditor`. Structure dropdown (Not priced yet / Flat fee / Packages to choose from / Line items), rows, discount, notes, live total.
* `PricingTable` (`components/pricing-table.tsx`): read-only table with total; interactive tier selection when `onSelectTier` is passed. Used by `/proposal-view` (interactive), `/contract-sign`, and `CountersignDialog`.
* `web/lib/pricing.ts` is the client twin of `pricing.mjs`: `pricingTotal`, `pricingLines`, `fmtMoney`, `pricingSummary`, `samePricing`, `emptyPricing`. Comment demands both be kept in step.

**Technically**
* `cleanPricing` validates (max 12 tiers, 40 items, amounts to $100M, rounding to cents, exactly one recommended tier, discount <= subtotal) and is the only gate on writes (`contracts.mjs`, `contracts-create.mjs`, `proposals.mjs`, `templates.mjs`).
* `pricingTotal`: tiered with no `selected` returns `null` ("pending selection"). `collapseToSelected` flattens a chosen tier when a contract is generated. `samePricing` compares figures only (ignores names/summaries/order) to drive deviation detection. `pricingDiffSummary` builds the banner text.
* A **third copy** of `pricingTotal/pricingLines` is embedded in `backend/src/pdf/index.mjs:53-76` because that Lambda has its own bundle. Three implementations must agree.
* No API route of its own.

---

### 6. Page: `/contract-sign?token=…` (public signing page) — native path

File: `web/app/contract-sign/page.tsx`. No login. Credential = 32-hex `signToken` minted at send time.

**1. What's on the page**
* Lab-colour strip, "Optimistic Labs · {Lab}", document title ("Services Agreement" / "Master Services Agreement" / "Task Order"), "{id} · between Optimistic Labs and {client}" (+ "issued under MSA-…").
* Payment schedule and Term fields, the six sections (pricing as table), "Terms and conditions" clauses, then the signing panel, then the SHA-256 "Document fingerprint".
* Panel states: sign form; "Signed by X, waiting on {OL signatory} to countersign" (the link will serve the executed copy later); "This agreement is fully executed" with **Download the countersigned PDF** (or "being prepared").

**2. How it works for the signer**
1. Open the emailed link. Page shows the frozen document (the stored `executionCopy`, not the live record).
2. Name and title are pre-filled and editable. Choose **Type it** or **Draw it** (pointer-event canvas, PNG).
3. Tick the consent checkbox (exact wording stored with the signature).
4. **Sign agreement**. Page reloads; status shows waiting for OL.
5. After the Admin countersigns, the same link shows the executed panel and downloads the PDF; the signer also gets an email with a presigned download link (valid 7 days).

**3. Technically**
* Routes (`template.yaml:557-571`, `SignGetRoute`/`SignPostRoute`, Authorizer NONE); regex dispatch `app.mjs:647-654`:
  * `GET /sign/{token}` -> `signing.signView` (document, hash, brand, signatures minus IP, `awaiting`, `signMethod`, `pdfReady`)
  * `POST /sign/{token}` -> `signing.signSubmit`
  * `GET /sign/{token}/pdf` -> `signing.signPdf` (409 until executed; 5-minute presigned S3 URL)
  * `GET /sign/{token}/docusign-view` -> `docusign.contractEmbeddedView` (DocuSign only)
* `signSubmit` checks: status must be `Out for Signature`; no client signature yet; **rejects if `c.envelopeId` is set** (DocuSign-routed); recomputes `hashOf(executionCopy)` against stored `documentHash` (409 if tampered); `readSignature` requires name, `consent === true`, type typed|drawn, drawn must be `data:image/png;base64` <= 120,000 chars.
* Stored `signatures.client`: `name, title, signatureType, signatureImage, consent, consentText, party, email, at, ip, userAgent, documentHash`. `ip`/`ua` come from `event.requestContext.http.sourceIp` / `user-agent` (`app.mjs:631`).
* Side effects: audit `contract.signed-by-client`; notify + email the OL signatory (`notifyCountersigner`).
* Tamper evidence: `hashOf` = SHA-256 of canonical JSON (sorted keys) of `executionCopy(c)`, which includes docKind, parentId, client, lab, sections, pricing, total, clauses, paymentSchedule, dates, signer name/title, proposal, approvedVersion (`signing.mjs:68-97`).
* Consent text is duplicated word-for-word in `signature-capture.tsx:173` and `signing.mjs:335`.

---

### 7. Send, countersign, execution, PDF (backend flow)

#### 7a. Send (`signing.sendForSignature`, `signing.mjs:101-212`)
1. Role: Admin, or LL with lab/owner.
2. Re-merges clauses; `requirements(c)` must be empty (400 listing what to add).
3. Picks OL countersigner: named `olSignatory`, else the `superAdmin` Admin, else the first Admin.
4. Writes `status "Out for Signature"`, `signToken`, `executionCopy`, `documentHash`, `olSignatory(+Name)`, `sentForSignatureAt/By`, `signatures {}`, `signMethod: "native"`.
5. If `docusign.isConnected()` -> DocuSign branch (section 9); otherwise continues natively.
6. Audit `contract.sent-for-signature`; in-app notification to the signer if their email belongs to a PERSON (`tellSigner`, kind `signature`, href `/contracts`).
7. Email to `clientSignerEmail` via `sendClientEmail` (SES) with `{FRONTEND_URL}/contract-sign.html?token=…`. Subject varies per kind ("Please sign: Optimistic Labs services agreement (X)" / "Master Services Agreement" / "Task Order TO-nnn"). Email failure does **not** undo the send; the UI toast reports it.

#### 7b. Countersign (`signing.countersign`, `:409-482`; UI `countersign-dialog.tsx`)
* Admin only; if `olSignatory` is set only that Admin may sign (403 otherwise). Requires the client signature first (409 "The client hasn't signed yet"), no existing OL signature, and a passing hash check.
* The dialog shows client signature, deviations, pricing table, payment schedule, a name/title + typed/drawn capture + consent, and the fingerprint. Button **Countersign and execute**.
* Record `signatures.ol` includes `verifiedAccount: ctx.me.sk` (authenticated attribution).
* Sets `status "Signed"`, `executedAt`, `signedAt`. Then, each wrapped so it cannot undo execution:
  1. `generateExecutedPdf` (invoke PDF Lambda directly, store `executedFileId`)
  2. `rollUpDeal`
  3. notify the contract `owner` (kind `executed`)
  4. `deliverCopies` (email)
  5. `inviteOnExecution` (MSA only)
* Audit `contract.executed`.

#### 7c. Execution (`backend/src/execution.mjs`)
* `generateExecutedPdf`: `lambda.InvokeCommand` on `PDF_FUNCTION_NAME` with `{direct:true, kind:"contracts", id, actor}`; writes `executedFileId` back.
* `rollUpDeal`: if the contract has a `deal`, writes `contractSigned: true`, `contractSignedAt`, `contract: <id>` and moves stage to **Contracted** unless already Closed / Closed Lost (writes the DEAL directly, bypassing `updateDeal` gates).
* `deliverCopies`: emails the client signer, OL signatory and contract owner "Fully executed: Optimistic Labs {title} ({client})" with a 7-day presigned PDF link (falls back to the signing link if no PDF).
* `inviteOnExecution`: for `docKind === "msa"` only, calls `admin.inviteContributor` (skips if already a member), audit `contributor.invited`. Task orders do not invite.

#### 7d. PDF Lambda (`ContractPdfFunction`, `backend/src/pdf/index.mjs`)
* Separate function: `CodeUri: src/pdf/`, **x86_64**, 2048 MB, 28 s, puppeteer-core + `@sparticuz/chromium`, env `TABLE_NAME`, `FILES_BUCKET`.
* Two entries: HTTP (`POST /contracts/{id}/pdf`, `POST /proposals/{id}/pdf`; `template.yaml:352-364`) and **direct invoke** (`event.direct === true` and no `requestContext`), which is IAM-gated and skips identity checks.
* Draft render uses the live record; once `Signed` with an OL signature it renders the frozen `executionCopy`, shows the drawn/typed signatures, and appends a **Signature audit certificate** page (doc id, SHA-256, executed time, per-party name, email, time, method, IP, device, authenticated account, consent text). DocuSign signatures print "Signed via DocuSign" and point to DocuSign's own certificate.
* Output: S3 `contracts/{id}/{name}.pdf`; `FILE` record `F-PDF-{id}` (draft, overwritten in place) or `F-PDF-{id}-EXECUTED`; tagged with `contributorEmail` so a Contributor can find it; writes `pdfFileId` / `executedFileId` back to the CONTRACT.
* The frontend then calls `GET /files/{fileId}/download` (5-minute presigned URL, `app.mjs:377`, subject to `canSeeFile`) and `window.open`s it.

---

### 8. Page: `/templates` (Admin)

File: `web/app/(portal)/templates/page.tsx`. Non-Admins see "Templates are managed by Admins." (UI gate only; see note below).

**1. What's on the page**
* Title, an amber warning if no **contract** template exists ("cannot be sent for signature").
* Five tabs: **Contract terms**, **MSA terms**, **Task order terms**, **Proposal starts**, **Content blocks**. Each has "New …" and cards (name, lab badge or "All labs", Inactive badge, clause/section count, Edit, Delete).
* Dialog: name, lab (or All labs / OL master), Active toggle; clause editor (heading + text, add/remove) listing the 18 placeholders: `client clientSigner clientSignerTitle contributor contributorSigner contributorSignerTitle lab labLeader olSignatory contractId total paymentSchedule startDate endDate dealId msaId msaDate today`.

**2. How it works (Admin)**: create/edit/delete templates. Lab-specific templates win over OL-wide ones for that lab. Deleting is immediate with no confirm dialog.

**3. Technically** (`backend/src/templates.mjs`; routes `app.mjs:518-521`)
* `GET /templates`: any role (Admin sees all; others see OL-wide or their labs). `POST/PATCH/DELETE`: **Admin only**. Audit `template.created|updated|deleted`. Records `pk="TEMPLATE"`, `sk="T-nnn"`; `kind` in `proposal | block | contract | msa | task-order`; `active`; optional `lab`.
* Clause kinds need 1-60 clauses. `templateFor(lab, kind)` returns lab template, else OL-wide, active only. `mergeClauses` leaves unresolved `{{x}}` visible and returns the list (blocks sending). Merge happens at creation and on every contract save/send.
* **What actually consumes templates today**: `contract`, `msa`, `task-order` clause templates (contract creation + `NewContractDialog` picker, which calls `GET /templates`). **Proposal starts** are only consumed by `POST /proposals {templateId}` (API-only now) and **content blocks** by nothing (no drafting UI). Those two tabs can be edited but have no live downstream effect.
* Note: because `GET /templates` has no role check, a Contributor calling the API directly could read OL-wide clause text.

---

### 9. DocuSign (embedded signing) — conditionally live, opt-in, sandbox-configured

I could not verify runtime state (SSM `/ol-portal/docusign-credentials`, DynamoDB `DOCUSIGN/CONFIG`). Facts from code:

* Deployed: routes `GET /docusign/callback` and `POST /docusign/webhook` (`template.yaml:578-592`, Authorizer NONE); env `DOCUSIGN_CREDS_PARAM=/ol-portal/docusign-credentials`, **`DOCUSIGN_ENV: demo`**, redirect and webhook URLs hard-coded to the API host (`template.yaml:443-446`); IAM read of the SSM param (`:470`).
* `docs/pipeline-v2.md:160-168` says the DocuSign backend shipped with the first deploy after 2026-08-22 and is "inert" until the SSM credentials exist. The deploy workflow auto-deploys on every push to `backend/**`, so it is in production code.
* **Activation is two-step and runtime-only**: (1) SSM JSON `{integrationKey,userId,privateKey,impersonatedUserEmail,hmacKey}` exists; (2) an Admin clicks **Connect to DocuSign** on `/contracts` and completes consent, which stores `DOCUSIGN/CONFIG {connected:true, accountId, apiBase}`. Until then `/docusign/status` returns `configured:false` and the card says "Not configured yet".
* With `DOCUSIGN_ENV=demo` the OAuth and API hosts are `account-d.docusign.com` (developer sandbox). A connected production deployment would therefore be sending **sandbox envelopes**; going real requires changing that env var in `template.yaml` and redeploying (it is not a parameter).
* **Native signing is the default and the only path guaranteed to work.**

If connected, how it behaves:
* `sendForSignature` calls `docusign.sendContractEnvelope` (`docusign.mjs:332`): renders the unsigned PDF through the PDF Lambda (anchors `[[ds_sig_client]]`, `[[ds_date_client]]` hidden as 1 px white text, `pdf/index.mjs:219-229`), reads it from S3, creates an envelope with one **embedded** signer (`clientUserId = contract-{id}`, `status: "sent"`), stores `ENVELOPE#<envelopeId>` and sets `envelopeId`, `signMethod: "docusign"` on the contract. If envelope creation fails the contract reverts to its pre-send state and returns 502 (no silent fallback to native).
* The client still gets the same OL email link. `/contract-sign` sees `signMethod: "docusign"`, renders `EmbeddedSigningFrame` (an iframe on a fresh one-time URL from `GET /sign/{token}/docusign-view`, and polls `GET /sign/{token}` every 4 s).
* DocuSign Connect webhook (`docusign-webhook.mjs`): verifies HMAC-SHA256 over the raw body (`X-DocuSign-Signature-n`, fail-closed), de-dupes via `WEBHOOK_EVENT` (20-day TTL), updates the ENVELOPE record; on `completed` writes `signatures.client` with `signatureType: "docusign"` (no IP/UA/consent text) and emails the OL signatory. OL's countersignature, execution and PDF stay native.
* Admin / LL extras on the Contracts table for a DocuSign contract waiting on the client: **Resend** (`PUT …?resend_envelope=true`) and **Void** (voids the envelope and reverts the contract to Internal Review).
* Webhook auto-registration is best-effort at connect time (`registerConnectWebhook`).
* Tests: `backend/tests/docusign.test.mjs` covers only HMAC verification and the dedupe key (header also mentions "PDF anchor placement", which is not tested).

---

### 10. Page: `/invoices` and recurring billing

File: `web/app/(portal)/invoices/page.tsx`.

**1. What's on the page (live)**
* Title "Invoice requests" and an explanatory sentence. Card "Recent requests": search (client or requester), filters (Lab, Status, Cadence), sortable columns Client (with `INV-R-nnn` and deal id), Lab, Requested by, Amount, Cadence (Recurring/One-time), Status badge, Date. For Admin each non-final row has a **Mark sent to client** / **Mark paid** button.
* **Admin only:** a **QuickBooks card** and a footnote about "PRD Option A". The card is inert; see the dormant section.

**2. How it works by role**
* **Admin**: reviews the queue and advances `Admin review -> Sent to client -> Paid` (the UI never offers `Overdue`, although the API accepts it).
* **Lab Leader**: redirected to `/pipeline` (`invoices/page.tsx:351-353`). The Lab Leader "Request invoice" action that this relies on **no longer exists in the Pipeline UI**.
* **Contributor**: sees an empty table (backend never returns invoices to them, `listScoped` returns `[]`).
* Reachable only by URL, or via a Pipeline document card "Open on Invoice Requests →" for invoice rows that have no deal.

**3. Technically**
* `GET /invoices` -> `listScoped(ctx,"INVOICE", i => LL && i.requestedBy == me)` (`app.mjs:482-483`): Admin sees all; LL sees their labs plus ones they requested; Contributor `[]`.
* `PATCH /invoices/{id}` `{status}` -> `updateInvoice` (`app.mjs:317`): **Admin only** (`ctx.can.reviewInvoices`), status must be one of `Admin review | Sent to client | Paid | Overdue`. No emails, no accounting side effects.
* `POST /invoices` `{dealId, recurring}` -> `createInvoice` (`app.mjs:300`): LL/Admin with `editDeal`; amount = `deal.amount` or `deal.amount/12` if recurring; id `INV-R-nnn`; status `Admin review`. **No UI calls this** (verified: only `portal-data.tsx` GET and the Admin PATCH reference `/invoices`).
* Records: `pk="INVOICE"`, `sk="INV-R-nnn"`: `deal, client, lab, amount, requestedBy, date, recurring, status` (+ `month`, `auto` when created by the recurring job).
* **What "invoices" means for the pipeline today**: the actual gate is a file. `updateDeal` refuses moving a deal to `Closed` unless a `FILE` with `deal == id && kind == "invoice"` exists (`app.mjs:274-282`), mirrored in `deal-drawer.tsx:162-190`. Invoices are produced outside the portal and uploaded in the Pipeline deal drawer (`document-upload-panel.tsx` via `POST /files` + presigned S3 PUT, `lib/uploads.ts`).
* Invoice requests and uploaded invoice files are shown side by side as "Invoices" cards in the Pipeline Documents grid (`components/pipeline/documents-grid.tsx:290-340`).

#### 10a. Recurring billing (`backend/src/recurring.mjs`) — scheduled, effectively inert
* Wired: `RecurringFunction` with `Schedule: cron(15 6 * * ? *)` daily, 06:15 UTC (`template.yaml:301-319`).
* It writes a `RECUR` row `R-{deal}-{YYYY-MM}` (idempotent) for every deal with `recurring`, stage Contracted or Closed, not `recurPaused`, within `recurEnd`. Amount = `round(deal.amount / 12)`.
* It creates an `INVOICE` row only if `deal.autoInvoice` is true. **No UI sets `autoInvoice`** (it is only in the allow-list in `app.mjs:204`). So in practice only `RECUR` rows are written, and nothing in `web/` renders them (`portal-data.tsx` fetches `GET /recurrences` but no page uses the data).
* User-facing recurring controls that do exist: deal drawer "Recurring engagement — bills monthly" checkbox and Pause/Resume (`deal-drawer.tsx:569-584`), which set `recurring`/`recurPaused`. `POST /recurrences/run` (Admin) exists with no UI.

---

### 11. Email / notification touchpoints (all via SES, `backend/src/email.mjs`)

Sender logic: if the sender's address ends with `@optimisticlabs.com` the mail is `From: "Name <their address>"`; otherwise `Optimistic Labs <hello@optimisticlabs.com>` with Reply-To = sender. System mail uses `no-reply@optimisticlabs.com`. All links built from `FRONTEND_URL = https://portal.optimisticlabs.com` + `.html` paths.

| Trigger | To | Subject / content | Code |
|---|---|---|---|
| Send proposal with `sendEmail` (API-only) | customer | "Your proposal from Optimistic Labs: {title}" (or "Updated proposal…") + `/proposal-view.html?token=` | `proposals.mjs:242-262` |
| Customer opens proposal (first time) | proposal owner | "[OL Portal] {client} opened your proposal" | `:343` |
| Customer approves / declines / requests changes | proposal owner | "[OL Portal] {headline}" | `:458-464` |
| Send contract for signature | client/contributor signer | "Please sign: …" + `/contract-sign.html?token=` | `signing.mjs:191-204` |
| (same) | in-app bell for signer if they have a PERSON account | "sent you {Contract/MSA/Task Order} {id} to sign" | `tellSigner` |
| Client signs | OL signatory | email "[OL Portal] Countersignature needed: …" + bell | `notifyCountersigner` |
| DocuSign client completes | OL signatory | same email (no bell) | `docusign-webhook.mjs:75` |
| Countersign / execution | contract owner (bell, not if they signed) | "countersigned … fully executed" | `signing.mjs:464` |
| Execution | client signer, OL signatory, owner | "Fully executed: Optimistic Labs {title} ({client})" + 7-day PDF link | `execution.mjs:196` |
| Executed MSA | Contributor | portal account invite (Cognito/WorkOS provisioning) | `inviteOnExecution` -> `admin.inviteContributor` |

Audit trail (`pk="AUDIT"`, 90-day TTL): `proposal.*`, `contract.generated|created|deviation|sent-for-signature|signed-by-client|executed|signed`, `msa.created`, `task-order.created`, `template.*`, `docusign.*`, `contributor.invited`.

---

## 05 · Resources, The Optimist, Admin

Scope: `/resources` (library + courses), `/courses` and `/library` redirects, `/optimist`, `/admin`.
Repo state read: `main` @ 017389f (2026-10-01). Live = `web/` (static export via `amplify.yml`) + `backend/` (SAM, `AuthProvider=workos` per `.github/workflows/deploy-backend.yml:84-85`).

Conventions: "Role" is `Admin`, `Lab Leader` or `Contributor`. DynamoDB is one table, `ol-portal`, keys `pk`/`sk`, TTL attribute `ttl` (`template.yaml` PortalTable). All API calls go to the HTTP API (`ApiFunction`, `app.handler`) with `Authorization: Bearer <WorkOS access token>` and, while impersonating, `x-act-as`.

---

### 1. RESOURCES (`/resources`)

Nav: "Resources" is one of the three top-nav pills (`web/components/shell/top-nav.tsx:46`). Visible to all roles.

#### 1.1 Page structure: one route, five screens

`web/app/(portal)/resources/page.tsx` is a single client component. The screen is picked from the query string (so every screen is deep-linkable under the static export). Navigation is `router.replace('/resources' + query)` (page.tsx:129-132).

| URL | Screen |
|---|---|
| `/resources` | Library home: Continue card, first 3 courses, filter sidebar plus first 6 resources |
| `/resources?browse=resources` | All resources, grouped by tag |
| `/resources?browse=courses` | All courses, grouped by lab |
| `/resources?r=RS-001` | Resource screen |
| `/resources?c=C-001` | Course screen |

Precedence in code: `?r` first, then `?c`, then `?browse`, otherwise library home.

`/library` and `/courses` are pure client-side redirects that preserve the deep-link param (`library/page.tsx:20` maps `?r=` to `/resources?r=`; `courses/page.tsx:20` maps `?c=` to `/resources?c=`). Any other query string is dropped. They render "Taking you to Resources…" until `router.replace` runs. They are not in the nav; they exist so old links keep working. Nothing else in `web/` links to them.

#### 1.2 (1) What is on the page

**Library home**
- Header "Resources and courses" with the Admin-only author buttons (Admin only, see below).
- "Continue where you left off" violet banner (`ContinueCard`): the *published* course with the most steps viewed that is neither 0% nor 100% done (`continueCourse()`, `lib/resources-view.ts:49-62`). It shows the next unviewed step title and a "Resume course" button. No started course means no banner.
- "Courses and guides" section: first 3 courses (`courses.slice(0,3)`), each a `CourseCard` (cover or violet block labelled "Course", Draft badge if draft, description, "N steps · M min", and a progress string: "Not started", "X of N viewed", "All steps viewed", "No steps yet"). "View all" goes to `?browse=courses`.
- "Resources" section: left filter aside (`FilterAside`): type list with counts (All, File, Post, Video) and tag chips (toggle). Right side: search box (matches title, description and tags) and first 6 matches as `ResourceCard`s (3:2 cover or a violet block labelled with the file extension, type kicker, Draft and "Course only" badges, title, description, lab name, meta such as "PDF · 2.1 MB", "Post" or "10 min"). "Showing N of M" and "View all" go to `?browse=resources`.
- Empty states differ by role: Admin sees "Build the first one" and "Write the first post or upload a file"; others see "No courses have been shared with you yet" and "Nothing has been shared with you yet".

**Browse all** (`?browse=…`): a Resources / Courses-and-guides pill switch, count, then a filter card. The resources tab has Type chips, Tag chips and search. The courses tab has search by title only. Resources are grouped by *tag*, so an item with several tags appears under each, and untagged items go under "Everything else". Courses are grouped by lab name ("All labs" when unset). Grouping is a front-end choice (`groupBy`, resources-view.ts:68-90). There is no topic field.

**Resource screen** (`ResourceScreen`)
- Banner "This is a step in <courses>" with an "Open course" button, but only if the resource is in a course the viewer can open. Only the first course is linked.
- Description, then the content via `ResourceViewer`:
  - Post: rendered markdown (`lib/markdown.tsx`).
  - File: header with extension chip and name; PDFs get an inline `<iframe>` preview (60vh); all files get a Download button; the "can't be previewed" note shows for non-PDFs.
  - Video: `VideoPlayer`, plus a collapsible Transcript if one exists.
- Tag pills.
- Sticky aside: Details (Type, Lab, Published date, Downloads for files, Access label), Related (just the first 3 *other* visible resources, not a relevance match), and an Admin-only box with "Edit resource" and "Delete".
- Not found or no access shows "This resource is no longer available, or you do not have access to it."

**Course screen** (`CourseScreen`, fed by `CourseRoute`)
- Cover (260px) or title, description, a "Steps" card. Each step shows a checkbox, number, resource title, type, optional note, and a Watch / Read / Open button ("Unavailable" if the resource is gone or hidden).
- Footer line says "Free navigation…" or "Linear: each step unlocks the next."
- Aside "About this course" (estimated time, step count, lab, navigation, access label) with a "Start course" or "Resume at step N" button.
- Admin box "You published this" with "Edit steps" and "Delete".

**Authoring (Admin only)**: four always-visible pill buttons on the library and browse headers: "Write a post", "Upload a file", "Add a video", "New course" (page.tsx:207-216). They open `ResourceEditor` or `CourseEditor` dialogs. Edit and Delete live on the resource and course screens, not on the cards.

**Resource editor** (`components/resource-editor.tsx`, one dialog for all types)
- Title (200 chars), Description (2,000 chars with a counter), cover image (picked then centre-cropped to 3:2 and JPEG-compressed to under 110k chars by `readCover`, `lib/photo.ts`).
- Post: Write/Preview tabs, markdown textarea, "Insert image" button (PNG/JPEG/WebP/GIF up to 8 MB). Embedded image markers are `![alt](embed:pending:token)` until save. `@[resource](RS-003)` on its own line embeds another resource inline.
- Video: source select ("Link to YouTube, Vimeo, or Loom" or "Upload a video file"), link field, optional length in minutes, optional transcript.
- File or uploaded video: file chooser (PDF/PPTX/DOCX up to 50 MB; MP4/WebM/MOV up to 500 MB).
- Audience (Lab Leaders and Contributors / Lab Leaders only / Contributors only), Lab (All labs or one), "Where it appears" (Resource Library and courses / Inside courses only), Tags (comma-separated, max 10, lowercased).
- Footer: Cancel, "Save as draft", "Publish". Draft and Publish both write the record; they only differ in `status`.

**Course editor** (`components/course-editor.tsx`)
- Title, description, audience, lab, navigation (Free or Linear), estimated minutes, cover (`readPhoto`, max 800px JPEG, a separate code path from resource covers).
- Step list: add a resource from a dropdown listing *all* resources including drafts (drafts are flagged); per-step note (1,000 chars); reorder by drag or by up/down buttons; remove. Publishing needs at least one step.
- Draft or Publish, as above.

#### 1.3 (2) How it works for the end user

**Lab Leader / Contributor (read-only consumers)**
1. Click Resources in the nav. The page loads resources, courses and the learner's progress.
2. Browse. Search, or filter by type or tag (filters are client-side). Click a card.
3. Post: read it. File: PDFs preview inline; click Download to open a short-lived link in a new tab. Video: embedded YouTube/Vimeo/Loom, or an uploaded file played in a native player.
4. Course: open a course card, then click Watch / Read / Open on a step. This opens the *resource screen* (`?r=`), not an in-course player. Clicking the button first records the step as viewed. The checkbox beside each step also records it.
5. In a Linear course, step N's button and checkbox are disabled until step N-1 is viewed. This is a UI nicety only.
6. Back to the library with the "Back" link. Note this goes to the library home, not back to the course.

What they see is filtered server-side: only Published items; audience matches their role; if the item has a lab, they must be in that lab; "Inside courses only" items are hidden from the library list.

**Admin**
- Sees everything including Drafts, all audiences, and course-only items.
- Write a post: "Write a post", type, optionally insert images, Publish (or Save as draft).
- Upload a file or video: pick the file, Publish. The record is created first, then the browser PUTs bytes directly to S3 (see 1.4). If the upload fails, a record is already saved, so there is a visible item to retry.
- Add a video by link: paste a YouTube, Vimeo or Loom URL; the server rebuilds a safe embed URL.
- Build a course: "New course", add steps, set navigation, Publish.
- Edit or delete from the resource or course screen. Deleting a resource that any course still uses is refused with 409 (and a message naming the courses). Deleting a course leaves its resources.
- While an Admin is "acting as" another user, the Admin controls disappear (role is the target's) and the Admin sees what that person sees.

#### 1.4 (3) How it works technically

**Frontend files**
- `web/app/(portal)/resources/page.tsx` (router, filters, data fetch, delete confirm, `CourseRoute` sub-component).
- `web/components/resources/{cards,chrome,panels,course-screen,resource-screen,post-image}.tsx` (presentation).
- `web/components/{resource-editor,course-editor,resource-viewer,video-player}.tsx`.
- `web/lib/resources-view.ts` (meta strings, progress wording, `continueCourse`, `groupBy`), `web/lib/markdown.tsx` (renderer), `web/lib/photo.ts` (image resize), types in `web/lib/types.ts:599-703`.
- Data is fetched once on mount (page.tsx:110-127) via `api()` from `lib/api.ts`: `GET /resources`, `GET /courses`, `GET /progress`. After create/edit/delete the page patches local state rather than refetching.
- The resource screen finds the resource only inside the already-fetched `GET /resources` array (page.tsx:274). It never calls `GET /resources/{id}` (see Issues).
- The course screen calls `GET /courses/{id}`, then `POST /courses/{id}/progress` with `{stepId}` on step open or checkbox.

**API endpoints** (router `backend/src/app.mjs:522-543`; JWT-authorised like every other route)

| Method + path | Handler (`resources.mjs` / `courses.mjs`) | Who |
|---|---|---|
| GET `/resources` | `listResources` | any signed-in role, filtered by `canSee` |
| GET `/resources/{id}` | `getResource` | `resourceAccess`. **Not called by the live UI** |
| POST `/resources` | `createResource` | Admin |
| PATCH `/resources/{id}` | `updateResource` | Admin |
| DELETE `/resources/{id}` | `deleteResource` | Admin; 409 if used by a course |
| GET `/resources/{id}/download[?disposition=inline]` | `downloadResource` | `resourceAccess`; returns `{url}` presigned S3 GET (300 s attachment, 3,600 s inline) |
| POST `/resources/{id}/images` | `addPostImage` | Admin; posts only; returns `{fileName, uploadUrl}` |
| GET `/resources/{id}/images/{fileName}` | `getPostImage` | `resourceAccess`; returns `{url}` presigned GET (3,600 s) |
| GET `/courses` | `listCourses` | `canSee` |
| GET `/courses/{id}` | `getCourse` | `canSee`; returns course + resolved `resources` + this user's `viewed` |
| POST `/courses`, PATCH/DELETE `/courses/{id}` | `createCourse`, `updateCourse`, `deleteCourse` | Admin |
| GET `/progress` | `listProgress` | caller's own rows only |
| POST `/courses/{id}/progress` | `markStepViewed` | `canSee` the course; body `{stepId}` |

**DynamoDB entities**
- `pk=RESOURCE, sk=RS-nnn` (id from `nextId`). Fields: `type` (file|post|video), `title`, `description`, `tags[]`, `lab`, `permission` (lab_leaders|contributors|both), `visibility` (library|course-only), `status` (Draft|Published), `thumbnail` (data URL up to 120k chars), `author`, `created`, `updated`, `publishedAt`. Type-specific: `body` (up to 100,000 chars), `key` (S3 key, never sent to the client), `fileName`, `size`, `mime`, `downloads` (atomic `ADD` counter), `source` (upload|embed), `provider`, `embedId`, `embedUrl`, `duration`, `transcript` (up to 200,000 chars), `images[]` (S3 keys of inline post images). `publicView` strips only `pk`, `sk`, `key`, so `images[]` S3 keys are sent to clients in the list payload (low risk, the bucket is private).
- `pk=COURSE, sk=C-nnn`: `title`, `description`, `cover` (data URL), `estimatedMinutes`, `lab`, `permission`, `navigation` (free|linear), `status`, `steps[] {id, resource, note}` embedded (max 100), `nextStep` counter, `author`, dates.
- Step ids (`s1`, `s2`, …) are stable. A step keeps its id (and everyone's progress) only if it still points at the same resource; repointing it mints a new id (`buildSteps`, courses.mjs:~180).
- `pk=PROGRESS#<username>, sk=<courseId>`: `{viewed: {stepId: ISO time}, updated}`. First view only is stored. There is no un-view endpoint.
- Counters via `nextId("RESOURCE","RS-")` and `nextId("COURSE","C-")`.
- Audit rows (`pk=AUDIT`): `resource.created/updated/deleted`, `course.created/updated/deleted` (not written for image adds or progress marks).

**S3** (bucket `ol-portal-files-<account>`, private, CORS PUT/GET for the portal origins; `FILES_BUCKET` env on `ApiFunction`)
- Attachments: `resources/<RS-id>/<sanitised file name>`; inline post images: `resources/<RS-id>/images/<timestamp>-<name>`.
- Two-step upload: the API validates name, size (1 byte to 50 MB for docs, 500 MB for video, 8 MB for images) and returns a 15-minute presigned PUT with `ContentLength` pinned; the browser PUTs straight to S3. Only mime-type is client-declared (the editor's `accept` attribute is the only file-type restriction; the server does not check extension for resources).
- The `AnalyzerFunction` S3 trigger is filtered to the `uploads/` prefix, so resource files are not AI-analysed (`template.yaml` AnalyzerFunction Events).
- Replacing a file with a differently-named one deletes the old object; switching an uploaded video to an embed deletes the file; deleting a resource deletes the file and images (best-effort).

**Access rules** (`resources.mjs`)
- `canSee(ctx, r)`: Admin sees all. Others need `status==Published`, audience match (`lab_leaders` needs Lab Leader, `contributors` needs Contributor, `both` passes), and, if `r.lab` is set, membership of that lab (`ctx.me.labs`).
- `listResources` additionally hides `visibility==course-only` from non-Admins and attaches `courses[]` back-links (only courses the viewer can see).
- `resourceAccess` (used by download, image and single-get): `canSee`, or the item is Published and sits in a course the viewer can see (the course's audience overrides the item's own audience).
- `getCourse` returns step resources for the course's audience (draft/unpublished ones dropped for non-Admins). Linear navigation is not enforced server-side (stated in the code).
- Embeds: `parseEmbed` accepts YouTube (watch, embed, shorts, live, youtu.be), Vimeo and Loom URLs, extracts the id and rebuilds the iframe URL (`youtube.com/embed/<id>?enablejsapi=1&rel=0`, `player.vimeo.com/video/<id>`, `loom.com/embed/<id>`).
- Markdown renderer never uses `dangerouslySetInnerHTML`; links limited to http/https/mailto, images to https/`data:image/`, `embed:name` images resolved via `ResourcePostImage` (fresh presigned GET on every mount).

**Video completion (what the code actually does)**
`VideoPlayer` measures 95% (HTML5 `timeupdate`, YouTube IFrame API polled each second, Vimeo `postMessage` `timeupdate`; Loom gets a manual "Mark as watched" button). It calls `onWatched`, but the page never passes an `onViewed` to `ResourceScreen` (page.tsx:293-305), so those callbacks go nowhere. Course progress is actually recorded when the learner clicks the step's Watch/Read/Open button or ticks the checkbox (`CourseRoute.markViewed`). See Issues.

**Related**: `ResourcePostImage` and `VideoPlayer` are only mounted through `ResourceViewer`. YouTube loads `https://www.youtube.com/iframe_api` lazily.

**External services**: S3 (presigned URLs), YouTube/Vimeo/Loom iframes. No AI.

**Tests**: `backend/tests/resources.test.mjs` (158 lines, 12 tests): types creatable, bad type refused, Admin-only publish, post body create/preserve/rewrite, no file needed for post, audience visibility (`canSee`), description cap (2,000 refused not truncated), file upload metadata validation, embed parsing. No tests for courses, progress, `resourceAccess`, `deleteResource` or S3 paths.

#### 1.5 Help touchpoint
`HelpWidget` (`web/components/shell/help-widget.tsx`, mounted in `portal-shell.tsx:58`) is a "?" floating button on every portal page. It POSTs `/help/assist` (`guides.helpAssist`), answered by `claude-sonnet-5` using role-filtered `GUIDE` records (`pk=GUIDE`, seeded from `backend/scripts/seed-guides.mjs`). The guide for this area is stale: it has pages `library` and `courses` (seed-guides.mjs:304,331) that describe "+ New Resource", a course "player with Previous and Next", and "a step marks itself viewed automatically". There is no `resources` guide. The widget keys its "you're on the X page" line on the first URL segment, so on `/resources` it shows the generic subtitle. The assistant itself still sees those two stale guides when answering.

---

### 2. THE OPTIMIST (`/optimist`)

#### 2.0 Reachability
`/optimist` is **not linked from anywhere in the live UI**. Verified: nav `PRIMARY` has only Community, Pipeline, Resources (top-nav.tsx:43-47); the avatar menu has only Your profile, Admin (Admin role) and Sign out (top-nav.tsx:221-240); a repo-wide search for `href`/`push` to `/optimist` finds none (the only importer is the dev harness). `OptimistIcon` is exported from `portal-icons.tsx:59` but is not imported anywhere. It is reachable only by typing the URL (the page is under `app/(portal)`, so it is real in the production export and gated by sign-in). The Help guide text for it exists (`seed-guides.mjs:137`, roles Admin, Lab Leader).
Requires `NEXT_PUBLIC_OPTIMIST_URL` (`web/lib/config.ts:9`, `.env.example:22`) to be set in the Amplify build env, which is the `OptimistUrl` stack output. I could not verify it is set. If empty the page shows "The Optimist is not configured for this environment yet." on first send. `/dev/optimist` is a click-test harness that 404s in production builds (`app/dev/_harness.tsx:40`).

#### 2.1 (1) What is on the page
Two states on one route (`optimist/page.tsx`): landing and conversation.
- **Landing**: eyebrow, headline "What are we building today?", subcopy, composer, and five quick-start chips: Draft a funder update, Summarize the pipeline, Find someone on the bench, Prep a kickoff agenda, Turn notes into a proposal. Clicking a chip sends its prompt immediately (`lib/optimist.ts` `STARTERS`; the funder-update and bench prompts hard-code "Grace Network" and "faith-based grant" examples).
- **Composer** (`components/optimist/composer.tsx`): auto-growing textarea (max 220px), Enter sends and Shift+Enter adds a line; Attach (paperclip) for a PDF, TXT, MD, CSV, PNG or JPEG under about 4 MB (client cap 4,125,000 raw bytes, with a toast above that); one attachment at a time, shown as a removable chip; a dashed "scope" pill that opens a menu of "All labs" plus labs the user can see (`can.seesLab`); a Send button (animated while busy); in a conversation also a "New chat" button.
- **Conversation**: user turns as right-aligned violet bubbles; assistant turns as full-width plain text with avatar. Three-dot "thinking" indicator until the first token; a blinking caret while streaming. Plain text only, whitespace preserved (no markdown rendering; the system prompt forbids markdown). Under a finished answer: Copy, Retry, Share. Footer text "The Optimist can be wrong. Check anything that leaves the Portal."
- **Errors**: inline red notice under the failed turn; the user's message is restored into the composer.
- **Contributor view**: a plain notice "The Optimist is available to Optimistic Labs staff…" (page.tsx:178-189).

#### 2.2 (2) How it works for the end user
1. Sign in as Admin or Lab Leader and go to `/optimist` by URL.
2. Optionally choose a scope (a lab). Optionally attach a file. Type a question or click a chip.
3. A "thinking" indicator appears while the assistant reads portal data; text then streams in word by word. (The live "tool" events are sent by the server but the UI ignores them, so users never see what is being looked up.)
4. Ask follow-ups in the same thread (the server keeps the conversation). "New chat" starts a fresh server conversation id.
5. Copy puts the answer on the clipboard. Retry re-asks the same question and discards that answer and everything after it. "Share" does **not** share the answer: it just opens the Messages panel (`useMessages().openList`, `turn.tsx:76`).
6. Refreshing the page loses the visible thread: there is no conversation list or reload UI (the server stores transcripts, see below, but nothing in the live UI reads them back).

Role differences:
- **Admin**: everything the tools allow, across all labs; scope menu lists all labs.
- **Lab Leader**: only their labs plus deals they lead (see 2.4); scope menu lists their labs only.
- **Contributor**: blocked at the page by a client-side check only. The backend does not refuse them (see Issues); a Contributor who called the Function URL directly would get answers limited as in 2.4.
- **Acting as**: the `x-act-as` header is forwarded, so the Optimist runs as the target user; the conversation is stored under the target's key, and the audit row names the real Admin.

#### 2.3 (3) How it works technically

**Frontend**: `web/app/(portal)/optimist/page.tsx`, `components/optimist/{composer,turn,icons,mark}.tsx`, `lib/optimist.ts`. This is the only code that bypasses `lib/api.ts`: `streamOptimist()` does a raw `fetch` POST to `CONFIG.optimistUrl` (the Lambda Function URL, a different origin), with `Authorization: Bearer <token>` and optional `x-act-as`, then reads `res.body.getReader()` and parses newline-delimited JSON.
Request body: `{message, scope, conversationId?, attachment?{type,data(base64),name}, historyLength?}`.
Events: `meta{conversationId}`, `tool{name}`, `text{v}`, `done{conversationId}`, `error{v}`. A 401 calls `endSession()`.

**Endpoint**: `OptimistFunction` (`template.yaml:375-415`): `ol-portal-optimist`, handler `optimist-stream.handler`, arm64, 1024 MB, 300 s timeout, `FunctionUrlConfig` with `AuthType: NONE`, `InvokeMode: RESPONSE_STREAM`, CORS POST from `portal.optimisticlabs.com`, the Amplify default domain and localhost, allowed headers `authorization, content-type, x-act-as`. Output `OptimistUrl`.

**Auth** (`optimist-stream.mjs` `validate()`): Function URLs have no authorizer, so the handler does it all: POST only (405); body limit 6,000,000 bytes (413); bearer token verified by `verifyWorkosToken` (`authz.mjs`: `jose` remote JWKS at `https://api.workos.com/sso/jwks/<client id>`, issuer `https://api.workos.com/user_management/<client id>` plus `WORKOS_TOKEN_ISSUER`); under WorkOS also `sessionVerified(sid)` (the emailed-code second factor, `MFA` rows) else 403; then `identityFromClaims` and `buildContext` (same permission matrix, same offboarded-user and act-as rules as the API). Errors before the stream opens return real status codes; later errors are `error` events. The template comments still say "Cognito ID token"; the code branches on `AUTH_PROVIDER`, and the deployed value is `workos`.

**Model / provider / credentials** (verified, not guessed):
- Provider: **Anthropic API directly** via `@anthropic-ai/sdk` (`optimist.mjs:36-47`). **No Bedrock** anywhere (no `bedrock` references, no Bedrock IAM policy in `template.yaml`).
- Model: `claude-sonnet-5` (`optimist.mjs:49`; also hard-coded in `guides.mjs` for the help widget).
- Authentication: API key stored in SSM Parameter Store as `/ol-portal/anthropic-api-key` (SecureString), read at cold start with `GetParameter` + `WithDecryption`, cached in module memory (`client()`). Function IAM: `SSMParameterReadPolicy ol-portal/anthropic-api-key`, `DynamoDBCrudPolicy`. The same key is used by `ApiFunction` (help widget) and `AnalyzerFunction`.
- Call shape: `messages.stream` with `max_tokens: 4000`, `thinking: {type:"adaptive"}`, `output_config.effort: "medium"`, system prompt marked `cache_control: ephemeral`, up to `MAX_TOOL_ROUNDS = 6` model/tool loops per message, tools run in parallel per round. A `refusal` stop gives "The Optimist declined to answer that".

**Behaviour** (`optimist.mjs`):
- System prompt (`systemPrompt`): identity (user name, role, today's date, scope, labs the user can see); never answer from memory, always read via tools; never mention tools; read-only (it cannot create/edit/send); plain text only (no markdown, no em/en dashes); concise "sharp colleague" voice; contact details are opt-in.
- Scope: `scope` is a lab id or `all`; unknown lab gives 400, a lab the caller cannot see gives 403 ("That lab is outside your access"). Scope only narrows retrieval.
- Attachment: PDF becomes a `document` block, PNG/JPEG an `image` block, TXT/MD/CSV is decoded and truncated to 150,000 chars into a text block. Limit about 4 MB (5.5M base64 chars). Attachments are **not** persisted; only the typed text is stored ("(attachment)" if empty).
- Conversation storage: `pk=CONV#<username>, sk=<uuid>`; fields `title` (first 80 chars), `scope`, `turns[]` (plain text only, last 40 kept, each capped at 8,000 chars), `created`, `updated`, `ttl` (180 days). Tool calls and results are not stored. `historyLength` (used by Retry) truncates stored turns to keep client and server in sync. Messages are capped at 8,000 chars.
- Audit: each completed chat writes `AUDIT` row `optimist.chat` with conversation id and the first 80 chars of the question, actor = real caller (the Admin, when acting as). The audit log therefore contains snippets of user questions (90-day TTL).

**Tools** (`optimist-tools.mjs`; nine, read-only, each running as the caller's own `ctx`; two shaping rules: reuse the REST list handlers where they exist so permissions can't drift, and compact results):

| Tool | What it reads | Role behaviour |
|---|---|---|
| `search_pipeline` | DEAL records: id, client, lab, stage, amount, expected close, owner, source, recurring, outcome, signed/ready flags. Open deals by default; optional stage and `includeClosed`. Max 60 | **Contributor: empty with a note.** Lab Leader: deals in their labs or that they lead. Admin: all. Scope narrows by lab |
| `get_deal` | One deal plus its proposals and contracts (via `listProposals`/`listContracts`) | Contributor: error. Lab Leader/Admin as above |
| `search_proposals` | Proposal summaries (title, client, lab, status, version, deal, sent date, customer decision, which sections are written). Max 60 | Via `proposals.listProposals`: Admin and Lab Leader as per lab/ownership; Contributors only proposals shared to their email |
| `get_proposal` | Full text of every section, pricing, version history, customer decision, view count | Same visibility as above |
| `search_bench` | PERSON directory: name, role, labs, specialties, blurb; email/phone only if opted in (`bench.showEmail !== false`, `showPhone === true`), or the viewer is Admin or the person themself. Max 60 | **No role gate**: any role, any lab (scope only filters by lab membership). Includes Admin-role people, unlike the Directory page |
| `search_resources` | Resources and courses via `listResources`/`listCourses`, so the same audience/lab/draft rules as the Resources page. Posts include up to 6,000 chars of body | Per the Resource rules in 1.4. Note the scope filter treats OL-wide items (no lab) as always in scope |
| `search_knowledge_base` | `KB` entries (title, lab, content up to 8,000 chars). Max 15 | **Readable by every role**, even though `/kb` CRUD is Admin-only (deliberate per comment). Lab-tagged entries are not restricted to that lab's members when scope is "all" |
| `search_agreements` | Contracts/MSAs/task orders (via `listContracts`) and invoices | Contracts: Admin all; Lab Leader own labs or contracts on deals they lead; Contributor only executed documents they are party to. Invoices: Contributors get none; Lab Leader own-lab or requested by them; Admin all |
| `how_to_use_the_portal` | `GUIDE` records filtered by role and section roles; returns up to 6 pages | All roles |

It cannot write anything, call external systems, send email, or see other people's conversations. The model has no tools beyond these nine.

**Tests**: no automated tests for `optimist*.mjs` in `backend/tests/`.

#### 2.4 Summary of what it can see, by role (effective, backend-enforced)
- **Admin**: all deals, proposals, contracts, invoices, the bench (with contact details), all resources/courses including drafts and course-only items, the whole knowledge base, role-appropriate guides.
- **Lab Leader**: deals, proposals, contracts and invoices of their labs plus anything they lead or requested; the bench (opt-in contact fields only); published resources aimed at Lab Leaders (and their lab); the whole knowledge base; guides.
- **Contributor** (UI-blocked, backend-open): no pipeline or invoices; only proposals and executed contracts naming their email; the bench; published resources aimed at Contributors; the whole knowledge base; guides.

---

### 3. ADMIN (`/admin`)

Entry: avatar menu, "Admin" item, shown only when `role === "Admin"` (top-nav.tsx:231). The "Stop acting as" button in the red banner also returns here (`act-as-banner.tsx:20`). The page itself shows "This page is for OL admins only." to non-Admins (`admin/page.tsx:136`), and every backend route re-checks the role.

#### 3.1 (1) What is on the page
Header "Admin & invites" with three tabs.

**Tab "Invites & accounts"**
- *Invite someone* form: first name, last name, email, role (Lab Leader default; options Lab Leader, Contributor, Admin), lab checkboxes. Note text: WorkOS emails an invitation link valid for 7 days and the person sets their own password.
- *Accounts* table (sorted by username): Person, Email (pencil edits email), Role and labs (pencil edits them, hidden for yourself and for rows with no role), Status badge, Actions.
  - Status badges: Active (CONFIRMED), Invite pending (FORCE_CHANGE_PASSWORD), No account, Offboarded (DEACTIVATED), Reset required.
  - Actions by state: pending invite gets "Resend invite" and "Revoke"; active account, not yourself, gets "Reset 2FA"; not pending, not yourself, not offboarded and not an Admin gets "Act as"; not yourself and not offboarded gets "Offboard"; offboarded gets "Restore".

**Tab "The Optimist knowledge base"**: list of KB entries (title, first 240 chars of content, lab or "All labs", updated date and by), Edit and Delete per entry, "Add entry" dialog (title, lab or all-labs, content textarea). Links out to a Google Doc "Optimist proposal template" hard-coded in the description. Copy says the assistant is "OL's proposal writer"; it is now the general assistant (stale wording).

**Tab "Audit log"**: newest 100 audit rows ("action · actor · detail", UTC time), a green dot for actions starting with `auth.`, violet otherwise. Description says "Sign-ins, invites, email changes, and 2FA resets. Kept for 90 days. Failed sign-in attempts are in CloudTrail."

#### 3.2 (2) How it works for the end user (Admin only)
- **Invite**: fill the form, Send invite. Success toast "Invite sent to … valid for 7 days". The new person appears in Accounts as "Invite pending". Duplicate email gives a 409 error toast.
- **Resend/Revoke** a pending invite: Revoke asks for confirmation, removes the WorkOS invitation and the portal profile.
- **Change email**: pencil, new address, Save. The sign-in email and the profile move together (the email is the key under WorkOS).
- **Change role and labs**: pencil beside the role, choose role and tick labs, Save. Takes effect on that person's next request with no re-sign-in. You cannot change your own role.
- **Reset 2FA**: confirm (the text tells the admin to verify identity out-of-band first); all of the person's WorkOS authenticators are deleted and they enrol a new one at next sign-in. Password and data untouched.
- **Offboard**: confirm; the WorkOS user is deleted and any pending invite revoked, the profile is marked inactive and the person loses access immediately even with a live token. Profile and history are kept so deals still show their name.
- **Restore** an offboarded person: confirm; a fresh invitation is sent; role and labs come back.
- **Act as**: confirm dialog ("You'll see exactly what they see and can make changes as them until you exit — every action is logged"), then the server logs the start, the browser stores the target in `sessionStorage` (cleared on browser close), and a hard reload to `/` re-bootstraps as that person. A red banner reads "<Admin> is viewing the portal as <Person>" with "Stop acting as" (calls `/admin/act-as/stop`, clears the target, refreshes, returns to `/admin`). Not allowed on another Admin, on yourself or on offboarded users. The same flow (`lib/act-as.ts`) is also started from the Directory person card (outside this section).
- **Knowledge base**: Add, Edit, Delete entries; these immediately feed `search_knowledge_base`.
- **Audit log**: read-only list; loaded once on page open (refreshed after offboard/restore only, not after other actions).

#### 3.3 (3) How it works technically

**Frontend**: `web/app/(portal)/admin/page.tsx` (1,004 lines, single client component, `AdminConsole`), `web/lib/act-as.ts`, `web/lib/api.ts` (`setActingAs`, `clearActingAs`, `x-act-as` header, `sessionStorage` key `olportal.actingAs`), `components/shell/act-as-banner.tsx`. UI copy switches on `CONFIG.authProvider === "workos"`.

**Endpoints** (`app.mjs:576-602`; handlers in `admin.mjs` and `kb.mjs`):

| Method + path | Handler | Notes |
|---|---|---|
| GET `/admin/users` | `listPortalUsers` | Admin. Merges directory accounts with `PERSON` rows (WorkOS: users + pending invitations + profiles without an account = `NO_ACCOUNT`; offboarded = `DEACTIVATED`); includes `mfaEnrolled` per user (one WorkOS factor-list call each) |
| POST `/admin/invites` | `createInvite` | Admin any role/labs. A Lab Leader is also allowed by code, only for role `Contributor`, only labs they hold, and only when a Signed CONTRACT in their labs names the email (`signedContractUnlocks`); this path is used by the Contracts page's `InviteContributorDialog`. Validates names (both required), email, role, labs exist. Creates a WorkOS invitation (`expires_in_days: 7`) then `PERSON` (sk = lowercased email), audit `invite.created`. 409 on existing profile/account/pending invite |
| POST `/admin/invites/{u}/resend` | `resendInvite` | audit `invite.resent`; 409 if already accepted |
| DELETE `/admin/invites/{u}` | `revokeInvite` | removes invitation and PERSON; not self; 409 if accepted; audit `invite.revoked` |
| PATCH `/admin/users/{u}` | `updateUserEmail` | Updates WorkOS user (or re-issues the pending invitation) and re-keys PERSON (put new, delete old when username changed); audit `user.email-changed`. Records elsewhere that point at the old key by value are left as is |
| PATCH `/admin/users/{u}/access` | `updateUserAccess` | Sets `role` and optionally `labs` on PERSON only; refuses self, unknown lab, invalid role; no-op detection; audit `user.access-changed`. WorkOS is not touched (role lives only on PERSON; `buildContext` reads `me.role` ahead of the token claim) |
| POST `/admin/users/{u}/reset-mfa` | `resetUserMfa` | not self; deletes all WorkOS auth factors; 409 if none; audit `user.access-reset` |
| POST `/admin/users/{u}/offboard` | `offboardUser` | not self; deletes WorkOS user and revokes invite; sets `active:false`, `offboardedAt`, `offboardedBy` on PERSON; audit `user.offboarded`. `buildContext` then returns 403 "This account has been deactivated" for any token the person already holds |
| POST `/admin/users/{u}/restore` | `restoreUser` | re-invites, clears offboard fields, `active:true`; audit `user.restored` |
| GET `/admin/audit` | `listAudit` | Query `pk=AUDIT`, newest first, `Limit 100` |
| POST `/admin/act-as` | `startActingAs` | gated on `ctx.realRole === "Admin"`; refuses self, unknown, Admin targets, offboarded targets; audit `admin.act-as-start` |
| POST `/admin/act-as/stop` | `stopActingAs` | audit `admin.act-as-stop` |
| GET/POST `/kb`, PATCH/DELETE `/kb/{id}` | `kb.mjs` | Admin only. `pk=KB, sk=KB-nnn`: `title` (200), `content` (30,000), optional `lab`, `updatedBy`, `updated`. Audit `kb.created`, `kb.deleted` (updates are not audited; delete does not check existence) |

**How "act as" works end to end** (`identity.mjs buildContext`, `app.mjs`): every request with an `x-act-as` header is checked: real caller must be Admin; target PERSON must exist, not be Admin, not be offboarded. The context then has `me` = target and `role` = target role, with `realMe`/`realRole` = the Admin. Every successful mutating request (POST/PATCH/PUT/DELETE, except the two act-as routes) in the ACT_AS session writes an `admin.act-as-mutation` audit row, `<METHOD> <path> (as <target>)`, with the real Admin as actor (`app.mjs:689`). `/bootstrap` returns `actingAs: {by, byName}` so the banner renders. The Optimist function also honours the header but, because it runs outside `app.mjs`, it logs `optimist.chat` rather than `admin.act-as-mutation` (it is read-only anyway).

**Sign-in directory**: `directory.mjs` switches on `AUTH_PROVIDER` (deployed: `workos`). The WorkOS side uses `workos.mjs` against the WorkOS API; the API key is in Secrets Manager (`WORKOS_SECRET_ID`, `ApiFunction` policy `AWSSecretsManagerGetSecretValuePolicy`). A Cognito implementation is kept whole in the same file for rollback.

**Entities**: `PERSON` (`pk=PERSON, sk=<lowercased email>`; firstName, lastName, role, labs, email, active, offboardedAt/By), `AUDIT` (`sk=<ISO>#<rand>`, actor, action, detail, `ttl` = 90 days), `KB`, `LAB` (read for validation), `CONTRACT` (read for the Lab Leader invite gate).

**Tests**: `backend/tests/admin.test.mjs` (491 lines, 27 tests, WorkOS and DynamoDB mocked): invite create/conflicts, Lab Leader gate, MSA auto-invite, list merge (users + pending + NO_ACCOUNT + DEACTIVATED), resend, revoke, email change (user, and pending invite re-issue), role/labs change (no-op, omitted vs empty labs, self/unknown/invalid refused), MFA reset, offboard (including never-invited and repeat), restore, "every route is admin-only". Act-as start/stop and the KB routes are not covered here (`identity.test.mjs`/`identity-linking.test.mjs` cover identity, not read in detail).

**Other callers of `/admin/*`**: `components/invite-contributor-dialog.tsx` (Contracts page) posts `/admin/invites` as the signed-in Lab Leader/Admin. It sends `lastName: ""` when the contract has a one-word name, which `createInvite` rejects ("last name is required").

---


---
# Part 3: Not Live / Dormant

Code that exists in the repository but is not available to end users. Nothing here should be described to customers or staff as a working feature.


## Dormant: Platform-wide inventory

Legend: **DEAD** = nothing reaches it; **UNLINKED** = works but no nav/link; **VESTIGIAL** = kept for rollback / old auth; **STUB** = placeholder UI/data; **STALE** = comment/doc contradicts code.

#### D1. Backend routes with no frontend caller
| Item | Ref | Note |
|---|---|---|
| `POST /proposals`, `PATCH /proposals/{id}`, `POST /proposals/{id}/send`, `POST /proposals/{id}/pdf` | app.mjs:499-501; template.yaml `ProposalPdfRoute` (tpl:~357) | Frontend only ever `GET /proposals` (portal-data.tsx:145, contracts/page.tsx:484). Proposals are "written outside the portal and uploaded" (app.mjs updateDeal comments). The whole in-portal proposal authoring/sending backend (`proposals.mjs` createProposal/updateProposal/sendProposal, share email) has **no UI**; the `deal-view-proposal-tab.tsx` it was built for was deleted (docs/deal-view-rollout.md:3-8). |
| Public `GET/POST /share/{token}` + page `web/app/proposal-view` | app.mjs share handlers; web/app/proposal-view/page.tsx | Page and route are live code but nothing in the product can mint a share link (only `sendProposal` does). Effectively DORMANT customer proposal view (old tokens may still exist). |
| `POST /events` (`createEvent`) | app.mjs:454-470, 473 | Only caller is `web/lib/analytics.ts` `track()`, which nothing imports. DEAD. |
| `POST /recurrences/run` (`runNow`) | app.mjs:575; recurring.mjs:78 | No UI button; cron does the work. Admin/curl only. |
| `GET /docusign/templates` | app.mjs:610; docusign.mjs:250 | Built for an "ad hoc pick a template" envelope picker in a nonexistent `envelopes.mjs` (docusign.mjs:21,249,257,318). DEAD. |
| `ol-portal-auth-events` Lambda + Cognito PostAuthentication | template.yaml:174, 159-162 | Fires only for Cognito logins. VESTIGIAL. |
| Cognito `UserPool`, client, 3 groups, `CognitoJwt` authorizer, Cognito IAM statement on API fn | template.yaml:129-215, 278-285, ~470 | VESTIGIAL (kept so cutover is reversible; also `directory.mjs` cognito branch, `admin.mjs`, `migrate-users.mjs`). |
| Dead exports | `docusign.mjs:307 downloadCombinedPdf`, `templates.mjs:196 proposalTemplate`, `templates.mjs:260 TEMPLATE_VAR_KEYS` (frontend keeps its own copy, templates/page.tsx:45), `notifications.mjs:73-74 NOTIF_KINDS/NOTIF_TABS`, `authz.mjs:84 resetJwksCache` | Never imported anywhere (incl. tests, except resetVerifiedCache which tests use). |
| Env-gated: `QBO_ENV=sandbox`, `DOCUSIGN_ENV=demo` | template.yaml:434, 444 | Production endpoints off by config. `QBO_CLIENT_ID/SECRET` env fallback (qbo.mjs:49) never set. |
| Unused change-order doc kind | util.mjs:100-103 | "Deliberately not in DOC_KINDS yet." Intentional placeholder. |

#### D2. Frontend routes / pages reachable but not linked (static export; URL typed or deep link only)
Primary nav is **Community, Pipeline, Resources** only (`web/components/shell/top-nav.tsx:44-48`); avatar menu = Profile, Admin (Admin only), Sign out (top-nav.tsx:223-237); bell -> `/notifications`. Everything else:
| Route | Inbound link? | Notes |
|---|---|---|
| `/optimist` (`app/(portal)/optimist/page.tsx`) | **None found** in components/lib/app | The flagship AI assistant has no nav entry or link (its own comment says "same gate the nav applies", line ~181, but the nav no longer has it). Works if URL typed. Needs `NEXT_PUBLIC_OPTIMIST_URL` (UNVERIFIED in Amplify). Ask Liz whether this is intentional. |
| `/deal-flow` | None | Admin-only board (comment says FR17). Orphan; its only link is outbound. |
| `/files` | None (only the deal-drawer upload panel uses the API) | Orphan standalone Files page. |
| `/templates` | None | Admin templates editor; orphan. |
| `/proposals` | None; non-Contributors redirect to `/pipeline` (proposals/page.tsx:32) | Contributor read-only grid, no link for them either. |
| `/contracts`, `/invoices` | Only from Deal drawer/documents grid (deal-drawer.tsx:626, documents-grid.tsx:243,313) | Lab Leaders are redirected from `/invoices` to `/pipeline` (invoices/page.tsx:352). QBO card lives here. |
| `/bench` | Only from `/profile` (profile/page.tsx:92,365) | |
| `/library`, `/courses` | None | Pure redirects to `/resources?r=` / `?c=` (legacy URLs). |
| `/welcome`, `/callback`, `/verify`, `/login`, `/contract-sign`, `/proposal-view` | system flows | Not dormant (except proposal-view, see D1). |
| `/dev/*` (17 pages: admin, bench, community, contracts, deal-drawer-footer, deal-flow, files, invoices, messages, notifications, optimist, pipeline, profile, proposals, resources, templates, verify) | None (no nav links) | **Not excluded from the production build**: `next.config.ts` has no exclusion, and amplify.yml mirrors every emitted `.html`. Each guards itself with `if (process.env.NODE_ENV === "production") notFound()` (`web/app/dev/_harness.tsx:41`, plus per-page copies e.g. dev/verify/page.tsx, dev/pipeline/page.tsx:60). So `/dev/*` URLs exist in the deployed static output but should render Next's not-found UI; I could not run a build (no node_modules) to confirm whether the files are emitted as 404 shells or omitted. Harnesses register a fake `dev-harness` token and need `backend/scripts/dev-api.mjs`. Risk is low; recommended cleanup is to move them behind an env-gated `pageExtensions` or delete. |

#### D3. Dead / unused frontend code
| Item | Ref |
|---|---|
| `web/lib/analytics.ts` (`track`) never imported; its comment is also **STALE**: says events go to the `AUDIT` table, 90-day TTL (analytics.ts:3-6) but `createEvent` writes `pk=EVENT`, 30-day TTL (app.mjs:446-470) | analytics.ts:1-8 |
| `web/lib/dashboard.ts`: only `messageTime` is used (messages.tsx:13); `digestStories`, `presenceLeaders`, `leaderLab`, `leaderMeta`, `todayLabel`, `editionLabel` (lines 49-130) have zero callers - leftovers of the removed Home dashboard (portal home comment `app/(portal)/page.tsx:1-10`) |
| `web/components/shell/portal-icons.tsx` unimported |
| `web/components/ui/sidebar.tsx`, `ui/collapsible.tsx`, `ui/calendar-demo.tsx` unimported; `web/hooks/use-mobile.ts` only used by sidebar.tsx (old sidebar shell, per portal-shell.tsx:~47) |
| Community **Events / RSVPs / Groups / pinned announcement / digest** are empty constants: `COMMUNITY_EVENTS=[]`, `PINNED_ANNOUNCEMENT=null`, `INITIAL_RSVPS={}`, `DIGEST_ORDER=[]`, `COMMUNITY_THREADS={}` (`web/lib/community.ts:262,266,273,279,302`); "Manage events" / "New event" buttons are permanently disabled with title "Events admin is designed but not built yet" (`web/app/(portal)/community/page.tsx:380-400`). STUB. Header: "Events and RSVPs still have no API" (community.ts:28-29). |
| Cognito-only UI: `lib/auth-cognito.tsx`, `lib/amplify.ts`, password/TOTP/forgot steps in `app/login/page.tsx` (steps `newpw`, `mfasetup`, `mfacode`, `forgot*`), `lib/password.ts` | VESTIGIAL (bundled; Next may or may not tree-shake given static import in auth.tsx:5-6) |
| `Deal.assignmentNotice` marked `@deprecated`, "read only to seed the new form" | web/lib/types.ts:321; assignment-tab.tsx:75-91 |
| Invoices footer copy ("PRD Option A ... natural next step") is roadmap text in the UI | invoices/page.tsx:632-636 |
| No commented-out code blocks, `TODO`/`FIXME` markers, or feature-flag env vars found in backend/src, web/app, web/components, web/lib (greps for `TODO|FIXME|HACK`, `^\s*//\s*(const|if|await|return...)`, `ENABLE_|FEATURE_`). The only runtime switches are `AUTH_PROVIDER` / `NEXT_PUBLIC_AUTH_PROVIDER`, `QBO_ENV`, `DOCUSIGN_ENV`, `ASSIGNMENT_APPROVER` (default `liz@optimisticlabs.com`, assignments.mjs:40), `NODE_ENV` (dev pages). |

#### D4. Stale references to files that do not exist
- `assist.mjs` (docs/costs.md:28,187; kb.mjs:5), `envelopes.mjs` (docusign.mjs:21,249,257,318), `deal-view-proposal-tab.tsx` (proposals/page.tsx:21; docs/deal-view-rollout.md), `proposal-panel.tsx`/`invoices-panel.tsx` (docs/deal-view-rollout.md:6-7; neither exists in `web/components/pipeline/`).
- docs/deal-view-rollout.md and docs/pipeline-v2.md are both flagged SUPERSEDED/historical in their own headers; docs/deal-view-rollout.md still says `/invoices` redirects to `/pipeline` (true only for Lab Leaders).

#### D5. Legacy `frontend/` directory
- 12 static HTML pages + `assets/` (Cognito `config.js` with the API URL and client id, `auth.js`, `store.js`, `ui.js`, `qr.js`, etc.) = the original vanilla-JS prototype (pre-Next). Last touched in the visible history at the root commit (2026-09-03); it has pages the Next app never replaced 1:1 (no `contract-sign.html` etc.).
- **Nothing deploys it**: `amplify.yml` builds only `web/` (`baseDirectory: web/out`); the only workflow deploys the SAM backend; no Pages workflow, CNAME, Netlify or Vercel config exists. Root `.nojekyll` is a 0-byte file, a GitHub Pages leftover; whether GitHub Pages is enabled in repo settings is UNVERIFIED (nothing in the repo uses it).
- Only live dependency: `backend/scripts/seed.mjs:17` reads `frontend/assets/data.js` to seed sample data (a one-time script that also predates the roster rebuild). The template still lists `http://localhost:8761` (the old frontend's local port) in CORS (tpl:~65, ~263, ~403), and the Cognito invite email text points to `/login.html`.
- Note: backend email links still use `.html` URLs (`/contract-sign.html?token=`, `/proposal-view.html`, `/contracts.html`, `/invoices.html?qbo=`; util.mjs:29, proposals.mjs:242, docusign.mjs:188,408, qbo callback app.mjs). They keep working only because Next's export emits `contract-sign.html` etc. and amplify.yml mirrors to directories; a change to export settings (`trailingSlash`) would break emailed links.
- **Verdict: dead, safe to delete after (1) deciding whether `seed.mjs` is still needed (it is a one-time migration, and `seed-roster.mjs` supersedes it) and (2) confirming Pages is not serving it.** Removing it also lets `localhost:8761` leave the CORS lists.

---


## Dormant: Auth, shell and messaging

**Cognito sign-in path (replaced by WorkOS).** The live backend runs `DefaultAuthorizer: WorkosLambda` (`backend/template.yaml:276`) and deploys with `AuthProvider=workos` (`.github/workflows/deploy-backend.yml:87`). Cognito tokens would be rejected by it. So the following is not reachable against the live API:
- `web/lib/auth-cognito.tsx` (`CognitoAuthProvider`, Amplify password, new-password, TOTP setup, forgot-password).
- The credential form in `web/app/login/page.tsx` (email and password, "Forgot password?", new-password, QR/authenticator code, reset-code steps, the `BTN_LABEL` map, `passwordProblem` and `pwnedCount` from `web/lib/password`, `qrcode.react`). It renders only when `hostedSignIn` is null, i.e. when `NEXT_PUBLIC_AUTH_PROVIDER` is not `workos`. Under WorkOS every one of those context methods rejects (`hostedInstead`).
- `LoginStep` and `TotpSetup` types and the `startLogin/submitNewPassword/submitMfaSetupCode/submitMfaCode/forgotPassword/confirmForgotPassword` members of `AuthContextValue` (`web/lib/auth-context.ts`).
- Backend: the Cognito branch of `identity.mjs` (`fromCognitoClaims`, `ROLE_OF_GROUP`) and of `directory.mjs` (the `cognito` object, `GROUP_OF_ROLE`, `idp`).
- `backend/src/authevents.mjs` (Cognito PostAuthentication trigger, `AuthEventsFunction` at `template.yaml:55`, wired at line 45). It only fires on Cognito password sign-ins. Under WorkOS the sign-in audit is written by `authorizer.mjs` `recordSignIn`.
- The `UserPool`, `UserPoolClient`, groups and `CognitoJwt` authorizer in `template.yaml` (`CognitoJwt` at lines 278-285). They stay deployed but unreferenced as the default authorizer. The template comment calls this the reversible "cutover line".
- The `/verify` and `/callback` pages short-circuit to `/` or `/login` when the build is not WorkOS. `sessionVerified()` returns true for non-WorkOS builds.

**Dev harness routes** `web/app/dev/{messages,notifications,profile,verify,admin,bench,community,...}` render the real shell and components against a local mock API (`backend/scripts/dev-api.mjs`). `DevHarness` (`web/app/dev/_harness.tsx`) calls `notFound()` in production builds. `/dev/verify` has no such guard in its own code (read lines 1-30 only). These files are pre-rendered into the static export. Per the harness comment they reach nothing in a deployed build.

**Notification kinds with no emitter.** `comment`, `post`, `event`, `join`, `proposal` and `invoice` are defined in `notifications.mjs:58-71` (and in the client chip/action maps in `web/lib/notifications.tsx`) but no `notify()` call uses them today. The only calls found are those in the table in section 7.3. The Community tab on `/notifications` therefore stays empty, because it is shown only when a row of that tab exists. The row component also has an "event" glyph and an `RSVP` action for kind `event` that nothing produces.

**Pagination not implemented.** `MAX_LIST=200` (`notifications.mjs:80`). The code comment mentions a "Load older" design that nothing asks for. `MAX_MSGS=200` per thread in `messages.mjs`. Older rows stay in DynamoDB but are unreachable from the UI.

**Hard-coded unread dot on the Messages icon** (`web/components/shell/top-nav.tsx:174-178`). It is always shown and is not driven by data.

**Stale comments (the code is newer than the comments).**
- `backend/src/notifications.mjs:40-45` and the header comment in `web/app/(portal)/notifications/page.tsx:9-13` say messages have no server behind them and are React state. This is out of date. Messages are persisted through `/messages` routes in `messages.mjs`, and `message` and `mention` notifications are emitted by it. Comments and likes are described there as client-side. I did not verify the community comment/like code (another section).
- The `/notifications` page header comment says tabs without server support are hidden. The code renders tabs from the data, which is consistent, but the stated reason is stale for Messages.
- `web/lib/auth.tsx:8-12` says Cognito is the default and WorkOS is "being exercised against staging". The live backend contradicts this. The `web/lib/config.ts` default is still `cognito` unless the env var is set, see open question 1.
- `web/components/shell/help-widget.tsx:25` mentions `app-sidebar.tsx`. The sidebar no longer exists. The top nav replaced it.
- `backend/src/app.mjs:1-3` header says "Cognito JWT".
- `backend/src/guides.mjs` mentions the "sidebar's route segments", and "dashboard" for the root page. The root page is now Community.

**Management-API helpers used only by tooling.** `workos.mjs` exports `environment()`, `isConfigured()`, `listOrganizations()` and `status()`. No Lambda module imports them. Only `backend/scripts/workos-status.mjs` does (a diagnostic script). The `NO_ACCOUNT` status in `directory.mjs` is documented as a possible value, but `listAccounts` does not itself produce it. It is presumably synthesised in `admin.mjs`, which was not read.

**Unused route plumbing.** Nav item `roles?` filter (`top-nav.tsx`) has no role-restricted item. `NavItem.also` is used for Community only.

---


## Dormant: Community and Bench

### Events, RSVPs (UI visible, no data, no backend)
- `web/lib/community.ts:262` `export const COMMUNITY_EVENTS: CommunityEvent[] = [];` — empty; there is no events API. Consequently: Events tab always shows "Nothing on the calendar yet.", the rail always shows "Nothing scheduled yet.", the tab count is always 0.
- `web/lib/community.ts:270-273` `RSVP_CHOICES` (Going/Interested/Can't go) and `INITIAL_RSVPS = {}`. `community/page.tsx:77-78,180-181` keeps RSVPs in `useState` only (never sent anywhere; lost on reload) and `goingLabel` (`:158`) computes "`base+1 of cap going`" locally. All of this is unreachable in practice because no event exists to RSVP to.
- `web/components/community/event-detail.tsx` (63 lines): the event dialog (`page.tsx:558-573`) and `onOpenEvent`/`onQuickRsvp` in `rail.tsx` can never be triggered with an empty list. Includes a `PhotoSlot` "Event photo" placeholder and "Attendee list is visible to <host>".
- `community/page.tsx:380-403`: "Manage events →" and "New event" buttons for Admin/Lab Leader are `disabled` ("Events admin is designed but not built yet"). No events routes exist in `backend/src/app.mjs`.

### Other dormant community items
- `web/lib/community.ts:266` `PINNED_ANNOUNCEMENT = null` -> `feed.tsx:96-113` pinned-announcement banner never renders. No backend.
- `web/lib/community.ts:279` `DIGEST_ORDER = []` and `web/lib/dashboard.ts` `digestStories`, `presenceLeaders`, `leaderLab`, `leaderMeta`, `todayLabel`, `editionLabel` (lines 49-130): leftovers of the removed home dashboard. Nothing imports them (verified by grep); only `messageTime` from `dashboard.ts` is used (by `web/lib/messages.tsx:13`).
- `web/lib/community.ts:302` `COMMUNITY_THREADS = {}` (and `LeaderThread`, `ChatMessage` types): legacy mock DM threads, empty, no consumer other than the dormant dashboard module.
- `CommunityPost.headline/dek/accent/linkTitle/linkSource/photo/online` (`community.ts:53-86`): `toCommunityPost` never sets them, and the backend stores no such fields, so the link card (`post-card.tsx` ~lines 218-230, `post-detail.tsx` ~lines 105-117; its anchor is `href="#"`), the photo placeholder (`PhotoSlot`, used when `post.photo`), and presence dots (`AvatarWithPresence`, `online` undefined) never render on feed posts.
- Post `kind` other than "Update", and `tags`: supported by the API and shown as a chip (`KindChip`), but the composer cannot set them; tags are never displayed anywhere.
- `GET /posts/{id}` (`community.mjs:242`, `app.mjs:554`): implemented and unit-tested but not called by the frontend.
- "Member-created groups" card (`community/page.tsx:492-504`): static "Coming later" placeholder.
- `docs/community-posts.md` "Home's digest and presence card read the same GET /posts" and "Not built: Likes and comments are still client-side" are out of date (digest/presence removed; likes/comments implemented).
- Bench: presence dots deliberately not drawn (`bench/page.tsx:22-26`); `linkedin` field supported by `PATCH /profile` but no UI for it on Bench.
- `/dev/community`, `/dev/bench` harness routes: `notFound()` in production builds.
- Comment in `community/page.tsx:71-73` mentions Home's digest `?post=p1`; ids are now `PS-NNN` and there is no digest.

---


## Dormant: Pipeline, Deal Flow and Files

| Item | Where | What exists |
|---|---|---|
| **Dev click-test harnesses** `/dev/pipeline`, `/dev/deal-flow`, `/dev/files` and the other `/dev/*` | `web/app/dev/*`, `web/app/dev/_harness.tsx:41` | Mount the real pages against `backend/scripts/dev-api.mjs`; `notFound()` when `NODE_ENV==="production"`, so not usable on the deployed site. (Pipeline harness: `app/dev/pipeline/page.tsx:57`.) |
| **First-party event log** | `backend/src/app.mjs:446-465` (`createEvent`), route `app.mjs:473`; client `web/lib/analytics.ts` `track()` | `POST /events` writes `pk "EVENT"` rows with a 30-day TTL. **No caller of `track()` exists anywhere in `web/`**, so it is unused. (The comment in `analytics.ts` says it writes to the AUDIT table; the backend actually uses its own `EVENT` pk.) |
| **Creating invoice requests** | `app.mjs:300 createInvoice`, route `app.mjs:497` (`POST /invoices`) | No UI calls it (grep of `web/` finds only `GET /invoices` and the Admin-page `PATCH /invoices/{id}`). INVOICE request rows therefore come only from the recurring engine with `autoInvoice`, or older data. |
| **Creating / editing / sending proposals** | `proposals.mjs` (`createProposal`, `updateProposal`, `sendProposal`), routes `app.mjs:499-501` | No UI in `web/` calls `POST /proposals`, `PATCH /proposals/{id}` or `POST /proposals/{id}/send`; the in-portal drafting tool was retired and proposals are uploaded as files. PROPOSAL records still display (Documents grid, deal-flow, gate fallback `sentAt`), and the customer-facing `/share/*` public routes still exist. Legacy-compat code: `pipeline/page.tsx:145-153, 220-230`, `deal-drawer.tsx:140-146`, `documents-grid.tsx:131-178`. |
| **`autoInvoice`, `recurEnd`** | `app.mjs:204-210`; `recurring.mjs:44`; display in `lib/pipeline.ts cadenceOf` | Accepted by `PATCH /deals`, no form control sets them. |
| **Contacts/Company extras** | `contacts.mjs:174-208` | `PATCH /companies` accepts `phone` and `email`; no form shows them. There is no company delete route (by design). |
| **Legacy assignment notice / readyToClose** | `web/lib/types.ts:266, 322, 337`; `assignment-tab.tsx:75`; `optimist-tools.mjs:89` | `deal.assignmentNotice` (v2) is read only to seed the new form; nothing writes it. `readyToClose` is typed and passed to the Optimist, but no backend code sets it (the "ready to close" parking was removed when Contracted/v3 landed). |
| **Contract "Sent" status** | `types.ts` `ContractStatus` | Legacy value, nothing sets it. |
| **SHOW_BILLING_ON_CARDS / SHOW_COLUMN_TOTALS** | `web/lib/pipeline.ts:16-17` | Build-time constants, both `true` (live, but not user-toggleable). |
| **Stale docs** | `docs/pipeline-v2.md`, `docs/deal-view-rollout.md` | See section 7. |
| **Task-order / invite dialogs** | not on these pages | `new-task-order-dialog.tsx` and `invite-contributor-dialog.tsx` are mounted only by `/contracts` (live there, see below), not by Pipeline. |

**Live, but on /contracts (touchpoints only).**
- **New task order** (`web/components/new-task-order-dialog.tsx`): on the Contributor-agreements tab, a Signed MSA's row action is "New task order". The dialog collects scope (required), deliverables, timeline, start/end date and compensation (`PricingEditor`), then `POST /contracts {docKind:"task-order", parentId, sections:{scope,deliverables,timeline}, startDate, endDate, pricing}` -> `contractsCreate.createTaskOrder` (`contracts-create.mjs:184`). Server: not a Contributor; parent must exist, be an MSA, be **Signed** (409 otherwise) and editable by the caller; ID `TO-nnn`; inherits lab, owner (the Lab Leader themselves, else the MSA owner), counterparty and signer from the MSA; adds a "Governing Agreement" clause referencing the MSA; audited as `task-order.created`. It is never tied to a deal, so it does not appear in the pipeline board; it can be sent for signature only with a timeline and a pricing total (`signing.mjs:526-528`). On success the editor opens.
- **Invite contributor** (`web/components/invite-contributor-dialog.tsx`): offered on a **Signed client contract** row that names a `contributorEmail`; a confirmation-only dialog that posts `POST /admin/invites {firstName,lastName,email,role:"Contributor",labs:[contract.lab]}` -> `admin.createInvite`. A Lab Leader may only invite Contributors, only into labs they lead, and only if a Signed contract in one of their labs already names that email (`signedContractUnlocks`); Admins are unrestricted. 409 if the address already has an account or profile. An executed **MSA** invites its Contributor automatically (`execution.inviteOnExecution`), which is why the button is not offered on MSAs.

---


## Dormant: Proposals, Contracts, Billing (incl. QuickBooks)

#### 12.1 QuickBooks Online (known not set up)
What the **UI actually shows**: on `/invoices`, Admin sees a "QuickBooks" card that calls `GET /qbo/status` (`invoices/page.tsx:131`). With no credentials, `configured` is false and the card prints "Not configured yet. Add the Intuit app credentials to SSM parameter /ol-portal/qbo-credentials and redeploy…" (`:207-214`). Nothing else on the page depends on QBO: the invoice-request table, filters and status buttons never read QBO data.

What exists (all inert until credentials + Admin connect):
* `backend/src/qbo.mjs` (1-300): Intuit OAuth2 authorization-code flow (`AUTH_URL`/`TOKEN_URL` `:103-104`, SSM creds `:118-135`, CSRF state in `QBO/STATE#…` `:162-175`, tokens in `QBO/TOKENS` `:153-160`, refresh `:257-266`), `listInvoices()` = `SELECT * FROM Invoice MAXRESULTS 100` normalized to `{id,number,customer,total,balance,status Paid|Open,…}` (`:281-300`). Read-only; nothing writes to QuickBooks and nothing reconciles to `INVOICE` rows.
* `backend/src/app.mjs`: import `:11`; handlers `qboConnect/Status/Disconnect/Invoices` `:402-425` (all Admin via `reviewInvoices`); `qboCallback` `:430-444` (redirects to `${FRONTEND_URL}/invoices.html?qbo=connected|error`); routes `:603-606`; public callback dispatch `:622`.
* `backend/template.yaml`: env `QBO_CREDS_PARAM`, `QBO_ENV: sandbox`, `QBO_REDIRECT_URI` (`:433-438`); SSM read policy (`:468`); public route `QboCallbackRoute` GET `/qbo/callback`, Authorizer NONE (`:527-535`).
* `web/app/(portal)/invoices/page.tsx`: `QboCard` `:116-316`, rendered `:629`, `?qbo=` flash handler `:336-344`, footnote `:631-635`; `web/lib/data.ts:86` `QBO_STATUS_VARIANT`.
* Legacy: `frontend/assets/qbo.js` is in the ignored prototype directory; no `qbo.js` exists in `web/`.
* Even if configured, `QBO_ENV` is hard-coded to `sandbox`.

#### 12.2 Proposal authoring and the proposal-to-client send path (UI removed, API still deployed)
* Create/edit/Final/send/pdf endpoints in `proposals.mjs` and the router (`app.mjs:499-501`, `template.yaml:358`). `docs/deal-view-rollout.md` and `docs/pipeline-v2.md` describe a Deal-View proposal tab (`deal-view-proposal-tab.tsx`) and `proposal-panel.tsx` that are **gone** from `web/components/pipeline/` (verified by listing). Stale UI copy remains in `documents-grid.tsx:164-173` ("Open deal — mark final and send", "request a contract", "revise and resend") which describes actions with no button behind them.
* `proposals.mjs` header and `notifyOwner` link still point at `/proposals.html`.
* The Optimist no longer authors proposals: `optimist-tools.mjs` has read-only tools (`search_proposals`, `get_proposal`, `search_agreements`, …); the "Draft PDF from The Optimist" comment in `template.yaml:321` is stale.
* Customer **reject** action (`proposals.mjs:395`) has no button on `/proposal-view`.
* Contributor proposal sharing (`contributorEmail` via PATCH) has no UI.

#### 12.3 Template kinds with no consumer
`proposal` ("Proposal starts") and `block` ("Content blocks") templates are editable on `/templates` but no live screen reads them (see section 8).

#### 12.4 Other unreached backend/UI pieces
* `GET /docusign/templates` (`docusign.mjs:250`, `app.mjs:610`): no UI; comments reference a non-existent `envelopes.mjs`. `ENVELOPE_VARIANT` in `web/lib/data.ts:91` has no page.
* Manual "Signed" status (`PATCH /contracts/{id} {status:"Signed"}`, `contracts.mjs:296-302`) and `PATCH /contracts/{id} {deal}` (link a standalone contract to a deal): API-only. `backend/scripts/report-orphan-client-contracts.mjs` lists orphans.
* Clause editing on a contract (`PATCH clauses`, Admin) has no UI.
* `signingReadiness()` (`signing.mjs:538`): used only by tests; the UI relies on the 400 message from send.
* `POST /invoices`, `INVOICE_STATUSES.Overdue`, `GET /recurrences`, `POST /recurrences/run`: no UI path (section 10).
* `/dev/contracts`, `/dev/invoices`, `/dev/proposals`, `/dev/templates`: click-test harnesses (`web/app/dev/_harness.tsx`) that mount the real pages against a local mock API; not product surfaces.
* Legacy contract status `Sent` (`contracts.mjs:44`) kept for reading old records only.

#### 12.5 DocuSign
See section 9: deployed but sandbox-configured and opt-in; treat as **not confirmed live**.

---


## Dormant: Resources, Optimist and Admin

**Dormant / unreachable**
1. `/optimist` page: built and functional but **no in-app link**; URL only. (`web/app/(portal)/optimist/page.tsx`; nav at `web/components/shell/top-nav.tsx:43-47`.) `OptimistIcon` (`web/components/shell/portal-icons.tsx:59`) is defined and unused.
2. `/dev/*` harness pages (`web/app/dev/**`, including `/dev/optimist`, `/dev/resources`, `/dev/admin`): `notFound()` in production (`app/dev/_harness.tsx:40`). Dev only; they use `backend/scripts/dev-api.mjs`.
3. Cognito path: `AuthEventsFunction` (`authevents.mjs`, `template.yaml:164,179`), the Cognito branch of `directory.mjs`, `cognitoVerifier()` in `optimist-stream.mjs:42-52` and the "temp password" copy in `admin/page.tsx:100-110` are not active under `AuthProvider=workos`. Consequence: the `auth.signin` audit rows that the Audit tab text promises ("Sign-ins") are no longer written; the live auth row is `auth.verify` (`verify.mjs:168`, emailed code confirmed).
4. Video 95% completion machinery in `components/video-player.tsx` (and the "Mark as watched" button for Loom): live and rendered, but its `onWatched` callback is unwired on the Resources page (`resources/page.tsx:293-305` passes no `onViewed`; `ResourceScreen` forwards `undefined`). It does not record course progress. Progress is recorded only on clicking a step's Watch/Read/Open or its checkbox.
5. `GET /resources/{id}` (`getResource`) exists and is routed but is not called by any live UI code.
6. The earlier proposal-drafting assistant is gone (`kb.mjs` header, `seed-guides.mjs:127`); no stub remains.
7. `frontend/` legacy prototype: ignored as instructed.

**Issues found while verifying (behaviour vs. intent)**
- **Course-only and course-audience items are not openable by non-Admins.** The resource screen resolves `?r=` from the `GET /resources` list, which hides `visibility == "course-only"` from non-Admins and applies the item's own audience. A learner who clicks a step whose resource is course-only (or aimed at a different audience than the course) lands on "This resource is no longer available, or you do not have access to it", even though the backend's `resourceAccess` and `getCourse` would allow it. The backend supports this case; the front-end route does not use it (`resources/page.tsx:274`).
- **Completion rule is not what the editor and help copy say.** `resource-editor.tsx` text claims YouTube/Vimeo "tick the step off automatically at 95% watched"; the dialog and guides say steps are ticked by opening or watching 95%. In the live flow, opening any step (including a video) marks it viewed immediately. The step checkbox is labelled "Mark not viewed" when checked but cannot un-view (`markViewed` returns early; no backend un-view).
- Linear course lock is front-end only (`course-screen.tsx` comment, `courses.mjs:~214`).
- "Share" on an Optimist answer only opens the Messages list; it does not attach or send the answer (`turn.tsx:76`). The tool-call events are streamed but unused in the UI.
- Optimist Contributor block is client-side only (`optimist/page.tsx:178`); the Function URL accepts Contributors.
- Optimist KB and bench tools are not lab-restricted for any role (see 2.3).
- Course cover goes through `readPhoto(f, 800)` (JPEG 0.85, no size ladder) while the server caps covers at 120,000 base64 chars (`courses.mjs` `MAX_COVER_CHARS`); a detailed photo can fail with "cover image is too large — resize it first". Resource covers use the step-down `readCover` and avoid this.
- Admin KB tab copy still calls The Optimist "OL's proposal writer"; Resource and Courses help guides (`seed-guides.mjs:304-345`) describe the pre-merge UI.
- `publicView` (resources.mjs) sends `images[]` S3 keys and `transcript` in the list payload (the code comment says transcripts are internal).

---


---
# Part 4: Known Issues, Stale Docs and Open Questions

Findings from reading the code. These were not exercised against production.


## Platform, costs and documentation drift

### F. `docs/costs.md` summary and staleness flags
Summary (dated July 21, 2026): the Claude API is ~90% of cost at every tier; AWS is near-free until ~100 users; Intuit/QBO API is $0 per call. Per-action: Optimist message ~ $0.06 (Sonnet 5, standard pricing $3/$15 per MTok), full proposal ~ $0.90, analyzed file ~ $0.03 (Haiku 4.5). Blended ~ $1.95 per user per month. Totals: ~ $21 / $52 / $205 / $1,015 per month at 10 / 25 / 100 / 500 users (about $2 per user). Section 5 compares models; section 6 lists levers (right-sizing done; prompt caching, trimming context, rate limits, Anthropic spend limit).
`docs/OL-Portal-Running-Costs.pdf` (3.5KB) is a companion; not inspected for content.

Claims that look stale vs code:
1. **`POST /assist`, `assist.mjs`** (costs.md:28, 187): neither exists. The Optimist is `optimist.mjs` + `optimist-stream.mjs` on a Function URL; no `/assist` route in `app.mjs`.
2. **Optimist workload model is for the old proposal-drafting assistant**: "full knowledge base (each KB entry up to 30k chars) + deal context + current draft of all 6 sections + last 30 turns, `max_tokens: 6000`". Current code: tool-calling chat over live records, KB read on demand via `search_knowledge_base`, up to 6 tool rounds per answer (each a full model call), `max_tokens: 4000`, last 40 stored turns, adaptive thinking at effort medium (optimist.mjs:49-53, 208-216). Per-message cost is therefore structurally different (multiple model calls per question; much smaller static prompt).
3. **"No prefix is stable enough to cache" / lever 2**: the Optimist and help widget already set `cache_control: ephemeral` on the system prompt (optimist.mjs:216; guides.mjs:90). Lever partly implemented.
4. **`ol-portal-api` "2048MB"** (costs.md AWS table): the API function is 256MB (Globals default, 28s). 2048MB is the PDF renderer (x86_64 Chromium), which the doc does not cost at all. The Optimist function (1024MB, up to 300s, streaming) is also absent.
5. **"Cognito (Essentials tier) $0"**: live auth is WorkOS (not costed anywhere); Cognito is idle. WorkOS pricing, **SES**, **Secrets Manager** (`WorkOs` secret), the **Lambda authorizer invoked on every request with no caching**, DocuSign (envelope/plan fees if it goes to production) are all missing.
6. **"Lambda (analyzer, auth-events, recurring cron)"**: auth-events no longer fires.
7. **Intro pricing "$2/$10 through Aug 31, 2026"** and the "~$14/$34/..." intro rows: expired (today 2026-10-06) - use standard rows.
8. **"Bootstrap reads whole table per session"**: `/bootstrap` reads only the LAB and PERSON partitions (app.mjs bootstrap); the heavy reads are `portal-data.tsx`'s parallel loads of deals/proposals/invoices/files/contracts/etc. (each a full partition Query), still small.
9. **Help widget** (`/help/assist`, Sonnet 5, max 1000 tokens) is a third AI feature not in the doc.
10. Optimist is described as "proposal writing"; today it is read-only Q&A (tools: search_pipeline, get_deal, search_proposals, get_proposal, search_bench, search_resources, search_knowledge_base, search_agreements, how_to_use_the_portal; optimist-tools.mjs). Proposal/section drafting and "Auto-fill the rest" were removed.
11. Consistent with code: 50MB file cap, analyzer 10MB limit and Haiku 4.5, Sonnet 5 for the Optimist, SSM key path, `QBO_ENV=sandbox`. Unverifiable from repo: account id, the $10 AWS budget alert, Anthropic console limits.

---

### G. Other staleness worth fixing in the write-up
- `web/lib/auth.tsx:10-12`, `web/lib/config.ts` (auth comments), `web/.env.example` (Cognito default): say Cognito is default; production is WorkOS.
- `web/lib/can.ts:3-4`: "Mirrors backend/src/app.mjs's perms()"; it is `identity.mjs`.
- Many comments reference PRD numbers ("PRD 3.3", "Base Contract PRD FR15/FR17", "Contributor MSA PRD"); those PRDs are not in the repo.
- `backend/package.json` (scripts/tests deps, anthropic ^0.125) and `backend/src/package.json` (Lambda bundle deps, anthropic ^0.111) pin different SDK versions; the deployed one is `src/package.json`.


## Auth, shell and messaging

1. **Frontend auth switch is not in the repo.** `amplify.yml` sets no env vars, and the frontend default is `NEXT_PUBLIC_AUTH_PROVIDER=cognito` (`web/lib/config.ts`). `.env.example` also says cognito. The live backend only accepts WorkOS tokens, so the production Amplify console must set `NEXT_PUBLIC_AUTH_PROVIDER=workos`, `NEXT_PUBLIC_WORKOS_CLIENT_ID` and `NEXT_PUBLIC_WORKOS_API_HOSTNAME`. I inferred this and could not verify it.
2. Whether `router.push("/community#messages/<id>")` from the bell peek opens the thread when the user is already on `/community` (hash-only change) was not tested. The `/notifications` page handles `#messages` hrefs itself.
3. `linkedin` is accepted by `PATCH /profile` but no UI for it was found in the profile page or `EditProfileDialog` (only the first 150 lines of the dialog were read).
4. I did not confirm that a `GUIDE` record exists for the Community landing page. The widget's header line uses `"dashboard"` for `/`, and `/community` maps to key `community`.
5. `NO_ACCOUNT` status: not read in `admin.mjs`.
6. `/dev/*` pages in the static export: only `_harness.tsx` and `dev/verify/page.tsx` (first 30 lines) were read. The guard shown in `_harness.tsx` is `notFound()` when `NODE_ENV==="production"`. I did not check every dev page for the same guard.


## Community and Bench

1. Events/RSVPs: is there a planned API/owner, or should the empty Events tab and rail panel be described to readers as "coming soon"? (The Events tab with disabled admin buttons is visible to all users.)
2. Rail section titled "Your labs" lists all labs; is that intended or a copy bug? Same for Groups ("Groups follow your lab affiliation") which lists every lab, including ones the viewer is not in.
3. Is the id-reuse-after-delete / unconditional-put race acceptable for the write-up's "known limitations" section?
4. Bench is not in the nav; is the intended entry the Members tab, or should /bench be documented as a legacy/secondary route?


## Pipeline, Deal Flow and Files

### 7. Design docs vs. reality (verify before quoting them)

`docs/pipeline-v2.md` is a snapshot, not current:
- It describes components `proposal-panel`, `invoices-panel`, `proposals-grid`, `version-viewer`, `fee-split-editor`. **None exist** (`web/components/pipeline/` holds only the 9 files listed at the top). The current document model is upload-based with a Documents grid.
- Tabs are **Deals / Companies / People / Documents** (it says Board / Companies / People / Proposals; `?view=proposals` is gone and falls back to the board).
- Gates: it says "closing needs `contractSigned`". Now **Contracted** needs the signed contract and **Closed** needs an uploaded invoice (Pipeline v4).
- "No delete endpoint" is out of date for people: `DELETE /contacts/{id}` exists (companies still have none).
- "Assignment Notice" is replaced by the v3 Assignment (single approver, 70% pool, 5% soft reserve).
- "Contributors get `[]`" and the deploy-order warnings about `/companies` fail-soft are still accurate.
`docs/deal-view-rollout.md` (itself bannered SUPERSEDED): the tabbed Deal View is gone. Still true: `/proposals` redirects non-Contributors to `/pipeline` and `/invoices` redirects Lab Leaders to `/pipeline`; `POST /events` and `Deal.created/updated` exist (the former unused). Its statement that Proposals/Invoice Requests appear in the nav for Contributor/Admin is no longer true: the nav has only Community, Pipeline, Resources.
The seeded in-app help guides (`backend/scripts/seed-guides.mjs`, shown by the help widget) are mostly current for Pipeline but describe the two owner fields as "Owner = leads internally, deal owner = credited with sourcing", while the UI labels them **Originator** (`owner`, which also grants a Lab Leader edit rights) and **Deal owner** (`dealOwner`, the default assignment leader).

### 8. Tests covering this area (`backend/tests`, run with `node --test tests/`)
- `pipeline-scope.test.mjs`: Lab Leader / Admin / Contributor scoping of `/companies`, `/contacts`, `/deals`; 404-not-403 for out-of-scope ids; createdBy carve-out; attach-scope rules on create and update; lab re-send is not an admin-only reassignment; delete-refusal counts all deals but names only visible ones.
- `contacts.test.mjs`: phone, website, address, imported-company address fallback, person delete rules (blocked by deals, clears company primary contact, Contributor/missing refused).
- `assignments.test.mjs`: pool math (70% of net after costs and 5% reserve), validation, approver by email/key, notifications and email on file/approve, only-approver approve/reopen, revise-until-approved, stage restriction (Contracted/Closed), and the gate chain (Contracted needs contract or uploaded file; Closed needs invoice; Negotiating->Closed needs all; Closed Lost ungated; leaving a closed stage drops outcome).
No front-end tests cover these pages (`web/tests` has only `return-to` and `roster`).

### 9. Summary of observations worth flagging to product/engineering
1. **/deal-flow and /files are URL-only.** `/files` is also where all deal documents surface unlabelled.
2. **Untagged files are world-readable to signed-in users.** The Files page defaults to "Everyone (no lab)", and a Lab Leader uploading to an out-of-lab deal they own produces an untagged proposal/contract/invoice.
3. **Deal-document uploads are sent to the Anthropic API** (Claude Haiku 4.5) for auto-analysis (PDF/image/text <= 10 MB).
4. **Gate evidence is just "a FILE row exists"**: no check of upload status, uploader, deal ownership, or that the deal id is real in `createFile`.
5. Closed Lost -> Contracted/Closed by API skips three gates (UI does not).
6. `/deal-flow` ignores uploaded documents, so it reports "No proposal yet" for upload-era deals.
7. `PATCH /deals` does not validate `client`, `close`, `source`.
8. Deleting a deal leaves its files/proposals/contracts/invoices behind (their cards then render with no deal link).
9. The assignment approver is a single hard-coded person (default `liz@optimisticlabs.com`) and re-filing re-emails them each time.


## Proposals, Contracts, Billing

### 13. Known issues and risks found while reading (code-level; not exercised live)

1. **PDF buttons probably fail in production (WorkOS).** `ContractPdfFunction` derives identity only from Cognito claims (`pdf/index.mjs:78-86`: `authorizer.jwt.claims["cognito:username"]`). Under the WorkOS Lambda authorizer the context is at `authorizer.lambda` (see `app.mjs:123`), so `username/role` are empty and the handler returns 403 "No portal role on this account" (`:367`). Affected: **Draft PDF / Executed copy / Download PDF** on `/contracts`, and `POST /proposals/{id}/pdf`. Unaffected: execution-time PDF generation (direct Lambda invoke skips identity), the emailed presigned link, and `GET /sign/{token}/pdf`.
2. **Stale `envelopeId` after a void.** `voidContractEnvelope` reverts status but leaves `envelopeId` on the record. A later native re-send keeps it, and `signSubmit` then refuses with "Sign this agreement in the DocuSign window above" (`signing.mjs:349`). Also keeps showing "via DocuSign".
3. **Credential-bearing fields returned in list endpoints.** `GET /contracts` returns `signToken`, `executionCopy`, signature `ip`/`userAgent` to every Lab Leader who can see the lab (and to a party Contributor for executed docs); `GET /proposals` returns `shareToken` to Admin/LL and to a Contributor the proposal is shared with (who could then open the customer link and record a decision). Public `/sign` and `/share` correctly redact IPs.
4. **Invite Contributor button can 400.** `InviteContributorDialog` sends `lastName: ""` for single-word names, but `createInvite` requires a non-empty last name (`admin.mjs:101`).
5. **Linear scans.** `byToken` (proposals and contracts) scans the whole partition on every public view/sign; fine at current volume, no GSI.
6. **Three pricing implementations** (`pricing.mjs`, `lib/pricing.ts`, inline in `pdf/index.mjs`) must be hand-kept in sync; the PDF copy omits `samePricing`.
7. **Large drawn signatures** can exceed the 120,000-character server limit (canvas is scaled by `devicePixelRatio`, `signature-capture.tsx:308-311`), returning "drawn signature is too large".
8. DocuSign "Resend" calls `resend_envelope=true` on an embedded (clientUserId) recipient, for which DocuSign sends no email; behavior is unverified.

---

### 14. Test coverage

* `backend/tests/contracting.test.mjs` (pure functions only): pricing validation/totals/diff, deviation detection, hash stability and tamper properties, one-decision-per-version, placeholder merge, docKind helpers, per-kind send requirements, execution-copy shape, Contributor visibility boundary (`contributorVisible`), task-order governing clause.
* `backend/tests/docusign.test.mjs`: webhook HMAC verification (valid, tampered, wrong key, missing header, missing key, multiple headers) and dedupe key.
* Not covered: route handlers, SES, PDF rendering, DocuSign API, native sign/countersign end to end, invoices, recurring, QBO. Frontend has no test runner (`docs/deal-view-rollout.md`).

### 15. Quick reference: routes in this area

Authenticated (WorkOS Lambda authorizer, all via `ApiFunction` `/{proxy+}` unless noted):
`GET/POST /proposals`, `PATCH /proposals/{id}`, `POST /proposals/{id}/send`, `POST /proposals/{id}/pdf` (PDF Lambda) ·
`GET/POST /contracts`, `PATCH /contracts/{id}`, `POST /contracts/{id}/send-for-signature|countersign|docusign/resend|docusign/void`, `POST /contracts/{id}/pdf` (PDF Lambda) ·
`GET/POST /templates`, `PATCH/DELETE /templates/{id}` ·
`GET/POST /invoices`, `PATCH /invoices/{id}` ·
`GET /files/{id}/download`, `POST /files`, `DELETE /files/{id}` (uploads incl. kind proposal/contract/invoice) ·
`GET /qbo/status|connect|invoices`, `POST /qbo/disconnect` (dormant) · `GET /docusign/status|connect|templates`, `POST /docusign/disconnect` ·
`GET /recurrences`, `POST /recurrences/run`.

Public (Authorizer NONE, `template.yaml`): `GET /share/{token}`, `POST /share/{token}/decision`, `GET /sign/{token}`, `POST /sign/{token}`, `GET /sign/{token}/pdf`, `GET /sign/{token}/docusign-view`, `GET /docusign/callback`, `POST /docusign/webhook` (HMAC), `GET /qbo/callback` (OAuth state).

Environment/config that matters: `FRONTEND_URL`, `PDF_FUNCTION_NAME`, `FILES_BUCKET`, `DOCUSIGN_ENV=demo`, `DOCUSIGN_CREDS_PARAM`, `QBO_ENV=sandbox`, `QBO_CREDS_PARAM`, `AUTH_PROVIDER=workos` (set by `deploy-backend.yml`), SES identity `optimisticlabs.com`.


## Resources, Optimist and Admin

1. Is `NEXT_PUBLIC_OPTIMIST_URL` set on the production Amplify app, and is the omission of any `/optimist` link intentional (hidden launch) or pending?
2. Should Contributors be refused by the Function URL itself, and should the KB and bench tools respect lab membership?
3. Is the unwired 95% video rule meant to drive course progress (and should the resource screen fetch `GET /resources/{id}` so course-only steps open for learners)?
4. The Anthropic key is read from SSM `/ol-portal/anthropic-api-key`; I could not confirm which Anthropic account/workspace owns it, or that the model id `claude-sonnet-5` is the intended one. It is hard-coded in `optimist.mjs:49` and `guides.mjs`.
5. Should the Admin audit tab text and WorkOS-era behaviour (no `auth.signin` rows) be corrected?
