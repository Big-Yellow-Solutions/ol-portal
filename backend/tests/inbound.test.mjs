/* OL Portal · the Optimist's inbox (email intake, dry-run phase).

   The parser, sender check and planner are exercised on their own, then the
   whole flow runs through processMessage with S3, SES and the Anthropic call
   stubbed — everything else (identity, lab scope, record shapes) is real.

   Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";

process.env.TABLE_NAME = "ol-portal-test";
process.env.AWS_REGION ??= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";
process.env.AWS_EC2_METADATA_DISABLED = "true";
process.env.AWS_ENDPOINT_URL_DYNAMODB = "http://127.0.0.1:1";

const { doc } = await import("../src/util.mjs");
const { perms } = await import("../src/identity.mjs");
const { splitForward, parseInbound } = await import("../src/inbound-parse.mjs");
const { authenticateSender } = await import("../src/inbound-auth.mjs");
const { sanitize } = await import("../src/inbound-extract.mjs");
const { planIntake, resolveLab, labFromNote, companyKey, externalPersonEmail } = await import("../src/inbound-plan.mjs");
const { buildReply } = await import("../src/inbound-reply.mjs");
const { processMessage } = await import("../src/inbound.mjs");

/* ---------- in-memory table ---------- */
const rows = new Map();
const k = (pk, sk) => `${pk} ${sk}`;
doc.send = async cmd => {
  const n = cmd.constructor.name, i = cmd.input;
  if (n === "PutCommand") {
    if (i.ConditionExpression?.includes("attribute_not_exists") && rows.has(k(i.Item.pk, i.Item.sk)))
      throw Object.assign(new Error("exists"), { name: "ConditionalCheckFailedException" });
    rows.set(k(i.Item.pk, i.Item.sk), structuredClone(i.Item));
    return {};
  }
  if (n === "GetCommand") { const h = rows.get(k(i.Key.pk, i.Key.sk)); return { Item: h && structuredClone(h) }; }
  if (n === "QueryCommand") {
    const pk = i.ExpressionAttributeValues[":p"], since = i.ExpressionAttributeValues[":s"];
    const Items = [...rows.values()].filter(r => r.pk === pk && (!since || r.sk >= since)).map(r => structuredClone(r));
    return { Items: Items.sort((a, b) => a.sk.localeCompare(b.sk)) };
  }
  throw new Error(`unexpected command in test: ${n}`);
};
const seed = (pk, sk, rest = {}) => rows.set(k(pk, sk), { pk, sk, ...rest });
const ofType = pk => [...rows.values()].filter(r => r.pk === pk);

test.beforeEach(() => {
  rows.clear();
  seed("LAB", "faith", { name: "Optimistic Faith" });
  seed("LAB", "democracy", { name: "Optimistic Democracy" });
  seed("PERSON", "liz@optimisticlabs.com", { email: "liz@optimisticlabs.com", role: "Admin", firstName: "Liz" });
  seed("PERSON", "aliza@optimisticlabs.com", { email: "aliza@optimisticlabs.com", role: "Lab Leader", labs: ["faith"], firstName: "Aliza" });
  seed("PERSON", "sam@optimisticlabs.com", { email: "sam@optimisticlabs.com", role: "Contributor" });
});

/* ---------- fixtures ---------- */
const SES_OK = "Authentication-Results: amazonses.com; spf=pass smtp.mailfrom=optimisticlabs.com; dkim=pass header.i=@optimisticlabs.com header.d=optimisticlabs.com; dmarc=pass header.from=optimisticlabs.com";

const mime = ({ from = "Liz <liz@optimisticlabs.com>", auth = SES_OK, id = "<m1@mail.gmail.com>", note = "Faith lab. Referral from Aliza. ~$40k board retreat.", fwd } = {}) => [
  auth, `From: ${from}`, "To: theoptimist@optimisticlabs.com", "Subject: Fwd: Board retreat", `Message-ID: ${id}`,
  "Date: Thu, 12 Nov 2026 10:00:00 -0500", "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "",
  note, "",
  fwd ?? [
    "---------- Forwarded message ---------",
    "From: Dana Whitfield <dana@riverchurch.org>",
    "Date: Tue, Nov 10, 2026 at 3:14 PM",
    "Subject: Board retreat",
    "To: Aliza <aliza@optimisticlabs.com>",
    "Cc: Pat Lee <pat@riverchurch.org>", "",
    "Hi Aliza, we'd like help with a board retreat this spring, around $40,000.", "",
    "Dana Whitfield", "Executive Director, River Church", "555-123-4567", "",
    "On Mon, Nov 9, 2026 at 9:00 AM Pat wrote:", "> earlier chatter"
  ].join("\n")
].filter(x => x !== undefined).join("\r\n");

