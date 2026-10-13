import { FUNDING_TRIP_LANE, laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";

export const id = "funding-trip";
export const title = "Funding trip reaches the money books";
export const kind = "probe";
export const covers = ["route:pipeline-cards", "job:f-07-funding-locked"];
export const box = false;
export const reads = [];
export const checkIds = FUNDING_TRIP_LANE.checks.map((check) => check.id);
export const steps = ["read", ...FUNDING_TRIP_LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 9000;

export async function run(ctx) {
  return runLaneBeat(ctx, FUNDING_TRIP_LANE);
}

export const fixGuide = [
  "A customer moved through funding but a step Fundhub owes is missing.",
  "",
  "Likely causes:",
  "- The pipeline card, closeout, success-fee bill, or commission writer did not finish.",
  "- A funded card and the money books disagree about the round or approved amount.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs funding-trip and read the named step and customer.",
  "- Compare the round, pipeline card, closeout, success-fee bill, and commission rows without changing them.",
  "- Repair the writer for the first missing step, then add a failing test beside that writer.",
  "Files: src/pulse/coverage/gap-trip-funding.mjs, src/handlers/money-chain.mjs, src/workflows/f-07-funding-locked.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(FUNDING_TRIP_LANE),
  fail: () => laneSelfTest(FUNDING_TRIP_LANE, true)
};
