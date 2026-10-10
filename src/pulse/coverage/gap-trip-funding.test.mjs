// trip:funding, both ways. A trip stuck on a step the company owes must go red and name the step.
// A trip waiting on a person or on the customer must stay green. No database: a fake db answers by tag.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  CHECK_IDS, FUNDED_CARD_STAGES, HELD_OUTCOMES, ROW_CAP, SALES_PAID_OR_LATER, STEPS, TRIP_SQL,
  WINDOW_MS, gapChecks, judgeFunding, toTripRow, tripParams
} from "./gap-trip-funding.mjs";
import { CARD_STACKING, FUNDED_BILL_WAIT_MS, LOOKBACK_MS, roundProblems } from "./gap-money-funding.mjs";
import { PAID_GRACE_MS, SETTLE_GRACE_MS } from "./gap-pipeline-facts.mjs";
import { BY, walkTrip } from "./trip-kit.mjs";
import { tagDb } from "./money-test-kit.mjs";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-10T18:00:00.000Z");
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const ORG = "11111111-1111-4111-8111-111111111111";

/** A SQL row for one customer. Overrides win. */
function sqlRow(over = {}) {
  return {
    client_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    client_code: "FH-000101",
    diagnostic_paid_at: null, deposit_paid_at: null,
    sales_card_at: null, sales_stage: null,
    booked_at: null, call_held_at: null, last_outcome: null,
    funding_card_at: null, funding_stage: null,
    round_id: null, round_number: null, round_status: null, round_opened_at: null, funded_at: null,
    card_stacking: null, has_closeout: false, bills: 0, linked_sales: 0, back_end_staff: 0,
    commission_rows: 0, confirmed_approvals: 0, excluded_approvals: 0, fee_percent: null,
    approved_at: null, submitted_at: null,
    ...over
  };
}

function walkRow(over) {
  const t = toTripRow(sqlRow(over), NOW);
  return walkTrip({ steps: STEPS, facts: t.facts, now: NOW, notOwed: t.notOwed, ended: t.ended, stall: t.stall, detail: t.detail });
}

/** A card-stacking customer who is funded, billed and paid commission. Everything the money chain owes. */
function whole(over = {}) {
  return sqlRow({
    diagnostic_paid_at: ago(40 * DAY), sales_card_at: ago(39 * DAY), sales_stage: "closed_won",
    booked_at: ago(38 * DAY), call_held_at: ago(37 * DAY), last_outcome: "deposit",
    deposit_paid_at: ago(37 * DAY), funding_card_at: ago(36 * DAY), funding_stage: "funded",
    round_id: "r1", round_number: 1, round_status: "funded", round_opened_at: ago(36 * DAY),
    funded_at: ago(10 * DAY), card_stacking: true, has_closeout: true, bills: 1, linked_sales: 1,
    back_end_staff: 1, commission_rows: 2, confirmed_approvals: 1, excluded_approvals: 0, fee_percent: 10,
    approved_at: ago(12 * DAY), submitted_at: ago(20 * DAY),
    ...over
  });
}

/* ---------- the numbers are the other lanes' own ---------- */

test("the check id is the one written in the brief", () => {
  assert.deepEqual([...CHECK_IDS], ["trip:funding"]);
});

test("every wait is the number another lane already uses, and each step says where it comes from", () => {
  const by = Object.fromEntries(STEPS.map((s) => [s.key, s]));
  assert.equal(by.sales_card.graceMs, PAID_GRACE_MS);
  assert.equal(by.funding_card.graceMs, PAID_GRACE_MS);
  assert.equal(by.round_opened.graceMs, SETTLE_GRACE_MS);
  for (const k of ["closeout", "invoice", "commission"]) assert.equal(by[k].graceMs, FUNDED_BILL_WAIT_MS);
  assert.equal(PAID_GRACE_MS, HOUR);
  assert.equal(SETTLE_GRACE_MS, 15 * MIN);
  assert.equal(FUNDED_BILL_WAIT_MS, 30 * MIN);
  for (const s of STEPS) {
    if (s.by === BY.SYSTEM) {
      assert.ok(s.from, `${s.key}: a system step names the step its clock starts at`);
      assert.ok(s.graceMs > 0, `${s.key}: a system step has a wait`);
      assert.ok(typeof s.source === "string" && s.source.length > 10, `${s.key}: say where the wait comes from`);
    }
  }
  assert.equal(WINDOW_MS, LOOKBACK_MS);
});

