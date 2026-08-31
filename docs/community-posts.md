# Community posts — storage, API, deployment

The Community feed's composer used to write into React state and nothing else:
`submitPost` pushed an object into a `useState` array, so a post lasted exactly
as long as that component instance. A refresh, a tab change, or a second person
opening the page, and it had never happened. This is the backend it was missing.

## Where posts live

A post is a record in the existing `ol-portal` DynamoDB table — the same
single-table store every other record type uses, so it inherits that table's
on-demand billing, point-in-time recovery and backups. **No infrastructure
change was needed**: `template.yaml` already routes `/{proxy+}` to
`ApiFunction` with `DynamoDBCrudPolicy` over the table, so a new `pk` and a new
router branch is the whole surface area.

| Attribute    | Type   | Notes |
|--------------|--------|-------|
| `pk`         | S      | Always `"POST"` — the partition the feed queries. |
| `sk`         | S      | The post id, `PS-001`, `PS-002`… Readable, and already what `/community?post=PS-001` deep-links. |
| `author`     | S      | PERSON key, taken from the JWT. Never read from the request body. |
| `authorName` | S      | Display-name snapshot at write time. The browser prefers the live roster and falls back to this for an author who has left. |
| `text`       | S      | The body. Trimmed, capped at 5 000 characters. |
| `kind`       | S      | One of `Update`, `Ask`, `Win`, `Link`, `Introduction` — the chip on the card. Defaults to `Update`. |
| `lab`        | S      | LAB key, **or absent**. Absent is the scope "the whole network", not a missing value. |
| `tags`       | L of S | Lowercased, deduped, at most 10, 30 chars each. |
| `likes`      | N      | Reserved at `0`. There is no like route yet — see *Not built* below. |
| `comments`   | L      | Reserved at `[]`. Same standing as `likes`. |
| `created`    | S      | ISO 8601 write time. The feed sorts on this, descending. |
| `updated`    | S      | ISO 8601 of the last edit; equal to `created` until one happens. |

`created`/`updated` are named the way `RESOURCE` names them rather than
`createdAt`/`updatedAt`, so the table reads consistently across record types.

## API

All five routes are on the existing HTTP API behind the Cognito JWT authorizer,
handled by `backend/src/community.mjs`.

| Route | Who | Behaviour |
|-------|-----|-----------|
| `GET /posts` | any signed-in user | Every post they are entitled to see, newest first. Scoping happens server-side, so a lab's posts never leave the API for a browser outside that lab. |
| `GET /posts/{id}` | any signed-in user | `404` if it does not exist, `403` if it is out of scope. Being filtered out of a list and being unreadable are deliberately different answers. |
| `POST /posts` | any signed-in user | `text` required. `lab` must exist and must be one the author is in (Admins may file anywhere). Returns `201` with the stored record. |
| `PATCH /posts/{id}` | author, or Admin | `text`, `kind`, `tags`, `lab`. Same validation as create, so a PATCH cannot produce a record a POST would have refused. |
| `DELETE /posts/{id}` | author, or Admin | An Admin removing someone else's post is moderation and is written to the audit log; an author deleting their own is not. |

**Visibility.** Admin sees everything. Otherwise: a post with no `lab` is
visible to everyone, a lab-scoped post is visible to members of that lab, and an
author always sees their own post even after leaving the lab they filed it under.

**Editing.** Author or Admin only. A Lab Leader does not own other people's
posts in their lab — silently rewritable posts would make the feed a worse
record than no record.

## Observability

Structured JSON lines, matching the shape the other modules log in, filterable
in CloudWatch Logs Insights on `message`:

- `community.post.created` — actor, post id, lab, character count
- `community.post.rejected` — actor and the validation reason
- `community.post.updated`, `community.post.deleted`
- `community.posts.listed` — actor, role, `stored` vs `visible` counts. This is
  the line that answers "why can't I see it": `stored: 3, visible: 1` is a scope
  rule doing its job, not a lost post.

