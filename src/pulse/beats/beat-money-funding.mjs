import { MONEY_FUNDING_LANES, laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";

export const id = "money-funding";
export const title = "Funding bills payouts and commission agree";
export const kind = "probe";
export const covers = [
  "route:pipeline-cards",
  "route:applications",
  "route:commissions",
  "route:commission-rules",
  "route:slo-connections",
  "route:dashboard/seed",
  "route:read/affiliates",
  "desk:products-commissions.html",
  "desk:client-control-panel.html",
  "desk:affiliate.html"
];
export const box = false;
export const reads = [];
export const checkIds = MONEY_FUNDING_LANES.checks.map((check) => check.id);
export const steps = ["read", ...MONEY_FUNDING_LANES.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 9000;

export async function run(ctx) {
  return runLaneBeat(ctx, MONEY_FUNDING_LANES);
}

export const fixGuide = [
  "A funding, bill, payout, commission, product map, or sample-money check is wrong.",
  "",
  "Likely causes:",
  "- A money-chain writer stopped, a pay rule is missing, or test money reached the live books.",
  "- A funded round, approved amount, product map, payout stamp, or rate row is missing.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs money-funding and use the first red step as the repair target.",
  "- Read the named money rows and the writer that owns them. Do not make a payment or release a payout from the beat.",
  "- Fix the one writer, keep the daily and hourly judge shared, and add a failing test for the exact bad row.",
  "Files: src/pulse/coverage/gap-money-funding.mjs, src/handlers/money-chain.mjs, src/commissions/payout.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(MONEY_FUNDING_LANES),
  fail: () => laneSelfTest(MONEY_FUNDING_LANES, true)
};
