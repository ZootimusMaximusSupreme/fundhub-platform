import { MONEY_CHECKOUT_LANES, laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";

export const id = "money-checkout";
export const title = "Buyer checkout money paths agree";
export const kind = "probe";
export const covers = ["route:paid-services", "route:public/slo-repair-checkout", "route:public/funnel-checkout"];
export const box = false;
export const reads = [
  { host: "SITE", methods: ["GET"] },
  { host: "*", methods: ["GET", "HEAD"] }
];
export const checkIds = MONEY_CHECKOUT_LANES.checks.map((check) => check.id);
export const steps = ["read", ...MONEY_CHECKOUT_LANES.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 11000;

export async function run(ctx) {
  return runLaneBeat(ctx, MONEY_CHECKOUT_LANES);
}

export const fixGuide = [
  "A buyer checkout link, repair price, funnel door, or sale result is wrong.",
  "",
  "Likely causes:",
  "- A checkout route is down, a saved link is dead, or the price and receipt do not agree.",
  "- A paid request did not start, or funnel presses produced no matching sale.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs money-checkout and read the first red checkout step.",
  "- Compare the saved request, link, price, funnel press, and receipt. The beat only reads links with GET or HEAD.",
  "- Repair the route or writer named by the result and add a failing test for the same buyer-visible break.",
  "Files: src/pulse/coverage/gap-checkout.mjs, api/public/funnel-checkout.mjs, api/public/slo-repair-checkout.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(MONEY_CHECKOUT_LANES),
  fail: () => laneSelfTest(MONEY_CHECKOUT_LANES, true)
};
