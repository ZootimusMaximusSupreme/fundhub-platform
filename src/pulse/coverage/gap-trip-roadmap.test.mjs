// trip:roadmap, both ways. A buyer stuck on a step the company owes goes red and names the step. A buyer
// who has not filled the form yet, or who was reminded, stays green. No database.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHECK_IDS, FORM_REMINDER_MS, PULL_DUE_MS, ROW_CAP, SIGN_IN_GRACE_MS, STEPS, TRIP_SQL, WINDOW_MS,
  gapChecks, judgeRoadmap, toTripRow, tripParams
} from "./gap-trip-roadmap.mjs";
import { LOOKBACK_MS } from "./gap-money-funding.mjs";
import { SIGN_IN_GRACE } from "./gap-portal.mjs";
import {
  AUTO_QUEUED_MINUTES, NUDGE_DEAD_STATUSES, NUDGE_KEYS, PAID_FORM_HOURS, PROCESSING_MINUTES
} from "./gap-soft-pull.mjs";
import {
  GRACE_MS, PACK_ANCHOR_SUBTYPES, PACK_EMAIL_PATHS, PACK_EMAIL_TEMPLATE, PACK_SUBTYPES
} from "./gap-underwrite.mjs";
import { BY, walkTrip } from "./trip-kit.mjs";
import { tagDb } from "./money-test-kit.mjs";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-14T18:00:00.000Z");
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const ORG = "11111111-1111-4111-8111-111111111111";

function sqlRow(over = {}) {
  return {
    client_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", client_code: "FH-000401", email: "buyer@gmail.com",
    paid_at: null, form_filled_at: null, credit_file_at: null, live_consent_at: null, nudge_at: null, pull_done_at: null,
    subtypes: null, first_at: null, last_at: null, empty_n: 0, short_n: 0, core_n: 0, email_path: false,
    tier: null, email_at: null, signed_in: false, access_since: null,
    ...over
  };
}

const FUNDING_PACK = [...PACK_SUBTYPES, "funding_summary", "business_duplication_map"];

/** A buyer with a whole pack and its email. */
function packed(over = {}) {
  return sqlRow({
    paid_at: ago(5 * DAY), form_filled_at: ago(5 * DAY), pull_done_at: ago(5 * DAY + 20 * MIN),
    subtypes: FUNDING_PACK, first_at: ago(5 * DAY - 10 * MIN), last_at: ago(5 * DAY - 12 * MIN), core_n: 4,
    email_path: true, tier: "FULL_FUNDING", email_at: ago(5 * DAY - 15 * MIN), access_since: ago(5 * DAY - 10 * MIN),
    signed_in: true,
    ...over
  });
}

function walkRow(over) {
  const t = toTripRow(sqlRow(over), NOW);
  return walkTrip({ steps: STEPS, facts: t.facts, now: NOW, notOwed: t.notOwed, ended: t.ended, stall: t.stall, detail: t.detail, defects: t.defects });
}

function walkPacked(over) {
  const t = toTripRow(packed(over), NOW);
  return walkTrip({ steps: STEPS, facts: t.facts, now: NOW, notOwed: t.notOwed, ended: t.ended, stall: t.stall, detail: t.detail, defects: t.defects });
}

/* ---------- constants ---------- */

test("the check id and the ladder are the brief's", () => {
  assert.deepEqual([...CHECK_IDS], ["trip:roadmap"]);
  assert.deepEqual(STEPS.map((s) => s.key), ["roadmap_paid", "pull_form_filled", "pack_delivered", "portal_sign_in"]);
  assert.deepEqual(STEPS.filter((s) => s.by === BY.SYSTEM).map((s) => s.key), ["pack_delivered"]);
});

test("every wait is another lane's own number", () => {
  const pack = STEPS.find((s) => s.key === "pack_delivered");
  assert.equal(pack.graceMs, GRACE_MS);
  assert.equal(GRACE_MS, 2 * HOUR);
  assert.equal(FORM_REMINDER_MS, PAID_FORM_HOURS * HOUR);
  assert.equal(PAID_FORM_HOURS, 2);
  assert.equal(PULL_DUE_MS, (AUTO_QUEUED_MINUTES + PROCESSING_MINUTES) * MIN);
  assert.equal(PULL_DUE_MS, 30 * MIN);
  assert.equal(SIGN_IN_GRACE, "72 hours");
  assert.equal(SIGN_IN_GRACE_MS, 72 * HOUR);
  assert.equal(WINDOW_MS, LOOKBACK_MS);
  assert.ok(/\w/.test(pack.source));
});

