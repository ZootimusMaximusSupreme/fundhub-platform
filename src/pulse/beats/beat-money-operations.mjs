import { MONEY_OPERATIONS_LANES, laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";

export const id = "money-operations";
export const title = "Money plans transfers and ad spend agree";
export const kind = "probe";
export const covers = [
  "route:money/setup",
  "route:money/payments",
  "route:money/transfers",
  "route:finance/subscriptions",
  "route:finance/cards",
  "route:partner-addons",
  "route:campaigns/write",
  "desk:money-setup.html",
  "desk:money-payments.html",
  "desk:money-transfers.html",
  "desk:campaign-manager.html",
  "job:finance-os-money-transfers"
];
export const box = false;
export const reads = [{ host: "graph.facebook.com", methods: ["GET"] }];
export const checkIds = MONEY_OPERATIONS_LANES.checks.map((check) => check.id);
export const steps = ["read", ...MONEY_OPERATIONS_LANES.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 12000;

export async function run(ctx) {
  return runLaneBeat(ctx, MONEY_OPERATIONS_LANES);
}

export const fixGuide = [
  "A setup fee, unmatched payment, subscription, transfer, Meta campaign, or load job is wrong.",
  "",
  "Likely causes:",
  "- A setting is empty, a retry stopped, a transfer stalled, or Meta and Fundhub disagree.",
  "- An add-on plan, unmatched receipt, late installment task, or Meta load job is missing.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs money-operations and read the first red step.",
  "- Compare the saved row with its source. Meta is read with GET only; the beat never syncs an ad or moves money.",
  "- Repair the one writer or setting named by the result and add a failing test for that exact condition.",
  "Files: src/pulse/coverage/gap-finance-os-setup.mjs, src/pulse/coverage/gap-money-moves.mjs, src/pulse/coverage/gap-ads-meta.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(MONEY_OPERATIONS_LANES),
  fail: () => laneSelfTest(MONEY_OPERATIONS_LANES, true)
};
