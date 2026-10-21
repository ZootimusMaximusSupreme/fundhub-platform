import { PARTNER_TRIP_LANE, laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";

export const id = "partner-trip";
export const title = "Partner trip reaches commission and payout";
export const kind = "probe";
export const covers = [
  "route:read/affiliates",
  "route:partners/approve",
  "route:public/affiliate-click",
  "job:affiliate-payout-run",
  // Affiliate autopay through Plaid (495). A payout ready over a day and not
  // sent, held over a day, or stuck in processing turns this beat red.
  "route:affiliates/payouts",
  "route:affiliates/payout-account",
  "route:read/affiliate-payouts",
  "job:affiliate-payout-autopay"
];
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const checkIds = PARTNER_TRIP_LANE.checks.map((check) => check.id);
export const steps = ["read", ...PARTNER_TRIP_LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 10000;

export async function run(ctx) {
  return runLaneBeat(ctx, PARTNER_TRIP_LANE);
}

export const fixGuide = [
  "A partner trip is missing a Fundhub-owned step between signup and payout.",
  "",
  "Likely causes:",
  "- The referral, page, revenue, commission, or payout writer did not finish.",
  "- A required agreement, tax form, referral code, or published page is missing.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs partner-trip and read the named partner and first missing step.",
  "- Read the referral, page, revenue, commission, and payout records. The beat never approves or pays anyone.",
  "- Repair only the writer for the first missing step and add a failing test for that exact break.",
  "Files: src/pulse/coverage/gap-trip-partner.mjs, src/partners/revenue.mjs, src/affiliates/payouts.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(PARTNER_TRIP_LANE),
  fail: () => laneSelfTest(PARTNER_TRIP_LANE, true)
};
