// sales-totals: every hour, can the Sales floor's team numbers be read, and are they real numbers?
//
// Same SQL, same math, same verdict as the Sales floor page and the morning lane gap-sales-manager.mjs (the
// truth lives in lib/sales-totals-truth.mjs; src/sales/metrics.mjs salesFloor() runs floorTotals() from there).
// One read of four counts for this UTC month: team cash, booked, held and deposits (with downsells), and
// deposits that funded. A read that fails is red, as on the morning pulse: the page would answer 500.
//
//   sales-manager:totals   team cash, booked, held, deposits, show rate, close rate and deposit to funded are
//                          readable, are numbers, are not negative, and every rate sits between 0 and 1
//
// What it guards, and why each surface is on `covers` (the deep checks src/pulse/tripwires.mjs names):
//   desk:sales-floor.html  sales-manager:totals (here), pipeline:two-records (beat pipeline-facts, step
//                          pipeline-two-records; see RUNS_ELSEWHERE)
//
// Not here, on purpose: the rest of salesFloor() (closer list, beliefs, recordings, cold deals, late shifts, the
// offer stack). It reads Drive and attaches loose recordings to calls, which writes, so it stays on the morning
// pulse (sales-manager:read-api). Drive is not part of the totals.
//
// Read only: every read goes through ctx.read (the read box). No send, no write, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import {
  CHECK_IDS, DEPOSIT_TO_FUNDED_SQL, FLOOR_BOOKED_SQL, FLOOR_CASH_SQL, FLOOR_OUTCOMES_SQL, readTotalsTruth
} from "./lib/sales-totals-truth.mjs";

export const HOURLY_CHECK_IDS = CHECK_IDS;

/** Checks a covered surface names that another beat runs every hour: [beat id, step]. */
export const RUNS_ELSEWHERE = Object.freeze({
  "pipeline:two-records": Object.freeze(["pipeline-facts", "pipeline-two-records"])
});

const ONE = (value) => Object.freeze([Object.freeze(value)]);

/** A plain month on the floor: $1,500 in, 5 booked, 4 held, 2 deposits, 1 of them funded. */
export const PASS_ROWS = Object.freeze([
  Object.freeze([FLOOR_CASH_SQL, ONE({ cents: "150000" })]),
  Object.freeze([FLOOR_BOOKED_SQL, ONE({ n: 5 })]),
  Object.freeze([FLOOR_OUTCOMES_SQL, ONE({ held: 4, deposits: 2, downsells: 0, downsell_cents: "0" })]),
  Object.freeze([DEPOSIT_TO_FUNDED_SQL, ONE({ deposits: 2, funded: 1 })])
]);

/** Team cash adds up below zero (a refund logged as cash taken back): the floor's hero number is wrong. */
export const RED_ROWS = Object.freeze([
  Object.freeze([FLOOR_CASH_SQL, ONE({ cents: "-25000" })])
]);

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: (io) => readTotalsTruth({ db: { query: (sql, params) => io.read(sql, params) }, orgId: io.orgId, now: io.now }),
  selfTest: Object.freeze({
    passRows: PASS_ROWS,
    failRows: RED_ROWS
  })
});

export const id = "sales-totals";
export const title = "Sales floor team numbers read true";
export const kind = "probe";
export const covers = ["desk:sales-floor.html"];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 8000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "sales floor total" });
}

export const fixGuide = [
  "The Sales floor's team numbers (cash, booked, held, deposits, rates) cannot be read or are not real numbers.",
  "",
  "Likely causes:",
  "- A column the totals read on call_outcomes, events, clients, funding_rounds or funding_closeout was renamed or dropped.",
  "- A call outcome was saved with negative cash (a refund logged as cash), so team cash adds up below zero.",
  "- The totals read is too slow or the database refused it, so the page would answer 500.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs sales-totals and read the red step: it names the number that is wrong.",
  "- Open the Sales floor signed in as a manager and compare team cash, booked, held and deposits.",
  "- Fix the saved call outcome or the read. Do not change rows from the pulse; the beat only reads.",
  "Files: src/pulse/beats/lib/sales-totals-truth.mjs, src/sales/metrics.mjs, src/pulse/coverage/gap-sales-manager.mjs, api/read/sales-floor.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