test("the ladder is the brief's thirteen steps in order", () => {
  assert.deepEqual(STEPS.map((s) => s.key), [
    "diagnostic_paid", "sales_card", "booked", "call_held", "deposit_paid", "funding_card",
    "round_opened", "submitted", "approved", "funded", "closeout", "invoice", "commission"
  ]);
  const owner = Object.fromEntries(STEPS.map((s) => [s.key, s.by]));
  assert.deepEqual(
    Object.entries(owner).filter(([, v]) => v === BY.SYSTEM).map(([k]) => k),
    ["sales_card", "funding_card", "round_opened", "closeout", "invoice", "commission"]
  );
});

test("constants name the same stages and outcomes the code writes", () => {
  assert.ok(SALES_PAID_OR_LATER.includes("diagnostic_paid"));
  assert.ok(SALES_PAID_OR_LATER.includes("closed_won"));
  assert.deepEqual([...FUNDED_CARD_STAGES], ["funded"]);
  assert.ok(!HELD_OUTCOMES.includes("no_show"), "a no show is not a held call");
  const seed = fs.readFileSync(new URL("../../../db/seed/002_pipelines.sql", import.meta.url), "utf8");
  for (const k of ["diagnostic_paid", "decision_rendered", "closed_won", "downsell", "lost", "apply_now", "funded"]) {
    assert.match(seed, new RegExp(`'${k}'`), `stage ${k} must exist in the seed`);
  }
  const beliefs = fs.readFileSync(new URL("../../sales/beliefs.mjs", import.meta.url), "utf8");
  for (const o of HELD_OUTCOMES) assert.match(beliefs, new RegExp(`"${o}"`), `outcome ${o} must exist`);
});

/* ---------- the SQL is one read, with every parameter used ---------- */

test("the SELECT writes nothing, opens no transaction, and uses each parameter", () => {
  const bare = TRIP_SQL.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  assert.match(bare, /^SELECT\b/i);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|BEGIN|COMMIT|ROLLBACK)\b/i.test(bare));
  assert.ok(!/\bSET\s+(LOCAL\s+)?\w+\s*(=|TO)\b/i.test(bare));
  const used = new Set([...TRIP_SQL.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  const max = Math.max(...used);
  assert.deepEqual([...used].sort((a, b) => a - b), Array.from({ length: max }, (_, i) => i + 1), "no gap in the parameters");
  assert.equal(tripParams(ORG, NOW).length, max);
  assert.match(TRIP_SQL, new RegExp(`LIMIT ${ROW_CAP}\\b`));
});

test("the round block carries every field the money lane's roundProblems reads", () => {
  for (const f of [
    "has_closeout", "bills", "linked_sales", "back_end_staff", "commission_rows",
    "confirmed_approvals", "excluded_approvals", "fee_percent", "card_stacking"
  ]) {
    assert.match(TRIP_SQL, new RegExp(`AS\\s+${f}\\b`), `${f} must be selected`);
  }
  assert.match(TRIP_SQL, /funding_success_fee/);
  assert.match(TRIP_SQL, /success_fee/);
  assert.match(TRIP_SQL, /reverses_ledger_id IS NULL/);
});

test("the parameters are the org, the window start, the test pattern, the product value and the held outcomes", () => {
  const p = tripParams(ORG, NOW);
  assert.equal(p[0], ORG);
  assert.equal(new Date(p[1]).getTime(), NOW.getTime() - WINDOW_MS);
  assert.equal(typeof p[2], "string");
  assert.equal(p[3], CARD_STACKING);
  assert.deepEqual(p[4], HELD_OUTCOMES);
});

/* ---------- RED: the company owes a step and it is missing ---------- */

test("RED: paid the diagnostic 3 hours ago and the Sales card is not at Diagnostic Paid", () => {
  const w = walkRow({ diagnostic_paid_at: ago(3 * HOUR), sales_card_at: ago(2 * DAY), sales_stage: "new_lead" });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "sales_card");
});

test("RED: paid the diagnostic and the customer has no Sales card at all", () => {
  const w = walkRow({ diagnostic_paid_at: ago(5 * HOUR) });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "sales_card");
});

test("RED: the funding deposit was paid 3 hours ago and no Funding card was placed", () => {
  const w = walkRow({
    diagnostic_paid_at: ago(5 * DAY), sales_card_at: ago(5 * DAY), sales_stage: "diagnostic_paid",
    deposit_paid_at: ago(3 * HOUR)
  });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "funding_card");
});

test("RED: the Funding card has been at Apply Now for an hour and there is no round", () => {
  const w = walkRow({
    deposit_paid_at: ago(2 * DAY), funding_card_at: ago(HOUR), funding_stage: "apply_now"
  });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "round_opened");
});

