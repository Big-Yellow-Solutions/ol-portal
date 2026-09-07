/* Resource Library · tests for what the library accepts.

   Three types come in: a file or a video from someone's device, and a post —
   markdown composed in the portal, the one intake that needs no upload at all.
   What these tests hold down is that each type is validated on its own terms
   before anything is minted, and that a description is refused rather than
   quietly shortened when it runs past the cap the editor counts against.

   Pure functions and the pre-DynamoDB half of createResource only, matching
   contracting.test.mjs — the route handlers are exercised end to end against
   the deployed stack.

   Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";

import {
  RESOURCE_TYPES,
  MAX_DESCRIPTION_CHARS,
  applyFields,
  applyTypeFields,
  createResource,
  canSee,
  parseEmbed
} from "../src/resources.mjs";

const admin = { role: "Admin", me: { sk: "admin", labs: [] } };
const contributor = { role: "Contributor", me: { sk: "cass", labs: [] } };
const body = res => JSON.parse(res.body);

/* ---------- what can be created ---------- */

test("all three types are creatable", () => {
  assert.deepEqual(RESOURCE_TYPES, ["file", "post", "video"]);
});

test("a made-up type is refused, and the error names the three that work", async () => {
  const res = await createResource(admin, { type: "essay", title: "Anything" });
  assert.equal(res.statusCode, 400);
  assert.equal(body(res).error, "type must be file, post, or video");
});

test("publishing stays admin-only", async () => {
  const res = await createResource(contributor, { type: "file", title: "Deck" });
  assert.equal(res.statusCode, 403);
});

/* ---------- posts ---------- */

test("a new post carries its markdown body", async () => {
  const res = await applyTypeFields(
    { sk: "RS-010", type: "post" },
    { body: "## Walk the client through each section\n\n@[resource](RS-004)" },
    true
  );
  assert.equal(res.error, undefined);
  assert.match(res.item.body, /Walk the client through/);
});

test("a post needs no file, unlike the other two types", async () => {
  const post = await applyTypeFields({ sk: "RS-011", type: "post" }, {}, true);
  assert.equal(post.error, undefined);
  assert.equal(post.item.body, "");

  const file = await applyTypeFields({ sk: "RS-012", type: "file" }, {}, true);
  assert.equal(file.error, "a file resource needs a file");
});

/* A metadata-only save from the editor — retagging, changing the audience —
   sends no `body`. That must not read as "clear the text". */
test("editing a post's metadata leaves its published text alone", async () => {
  const stored = {
    sk: "RS-003",
    type: "post",
    title: "How to use this checklist",
    body: "## Walk the client through each section",
    tags: ["onboarding"]
  };
  const res = await applyTypeFields({ ...stored, title: "Renamed" }, { title: "Renamed" }, false);
  assert.equal(res.error, undefined);
  assert.equal(res.item.body, stored.body);
  assert.equal(res.item.title, "Renamed");
});

test("a post's body can be rewritten", async () => {
  const stored = { sk: "RS-003", type: "post", title: "Checklist", body: "original" };
  const res = await applyTypeFields({ ...stored }, { body: "rewritten" }, false);
  assert.equal(res.error, undefined);
  assert.equal(res.item.body, "rewritten");
});

test("a published post reaches the audience it was aimed at", () => {
  const post = {
    sk: "RS-003", type: "post", status: "Published",
    permission: "both", visibility: "library"
  };
  assert.equal(canSee(contributor, post), true);
  assert.equal(canSee(admin, post), true);

  const draft = { ...post, status: "Draft" };
  assert.equal(canSee(contributor, draft), false, "draft gating is unchanged");
});

/* ---------- description ---------- */

/* Truncating at the cap is what sent someone looking for the limit in the
   first place: the save succeeded and the tail was gone. */
test("an over-long description is refused, not shortened", async () => {
  const res = await applyFields(
    admin,
    { sk: "RS-020", type: "post" },
    { description: "x".repeat(MAX_DESCRIPTION_CHARS + 1) },
    false
  );
  assert.match(res.error, /2000 characters or fewer/);
});

test("a description at the cap saves whole", async () => {
  const description = "x".repeat(MAX_DESCRIPTION_CHARS);
  const res = await applyFields(admin, { sk: "RS-021", type: "post" }, { description }, false);
  assert.equal(res.error, undefined);
  assert.equal(res.item.description.length, MAX_DESCRIPTION_CHARS);
});

/* ---------- uploads ---------- */

test("file upload metadata is validated before a URL is minted", async () => {
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

test("an embed still parses and is rebuilt from the id, never the pasted URL", async () => {
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
