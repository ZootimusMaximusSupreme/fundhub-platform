import test from "node:test";
import assert from "node:assert/strict";

import * as checkoutTruth from "./money-checkout-truth.mjs";
import * as financeTruth from "./money-finance-setup-truth.mjs";
import * as unmatchedTruth from "./money-unmatched-truth.mjs";
import * as subscriptionsTruth from "./money-subscriptions-truth.mjs";
import * as movesTruth from "./money-moves-truth.mjs";
import * as adsTruth from "./money-ads-meta-truth.mjs";
import * as checkoutDaily from "../../coverage/gap-checkout.mjs";
import * as financeDaily from "../../coverage/gap-finance-os-setup.mjs";
import * as unmatchedDaily from "../../coverage/gap-payments-unmatched.mjs";
import * as subscriptionsDaily from "../../coverage/gap-subscriptions.mjs";
import * as movesDaily from "../../coverage/gap-money-moves.mjs";
import * as adsDaily from "../../coverage/gap-ads-meta.mjs";

test("W2 daily lanes re-export the exact SQL and verdict runners used by hourly beats", () => {
  const pairs = [
    [checkoutDaily, checkoutTruth, "readCheckoutTruth", ["PAID_SERVICE_SQL", "REPAIR_PRICE_SQL", "FUNNEL_PRESSES_SQL", "judgeRepairRows"]],
    [financeDaily, financeTruth, "readFinanceSetupTruth", ["PAID_TURNS_ON_SQL", "parseSetupFeeCents"]],
    [unmatchedDaily, unmatchedTruth, "readUnmatchedTruth", ["RECEIPT_WAITING_SQL", "LATE_NO_FLAG_SQL"]],
    [subscriptionsDaily, subscriptionsTruth, "readSubscriptionsTruth", ["PAST_DUE_SQL", "ADDON_PAID_NO_PLAN_SQL", "judgePastDue"]],
    [movesDaily, movesTruth, "readMoneyMovesTruth", ["STUCK_SQL"]],
    [adsDaily, adsTruth, "readAdsMetaTruth", ["CONNECTIONS_SQL", "CAMPAIGNS_SQL", "LOAD_JOBS_SQL", "judgeCampaigns"]]
  ];
  for (const [daily, truth, runner, names] of pairs) {
    assert.equal(daily[runner], truth[runner], runner);
    for (const name of names) assert.equal(daily[name], truth[name], name);
  }
});
