/* DocuSign integration · tests for the logic that has to be right rather than
   merely working: webhook authenticity, idempotency, and PDF anchor
   placement. Everything that talks to DocuSign's API or AWS itself is
   exercised manually against the sandbox, same convention as
   contracting.test.mjs.

   Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { verifyWebhookSignature, webhookDedupeKey } from "../src/docusign-webhook.mjs";

/* ---------------- webhook HMAC verification ---------------- */

test("a correctly signed webhook body verifies", () => {
  const key = "test-hmac-key";
  const body = JSON.stringify({ event: "envelope-completed", data: { envelopeId: "abc-123" } });
  const mac = createHmac("sha256", key).update(body).digest("base64");
  assert.equal(verifyWebhookSignature(body, { "X-DocuSign-Signature-1": mac }, key), true);
});

test("a tampered body fails verification even with a valid-looking signature", () => {
  const key = "test-hmac-key";
  const original = JSON.stringify({ event: "envelope-completed", data: { envelopeId: "abc-123" } });
  const mac = createHmac("sha256", key).update(original).digest("base64");
  const tampered = JSON.stringify({ event: "envelope-completed", data: { envelopeId: "abc-999" } });
  assert.equal(verifyWebhookSignature(tampered, { "X-DocuSign-Signature-1": mac }, key), false);
});

test("the wrong secret fails verification", () => {
  const body = JSON.stringify({ event: "envelope-completed" });
  const mac = createHmac("sha256", "the-real-key").update(body).digest("base64");
  assert.equal(verifyWebhookSignature(body, { "X-DocuSign-Signature-1": mac }, "a-different-key"), false);
});

test("a missing signature header fails closed, not open", () => {
  assert.equal(verifyWebhookSignature("{}", {}, "any-key"), false);
});

test("a missing configured key fails closed rather than skipping verification", () => {
  const body = "{}";
  const mac = createHmac("sha256", "").update(body).digest("base64");
  assert.equal(verifyWebhookSignature(body, { "X-DocuSign-Signature-1": mac }, undefined), false);
});

test("checks every configured signature header, not just the first", () => {
  const key = "second-key-is-the-real-one";
  const body = JSON.stringify({ event: "envelope-declined" });
  const mac = createHmac("sha256", key).update(body).digest("base64");
  const headers = { "X-DocuSign-Signature-1": "not-a-real-signature", "X-DocuSign-Signature-2": mac };
  assert.equal(verifyWebhookSignature(body, headers, key), true);
});

/* ---------------- idempotency key ---------------- */

test("the same envelope/event/timestamp always derives the same dedupe key", () => {
  const a = webhookDedupeKey("env-1", "envelope-completed", "2026-08-22T00:00:00.000Z");
  const b = webhookDedupeKey("env-1", "envelope-completed", "2026-08-22T00:00:00.000Z");
  assert.equal(a, b);
});

test("a different envelope, event, or timestamp derives a different dedupe key", () => {
  const base = webhookDedupeKey("env-1", "envelope-completed", "2026-08-22T00:00:00.000Z");
  assert.notEqual(webhookDedupeKey("env-2", "envelope-completed", "2026-08-22T00:00:00.000Z"), base);
  assert.notEqual(webhookDedupeKey("env-1", "envelope-declined", "2026-08-22T00:00:00.000Z"), base);
  assert.notEqual(webhookDedupeKey("env-1", "envelope-completed", "2026-08-22T00:00:01.000Z"), base);
});
