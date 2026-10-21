// pipeline-lost: every hour, did a paying client end up on no board, and did a card land on a stage nothing moves
// a card to?
//
// Same SQL, same verdicts as the morning lane gap-pipeline-boards.mjs (the truth lives in
// lib/pipeline-boards-truth.mjs). Split out of pipeline-boards on 2026-10-21: that beat made about 25 reads and took
// 6.2 s of its 10 s deadline on the GitHub ship runner, which stopped the ship. pipeline-boards now runs count-true
// (one read for every board's columns, then the route's own card read per board); this beat runs the other two
// hourly board checks, a handful of reads.
//
// What it guards, and why each surface is on `covers` (the deep checks src/pulse/tripwires.mjs names):
//   route:dashboard/client-archive  pipeline:nobody-lost
//   route:inquiry-cases             pipeline:dead-stage (stage-vs-fact: pipeline-facts)
// route:pipeline-clients and desk:pipeline.html also need pipeline:nobody-lost; they stay on pipeline-boards'
// covers (count-true) and this beat runs their nobody-lost hourly.
//
// pipeline:dead-stage says "nothing to judge" while no card sits on a dead stage; that is a skipped step,
// not a red. Read only: every read goes through ctx.read (the read box). No send, no write, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { clockedRun } from "./lib/pipeline-read-clock.mjs";
import { DEAD_CARDS_SQL, PAID_NO_CARD_SQL, runBoardsChecks } from "./lib/pipeline-boards-truth.mjs";

export const HOURLY_CHECK_IDS = Object.freeze(["pipeline:nobody-lost", "pipeline:dead-stage"]);

/** One red per check, each on its own: what the fake database answers to turn that check red. */
export const RED_ROWS = Object.freeze({
  // A client paid for funding and has no card on the Funding board.
  "pipeline-nobody-lost": Object.freeze([PAID_NO_CARD_SQL, Object.freeze([Object.freeze({ client_id: "aaaaaaaa-0000-4000-8000-000000000001", category: "funding", paid_at: "2026-10-09T10:00:00.000Z", has_sale: true, total: 1 })])]),
  // A card landed on Sales Confirmed, which no code moves a card to.
  "pipeline-dead-stage": Object.freeze([DEAD_CARDS_SQL, Object.freeze([Object.freeze({ pipeline: "sales", stage: "confirmed", n: 1 })])])
});

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => runBoardsChecks({ run: clockedRun(io.read), orgId: io.orgId, now: io.now }, { only: HOURLY_CHECK_IDS }),
  selfTest: Object.freeze({
    // Nobody paid and nothing sits on a dead stage: nobody-lost is green, dead-stage has nothing to judge.
    passRows: Object.freeze([]),
    // A paying client with no card on the board that owns what they bought: the beat stops at nobody-lost.
    failRows: Object.freeze([RED_ROWS["pipeline-nobody-lost"]])
  })
});

export const id = "pipeline-lost";
export const title = "No paying client is off the boards; no dead-stage card";
export const kind = "probe";
export const covers = [
  "route:dashboard/client-archive",
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
  "A paying client is on no pipeline board, or a card sits on a stage nothing moves a card to.",
  "",
  "Likely causes:",
  "- A funding or repair payment was saved and the move that puts the client on that board never fired.",
  "- A client was archived and then paid, or a card sits on a stage from another board.",
  "- A person dropped a card on a stage no code moves a card to, so nothing watches it next.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs pipeline-lost and read the red step: it names the board and the client ids.",
  "- Open Pipeline and the client. Find why the card is missing or on that stage.",
  "- Fix the handler that should have placed the card. Do not move cards from the pulse; the beat only reads.",
  "Files: src/pulse/beats/lib/pipeline-boards-truth.mjs, src/handlers/client-lifecycle.mjs, src/handlers/purchase-routing.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