const EXTRACTION = {
  intent: "pipeline.add",
  person: { firstName: "Dana", lastName: "Whitfield", email: "dana@riverchurch.org", phone: "555-123-4567", title: "Executive Director" },
  company: { name: "River Church", website: "riverchurch.org" },
  deal: { name: "River Church board retreat", labHint: "faith", amount: 40000, source: "Referral", summary: "Dana asked about a spring board retreat." },
  confidence: { person: 0.95, company: 0.9, lab: 0.9, amount: 0.8 }, ambiguities: []
};

const run = (raw, { extraction = EXTRACTION, extractFn } = {}) => {
  const sent = [];
  return processMessage(Buffer.from(raw), {
    now: new Date("2026-11-12T15:00:00Z"),
    deps: { send: async m => { sent.push(m); }, extract: extractFn || (async () => extraction) }
  }).then(out => ({ out, sent }));
};

/* ---------- parser ---------- */
test("a Gmail forward splits into the forwarder's note and the forwarded message", () => {
  const raw = mime();
  const { note, forwarded } = splitForward(raw.split("\r\n\r\n").slice(1).join("\n\n"));
  assert.match(note, /^Faith lab\./);
  assert.equal(forwarded.from.address, "dana@riverchurch.org");
  assert.equal(forwarded.from.name, "Dana Whitfield");
  assert.equal(forwarded.subject, "Board retreat");
  assert.deepEqual(forwarded.cc.map(a => a.address), ["pat@riverchurch.org"]);
  assert.match(forwarded.body, /Executive Director/);
  assert.doesNotMatch(forwarded.body, /earlier chatter/, "quoted history beyond the forward is stripped");
});

test("a message with no forward marker is all note", () => {
  const r = splitForward("just a typed message");
  assert.equal(r.forwarded, null);
  assert.equal(r.note, "just a typed message");
});

test("parseInbound reads Message-ID, sender and the split", async () => {
  const p = await parseInbound(Buffer.from(mime()));
  assert.equal(p.messageId, "<m1@mail.gmail.com>");
  assert.equal(p.from, "liz@optimisticlabs.com");
  assert.equal(p.forwarded.from.address, "dana@riverchurch.org");
});

/* ---------- sender authentication ---------- */
const authOf = async opts => authenticateSender(await parseInbound(Buffer.from(mime(opts))));

test("a DKIM-aligned, DMARC-passing message from the company domain is accepted", async () => {
  assert.equal((await authOf()).ok, true);
});

