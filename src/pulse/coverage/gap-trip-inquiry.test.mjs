// trip:inquiry, both ways. A case stuck on a step the company owes goes red and names the step. A case
// waiting on the bureau, on a person, or held by a fraud alert stays green. No database.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHECK_IDS, ROW_CAP, STEPS, TRIP_SQL, WINDOW_MS, gapChecks, judgeInquiry, toTripRow, tripParams
} from "./gap-trip-inquiry.mjs";
import {
  CALL_DUE_STATUSES, CALL_GRACE_MS, GATE_SOURCE, LETTER_STATUSES, STUCK_AFTER_MS
} from "./gap-inquiry.mjs";
import { LOOKBACK_MS } from "./gap-money-funding.mjs";
import { SETTLE_GRACE_MS } from "./gap-pipeline-facts.mjs";
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
    client_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", client_code: "FH-000301",
    deposit_event_at: null, gate_raised_at: null, raised_bureaus: [], gate_clear_at: null,
    started_at: null, cases_n: 0, completed_n: 0, completed_at: null, case_bureaus: [],
    letters_owed_n: 0, letters_missing_n: 0, calls_fired_n: 0, stuck_idle_n: 0, stuck_call_n: 0,
    removed_event_at: null, product_path: null, ready_for_next_round: false, hold_reason: null, fraud_alert: false,
    ...over
  };
}

/** A pass the gate raised for three bureaus: three cases, three letters, the gate event. */
function raised(over = {}) {
  return sqlRow({
    deposit_event_at: ago(3 * DAY), gate_raised_at: ago(3 * DAY), raised_bureaus: ["EQ", "EX", "TU"],
    started_at: ago(3 * DAY), cases_n: 3, case_bureaus: ["EQ", "EX", "TU"], letters_owed_n: 3, letters_missing_n: 0,
    ...over
  });
}

function walkRow(over) {
  const t = toTripRow(sqlRow(over), NOW);
  return walkTrip({ steps: STEPS, facts: t.facts, now: NOW, notOwed: t.notOwed, ended: t.ended, stall: t.stall, detail: t.detail });
}

test("the check id is the one in the brief and the ladder is its seven steps", () => {
  assert.deepEqual([...CHECK_IDS], ["trip:inquiry"]);
  assert.deepEqual(STEPS.map((s) => s.key), ["gate", "cases", "letters", "calls", "removed", "event_fired", "funding_resumes"]);
});

test("the waits and clocks are the other lanes' own", () => {
  for (const s of STEPS.filter((x) => x.by === BY.SYSTEM)) {
    assert.equal(s.graceMs, SETTLE_GRACE_MS, `${s.key} uses the 15 minute settle wait`);
    assert.ok(s.from && /\w/.test(s.source || ""), `${s.key} names its anchor and source`);
  }
  assert.equal(SETTLE_GRACE_MS, 15 * MIN);
  assert.equal(WINDOW_MS, LOOKBACK_MS);
  assert.equal(STUCK_AFTER_MS, 72 * HOUR);
  assert.equal(CALL_GRACE_MS, 45 * MIN);
});

test("the parameters are the org, the window, the test pattern, the gate source, the letter statuses and the two cuts", () => {
  const p = tripParams(ORG, NOW);
  assert.equal(p.length, 8);
  assert.equal(p[0], ORG);
  assert.equal(new Date(p[1]).getTime(), NOW.getTime() - WINDOW_MS);
  assert.equal(p[3], GATE_SOURCE);
  assert.deepEqual(p[4], LETTER_STATUSES);
  assert.equal(new Date(p[5]).getTime(), NOW.getTime() - STUCK_AFTER_MS);
  assert.deepEqual(p[6], CALL_DUE_STATUSES);
  assert.equal(new Date(p[7]).getTime(), NOW.getTime() - CALL_GRACE_MS);
});

test("the SELECT writes nothing and uses parameters 1 to 8", () => {
  const bare = TRIP_SQL.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  assert.match(bare, /^SELECT\b/i);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|BEGIN|COMMIT|ROLLBACK)\b/i.test(bare));
  const used = [...new Set([...TRIP_SQL.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  assert.deepEqual(used, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.match(TRIP_SQL, new RegExp(`LIMIT ${ROW_CAP}\\b`));
});

test("the stuck conditions copy gap-inquiry.mjs STUCK_SQL clause for clause", () => {
  const s = TRIP_SQL.replace(/\s+/g, " ");
  assert.match(s, /irc\.closed_at IS NULL AND \(\(irc\.case_status::text = 'Escalated' AND irc\.updated_at < \$6::timestamptz\)/);
  assert.match(s, /irc\.call_due_at IS NULL AND irc\.call_fired_at IS NULL AND irc\.updated_at < \$6::timestamptz/);
  assert.match(s, /irc\.call_due_at IS NOT NULL AND irc\.call_due_at <= \$8::timestamptz AND irc\.call_fired_at IS NULL/);
});

/* ---------- RED ---------- */

test("RED: the deposit was paid 3 hours ago and the gate left no case and no event", () => {
  const w = walkRow({ deposit_event_at: ago(3 * HOUR) });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "gate");
  assert.match(w.why, /"the deposit payment" was 3 hours ago/);
});

test("RED: the gate raised three bureaus and one has no case", () => {
  const w = walkRow(raised({ cases_n: 2, case_bureaus: ["EQ", "EX"] }));
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "cases");
  assert.match(w.why, /TU has no case/);
});

test("RED: a gate case with open inquiries has no draft letter an hour after the case", () => {
  const w = walkRow(raised({ letters_missing_n: 1, started_at: ago(HOUR) }));
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "letters");
});

