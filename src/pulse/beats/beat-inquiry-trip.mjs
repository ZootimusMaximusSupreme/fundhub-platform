// inquiry-trip: every hour, is each inquiry-removal customer moving, and is no inquiry case stuck?
//
// Same SQL, same verdicts as the morning lanes. Nothing here judges on its own words:
//   trip:inquiry         lib/inquiry-trip-truth.mjs   (gap-trip-inquiry.mjs imports it back)
//   inquiry:case-stuck   lib/inquiry-truth.mjs        (gap-inquiry.mjs imports it back)
// It reads the EFFECT: after a deposit, the gate's case per bureau, the draft letter on each gate case, the
// call the sweeper owes, the inquiry.removed event once every case is done, and funding marked ready by C-03.
// A case waiting on the bureau, or on a person to schedule its call, is never red; a case past the clocks
// the code already writes (72 hours idle, or a due call the sweeper did not fire in 3 of its runs) is.
//
// What it guards, and why each surface is on `covers` (the deep checks src/pulse/tripwires.mjs names):
//   job:c-03-inquiry-removed-resume-or-hold   trip:inquiry (its "funding ready for the next round" step)
//   route:inquiries                           trip:inquiry
//   job:inquiry-call-sweeper                  trip:inquiry and inquiry:case-stuck (a due call left unfired)
//   route:inquiry                             trip:inquiry and inquiry:case-stuck
//
// Read only: every read goes through ctx.read (the read box). No send, no write, no web call, no bureau call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { TRIP_SQL, readInquiryTrip } from "./lib/inquiry-trip-truth.mjs";
import { STUCK_SQL, checkStuck } from "./lib/inquiry-truth.mjs";

export const HOURLY_CHECK_IDS = Object.freeze(["trip:inquiry", "inquiry:case-stuck"]);

/** A deposit paid 2 hours before the self-test clock and no gate after it: the gate never ran. */
const NO_GATE_ROW = Object.freeze({
  client_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  client_code: "FH-000998",
  deposit_event_at: "2026-10-09T17:07:00.000Z",
  gate_raised_at: null,
  raised_bureaus: null,
  gate_clear_at: null,
  started_at: null,
  cases_n: 0,
  completed_n: 0,
  completed_at: null,
  case_bureaus: null,
  letters_owed_n: 0,
  letters_missing_n: 0,
  calls_fired_n: 0,
  stuck_idle_n: 0,
  stuck_call_n: 0,
  removed_event_at: null,
  product_path: "Funding",
  ready_for_next_round: false,
  hold_reason: null,
  fraud_alert: false
});

export const SELF_TEST_ROWS = Object.freeze({ NO_GATE_ROW });

const PASS_ROWS = Object.freeze([
  Object.freeze([TRIP_SQL, Object.freeze([])]),
  Object.freeze([STUCK_SQL, Object.freeze([Object.freeze({ n: 0 })])])
]);

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => {
    const trip = await readInquiryTrip(io);
    const stuck = await checkStuck({ db: { query: (sql, params) => io.read(sql, params) }, orgId: io.orgId, now: io.now });
    return [trip, stuck];
  },
  selfTest: Object.freeze({
    passRows: PASS_ROWS,
    // An inquiry case past its clock: the beat must stop at inquiry-case-stuck.
    failRows: Object.freeze([
      Object.freeze([STUCK_SQL, Object.freeze([Object.freeze({ n: 1 })])])
    ])
  })
});

export const id = "inquiry-trip";
export const title = "Inquiry removals move and no case is stuck";
export const kind = "probe";
export const covers = [
  "job:c-03-inquiry-removed-resume-or-hold",
  "job:inquiry-call-sweeper",
  "route:inquiries",
  "route:inquiry"
];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 10000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "inquiry" });
}

export const fixGuide = [
  "An inquiry-removal customer stopped on a step the company owes, or an inquiry case stopped moving.",
  "",
  "Likely causes:",
  "- deposit.paid was saved but the inquiry gate (onDepositPaidGate) never ran, so no case or gate event exists.",
  "- The gate raised a bureau and wrote no case or no draft letter for it.",
  "- A bureau call came due and the call sweeper did not fire it in 3 of its 15-minute runs.",
  "- Every case is Completed but inquiry.removed never fired, or C-03 did not mark funding ready.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs inquiry-trip and read the red step: it names the client and the step.",
  "- Open the client on the Specialist desk; read failed_events for inquiry.removed and the deposit event.",
  "- Fix the handler or the job. Never call a bureau from the pulse; the beat only reads.",
  "Files: src/pulse/beats/lib/inquiry-trip-truth.mjs, src/pulse/beats/lib/inquiry-truth.mjs, src/handlers/inquiry-gate.mjs, src/workflows/inquiry-call-sweeper.mjs, src/workflows/c-03-inquiry-removed-resume-or-hold.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