test("a From address outside the company domain is rejected before anything else", async () => {
  const r = await authOf({ from: "Eve <eve@evil.example>" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "from-outside-domain");
});

test("a company From with no SES verdict is rejected: the header alone proves nothing", async () => {
  assert.equal((await authOf({ auth: "X-Foo: bar" })).reason, "no-ses-authentication-results");
});

test("DKIM failing, or signed by another domain, is rejected", async () => {
  assert.equal((await authOf({ auth: SES_OK.replace("dkim=pass", "dkim=fail") })).reason, "dkim-not-pass");
  const other = "Authentication-Results: amazonses.com; dkim=pass header.d=evil.example; dmarc=pass header.from=optimisticlabs.com";
  assert.equal((await authOf({ auth: other })).reason, "dkim-not-aligned");
  assert.equal((await authOf({ auth: SES_OK.replace("dmarc=pass", "dmarc=fail") })).reason, "dmarc-not-pass");
});

test("a sender-supplied Authentication-Results from another server is not trusted", async () => {
  const forged = "Authentication-Results: mx.evil.example; dkim=pass header.d=optimisticlabs.com; dmarc=pass";
  assert.equal((await authOf({ auth: forged })).reason, "no-ses-authentication-results");
});

test("a spam or virus FAIL verdict stops the message", async () => {
  const r = await authOf({ auth: `${SES_OK}\r\nX-SES-Virus-Verdict: FAIL` });
  assert.equal(r.ok, false);
});

/* ---------- extraction clamp ---------- */
test("sanitize drops an email address the model made up and clamps the rest", () => {
  const out = sanitize({
    intent: "pipeline.add",
    person: { firstName: "A", lastName: "B", email: "invented@nowhere.org", phone: "", title: "" },
    company: { name: "X", website: "ghost.example" },
    deal: { name: "n".repeat(300), labHint: "not-a-lab", amount: -5, source: "Cold call", summary: "s" },
    confidence: { person: 9, company: -1, lab: 0.5, amount: 0.5 }
  }, { labIds: ["faith"], evidence: "mail from dana@riverchurch.org about retreat" });
  assert.equal(out.person.email, "");
  assert.equal(out.company.website, "");
  assert.equal(out.deal.name.length, 80);
  assert.equal(out.deal.labHint, "");
  assert.equal(out.deal.amount, null);
  assert.equal(out.deal.source, "");
  assert.equal(out.confidence.person, 1);
  assert.equal(out.confidence.company, 0);
});

test("a model answer that is not valid reads as unknown, never as an instruction", () => {
  assert.equal(sanitize({ intent: "delete.everything" }).intent, "unknown");
  assert.equal(sanitize(null).intent, "unknown");
});

/* ---------- lab rules ---------- */
const LABS = [{ id: "faith", name: "Optimistic Faith" }, { id: "democracy", name: "Optimistic Democracy" }];
const ctxOf = (role, labs = [], sk = "u") => ({ role, me: { sk, labs }, can: perms(role, labs, sk) });

test("a lab named in the note is found without its Optimistic/Lab dressing", () => {
  assert.equal(labFromNote("Faith lab. Referral", LABS), "faith");
  assert.equal(labFromNote("for Democracy please", LABS), "democracy");
  assert.equal(labFromNote("faith and democracy", LABS), null, "two labs settle nothing");
  assert.equal(labFromNote("no lab here", LABS), null);
});

test("Lab Leader with one lab: that lab. With several: note, then hint, then first (guessed)", () => {
  assert.deepEqual(resolveLab({ ctx: ctxOf("Lab Leader", ["faith"]), labs: LABS, note: "", hint: "" }), { lab: "faith", how: "only-lab" });
  const two = ctxOf("Lab Leader", ["faith", "democracy"]);
  assert.deepEqual(resolveLab({ ctx: two, labs: LABS, note: "democracy", hint: "faith" }), { lab: "democracy", how: "note" });
  assert.deepEqual(resolveLab({ ctx: two, labs: LABS, note: "", hint: "democracy" }), { lab: "democracy", how: "model" });
  assert.deepEqual(resolveLab({ ctx: two, labs: LABS, note: "", hint: "" }), { lab: "faith", how: "guessed" });
});

test("a Lab Leader can never land a deal in a lab that isn't theirs", () => {
  const r = resolveLab({ ctx: ctxOf("Lab Leader", ["faith"]), labs: LABS, note: "democracy lab", hint: "democracy" });
  assert.equal(r.lab, "faith");
});

test("an Admin with no note and no hint is held, never guessed", () => {
  assert.deepEqual(resolveLab({ ctx: ctxOf("Admin"), labs: LABS, note: "", hint: "" }), { lab: null, how: "held" });
});

/* ---------- planner ---------- */
const parsedOf = (over = {}) => ({
  note: "", subject: "Fwd: x",
  forwarded: { from: { name: "Dana", address: "dana@riverchurch.org" }, to: [], cc: [], subject: "Re: Retreat", body: "", date: "" },
  ...over
});
const dataOf = (over = {}) => ({ labs: LABS, contacts: [], companies: [], deals: [], ...over });
const plan = (o = {}) => planIntake({ ctx: ctxOf("Admin", [], "liz"), parsed: parsedOf(o.parsed), extraction: { ...EXTRACTION, ...o.x }, data: dataOf(o.data), scope: o.scope ?? null });

test("a new person at a new company is planned as two creates and a Lead deal", () => {
  const p = plan();
  assert.equal(p.outcome, "ready");
  assert.equal(p.lab, "faith");
  assert.equal(p.person.matched, null);
  assert.equal(p.company.matched, null);
  assert.deepEqual([p.deal.stage, p.deal.source, p.deal.amount], ["Lead", "Referral", 40000]);
  assert.deepEqual(p.flags, []);
});

test("source defaults to Inbound when the note named none", () => {
  assert.equal(plan({ x: { deal: { ...EXTRACTION.deal, source: "" } } }).deal.source, "Inbound");
});

test("an existing contact is reused; a company matched by domain is reused but flagged", () => {
  const p = plan({ data: {
    contacts: [{ sk: "CT-001", email: "dana@riverchurch.org", companyId: "CO-001" }],
    companies: [{ sk: "CO-001", name: "River Church of Camden", website: "https://www.riverchurch.org/" }]
  } });
  assert.equal(p.person.matched, "CT-001");
  assert.equal(p.company.matched, "CO-001");
  assert.equal(p.company.via, "domain");
  assert.deepEqual(p.flags.map(f => f.code), ["company-by-domain"]);
});

test("a company matched by normalised name is reused without a flag", () => {
  const p = plan({
    x: { company: { name: "The River Church, Inc.", website: "" } },
    data: { companies: [{ sk: "CO-009", name: "River Church", website: "" }] },
    parsed: { forwarded: { from: { name: "Dana", address: "dana@gmail.com" }, to: [], cc: [], subject: "", body: "", date: "" } }
  });
  assert.equal(p.company.matched, "CO-009");
  assert.deepEqual(p.flags, []);
  assert.equal(companyKey("The River Church, Inc."), "river church");
});

test("a free-mail sender gets no company from the domain", () => {
  const p = plan({
    x: { person: { ...EXTRACTION.person, email: "dana@gmail.com" }, company: { name: "", website: "" } },
    parsed: { forwarded: { from: { name: "Dana", address: "dana@gmail.com" }, to: [], cc: [], subject: "", body: "", date: "" } }
  });
  assert.equal(p.company, null);
  assert.equal(p.outcome, "ready");
});

test("an open deal the forwarder can see for the same person is flagged as a possible duplicate", () => {
  const p = plan({ data: {
    contacts: [{ sk: "CT-001", email: "dana@riverchurch.org" }],
    deals: [{ sk: "D-042", stage: "Discovery", lab: "faith", contactId: "CT-001" },
            { sk: "D-007", stage: "Closed", lab: "faith", contactId: "CT-001" }]
  } });
  assert.deepEqual(p.flags.map(f => f.code), ["possible-duplicate"]);
  assert.match(p.flags[0].text, /D-042/);
});

test("a contact outside a Lab Leader's scope reads as not found, and is never reused", () => {
  const ctx = ctxOf("Lab Leader", ["faith"], "aliza");
  const scope = { contacts: new Set(), companies: new Set() };
  const p = planIntake({ ctx, parsed: parsedOf(), extraction: EXTRACTION,
    data: dataOf({ contacts: [{ sk: "CT-777", email: "dana@riverchurch.org" }] }), scope });
  assert.equal(p.person.matched, null);
  assert.equal(p.outOfScopeDuplicate, true);
  assert.equal(JSON.stringify(p.flags).includes("CT-777"), false, "the forwarder is never told another lab's record exists");
});

test("no usable person email stops with a request for the contact", () => {
  const p = plan({ x: { person: { ...EXTRACTION.person, email: "" } },
    parsed: { forwarded: { from: { name: "Liz", address: "liz@optimisticlabs.com" }, to: [], cc: [], subject: "", body: "", date: "" } } });
  assert.equal(p.outcome, "needs-contact");
});

test("when the forwarder wrote the email, the first outside recipient is the person", () => {
  const parsed = parsedOf({ forwarded: { from: { name: "Liz", address: "liz@optimisticlabs.com" },
    to: [{ name: "", address: "aliza@optimisticlabs.com" }, { name: "Dana", address: "dana@riverchurch.org" }], cc: [], subject: "", body: "", date: "" } });
  assert.equal(externalPersonEmail(parsed), "dana@riverchurch.org");
});

test("an intent the Optimist doesn't know changes nothing", () => {
  assert.equal(plan({ x: { intent: "unknown" } }).outcome, "unknown-intent");
});

test("a deal name falls back to company-or-person when the model gave none", () => {
  const p = plan({ x: { deal: { ...EXTRACTION.deal, name: "" } } });
  assert.equal(p.deal.name, "River Church (from email)");
});

/* ---------- reply ---------- */
test("the dry-run reply says nothing was created, then lists what would be", () => {
  const r = buildReply({ kind: "plan", mode: "dry-run", plan: plan({ x: { person: { ...EXTRACTION.person } } }), subject: "Board retreat" });
  assert.match(r.text, /^Dry run: nothing was created/);
  assert.match(r.text, /Person:\s+Dana Whitfield, dana@riverchurch.org\s+\(new\)/);
  assert.match(r.text, /Nothing to address\./);
  assert.equal(r.subject, "Re: Board retreat");
});

test("reply HTML escapes what a stranger wrote", () => {
  const p = plan({ x: { deal: { ...EXTRACTION.deal, name: "<script>x</script>" } } });
  assert.doesNotMatch(buildReply({ kind: "plan", mode: "dry-run", plan: p }).html, /<script>/);
});

/* ---------- the whole flow ---------- */
test("an Admin's forward is planned and answered, and NOTHING reaches Pipeline", async () => {
  const { out, sent } = await run(mime());
  assert.equal(out.status, "done");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].toEmail, "liz@optimisticlabs.com");
  assert.match(sent[0].text, /Dry run/);
  assert.equal(ofType("DEAL").length + ofType("CONTACT").length + ofType("COMPANY").length, 0);
  const [row] = ofType("INBOUND");
  assert.equal(row.status, "done");
  assert.equal(row.dryRun, true);
  assert.equal(row.plan.lab, "faith");
  assert.ok(row.ttl > 0);
  assert.equal(ofType("AUDIT")[0].action, "pipeline.email-intake");
});

