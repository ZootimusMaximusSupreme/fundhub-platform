// What FundHub owes when the trial books nothing.
//
// TWO PROMISES, AND THEY ARE NOT THE SAME PROMISE.
//
// 1. THE DAY-1 GUARANTEE — unconditional, and it is about FundHub's own work.
//    If the branded page, the ad set, the live dashboard and the campaign are
//    not delivered by the end of day one, every dollar goes back, automatically,
//    without the buyer asking. That is defensible because all four are things
//    FundHub controls completely.
//
// 2. THE ZERO-CALL REMEDY — conditional, and it is SERVICE, NOT CASH.
//    The $297 buys the machine. It cannot buy a booked call, because the number
//    of calls depends on the ad budget the BUYER controls, the market they
//    picked, and the platform's own delivery. Promising a result FundHub does
//    not control is how a good offer becomes a refund machine. So a trial that
//    ran properly and booked nothing gets: a written breakdown of why, seven
//    more days of the machine, and the $297 credited in full toward the partner
//    entry fee if they join within 30 days. The entry fee is read from
//    src/config/offers.mjs PARTNER_ENTRY ($30,000, owner-set 2026-11-07), never
//    typed here.
//
// EVERY CONDITION IS MEASURABLE FROM DATA FUNDHUB ALREADY HOLDS. Spend comes
// from ad_metrics_daily, the campaign's own status from campaigns.status, and
// the account's state from ad_platform_connections.connection_state. Nobody
// argues about whether the campaign was paused — the system knows.
//
// THIS FILE DECIDES. IT DOES NOT PAY. A cash refund is a payments row of kind
// 'refund' written on the existing rail; there is no refund table here and none
// should ever be invented. Whether a refund can be INITIATED from FundHub, or
// must be done by hand in the Commas dashboard, is unverified — see
// REFUND_INITIATION_UNVERIFIED below. Nothing in this module claims otherwise.

import {
  REMEDY_MIN_SPEND_CENTS,
  REMEDY_EXTRA_DAYS,
  REMEDY_CREDIT_WINDOW_DAYS,
  LIVE_TRIAL_PRICE_CENTS,
  TRIAL_DAYS
} from "./constants.mjs";
import { OFFERS, formatCents } from "../config/offers.mjs";

/** "the $30,000" — the partner entry fee the $297 is credited toward, from the
    catalogue. An unusable price says "the entry fee" rather than a guess. */
function entryFeeWords(entryPriceCents) {
  const price = Number.isSafeInteger(entryPriceCents) && entryPriceCents > 0 ? formatCents(entryPriceCents) : null;
  return price ? `the ${price}` : "the entry fee";
}

/** OUTCOME — what is owed. Four answers and no fifth. */
export const OUTCOME = Object.freeze({
  DAY_ONE_REFUND: "day_one_refund",
  SERVICE_REMEDY: "service_remedy",
  NOT_DUE: "not_due",
  TOO_EARLY: "too_early"
});

/* The four things the day-1 guarantee is about. All four are FundHub's own
   work and all four are delivered on day 0 whether or not a call books. */
export const DAY_ONE_DELIVERABLES = Object.freeze([
  "branded_page_published",
  "ad_set_built",
  "dashboard_live",
  "campaign_live"
]);

/** UNVERIFIED, and named rather than assumed. The day-1 guarantee promises
    "automatically, without asking". Refund handling in this repository is
    inbound only (src/payments/commas-inbox.mjs); no outbound refund path was
    found. Until one person confirms it, a caller must treat a refund decision
    as an instruction to a human, not as a completed action. */
export const REFUND_INITIATION_UNVERIFIED = true;

/**
 * checkDayOneDelivery(delivered) → { met, missing }
 *
 * `delivered` is an object of the four booleans. An ABSENT key is treated as
 * NOT delivered, deliberately: "we did not check" must not read as "we did it".
 */
export function checkDayOneDelivery(delivered = {}) {
  const missing = DAY_ONE_DELIVERABLES.filter((k) => delivered[k] !== true);
  return { met: missing.length === 0, missing };
}

/**
 * evaluateRemedy(facts) → { outcome, ... }
 *
 * facts:
 *   bookedCalls        integer count of booked calls in the trial window
 *   spendCents         integer cents deployed, or null when nothing has synced
 *   campaignPaused     true when the buyer paused their own campaign
 *   connectionRevoked  true when the ad account connection was pulled
 *   trialComplete      true once the seventh live day is finished
 *   dayOneDelivered    the four booleans above
 *   priceCents         what they paid
 *   entryPriceCents    the partner entry fee the $297 is credited toward;
 *                      defaults to the catalogue's (offers.mjs PARTNER_ENTRY)
 *
 * NULL SPEND IS NOT ZERO SPEND. When no metrics have synced, the answer is
 * "cannot tell yet" and the remedy is not refused on a number nobody has.
 */
