/* Resource Library · tests for the withdrawal of native document creation.

   The library takes uploads now. A "post" — markdown composed inside the
   portal — can no longer be created, and a stored post's body can no longer be
   written. What these tests hold down is the pair of guarantees that make that
   safe to ship: the door is shut on new documents, and nothing already behind
   it moved.

   Pure functions and the pre-DynamoDB half of createResource only, matching
   contracting.test.mjs — the route handlers are exercised end to end against
   the deployed stack.

   Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";

import {
  RESOURCE_TYPES,
  CREATABLE_RESOURCE_TYPES,
  isCreatableType,
  applyTypeFields,
  createResource,
  canSee,
  parseEmbed
} from "../src/resources.mjs";

const admin = { role: "Admin", me: { sk: "admin", labs: [] } };
const contributor = { role: "Contributor", me: { sk: "cass", labs: [] } };
const body = res => JSON.parse(res.body);

/* ---------- no native document creation ---------- */

test("post is not a type anyone can create", () => {
  assert.equal(isCreatableType("post"), false);
  assert.ok(!CREATABLE_RESOURCE_TYPES.includes("post"));
});

test("the only creatable types are the upload-backed ones", () => {
  assert.deepEqual(CREATABLE_RESOURCE_TYPES, ["file", "video"]);
  assert.equal(isCreatableType("file"), true);
  assert.equal(isCreatableType("video"), true);
});

/* The old flow had no route of its own — it was a dialog the admin menu
   opened — so "navigating to it directly" means POSTing what that dialog used
   to send. An Admin is the one role that could, and it is refused before the
   handler reaches DynamoDB, so nothing is minted on the way to the error. */
test("POST /resources refuses a post, and says what to do instead", async () => {
  const res = await createResource(admin, {
    type: "post",
    title: "Client onboarding checklist",
    body: "## Walk the client through each section"
  });
  assert.equal(res.statusCode, 400);
  assert.match(body(res).error, /upload a file/i);
});

test("a made-up type is still refused, and the error no longer offers post", async () => {
  const res = await createResource(admin, { type: "essay", title: "Anything" });
  assert.equal(res.statusCode, 400);
  assert.equal(body(res).error, "type must be file or video");
});

test("publishing stays admin-only", async () => {
  const res = await createResource(contributor, { type: "file", title: "Deck" });
  assert.equal(res.statusCode, 403);
});

/* ---------- uploads still work ---------- */

test("a file resource still has to carry a file", async () => {
  const res = await applyTypeFields({ sk: "RS-900", type: "file" }, {}, true);
  assert.equal(res.error, "a file resource needs a file");
});

test("file upload metadata is still validated before a URL is minted", async () => {
  const tooBig = await applyTypeFields(
    { sk: "RS-901", type: "file" },
    { file: { name: "deck.pdf", size: 60 * 1024 * 1024, type: "application/pdf" } },
    true
  );
  assert.match(tooBig.error, /1 byte to 50 MB/);

  const unnamed = await applyTypeFields(
    { sk: "RS-902", type: "file" },
    { file: { name: "", size: 1024, type: "application/pdf" } },
    true
  );
  assert.equal(unnamed.error, "file name is required");
});

test("video intake is untouched — an embed still parses and is rebuilt", async () => {
  assert.deepEqual(parseEmbed("https://youtu.be/dQw4w9WgXcQ"), {
    provider: "youtube",
    embedId: "dQw4w9WgXcQ",
    embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&rel=0"
  });

  const res = await applyTypeFields(
    { sk: "RS-903", type: "video" },
    { source: "embed", embedUrl: "https://vimeo.com/123456789" },
    true
  );
  assert.equal(res.error, undefined);
  assert.equal(res.item.provider, "vimeo");
});

/* ---------- existing posts are unaffected ---------- */

test("post is still a type a stored record may be", () => {
  assert.ok(RESOURCE_TYPES.includes("post"));
});

test("a stored post keeps its body when its metadata is edited", async () => {
  const stored = {
    sk: "RS-003",
    type: "post",
    title: "How to use this checklist",
    body: "## Walk the client through each section\n\n@[resource](RS-004)",
    tags: ["onboarding"]
  };
  const res = await applyTypeFields({ ...stored, title: "Renamed" }, { title: "Renamed" }, false);
  assert.equal(res.error, undefined);
  assert.equal(res.item.body, stored.body, "the published text is left exactly as it was");
  assert.equal(res.item.title, "Renamed");
});

/* Silently, rather than with a 400: an older client PATCHing a whole record
   should still save the metadata it changed instead of failing the edit. */
test("a post's body cannot be rewritten through the API", async () => {
  const stored = { sk: "RS-003", type: "post", title: "Checklist", body: "original" };
  const res = await applyTypeFields({ ...stored }, { body: "rewritten" }, false);
  assert.equal(res.error, undefined);
  assert.equal(res.item.body, "original");
});

test("an existing published post is still visible to the audience it was aimed at", () => {
  const post = {
    sk: "RS-003", type: "post", status: "Published",
    permission: "both", visibility: "library"
  };
  assert.equal(canSee(contributor, post), true, "listing, preview and download still resolve");
  assert.equal(canSee(admin, post), true);

  const draft = { ...post, status: "Draft" };
  assert.equal(canSee(contributor, draft), false, "draft gating is unchanged");
});
