// The Live Trial — the numbers, the names, and the words that are fixed.
//
// $297 buys seven days in which FundHub builds and runs the buyer's first ad
// campaign under the buyer's brand. Day 8 they pay $30,000 and become a partner,
// or they walk away KEEPING every lead the trial produced, paid at the standard
// affiliate 20% on the ones FundHub closes. Spec: docs/specs/W4-live-trial.md.
//
// MONEY IS INTEGER CENTS. Every figure below is cents and stays cents until
// src/commissions/money.mjs formats it. fromCents() returns a STRING — never do
// arithmetic on its output.
//
// WHY THE PRICES ARE HERE AND NOT IN src/config/offers.mjs. offers.mjs is the
// catalogue and it is owned by the checkout unit; the LIVE_TRIAL and
// PARTNER_ENTRY entries land there. This module must not fork that catalogue,
// so instead of copying it silently, drift is a TEST FAILURE:
// src/trials/offer-drift.test.mjs reads offers.mjs and fails if an entry exists
// there with a different price to the one below. Two numbers that disagree is
// the bug; two numbers that must agree, with a test holding them together, is a
// seam.
//
// NO EARNINGS CLAIMS. There are zero measured paid closes on record, so nothing
// in this module — or anything built on it — may state, imply or model a booked
// call rate, a typical result, a range, or another buyer's result. The only
// numbers a buyer ever sees are their own, after they happen.

/** The offer key the checkout rail uses. Matches offers.mjs when it lands. */
export const LIVE_TRIAL_OFFER_KEY = "LIVE_TRIAL";

/** products.code for the trial. Deliberately absent from FUNDING_PRODUCT_CODES
    and REPAIR_PRODUCT_CODES in src/affiliates/economics.mjs: the trial is an
    e-product and stays 100% FundHub. */
export const LIVE_TRIAL_PRODUCT_CODE = "live-trial";

/** $297.00 */
export const LIVE_TRIAL_PRICE_CENTS = 29700;

/** The partner entry fee, one time, no monthly. $30,000.00 */
export const PARTNER_ENTRY_OFFER_KEY = "PARTNER_ENTRY";
export const PARTNER_ENTRY_PRODUCT_CODE = "partner-entry";
/* owner-set 2026-11-07: $30,000 (mirrors src/config/offers.mjs PARTNER_ENTRY) */
export const PARTNER_ENTRY_PRICE_CENTS = 3000000;

/** Seven live days, counted from the first ad impression — not from checkout. */
export const TRIAL_DAYS = 7;

/** The dashboard stays readable, frozen, for 30 days after the trial ends. */
export const FREEZE_DAYS = 30;

/** A held-start trial whose verification is refused inside this window gets a
    full cash refund automatically. It is the one place a plain cash refund is
    correct: FundHub genuinely cannot deliver. */
export const HELD_START_REFUND_DAYS = 30;

/** The minimum ad spend a buyer must have deployed for the zero-call service
    remedy to apply. Their budget, their card — FundHub never holds it. */
export const REMEDY_MIN_SPEND_CENTS = 50000;

/** Extra days of the machine granted by the service remedy. */
export const REMEDY_EXTRA_DAYS = 7;

/** How long the $297 stays creditable against the $30,000 after a zero-call
    trial ends. */
export const REMEDY_CREDIT_WINDOW_DAYS = 30;

/** Trial campaigns run FUNDING only in version one. Never credit_repair: that
    keeps CROA, the credit-repair approver constraint and the TikTok prohibition
    off the critical path of a seven-day product sold to an unsigned party. */
export const TRIAL_OFFER_TYPE = "funding";

/** Stamped on every referral the trial produces so trial-sourced ownership is
    separable in reporting later. */
export const TRIAL_LEAD_SOURCE = "live_trial";

/** The query parameter every trial funnel link carries. NOT arbitrary:
    parseAffiliateClickBody in api/public/affiliate-click.mjs accepts ref, code
    and a1, and src/workflows/af-02-referral-ownership-capture.mjs reads a1 and
    a2 straight off the event payload. Using a1 means zero new attribution code. */
export const TRIAL_ATTRIBUTION_PARAM = "a1";

/** live_trials.status — the whole lifecycle, in order.

    pending_eligibility — the gate has been asked, the sale has not been made
    held_start          — paid; verification is not in yet, so the clock is held
    provisioned         — paid, provisioned, waiting on the first impression
    running             — the clock is running
    ended               — seven live days are done; dashboard frozen, readable
    converted           — they paid the entry fee and became a partner
    declined            — they said no; they keep the leads as an affiliate
    refunded            — money returned (day-1 guarantee, or verification refused) */
export const TRIAL_STATUS = Object.freeze({
  PENDING_ELIGIBILITY: "pending_eligibility",
  HELD_START: "held_start",
  PROVISIONED: "provisioned",
  RUNNING: "running",
  ENDED: "ended",
  CONVERTED: "converted",
  DECLINED: "declined",
  REFUNDED: "refunded"
});

export const TRIAL_STATUSES = Object.freeze(Object.values(TRIAL_STATUS));

/** The statuses in which the dashboard shows live, moving numbers. Anything
    else renders frozen. */
export const LIVE_STATUSES = Object.freeze([TRIAL_STATUS.RUNNING]);

/** Reason strings written to affiliate_referrals.void_reason on conversion.
    voidReferral() requires a reason and never deletes. */
export const VOID_REASON_CONVERTED = "converted_to_partner";

export default {
  LIVE_TRIAL_OFFER_KEY,
  LIVE_TRIAL_PRODUCT_CODE,
  LIVE_TRIAL_PRICE_CENTS,
  PARTNER_ENTRY_OFFER_KEY,
  PARTNER_ENTRY_PRODUCT_CODE,
  PARTNER_ENTRY_PRICE_CENTS,
  TRIAL_DAYS,
  FREEZE_DAYS,
  HELD_START_REFUND_DAYS,
  REMEDY_MIN_SPEND_CENTS,
  REMEDY_EXTRA_DAYS,
  REMEDY_CREDIT_WINDOW_DAYS,
  TRIAL_OFFER_TYPE,
  TRIAL_LEAD_SOURCE,
  TRIAL_ATTRIBUTION_PARAM,
  TRIAL_STATUS,
  TRIAL_STATUSES,
  LIVE_STATUSES,
  VOID_REASON_CONVERTED
};