export function evaluateRemedy(facts = {}) {
  const {
    bookedCalls = null,
    spendCents = null,
    campaignPaused = false,
    connectionRevoked = false,
    trialComplete = false,
    dayOneDelivered = {},
    priceCents = LIVE_TRIAL_PRICE_CENTS,
    minSpendCents = REMEDY_MIN_SPEND_CENTS,
    entryPriceCents = OFFERS.PARTNER_ENTRY.priceCents
  } = facts;

  /* The day-1 guarantee is checked FIRST and it does not care about calls. It
     is about whether FundHub built the thing it sold. */
  const delivery = checkDayOneDelivery(dayOneDelivered);
  if (!delivery.met) {
    return {
      outcome: OUTCOME.DAY_ONE_REFUND,
      refundCents: priceCents,
      missing: delivery.missing,
      automatic: true,
      requiresHuman: REFUND_INITIATION_UNVERIFIED,
      message:
        "We did not deliver your page, your ad set, your dashboard and your campaign by the end of day one. " +
        "That is on us. Your $297 goes back in full."
    };
  }

  if (!trialComplete) {
    return {
      outcome: OUTCOME.TOO_EARLY,
      message: "The seven days are not finished. Nothing is decided until they are."
    };
  }

  if (bookedCalls == null) {
    return {
      outcome: OUTCOME.TOO_EARLY,
      message: "We do not have a booked-call count for this trial yet, so there is nothing to decide on."
    };
  }

  if (bookedCalls > 0) {
    return {
      outcome: OUTCOME.NOT_DUE,
      bookedCalls,
      message: "Calls booked. The zero-call remedy does not apply."
    };
  }

  const failed = [];
  if (spendCents == null) failed.push("spend_unknown");
  else if (spendCents < minSpendCents) failed.push("spend_below_minimum");
  if (campaignPaused) failed.push("campaign_paused");
  if (connectionRevoked) failed.push("account_disconnected");

  if (failed.length) {
    return {
      outcome: OUTCOME.NOT_DUE,
      bookedCalls: 0,
      unmet: failed,
      // Said plainly, because this is the conversation that goes wrong when it
      // is said vaguely.
      message:
        "No calls booked, and the trial did not run the way the remedy covers. " +
        "The remedy needs the full seven days, at least $500 of your own ad spend, and an account that stayed connected the whole time."
    };
  }

  return {
    outcome: OUTCOME.SERVICE_REMEDY,
    bookedCalls: 0,
    grants: {
      writtenBreakdown: true,
      extraDays: REMEDY_EXTRA_DAYS,
      creditCents: priceCents,
      creditWindowDays: REMEDY_CREDIT_WINDOW_DAYS
    },
    // NOT a cash refund, and the wording says so rather than leaving it to be
    // discovered on a call.
    refundCents: 0,
    message:
      "You ran the full seven days, you spent your budget, your account stayed live, and no call booked. " +
      `You get a written breakdown of why at no charge, ${REMEDY_EXTRA_DAYS} more days of the machine at no charge, ` +
      `and your $297 credited in full toward ${entryFeeWords(entryPriceCents)} if you join within ${REMEDY_CREDIT_WINDOW_DAYS} days.`
  };
}

/** The exact policy wording that goes on the page. One string, one place — a
    guarantee that is paraphrased on a second surface is a guarantee with two
    meanings. */
export function remedyPolicyText({ entryPriceCents = OFFERS.PARTNER_ENTRY.priceCents } = {}) {
  return [
    "If FundHub does not deliver your branded page, your ad set, your live dashboard and your campaign " +
    "by the end of day one, you get every dollar back, automatically, without asking.",
    `If you run the full ${TRIAL_DAYS} days with at least $500 in spend, your account stays active the whole time, ` +
    "and no call books, you get: a written breakdown of why, at no charge; " +
    `${REMEDY_EXTRA_DAYS} more days of the machine, at no charge; and your $297 credited in full toward ${entryFeeWords(entryPriceCents)} ` +
    `if you join within ${REMEDY_CREDIT_WINDOW_DAYS} days.`
  ];
}

export default {
  OUTCOME,
  DAY_ONE_DELIVERABLES,
  REFUND_INITIATION_UNVERIFIED,
  checkDayOneDelivery,
  evaluateRemedy,
  remedyPolicyText
};