test("the SELECT writes nothing, uses parameters 1 to 9, and names the fields the underwrite judges read", () => {
  const bare = TRIP_SQL.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  assert.match(bare, /^SELECT\b/i);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|BEGIN|COMMIT|ROLLBACK)\b/i.test(bare));
  const used = [...new Set([...TRIP_SQL.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  assert.deepEqual(used, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.match(TRIP_SQL, new RegExp(`LIMIT ${ROW_CAP}\\b`));
  for (const f of ["subtypes", "first_at", "last_at", "empty_n", "short_n", "core_n", "email_path", "tier", "email_at"]) {
    assert.match(TRIP_SQL, new RegExp(`AS\\s+${f}\\b`), `${f} must be selected`);
  }
  const p = tripParams(ORG, NOW);
  assert.equal(p.length, 9);
  assert.deepEqual(p[3], PACK_ANCHOR_SUBTYPES);
  assert.deepEqual(p[4], PACK_SUBTYPES);
  assert.deepEqual(p[5], PACK_EMAIL_PATHS);
  assert.equal(p[6], PACK_EMAIL_TEMPLATE);
  assert.deepEqual(p[7], [...NUDGE_KEYS]);
  assert.deepEqual(p[8], [...NUDGE_DEAD_STATUSES]);
});

/* ---------- RED ---------- */

test("RED: paid 3 hours ago, the form is empty, and no reminder went out", () => {
  const w = walkRow({ paid_at: ago(3 * HOUR) });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "pull_form_filled");
  assert.match(w.why, /empty for over 2 hours and no reminder text or email went out/);
});

test("RED: the form is filled, the pull should have finished, and 3 hours later there is no pack", () => {
  const w = walkRow({ paid_at: ago(5 * HOUR), form_filled_at: ago(4 * HOUR) });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "pack_delivered");
  assert.match(w.why, /"the credit pull was due to finish" was/);
});

test("RED: the pull finished 3 hours ago and no pack file was saved", () => {
  const w = walkRow({ paid_at: ago(DAY), form_filled_at: ago(DAY), pull_done_at: ago(3 * HOUR) });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "pack_delivered");
});

test("RED: the saved pack is missing a promised file", () => {
  const w = walkPacked({ subtypes: ["credit_analysis_report", "funding_snapshot"], core_n: 2 });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "pack_delivered");
  assert.match(w.why, /the saved pack is missing the/);
});

test("RED: the saved pack has an empty file", () => {
  const w = walkPacked({ empty_n: 1 });
  assert.equal(w.state, "broken");
  assert.match(w.why, /1 pack file with 0 bytes/);
});

test("RED: the pack is whole and no pack-ready email was queued", () => {
  const w = walkPacked({ email_at: null });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "pack_delivered");
  assert.match(w.why, /no pack-ready email was queued/);
});

test("RED: access has been held for 4 days and the buyer never signed in", () => {
  const w = walkPacked({ access_since: ago(4 * DAY), signed_in: false });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "portal_sign_in");
  assert.match(w.why, /held access for over 72 hours and has never signed in/);
});

/* ---------- GREEN ---------- */

test("GREEN: paid 30 minutes ago and the form is empty is inside the reminder's wait", () => {
  const w = walkRow({ paid_at: ago(30 * MIN) });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "pull_form_filled");
  assert.equal(w.step.by, BY.CLIENT);
});

test("GREEN: paid 2 days ago, the form is empty, and the reminder went out", () => {
  const w = walkRow({ paid_at: ago(2 * DAY), nudge_at: ago(2 * DAY - 3 * HOUR) });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "pull_form_filled");
});

