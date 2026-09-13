/* The confirmed failure mode (9/13/26): a session that has to re-enter
   AuthKit — after a document load, or when the five-minute access token
   expires and the cross-site refresh cookie is not there — came back to "/"
   instead of the page it left, because nothing carried the page through the
   round trip. These pin the carrying. Run with `npm test` in web/. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loginPath, safeReturnTo, verifyPath } from "../lib/return-to.ts";

const origin = "https://portal.example";

test("a path and its query survive the login round trip intact", () => {
  const page = "/pipeline?deal=01ABC&tab=documents";
  const login = loginPath(page, origin);
  assert.equal(login, `/login?returnTo=${encodeURIComponent(page)}`);
  const carried = new URL(login, origin).searchParams.get("returnTo");
  assert.equal(safeReturnTo(carried, origin), page);
});

test("a hash survives too, and the root stays off the login URL", () => {
  assert.equal(safeReturnTo("/resources?r=x#top", origin), "/resources?r=x#top");
  assert.equal(loginPath("/", origin), "/login");
  assert.equal(loginPath("", origin), "/login");
});

test("the OAuth state round-trips the same way", () => {
  // authkit-js JSON-encodes `state` into the authorize URL and parses it back.
  const state = JSON.parse(JSON.stringify({ returnTo: "/contracts?c=7" }));
  assert.equal(safeReturnTo(state.returnTo, origin), "/contracts?c=7");
});

test("anything off this origin falls back to the root", () => {
  for (const raw of [
    "https://evil.example/phish",
    "//evil.example/phish",
    "javascript:alert(1)",
    "http://portal.example/", // wrong scheme is another origin
    "\\\\evil.example",
  ]) {
    assert.equal(safeReturnTo(raw, origin), "/", raw);
  }
  // A bare word is a relative path on this origin, which is harmless.
  assert.equal(safeReturnTo("not a url at all", origin), "/not%20a%20url%20at%20all");
});

test("missing and empty values mean the root", () => {
  assert.equal(safeReturnTo(null, origin), "/");
  assert.equal(safeReturnTo(undefined, origin), "/");
  assert.equal(safeReturnTo("", origin), "/");
});

test("the detour pages never become a destination", () => {
  assert.equal(safeReturnTo("/login", origin), "/");
  assert.equal(safeReturnTo("/login?returnTo=%2Fpipeline", origin), "/");
  assert.equal(safeReturnTo("/callback?code=abc", origin), "/");
  // /verify carries its own returnTo and is a legitimate place to come back to.
  assert.equal(safeReturnTo("/verify?returnTo=%2Fpipeline", origin), "/verify?returnTo=%2Fpipeline");
  // ...but not for the verify page itself (lib/verify.ts adds that rule).
  assert.equal(verifyPath("/pipeline?x=1"), "/verify?returnTo=%2Fpipeline%3Fx%3D1");
});

test("a lookalike prefix is not a detour", () => {
  assert.equal(safeReturnTo("/loginhistory", origin), "/loginhistory");
  assert.equal(safeReturnTo("/callbacks/list", origin), "/callbacks/list");
});
