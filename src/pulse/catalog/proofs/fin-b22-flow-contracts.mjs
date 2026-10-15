// Finish-853 batch 22 (Flow lane): which flow rows left NOT_PROVED, and what each now rests on.
//
//   practice rows  A test with fake data judges the exact result. The row leaves the Flow gap monitor
//                  (flow-gap-cases.mjs) and carries the test as its proof.
//   live rows      The row stays in the Flow lane and is judged there from the saved results the flow leaves
//                  behind (fin-b22-flow-live.mjs). Its proof names that lane and the tests that run the
//                  lane's exact query over stand-in rows.
//   page rows      The row stays in the Flow lane and is judged there by one read of the live public page
//                  (fin-b22-page-reads.mjs). Its proof names that lane and the tests that hold the judge
//                  to the page files and to changed copies of them.
//
// A surface not listed here is still not proved and stays in the gap monitor, red by its exact name.
// This file imports nothing, so flow-gap-cases.mjs can import it without a cycle.

const LANE = "src/pulse/coverage/gap-catalog-flow.mjs";
const LANE_TEST = "src/pulse/coverage/gap-catalog-flow.test.mjs";
const LIVE_TEST = "src/pulse/catalog/proofs/fin-b22-flow-live.test.mjs";
const ASK_TEST = "src/http/fin-b22-journeys-ask.test.mjs";
const SOFT_PULL_SERVER = "src/http/fin-b22-soft-pull-flow.test.mjs";
const SOFT_PULL_PAGE = "src/pulse/catalog/proofs/fin-b22-soft-pull-page.test.mjs";
const SOFT_PULL_STAFF = "src/pulse/catalog/proofs/fin-b22-soft-pull-staff.test.mjs";
const TWILIO_TEST = "src/http/fin-b22-twilio-status.test.mjs";
const PUSH_SEND_TEST = "src/push/fin-b22-send-to-client.test.mjs";
const PAGE_TEST = "src/pulse/catalog/proofs/fin-b22-page-reads.test.mjs";

/** surface -> { file, tests }. A test with fake data judges the exact result. */
export const FIN_B22_PRACTICE = Object.freeze({
  "ai-caller:api/journeys/ask.mjs": Object.freeze({ file: "agents.json", tests: Object.freeze([ASK_TEST]) }),
  "journey:soft-pull-multi-biz-intended-draft#2-authorize-first": Object.freeze({
    file: "journeys.json", tests: Object.freeze([SOFT_PULL_SERVER, SOFT_PULL_PAGE]),
  }),
  "journey:soft-pull-multi-biz-intended-draft#5-pay-same-page": Object.freeze({
    file: "journeys.json", tests: Object.freeze([SOFT_PULL_SERVER, SOFT_PULL_PAGE]),
  }),
});

/** surface -> { file, tests }. Judged in the Flow lane from saved results; the tests run its query over stand-in rows. */
export const FIN_B22_LIVE_PROOFS = Object.freeze({
  "dispatch:sms-duplicate-guard-NOT-WIRED": Object.freeze({ file: "messages.json", tests: Object.freeze([LIVE_TEST, LANE_TEST]) }),
  "job:staff-message-sweeper": Object.freeze({ file: "messages.json", tests: Object.freeze([LIVE_TEST, LANE_TEST]) }),
  "owner-alert:owner_notifications queue (finance alerts)": Object.freeze({ file: "messages.json", tests: Object.freeze([LIVE_TEST, LANE_TEST]) }),
  "receipt:twilio-status-webhook": Object.freeze({ file: "messages.json", tests: Object.freeze([LIVE_TEST, TWILIO_TEST, LANE_TEST]) }),
  "manual-proof:comms-map-2026-09-19 (template delivery proof)": Object.freeze({ file: "messages.json", tests: Object.freeze([LIVE_TEST, LANE_TEST]) }),
  "workflow:waypoint-nudge-sweeper": Object.freeze({ file: "messages.json", tests: Object.freeze([LIVE_TEST, LANE_TEST]) }),
  "template-copy:seed-vs-live-drift": Object.freeze({ file: "messages.json", tests: Object.freeze([LIVE_TEST, LANE_TEST]) }),
  "template-copy:SQL-seeded-only-keys-not-in-doc-source": Object.freeze({ file: "messages.json", tests: Object.freeze([LIVE_TEST, LANE_TEST]) }),
  "journey:soft-pull-multi-biz-intended-draft#6-staff-sees-files": Object.freeze({
    file: "journeys.json", tests: Object.freeze([LIVE_TEST, SOFT_PULL_STAFF, LANE_TEST]),
  }),
  // Generation 2. Judged from the devices a client turned on; the sender itself is held by a practice test.
  "provider:web-push-and-client-push": Object.freeze({
    file: "messages.json", tests: Object.freeze([LIVE_TEST, PUSH_SEND_TEST, LANE_TEST]),
  }),
  // Generation 2. Judged by one read of the live public page.
  "journey:climate-lead-magnet-intended#2-reading-and-map": Object.freeze({
    file: "journeys.json", tests: Object.freeze([PAGE_TEST, LANE_TEST]), page: true,
  }),
  "journey:fh-consulting-intended#5-request-enrollment": Object.freeze({
    file: "journeys.json", tests: Object.freeze([PAGE_TEST, LANE_TEST]), page: true,
  }),
});

function basename(sourceFile) {
  return String(sourceFile || "").split(/[\\/]/).at(-1);
}

const surfaceOf = (row) => String(row?.surface || "");

/** True when a practice test owns this Flow row, so the gap monitor must not. */
export function isFinB22ProvedFlowRow(row) {
  return Object.hasOwn(FIN_B22_PRACTICE, surfaceOf(row));
}

/** True when the Flow lane judges this row from saved results. */
export function isFinB22LiveFlowRow(row) {
  return Object.hasOwn(FIN_B22_LIVE_PROOFS, surfaceOf(row));
}

export function finB22FlowProof(sourceFile, row) {
  const surface = surfaceOf(row);
  const file = basename(sourceFile);
  if (Object.hasOwn(FIN_B22_PRACTICE, surface) && FIN_B22_PRACTICE[surface].file === file) {
    return {
      depth: "deep",
      evidence: `Executable final-result tests: ${FIN_B22_PRACTICE[surface].tests.join(", ")}`,
      asserts: row.control,
    };
  }
  if (Object.hasOwn(FIN_B22_LIVE_PROOFS, surface) && FIN_B22_LIVE_PROOFS[surface].file === file) {
    const live = FIN_B22_LIVE_PROOFS[surface];
    return {
      depth: "deep",
      evidence: live.page
        ? `Executable live page read: ${LANE}; its judge is held to the page files and to changed copies of them by ${live.tests.join(", ")}`
        : `Executable live saved-result check: ${LANE}; its query is run over stand-in rows by ${live.tests.join(", ")}`,
      asserts: row.control,
    };
  }
  return null;
}
