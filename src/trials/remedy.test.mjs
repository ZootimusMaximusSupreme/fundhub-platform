// Zero calls in seven days. What is owed, and what is not.
//
// The two promises are different and these tests keep them apart:
//   the DAY-1 GUARANTEE is unconditional and it is about FundHub's own work
//   the ZERO-CALL REMEDY is conditional and it is SERVICE, not cash

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  evaluateRemedy, checkDayOneDelivery, remedyPolicyText,
  OUTCOME, DAY_ONE_DELIVERABLES, REFUND_INITIATION_UNVERIFIED
} from "./remedy.mjs";
import { LIVE_TRIAL_PRICE_CENTS, REMEDY_MIN_SPEND_CENTS, REMEDY_EXTRA_DAYS } from "./constants.mjs";
import { OFFERS, formatCents } from "../config/offers.mjs";

const DELIVERED = {
  branded_page_published: true,
  ad_set_built: true,
  dashboard_live: true,
  campaign_live: true
};

const RAN_PROPERLY = {
  bookedCalls: 0,
  spendCents: REMEDY_MIN_SPEND_CENTS,
  campaignPaused: false,
  connectionRevoked: false,
  trialComplete: true,
  dayOneDelivered: DELIVERED
};

describe("checkDayOneDelivery", () => {
  test("all four present is met", () => {
    assert.deepEqual(checkDayOneDelivery(DELIVERED), { met: true, missing: [] });
  });

  /* AN ABSENT KEY IS NOT DELIVERED. "We did not check" must never read as
     "we did it" — that is the direction that costs a refund promise. */
  test("an absent key counts as not delivered", () => {
    const out = checkDayOneDelivery({});
    assert.equal(out.met, false);
    assert.deepEqual(out.missing, [...DAY_ONE_DELIVERABLES]);
  });

  test("a truthy non-true value does not count", () => {
    const out = checkDayOneDelivery({ ...DELIVERED, campaign_live: "yes" });
    assert.equal(out.met, false);
    assert.deepEqual(out.missing, ["campaign_live"]);
  });
});

describe("the day-1 guarantee", () => {
  test("undelivered on day one is a full cash refund, and calls do not matter", () => {
    const out = evaluateRemedy({
      ...RAN_PROPERLY,
      bookedCalls: 40,
      dayOneDelivered: { ...DELIVERED, campaign_live: false }
    });
    assert.equal(out.outcome, OUTCOME.DAY_ONE_REFUND);
    assert.equal(out.refundCents, LIVE_TRIAL_PRICE_CENTS);
    assert.deepEqual(out.missing, ["campaign_live"]);
    assert.equal(out.automatic, true);
  });

  /* The page promises "automatically, without asking". No outbound refund path
     was found in this repository, so the decision object says a human is still
     required rather than letting a screen imply the money has moved. */
  test("the refund still names a human, because no outbound refund path is proven", () => {
    const out = evaluateRemedy({ ...RAN_PROPERLY, dayOneDelivered: {} });
    assert.equal(out.requiresHuman, REFUND_INITIATION_UNVERIFIED);
    assert.equal(REFUND_INITIATION_UNVERIFIED, true);
  });

  test("it is checked before the trial is complete — day one does not wait a week", () => {
    const out = evaluateRemedy({ ...RAN_PROPERLY, trialComplete: false, dayOneDelivered: {} });
    assert.equal(out.outcome, OUTCOME.DAY_ONE_REFUND);
  });
});