test("RED: funded 2 hours ago and there is no closeout record", () => {
  const w = walkRow(whole({ has_closeout: false, funded_at: ago(2 * HOUR) }));
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "closeout");
});

test("RED: funded 2 hours ago and no success-fee bill was made", () => {
  const w = walkRow(whole({ bills: 0, funded_at: ago(2 * HOUR) }));
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "invoice");
});

test("RED: funded 2 hours ago, a staff member is attributed, and no commission rows exist", () => {
  const w = walkRow(whole({ commission_rows: 0, funded_at: ago(2 * HOUR) }));
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "commission");
});

test("RED: the round is funded and no bank said yes with a dollar amount (and none was marked not counting)", () => {
  const w = walkRow(whole({ confirmed_approvals: 0, excluded_approvals: 0, approved_at: null }));
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "approved");
  assert.match(w.why, /never happened/);
});

test("RED: the card sits on Funded with no funded round, past the 30 minutes the money chain gets", () => {
  const w = walkRow({
    deposit_paid_at: ago(5 * DAY), funding_card_at: ago(2 * HOUR), funding_stage: "funded",
    round_id: "r1", round_number: 1, round_status: "started", round_opened_at: ago(5 * DAY), card_stacking: true
  });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "funded");
  assert.match(w.why, /the board shows "round funded"/);
});

/* ---------- GREEN: waiting is not broken ---------- */

test("GREEN: a customer who just paid the diagnostic is waiting on the booking, not red", () => {
  const w = walkRow({
    diagnostic_paid_at: ago(20 * MIN), sales_card_at: ago(19 * MIN), sales_stage: "diagnostic_paid"
  });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "booked");
});

test("GREEN: a customer who paid the diagnostic 20 minutes ago and has no card yet is still inside the wait", () => {
  const w = walkRow({ diagnostic_paid_at: ago(20 * MIN) });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "sales_card");
});

test("GREEN: a booked customer waits on the call; 60 days of waiting on a person is not red", () => {
  const w = walkRow({
    diagnostic_paid_at: ago(59 * DAY), sales_card_at: ago(59 * DAY), sales_stage: "diagnostic_paid",
    booked_at: ago(58 * DAY)
  });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "call_held");
  assert.equal(w.step.by, BY.PERSON);
});

test("GREEN: a round sent to the banks waits on the banks", () => {
  const w = walkRow({
    deposit_paid_at: ago(20 * DAY), funding_card_at: ago(20 * DAY), funding_stage: "round_submitted",
    round_id: "r1", round_number: 1, round_status: "started", round_opened_at: ago(20 * DAY),
    card_stacking: true, submitted_at: ago(10 * DAY)
  });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "approved");
});

test("GREEN: funded 10 minutes ago, the closeout and the bill are still inside their 30 minutes", () => {
  const w = walkRow(whole({ has_closeout: false, bills: 0, commission_rows: 0, funded_at: ago(10 * MIN) }));
  assert.equal(w.state, "waiting");
  assert.equal(w.step.by, BY.SYSTEM);
});

test("GREEN: every bank yes was marked as not counting, so no closeout or bill is owed", () => {
  const w = walkRow(whole({
    confirmed_approvals: 0, excluded_approvals: 2, approved_at: null,
    has_closeout: false, bills: 0, commission_rows: 2
  }));
  assert.equal(w.state, "finished");
});

test("GREEN: a funded card-stacking round with every record is finished", () => {
  const w = walkRow(whole());
  assert.equal(w.state, "finished");
});

test("GREEN: a funded round with nobody attributed owes no staff commission", () => {
  const w = walkRow(whole({ back_end_staff: 0, commission_rows: 0 }));
  assert.equal(w.state, "finished");
});

test("GREEN: an alt-fin round owes no Funding card, no submit, no approval and no closeout", () => {
  const w = walkRow({
    diagnostic_paid_at: ago(30 * DAY), sales_card_at: ago(30 * DAY), sales_stage: "closed_won",
    deposit_paid_at: ago(25 * DAY),
    round_id: "r9", round_number: 1, round_status: "funded", round_opened_at: ago(24 * DAY),
    funded_at: ago(DAY), card_stacking: false, bills: 1, linked_sales: 1, fee_percent: 10
  });
  assert.notEqual(w.state, "broken");
});

test("GREEN: a Sales card on Lost with no deposit is an ended trip", () => {
  const w = walkRow({ diagnostic_paid_at: ago(30 * DAY), sales_card_at: ago(20 * DAY), sales_stage: "lost" });
  assert.equal(w.state, "ended");
});