Counters go out as CloudWatch Embedded Metric Format lines in namespace
`OLPortal/Community` — `PostCreated`, `PostRejected`, `PostsListed`,
`PostUpdated`, `PostDeleted`. EMF needs no SDK call and adds no request latency.

## Frontend

- `web/lib/community.ts` is the API client plus the join between the stored
  record and the card the design draws (author name and initials from the live
  roster, lab id to lab name, ISO timestamp to "3h ago").
- `web/app/(portal)/community/page.tsx` loads `GET /posts` on mount and, after a
  successful create, **re-reads the list** rather than splicing the response in.
  Showing the writer their own copy is how the old bug looked from the inside.
- Failures are surfaced: a create error toasts and **keeps the draft**; a load
  error replaces the feed with a message instead of an empty state that would
  read as "nobody has posted".
- The composer's "Posting to" menu offers only labs the person may post to, so
  the server's lab rule cannot produce an error they had no way to avoid.
- Home's digest and presence card read the same `GET /posts`. Both need fields a
  post does not carry yet (`headline`, presence), so they still show their empty
  states — but they now read from the feed's source of truth rather than a
  constant.

## Environment

No new variables. The routes use what `ApiFunction` already sets:

| Variable | Where | Value |
|----------|-------|-------|
| `TABLE_NAME` | Lambda (set by `template.yaml`) | `ol-portal` |
| `NEXT_PUBLIC_API_URL` | Amplify build env | the HTTP API base URL |

## Deployment

```bash
cd backend && sam deploy --profile ol-portal
```

Backend first — a frontend that ships before the routes exist shows "Could not
load the feed" until the Lambda catches up. The frontend deploys on push via
Amplify (`amplify.yml`), no separate step.

Ordering note: `GET /posts` returning `404 no such route` from an older Lambda
is a *load* failure, not a data failure — nothing is lost, and the page recovers
on the next reload once the backend is up.

## Migration

**None.** There is no existing data to move. Community posts have never been
persisted anywhere — the seed content was removed from `web/lib/community.ts` in
commit `d6b7efe` ("Empty Community of its seed content") and the composer only
ever wrote to React state. The first post written after this deploys is `PS-001`.

## Verification checklist

Backend unit and integration tests (in-memory table stand-in, real handlers):

```bash
cd backend && npm test
```

`tests/community.test.mjs` covers the regression directly — *"a post written by
one caller is there for the next one"* fails against the old behaviour, where
there was no write at all.

Click-testing without a deploy and without a sign-in, using
`backend/scripts/dev-api.mjs` (runs the real Lambda handler over an in-process
table and injects the identity the JWT authorizer would have supplied):

```bash
cd backend && node scripts/dev-api.mjs
```

```bash
cd web && NEXT_PUBLIC_API_URL=http://localhost:8788 NEXT_PUBLIC_AUTH_PROVIDER=cognito npx next dev -p 3100
```

Then open `/dev/community` and walk this list:

- [ ] Write a post and click Post — it appears, the draft clears, a toast confirms the scope it went to.
- [ ] Reload the page — the post is still there. *(This is the bug.)*
- [ ] Switch identity and reload: `fetch("http://localhost:8788/__dev/as/omar", {method:"POST"})` — a Sports Lab post is not visible to someone outside that lab; a post filed to "All labs" is visible to everyone.
- [ ] The composer's "Posting to" menu lists only the labs that person is in, while the filter chips still list every lab.
- [ ] Stop the dev API and post — an error toast appears and the draft is preserved.
- [ ] Reload with the API stopped — the feed reports the load failure instead of showing an empty feed.
- [ ] Restart the dev API and reload — every post is still there, so the store outlived the process.

## Not built

Deliberately out of scope, and flagged rather than half-done:

- **Likes and comments are still client-side.** The record reserves `likes` and
  `comments` so the stored shape is stable, but there is no route for either —
  a like or a reply still lives only in the browser session.
- **Presence.** No source, so no dot is drawn (it used to render a permanent
  "away" marker on every author, which was worse than nothing).
- **Events, RSVPs and messages** remain without an API, exactly as before.
