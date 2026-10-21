// pay-links: every hour, did each Pay press get its checkout link, did money that reached a link
// settle it, and did each payment that maps to a product grant get the grant?
//
// Same SQL, same verdicts as the morning checks in gap-payments.mjs (the truth lives in
// lib/payments-truth.mjs). Three reads of counts. Test money is left out the same way the lane
// leaves it out: demo rows, sim-pay- receipts, agent presses and test clients.
//
// What it guards, and why each surface is on `covers`:
//   route:payment-links        payments:pay-link-webhook and payments:checkout-started-no-link here;
//                              payments:whop-paid-no-access is the paid-access step of the whop-billing beat
//   route:public/slo-checkout  payments:checkout-started-no-link here;
//                              keys:checkout-key-read is the commas-key step of the vendor-keys beat
//                              (the same GET to Commas with the checkout key)
// Those are the exact deep checks src/pulse/tripwires.mjs names; the test holds every one of them to
// an hourly step. payments:paid-no-entitlement also runs here: it is half of route:read/entitlements,
// whose other half (portal:paid-entitlement) runs in the client-portal beat, so that door is on the
// client-portal beat's `covers` with this step named as its other half.
//
// Read only: every read goes through ctx.read (the read box). No send, no write, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import {
  CHECKOUT_STARTED_NO_LINK_SQL, PAID_NO_ENTITLEMENT_SQL, PAY_LINK_WEBHOOK_SQL,
  checkCheckoutStartedNoLink, checkPaidNoEntitlement, checkPayLinkWebhook
} from "./lib/payments-truth.mjs";

export const HOURLY_CHECK_IDS = Object.freeze([
  "payments:pay-link-webhook",
  "payments:checkout-started-no-link",
  "payments:paid-no-entitlement"
]);

/** The deep checks a covered door names that run hourly in another beat: check id -> [beat id, step]. */
export const RUNS_ELSEWHERE = Object.freeze({
  "payments:whop-paid-no-access": Object.freeze(["whop-billing", "paid-access"]),
  "keys:checkout-key-read": Object.freeze(["vendor-keys", "commas-key"])
});

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => {
    const env = { db: { query: (sql, params) => io.read(sql, params) }, orgId: io.orgId, now: io.now };
    return [
      await checkPayLinkWebhook(env),
      await checkCheckoutStartedNoLink(env),
      await checkPaidNoEntitlement(env)
    ];
  },
  selfTest: Object.freeze({
    passRows: Object.freeze([
      Object.freeze([PAY_LINK_WEBHOOK_SQL, Object.freeze([Object.freeze({ n: 0, rec_n: 0, money_n: 0, sim_n: 0 })])]),
      Object.freeze([CHECKOUT_STARTED_NO_LINK_SQL, Object.freeze([Object.freeze({ presses_n: 2, n: 0, oldest: null, refs: null })])]),
      Object.freeze([PAID_NO_ENTITLEMENT_SQL, Object.freeze([Object.freeze({ n: 0, sim_n: 0 })])])
    ]),
    // A buyer pressed Pay and no checkout link was made: the beat must stop at that step.
    failRows: Object.freeze([
      Object.freeze([CHECKOUT_STARTED_NO_LINK_SQL, Object.freeze([Object.freeze({ presses_n: 3, n: 1, oldest: "2026-10-09T17:00:00.000Z", refs: "slo_selftest" })])])
    ])
  })
});

export const id = "pay-links";
export const title = "Pay presses get links and paid links settle";
export const kind = "probe";
export const covers = ["route:payment-links", "route:public/slo-checkout"];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 9000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE);
}

export const fixGuide = [
  "A Pay press got no checkout link, money reached a link that never settled, or a paid grant is missing.",
  "",
  "Likely causes:",
  "- The card session call in api/public/slo-checkout failed, so the buyer pressed Pay and saw an error.",
  "- A Commas payment.succeeded receipt was processed but the pay link was never marked paid.",
  "- A succeeded payment maps to a product grant and the entitlement row was never written.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs pay-links and read the red step: it names the count and the refs.",
  "- Read payment_links, commas_inbox (by link ref), transactions and entitlements for those rows.",
  "- Reach the buyer with a fresh link from the existing pay link flow. Do not take a card or mint a Commas product from the pulse.",
  "Files: src/pulse/beats/lib/payments-truth.mjs, api/public/slo-checkout.mjs, src/payments/commas-inbox.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