test("the INBOUND row keeps the decision but not the thread", async () => {
  await run(mime());
  const json = JSON.stringify(ofType("INBOUND"));
  assert.doesNotMatch(json, /Executive Director|555-123-4567/);
});

test("the same message delivered twice is processed once", async () => {
  const first = await run(mime());
  const second = await run(mime());
  assert.equal(first.out.status, "done");
  assert.equal(second.out.status, "duplicate");
  assert.equal(second.sent.length, 0);
  assert.equal(ofType("INBOUND").length, 1);
});

test("a spoofed sender is dropped with no reply, and logged as rejected", async () => {
  const { out, sent } = await run(mime({ from: "Liz <liz@optimisticlabs.com>", auth: "X-Foo: bar" }));
  assert.equal(out.status, "rejected");
  assert.equal(sent.length, 0);
  assert.equal(ofType("INBOUND")[0].reason, "no-ses-authentication-results");
});

test("an authenticated sender with no portal account, or an offboarded one, gets no reply", async () => {
  assert.equal((await run(mime({ from: "Nobody <nobody@optimisticlabs.com>", id: "<a@x>" }))).sent.length, 0);
  seed("PERSON", "gone@optimisticlabs.com", { email: "gone@optimisticlabs.com", role: "Admin", active: false });
  const r = await run(mime({ from: "Gone <gone@optimisticlabs.com>", id: "<b@x>" }));
  assert.equal(r.out.reason, "no-active-person");
  assert.equal(r.sent.length, 0);
});

