// pipeline-boards: every hour, does each board paint every card the database holds, did a card land on a
// stage nothing moves a card to, and did anybody get lost?
//
// Same SQL, same verdicts as the morning lane gap-pipeline-boards.mjs (the truth lives in
// lib/pipeline-boards-truth.mjs). count-true runs the board route's own reads (held copies of
// api/dashboard/pipeline.mjs STAGES_SQL and CARDS_SQL) and counts what each column really gets back.
//
// Three of the lane's five checks run here. pipeline:age needs the Repair clocks and the owner hold, and
// pipeline:age-no-limit is a setting, so both stay daily. The facts half of the boards (is each card where
// its facts say, do two records agree) is its own beat, pipeline-facts, so each beat has room in its clock:
// this one makes about 25 reads.
//
// What it guards, and why each surface is on `covers` (the deep checks src/pulse/tripwires.mjs names):
//   route:dashboard/pipeline        pipeline:count-true
//   route:dashboard/client-archive  pipeline:nobody-lost
//   route:pipeline-clients          pipeline:count-true, pipeline:nobody-lost
//   desk:pipeline.html              pipeline:count-true, pipeline:nobody-lost (stage-vs-fact: pipeline-facts)
//   route:inquiry-cases             pipeline:dead-stage (stage-vs-fact: pipeline-facts)
//
// pipeline:dead-stage says "nothing to judge" while no card sits on a dead stage; that is a skipped step,
// not a red. Read only: every read goes through ctx.read (the read box). No send, no write, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { clockedRun } from "./lib/pipeline-read-clock.mjs";
import {
  BOARD_CARDS_SQL, BOARD_STAGES_SQL, DEAD_CARDS_SQL, HIRING_PAINTED_SQL, HIRING_TRUTH_SQL, PAID_NO_CARD_SQL,
  TRUTH_SQL, runBoardsChecks
} from "./lib/pipeline-boards-truth.mjs";

export const HOURLY_CHECK_IDS = Object.freeze(["pipeline:count-true", "pipeline:nobody-lost", "pipeline:dead-stage"]);

const ONE_BOARD = Object.freeze([Object.freeze({ pipeline: "sales", stage: "booked", sort_order: 0, n: 1 })]);
const PASS_ROWS = Object.freeze([
  Object.freeze([TRUTH_SQL, ONE_BOARD]),
  Object.freeze([BOARD_STAGES_SQL, Object.freeze([Object.freeze({ id: "stage-1", key: "booked", name: "Booked", sort_order: 0 })])]),
  Object.freeze([BOARD_CARDS_SQL, Object.freeze([Object.freeze({ id: "card-1", stage_id: "stage-1" })])]),
  Object.freeze([HIRING_TRUTH_SQL, Object.freeze([Object.freeze({ n: 0 })])]),
  Object.freeze([HIRING_PAINTED_SQL, Object.freeze([Object.freeze({ n: 0 })])])
]);

/** One red per check, each on its own: what the fake database answers to turn that check red. */
export const RED_ROWS = Object.freeze({
  // The board holds a card the board read does not hand back.
  "pipeline-count-true": Object.freeze([BOARD_CARDS_SQL, Object.freeze([])]),
  // A client paid for funding and has no card on the Funding board.
  "pipeline-nobody-lost": Object.freeze([PAID_NO_CARD_SQL, Object.freeze([Object.freeze({ client_id: "aaaaaaaa-0000-4000-8000-000000000001", category: "funding", paid_at: "2026-10-09T10:00:00.000Z", has_sale: true, total: 1 })])]),
  // A card landed on Sales Confirmed, which no code moves a card to.
  "pipeline-dead-stage": Object.freeze([DEAD_CARDS_SQL, Object.freeze([Object.freeze({ pipeline: "sales", stage: "confirmed", n: 1 })])])
});

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => runBoardsChecks({ run: clockedRun(io.read), orgId: io.orgId, now: io.now }, { only: HOURLY_CHECK_IDS }),
  selfTest: Object.freeze({
    passRows: PASS_ROWS,
    // A paying client with no card on the board that owns what they bought: the beat stops at nobody-lost.
    failRows: Object.freeze([RED_ROWS["pipeline-nobody-lost"]])
  })
});

export const id = "pipeline-boards";
export const title = "Every board shows every card and loses nobody";
export const kind = "probe";
export const covers = [
  "route:dashboard/pipeline",
  "route:dashboard/client-archive",
  "route:pipeline-clients",
  "desk:pipeline.html",
  "route:inquiry-cases"
];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 10000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "board" });
}

export const fixGuide = [
  "A pipeline board hides a card the database holds, or a paying client is on no board.",
  "",
  "Likely causes:",
  "- The board read (api/dashboard/pipeline.mjs) changed and now drops cards, or a board passed its 500-card limit.",
  "- A funding or repair payment was saved and the move that puts the client on that board never fired.",
  "- A client was archived and then paid, or a card sits on a stage from another board.",
  "- A person dropped a card on a stage no code moves a card to, so nothing watches it next.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs pipeline-boards and read the red step: it names the board and the client ids.",
  "- Open Pipeline and the client. Find why the card is missing, hidden or on that stage.",
  "- Fix the read or the handler that should have placed the card. Do not move cards from the pulse; the beat only reads.",
  "Files: src/pulse/beats/lib/pipeline-boards-truth.mjs, api/dashboard/pipeline.mjs, src/handlers/client-lifecycle.mjs, src/handlers/purchase-routing.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