describe("the zero-call service remedy", () => {
  test("ran the full seven days, spent the budget, stayed live, booked nothing", () => {
    const out = evaluateRemedy(RAN_PROPERLY);
    assert.equal(out.outcome, OUTCOME.SERVICE_REMEDY);
    assert.equal(out.grants.writtenBreakdown, true);
    assert.equal(out.grants.extraDays, REMEDY_EXTRA_DAYS);
    assert.equal(out.grants.creditCents, LIVE_TRIAL_PRICE_CENTS);
    // SERVICE, NOT CASH. More machine costs FundHub almost nothing and keeps
    // the relationship alive; a cash refund ends it.
    assert.equal(out.refundCents, 0);
  });

  test("a call booked means the remedy does not apply", () => {
    const out = evaluateRemedy({ ...RAN_PROPERLY, bookedCalls: 1 });
    assert.equal(out.outcome, OUTCOME.NOT_DUE);
  });

  test("below the spend floor, not due, and the reason is named", () => {
    const out = evaluateRemedy({ ...RAN_PROPERLY, spendCents: REMEDY_MIN_SPEND_CENTS - 1 });
    assert.equal(out.outcome, OUTCOME.NOT_DUE);
    assert.ok(out.unmet.includes("spend_below_minimum"));
  });

  test("a paused campaign or a revoked account is not due", () => {
    assert.ok(evaluateRemedy({ ...RAN_PROPERLY, campaignPaused: true }).unmet.includes("campaign_paused"));
    assert.ok(evaluateRemedy({ ...RAN_PROPERLY, connectionRevoked: true }).unmet.includes("account_disconnected"));
  });

  /* NULL SPEND IS NOT ZERO SPEND. When nothing has synced, the answer is
     "cannot tell", and the remedy is not refused on a number nobody has. */
  test("unknown spend is unknown, not below the floor", () => {
    const out = evaluateRemedy({ ...RAN_PROPERLY, spendCents: null });
    assert.equal(out.outcome, OUTCOME.NOT_DUE);
    assert.ok(out.unmet.includes("spend_unknown"));
    assert.ok(!out.unmet.includes("spend_below_minimum"));
  });

  test("an unfinished trial decides nothing", () => {
    assert.equal(evaluateRemedy({ ...RAN_PROPERLY, trialComplete: false }).outcome, OUTCOME.TOO_EARLY);
  });

  test("a missing booked-call count decides nothing rather than assuming zero", () => {
    assert.equal(evaluateRemedy({ ...RAN_PROPERLY, bookedCalls: null }).outcome, OUTCOME.TOO_EARLY);
  });
});

describe("remedyPolicyText", () => {
  test("says the day-1 guarantee is unconditional and about FundHub's work", () => {
    const [dayOne] = remedyPolicyText();
    assert.match(dayOne, /every dollar back, automatically, without asking/);
    assert.match(dayOne, /branded page, your ad set, your live dashboard and your campaign/);
  });

  test("the zero-call clause names all three conditions and all three grants", () => {
    const [, zero] = remedyPolicyText();
    assert.match(zero, /\$500 in spend/);
    assert.match(zero, /account stays active/);
    assert.match(zero, /written breakdown/);
    assert.match(zero, /more days of the machine/);
    assert.match(zero, /credited in full toward the \$30,000/);
  });

  test("the entry fee is the catalogue's PARTNER_ENTRY price, never typed (owner-set 2026-11-07)", () => {
    const fee = formatCents(OFFERS.PARTNER_ENTRY.priceCents);
    assert.equal(fee, "$30,000");
    assert.ok(remedyPolicyText()[1].includes(`credited in full toward the ${fee} `));
    assert.ok(evaluateRemedy(RAN_PROPERLY).message.includes(`credited in full toward the ${fee} if you join`));
  });

  test("a different entry price changes both lines; an unusable one names no figure", () => {
    const [, zero] = remedyPolicyText({ entryPriceCents: 2500000 });
    assert.match(zero, /credited in full toward the \$25,000 if you join/);
    assert.doesNotMatch(zero, /\$30,000/);
    const out = evaluateRemedy({ ...RAN_PROPERLY, entryPriceCents: 2500000 });
    assert.match(out.message, /credited in full toward the \$25,000 if you join/);
    assert.match(remedyPolicyText({ entryPriceCents: null })[1], /credited in full toward the entry fee if you join/);
  });

  test("no earnings claim, no promised result", () => {
    const text = remedyPolicyText().join(" ");
    assert.ok(!/average|typical|expect \d|guarantee(d)? (approval|results?)/i.test(text));
  });
});
