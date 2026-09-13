/* The roster · who the Directory and Community's Members tab list.

   Members used to be "every active Lab Leader or Contributor", a filter
   inherited from the original bench page, so an Admin never appeared. The
   rule is now isMember in lib/data.ts — every account that has not been
   offboarded, whatever the role, welcome screen or not — and these pin it,
   along with the card mapping around it.

   Runs the real lib/data.ts under Node's own type stripping, so nothing here
   is a copy of the rule: a change to isMember or benchRoster is a change to
   what these read.

   Run: npm test (in web/) */

import test from "node:test";
import assert from "node:assert/strict";
import { benchRoster, isMember, roleLine } from "../lib/data.ts";

const LABS = [
  { id: "sports", name: "Sports Lab" },
  { id: "philanthropy", name: "Philanthropy Lab" },
];

const person = (username, over = {}) => ({
  username,
  firstName: username[0].toUpperCase() + username.slice(1),
  lastName: "T",
  role: "Contributor",
  labs: [],
  onboarded: true,
  ...over,
});

/* What bootstrap's `people` looks like once portal-data has re-attached the
   usernames: one entry per person, every role, offboarded people included so
   that an old owner reference still resolves to a name. */
const BENCH = [
  person("liz", { role: "Admin" }),
  person("marcus", { role: "Admin", labs: ["sports"] }),
  person("nora", { role: "Lab Leader", labs: ["sports", "philanthropy"] }),
  person("cass", {
    labs: ["sports"],
    bench: { blurb: "Data pipelines", specialties: ["SQL", "dbt"], email: "cass@ol.test" },
    photo: "data:image/png;base64,AAAA",
  }),
  // Has an account, has not filled in the welcome screen (or skipped it).
  person("pat", { onboarded: false }),
  person("quinn", { onboarded: undefined }),
  // Offboarded — the record is kept, marked, and never on the roster.
  person("dana", { role: "Lab Leader", labs: ["sports"], active: false }),
  // Written before offboarding existed: no `active` field at all, and active.
  person("evan", { active: undefined }),
];

const ids = (roster) => roster.map((p) => p.id);

test("an onboarded Admin is on the roster, and reads as one", () => {
  const roster = benchRoster(BENCH, LABS);
  const liz = roster.find((p) => p.id === "liz");
  assert.ok(liz, "the Admin is missing");
  assert.equal(liz.role, "Admin");
  assert.equal(roster.find((p) => p.id === "marcus")?.role, "Admin · Sports Lab");
});

test("an onboarded Lab Leader and Contributor are on it too", () => {
  const roster = benchRoster(BENCH, LABS);
  assert.ok(ids(roster).includes("nora"));
  assert.ok(ids(roster).includes("cass"));
  assert.equal(roster.find((p) => p.id === "cass")?.role, "Contributor · Sports Lab");
});

test("someone who has not finished the welcome screen is on it too — an account is enough", () => {
  assert.equal(isMember(person("pat", { onboarded: false })), true);
  assert.equal(isMember(person("quinn", { onboarded: undefined })), true);
  const roster = benchRoster(BENCH, LABS);
  assert.ok(ids(roster).includes("pat"));
  assert.ok(ids(roster).includes("quinn"));
  // Nothing on the card depends on the flag.
  assert.equal(roster.find((p) => p.id === "pat")?.engage, undefined);
});

test("an offboarded person is not; a record with no active flag at all is", () => {
  assert.equal(isMember(person("dana", { active: false })), false);
  assert.equal(isMember(person("evan", { active: undefined })), true);
  const roster = benchRoster(BENCH, LABS);
  assert.ok(!ids(roster).includes("dana"));
  assert.ok(ids(roster).includes("evan"));
});

test("the whole roster: every active account once, in the order given", () => {
  assert.deepEqual(ids(benchRoster(BENCH, LABS)),
    ["liz", "marcus", "nora", "cass", "pat", "quinn", "evan"]);
});

test("a person in two labs is one card carrying both lab names", () => {
  const roster = benchRoster(BENCH, LABS);
  const noras = roster.filter((p) => p.id === "nora");
  assert.equal(noras.length, 1);
  assert.deepEqual(noras[0].labs, ["Sports Lab", "Philanthropy Lab"]);
  assert.equal(noras[0].role, "Lab Leader · Sports Lab · Philanthropy Lab");
});

test("a card carries only what the UI draws", () => {
  const cass = benchRoster(BENCH, LABS).find((p) => p.id === "cass");
  assert.deepEqual(cass, {
    id: "cass",
    name: "Cass T",
    initials: "CT",
    role: "Contributor · Sports Lab",
    labs: ["Sports Lab"],
    engage: "Data pipelines",
    tags: ["SQL", "dbt"],
    contact: "cass@ol.test",
    photo: "data:image/png;base64,AAAA",
  });
});

test("a lab id the portal no longer knows is shown as-is rather than dropped", () => {
  const [p] = benchRoster([person("rae", { labs: ["retired"] })], LABS);
  assert.deepEqual(p.labs, ["retired"]);
  assert.equal(roleLine(person("rae", { labs: ["retired"] }), LABS), "Contributor · retired");
});

test("isMember tolerates a missing record", () => {
  assert.equal(isMember(undefined), false);
  assert.equal(isMember(null), false);
});