test("RED: a call came due and the sweeper did not fire it", () => {
  const w = walkRow(raised({ stuck_call_n: 1 }));
  assert.equal(w.state, "broken");
  assert.match(w.why, /came due and the call sweeper did not fire it within its 3 runs/);
});

test("RED: a case idle 72 hours with no call scheduled", () => {
  const w = walkRow(raised({ stuck_idle_n: 2 }));
  assert.equal(w.state, "broken");
  assert.match(w.why, /2 cases have been Escalated or waiting with no call scheduled and no update for 72 hours/);
});

test("RED: every case is completed and no inquiry.removed event followed", () => {
  const w = walkRow(raised({ completed_n: 3, completed_at: ago(2 * HOUR), calls_fired_n: 3 }));
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "event_fired");
});

test("RED: inquiry.removed fired, the client bought funding, and funding was not marked ready", () => {
  const w = walkRow(raised({
    completed_n: 3, completed_at: ago(3 * HOUR), calls_fired_n: 3, removed_event_at: ago(2 * HOUR),
    product_path: "Funding", ready_for_next_round: false
  }));
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "funding_resumes");
});

/* ---------- GREEN ---------- */

test("GREEN: a deposit paid 10 minutes ago is still inside the gate's wait", () => {
  const w = walkRow({ deposit_event_at: ago(10 * MIN) });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "gate");
});

test("GREEN: cases raised, waiting for a call to be scheduled, is waiting on a person", () => {
  const w = walkRow(raised());
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "calls");
  assert.equal(w.step.by, BY.PERSON);
});

test("GREEN: a case waiting on the bureau for two weeks is not red (only the 72 hour idle clock is)", () => {
  const w = walkRow(raised({ started_at: ago(14 * DAY), calls_fired_n: 3, stuck_idle_n: 0 }));
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "removed");
});

test("GREEN: a gate that found nothing to remove is an ended trip", () => {
  const w = walkRow({ deposit_event_at: ago(DAY), gate_clear_at: ago(DAY) });
  assert.equal(w.state, "ended");
});

test("GREEN: a fraud alert holds funding on purpose and is not red", () => {
  const w = walkRow(raised({
    completed_n: 3, completed_at: ago(3 * HOUR), removed_event_at: ago(2 * HOUR),
    product_path: "Funding", ready_for_next_round: false, fraud_alert: true
  }));
  assert.equal(w.state, "ended");
  assert.match(w.why, /fraud alert/);
});

test("GREEN: a customer who did not buy funding owes no funding step", () => {
  const w = walkRow(raised({
    completed_n: 3, completed_at: ago(3 * HOUR), calls_fired_n: 3, removed_event_at: ago(2 * HOUR), product_path: "Repair"
  }));
  assert.equal(w.state, "finished");
});

test("GREEN: a case from the bureau's own webhook owes no draft letter", () => {
  const w = walkRow(sqlRow({
    started_at: ago(2 * DAY), cases_n: 1, case_bureaus: ["EQ"], letters_owed_n: 0, letters_missing_n: 0
  }));
  assert.equal(w.state, "waiting");
  assert.notEqual(w.step.key, "letters");
});

test("GREEN: the whole trip is finished", () => {
  const w = walkRow(raised({
    completed_n: 3, completed_at: ago(3 * DAY), calls_fired_n: 3, removed_event_at: ago(2 * DAY),
    product_path: "Funding", ready_for_next_round: true
  }));
  assert.equal(w.state, "finished");
});

/* ---------- the verdict and the lane ---------- */

test("judgeInquiry: nobody went through the gate is a plain green line, not a nothing-to-judge row", () => {
  const r = judgeInquiry({ rows: [], now: NOW });
  assert.equal(r.status, "PASS");
  assert.equal(r.na, undefined);
  assert.match(r.detail, /^Nobody started the .* trip in the last 60 days, so nobody is stuck\./);
});

test("judgeInquiry: a stuck customer is FAIL with the step", () => {
  const r = judgeInquiry({ rows: [sqlRow({ client_code: "FH-000888", deposit_event_at: ago(3 * HOUR) })], now: NOW });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /FH-000888 stopped at "inquiry gate ran"/);
});

test("judgeInquiry: waiting customers are PASS", () => {
  const r = judgeInquiry({ rows: [raised()], now: NOW });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /1 waiting \(1 at "bureau call fired"\)/);
});

test("gapChecks: one read, a skip on a failed read, a skip with no database", async () => {
  const seen = [];
  const db = tagDb({ "trip-inquiry": [sqlRow({ deposit_event_at: ago(3 * HOUR) })] }, seen);
  const out = await gapChecks({ db, orgId: ORG, now: NOW });
  assert.equal(out[0].status, "FAIL");
  assert.equal(seen.length, 1);
  const bad = await gapChecks({ db: { async query() { throw new Error("relation \"inquiry_removal_cases\" does not exist"); } }, orgId: ORG, now: NOW });
  assert.equal(bad[0].status, "skip");
  const none = await gapChecks({});
  assert.equal(none[0].status, "skip");
});