test("GREEN: a buyer with a live soft-pull consent counts as filled, as the soft-pull lane counts them", () => {
  const w = walkRow({ paid_at: ago(5 * DAY), live_consent_at: ago(5 * DAY) });
  assert.notEqual(w.state, "broken");
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "pack_delivered");
});

test("GREEN: a buyer on a test or company address is never sent a reminder, so is never missed", () => {
  for (const email of ["x@fundhub.ai", "someone@example.com", "tester+e2e@gmail.com"]) {
    const w = walkRow({ paid_at: ago(5 * DAY), email });
    assert.notEqual(w.state, "broken", email);
  }
});

test("GREEN: the form is filled and the pull is still inside its 30 minutes plus the pack's 2 hours", () => {
  const w = walkRow({ paid_at: ago(2 * HOUR), form_filled_at: ago(90 * MIN) });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "pack_delivered");
});

test("GREEN: a buyer with only an old credit file and no form has no pack clock", () => {
  const w = walkRow({ paid_at: ago(5 * DAY), credit_file_at: ago(40 * DAY), nudge_at: null });
  assert.notEqual(w.state, "broken");
});

test("GREEN: a pack still being saved (the newest file under 30 minutes old) is not judged", () => {
  const w = walkPacked({
    subtypes: ["credit_analysis_report"], core_n: 1, last_at: ago(10 * MIN), first_at: ago(11 * MIN),
    email_at: null, access_since: ago(10 * MIN)
  });
  assert.notEqual(w.state, "broken");
});

test("GREEN: a pack with no summary and an unknown credit tier is 'unsure', not red", () => {
  const w = walkPacked({ subtypes: [...PACK_SUBTYPES, "business_duplication_map"], tier: null });
  assert.notEqual(w.state, "broken");
});

test("GREEN: a repair-tier pack is not owed the funding summary", () => {
  const w = walkPacked({ subtypes: [...PACK_SUBTYPES, "business_duplication_map"], tier: "REPAIR_ONLY" });
  assert.notEqual(w.state, "broken");
});

test("GREEN: a signed-in buyer with a whole pack is a finished trip", () => {
  const w = walkPacked({ signed_in: true });
  assert.equal(w.state, "finished");
});

test("GREEN: access held for 2 days and not signed in yet is inside the 72 hours", () => {
  const w = walkPacked({ access_since: ago(2 * DAY), signed_in: false });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "portal_sign_in");
});

/* ---------- the verdict and the lane ---------- */

test("judgeRoadmap: nobody paid is a plain green line, not a nothing-to-judge row", () => {
  const r = judgeRoadmap({ rows: [], now: NOW });
  assert.equal(r.status, "PASS");
  assert.equal(r.na, undefined);
  assert.match(r.detail, /^Nobody started the .* trip in the last 60 days, so nobody is stuck\./);
});

test("judgeRoadmap: a stuck buyer is FAIL with the step; a waiting one is PASS", () => {
  const bad = judgeRoadmap({ rows: [sqlRow({ client_code: "FH-000555", paid_at: ago(3 * HOUR) })], now: NOW });
  assert.equal(bad.status, "FAIL");
  assert.match(bad.detail, /FH-000555 stopped at "filled the pull form"/);
  assert.match(bad.detail, /^1 of 1 buyer who started the roadmap trip/);
  const ok = judgeRoadmap({ rows: [packed({ signed_in: false, access_since: ago(DAY) })], now: NOW });
  assert.equal(ok.status, "PASS");
  assert.match(ok.detail, /1 waiting \(1 at "signed in to the portal"\)/);
});

test("gapChecks: one read, a skip on a failed read, a skip with no database", async () => {
  const seen = [];
  const db = tagDb({ "trip-roadmap": [sqlRow({ paid_at: ago(3 * HOUR) })] }, seen);
  const out = await gapChecks({ db, orgId: ORG, now: NOW });
  assert.equal(out[0].status, "FAIL");
  assert.equal(seen.length, 1);
  const bad = await gapChecks({ db: { async query() { throw new Error("relation \"documents\" does not exist"); } }, orgId: ORG, now: NOW });
  assert.equal(bad[0].status, "skip");
  assert.equal((await gapChecks({}))[0].status, "skip");
});


