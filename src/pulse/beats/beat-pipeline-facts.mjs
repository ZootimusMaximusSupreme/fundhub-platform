// pipeline-facts: every hour, is each card in the stage its facts say, and do the two records that hold one
// fact agree?
//
// Same SQL, same verdicts as the morning lane gap-pipeline-facts.mjs (the truth lives in
// lib/pipeline-facts-truth.mjs). It never trusts a card: it reads the fact the card is meant to follow
// (paid, booked, funded round, inquiry case cleared, partner status, invoice status) and, for two records,
// both rows (Funding round and Funding card, repair case and repair card, Sales floor and Sales board).
//
// Two of the lane's three checks run here. pipeline:move-receipt guards no surface that lacks an hourly beat,
// so it stays daily. The shape half of the boards (counts, dead stages, nobody lost) is pipeline-boards.
//
// What it guards, and why each surface is on `covers` (the deep checks src/pulse/tripwires.mjs names):
//   desk:inquiry-remover.html  pipeline:stage-vs-fact, pipeline:two-records
//   desk:pipeline.html         pipeline:stage-vs-fact (count-true and nobody-lost: pipeline-boards)
//   route:inquiry-cases        pipeline:stage-vs-fact (dead-stage: pipeline-boards)
// Not here: desk:sales-floor.html also needs sales-manager:totals, which runs the app's own salesFloor
// (src/sales/metrics.mjs, which also reads Drive and attaches recordings). A beat cannot import it, and a
// copy is what that lane was rebuilt to stop trusting. It stays on the morning pulse.
//
// Read only: every read goes through ctx.read (the read box). No send, no write, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { clockedRun } from "./lib/pipeline-read-clock.mjs";
import { CARD_NO_ROUND_SQL, SALES_PAID_SQL, runFactsChecks } from "./lib/pipeline-facts-truth.mjs";

export const HOURLY_CHECK_IDS = Object.freeze(["pipeline:stage-vs-fact", "pipeline:two-records"]);

/** One red per check, each on its own: what the fake database answers to turn that check red. */
export const RED_ROWS = Object.freeze({
  // A paying client still sits on New Lead.
  "pipeline-stage-vs-fact": Object.freeze([SALES_PAID_SQL, Object.freeze([Object.freeze({ client_id: "bbbbbbbb-0000-4000-8000-000000000002", stage: "new_lead", total: 1 })])]),
  // A Funding card past Apply Now with no round row behind it.
  "pipeline-two-records": Object.freeze([CARD_NO_ROUND_SQL, Object.freeze([Object.freeze({ client_id: "cccccccc-0000-4000-8000-000000000003", stage: "approved", total: 1 })])])
});

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => runFactsChecks({ run: clockedRun(io.read), orgId: io.orgId, now: io.now }, { only: HOURLY_CHECK_IDS }),
  selfTest: Object.freeze({
    // Every fact read answers with no rows: nobody is out of place, so both checks are green.
    passRows: Object.freeze([]),
    // A paying client still on New Lead: the beat must stop at stage-vs-fact.
    failRows: Object.freeze([RED_ROWS["pipeline-stage-vs-fact"]])
  })
});

export const id = "pipeline-facts";
export const title = "Every card sits where its facts say";
export const kind = "probe";
export const covers = [
  "desk:inquiry-remover.html",
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
  return runLaneBeat(ctx, LANE, { noun: "board fact" });
}

export const fixGuide = [
  "A pipeline card is not where its facts say, or two records of one fact disagree.",
  "",
  "Likely causes:",
  "- A payment, booking, funded round or cleared inquiry case was saved and the card move never fired.",
  "- A person moved a card by hand and the fact behind it says something else.",
  "- A Funding round and its card, or a repair case and its card, were written apart and now disagree.",
  "- The Sales floor counted a deposit and the client's Sales card is on another stage.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs pipeline-facts and read the red step: it names the rule and the client ids.",
  "- Open Pipeline and the client, and find which record is right: the card or the fact behind it.",
  "- Fix the handler that should have moved the card. Do not move cards from the pulse; the beat only reads.",
  "Files: src/pulse/beats/lib/pipeline-facts-truth.mjs, src/handlers/client-lifecycle.mjs, src/funding/card-stacking-rounds.mjs, src/sales/metrics.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