test("GREEN: a call outcome of not a fit ends the trip, and so does a downsell with no deposit", () => {
  const a = walkRow({ diagnostic_paid_at: ago(30 * DAY), sales_card_at: ago(30 * DAY), sales_stage: "diagnostic_paid", call_held_at: ago(20 * DAY), last_outcome: "not_a_fit" });
  assert.equal(a.state, "ended");
  const b = walkRow({ diagnostic_paid_at: ago(30 * DAY), sales_card_at: ago(30 * DAY), sales_stage: "diagnostic_paid", call_held_at: ago(20 * DAY), last_outcome: "downsell" });
  assert.equal(b.state, "ended");
});

test("a deposit buyer who was once marked not a fit is NOT ended: the money came in", () => {
  const w = walkRow(whole({ last_outcome: "not_a_fit" }));
  assert.equal(w.state, "finished");
});

test("the funded steps use roundProblems from the money lane, so the two can never disagree", () => {
  const r = whole({ has_closeout: false, bills: 0, commission_rows: 0, funded_at: ago(2 * HOUR) });
  const problems = roundProblems({
    card_stacking: true, has_closeout: false, bills: 0, linked_sales: 1, fee_percent: 10,
    back_end_staff: 1, commission_rows: 0, confirmed_approvals: 1, excluded_approvals: 0
  });
  const t = toTripRow(r, NOW);
  assert.equal(problems.length, 3);
  assert.ok(!("closeout" in t.facts) && !("invoice" in t.facts) && !("commission" in t.facts));
});

/* ---------- the verdict and the lane ---------- */

test("judgeFunding: no customer started is a plain green line, not a nothing-to-judge row, not a PASS", () => {
  const r = judgeFunding({ rows: [], now: NOW });
  assert.equal(r.id, "trip:funding");
  assert.equal(r.status, "PASS");
  assert.equal(r.na, undefined);
  assert.match(r.detail, /^Nobody started the .* trip in the last 60 days, so nobody is stuck\./);
});

test("judgeFunding: one stuck customer makes the lane FAIL and names the customer and the step", () => {
  const r = judgeFunding({
    rows: [whole(), sqlRow({ client_code: "FH-000777", deposit_paid_at: ago(3 * HOUR) })],
    now: NOW
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /FH-000777 stopped at "Funding card at Apply Now"/);
  assert.match(r.detail, /^1 of 2 customers/);
  assert.match(r.suggestedFix, /only reads/);
});

test("judgeFunding: waiting customers and finished ones are PASS", () => {
  const r = judgeFunding({
    rows: [whole(), sqlRow({ diagnostic_paid_at: ago(2 * DAY), sales_card_at: ago(2 * DAY), sales_stage: "diagnostic_paid" })],
    now: NOW
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /1 finished, 1 waiting \(1 at "booked a call"\)/);
});

function fakeDb(rows, seen = []) {
  return tagDb({
    "trip-funding": rows,
    "trip-funding-count": [{ n: rows.length }],
    "trip-counts": [{ "trip:funding": rows.length }]
  }, seen);
}

test("gapChecks: reads once, through ctx.db, and returns the verdict", async () => {
  const seen = [];
  const out = await gapChecks({ db: fakeDb([sqlRow({ client_code: "FH-000999", deposit_paid_at: ago(3 * HOUR) })], seen), orgId: ORG, now: NOW });
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "FAIL");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tag, "trip-funding");
  assert.equal(seen[0].params[0], ORG);
});

test("gapChecks: reads through the staff scope when the pulse has one", async () => {
  const db = fakeDb([]);
  let used = 0;
  const scope = async (fn) => { used += 1; return fn(db); };
  const out = await gapChecks({ scope, orgId: ORG, now: NOW });
  assert.equal(used, 1);
  assert.equal(out[0].status, "PASS");
  assert.match(out[0].detail, /^Nobody started the/);
});

test("gapChecks: a read that fails is a skip with the reason, never a PASS", async () => {
  const db = { async query() { throw new Error("relation \"call_outcomes\" does not exist"); } };
  const out = await gapChecks({ db, orgId: ORG, now: NOW });
  assert.equal(out[0].status, "skip");
  assert.match(out[0].detail, /call_outcomes/);
});

test("gapChecks: no database or no org is a skip", async () => {
  const a = await gapChecks({ orgId: ORG });
  assert.equal(a[0].status, "skip");
  assert.match(a[0].detail, /no database/);
  const b = await gapChecks({ db: fakeDb([]) });
  assert.equal(b[0].status, "skip");
  assert.match(b[0].detail, /no org id/);
});