test("a Contributor is told Pipeline intake isn't for them, and the model is never called", async () => {
  let called = false;
  const { out, sent } = await run(mime({ from: "Sam <sam@optimisticlabs.com>", id: "<c@x>" }),
    { extractFn: async () => { called = true; return EXTRACTION; } });
  assert.equal(out.reason, "contributor");
  assert.equal(called, false);
  assert.match(sent[0].text, /Admins and Lab Leaders/);
});

test("a Lab Leader's deal is planned in their own lab even if the note asks for another", async () => {
  const { out } = await run(mime({ from: "Aliza <aliza@optimisticlabs.com>", id: "<d@x>", note: "Democracy lab please" }));
  assert.equal(out.plan.lab, "faith");
});

test("an Admin with no lab settled is held and told to pick one", async () => {
  const { out, sent } = await run(mime({ id: "<e@x>", note: "" }),
    { extraction: { ...EXTRACTION, deal: { ...EXTRACTION.deal, labHint: "" } } });
  assert.equal(out.plan.outcome, "held");
  assert.match(sent[0].text, /no lab chosen yet/);
  assert.match(sent[0].text, /Pick one/);
});

test("an extraction failure tells the forwarder and stops cleanly", async () => {
  const { out, sent } = await run(mime({ id: "<f@x>" }), { extractFn: async () => { throw new Error("overloaded"); } });
  assert.equal(out.status, "failed");
  assert.match(sent[0].text, /Something went wrong/);
  assert.equal(ofType("INBOUND")[0].status, "failed");
});

test("a failed reply is recorded, not thrown", async () => {
  const out = await processMessage(Buffer.from(mime({ id: "<g@x>" })), {
    now: new Date("2026-11-12T15:00:00Z"),
    deps: { send: async () => { throw new Error("sandbox: address not verified"); }, extract: async () => EXTRACTION }
  });
  assert.equal(out.status, "done");
  assert.match(ofType("INBOUND")[0].replyError, /sandbox/);
});

test("a sender over 30 intakes an hour is ignored with no reply", async () => {
  for (let n = 0; n < 30; n++)
    seed("INBOUND", `2026-11-12T14:${String(10 + (n % 40)).padStart(2, "0")}:00.000Z#${n}`, { from: "liz@optimisticlabs.com" });
  const { out, sent } = await run(mime({ id: "<h@x>" }));
  assert.equal(out.reason, "sender-rate-limit");
  assert.equal(sent.length, 0);
});
