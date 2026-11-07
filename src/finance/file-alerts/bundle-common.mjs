// Alerts bundle (Finance OS CFO build, unit AL, 2026-11-07) — the shared names,
// numbers and words. Board: ops/workflows/finance-os-cfo-build-2026-11-06.txt
// (owner go, part 4, ideas 1, 2, 5 and 7; owner calls part 3 for pay-by and
// seasoning). Brief: ops/workflows/finance-os-wave3-brief.txt, unit AL.
//
// FIVE PIECES, NEW FILES ONLY (unit D owns the four older alerts in this folder):
//   card_over_10     after funding, a card is over 10% of its limit before its
//                    statement closes                       -> one text per card per cycle
//   intro countdown  days left on a card's promo rate and the monthly payoff to
//                    clear it in time                       -> screen only (promo_end texts)
//   business_credit  a business's saved score changed between its last two reports
//                                                           -> one text per business per report
//   pay-by date      "Pay by <date>", a couple of days before the statement close
//                    and the due date                       -> screen only
//   weekly_money     money in, card use, seasoning, steps left  -> one text per client per week
//
// THE LOCK SCREEN. A text preview shows on a locked phone. So every sentence these
// alerts send is plain words: no dollar amount, no bank or card name, no account
// digits (brief: "Plain push and text words, no amounts on the lock screen";
// owner-set 2026-11-06, spec item 1). The amounts are on the screen, behind the
// login. lockScreenSafe() below is the guard every planner runs on its own text.

import { PAYDOWN_TARGET_FRACTION } from "../../waypoints/definitions.mjs";
import { NEW_CREDIT_LOOKBACK_DAYS } from "./common.mjs";

export const BUNDLE_KINDS = Object.freeze(["card_over_10", "business_credit", "weekly_money"]);

/** Plain words for the screen, one per kind. */
export const BUNDLE_LABELS = Object.freeze({
  card_over_10: "Card over 10% after funding",
  business_credit: "Business credit changed",
  weekly_money: "Weekly money text"
});

/** The SMS template key for each kind (db/migrations/578_finance_alerts_bundle.sql). */
export const BUNDLE_TEMPLATES = Object.freeze({
  card_over_10: "SMS-FILE-PROTECT-CARD-OVER-10",
  business_credit: "SMS-FILE-PROTECT-BUSINESS-CREDIT",
  weekly_money: "SMS-FINANCE-WEEKLY-MONEY"
});

/** The card rule's target, in whole percent: the same 10% the checklist's paydown
 *  steps and the pay-before-close text work to (PAYDOWN_TARGET_FRACTION). */
export const CARD_TARGET_PCT = Math.round(PAYDOWN_TARGET_FRACTION * 100);

/** PAY-BY — "pay a couple of days BEFORE the statement close and the due date"
 *  (Chris, owner calls part 3, 2026-11-07). A couple is two. */
export const PAY_BY_DAYS_BEFORE = 2;

/** SEASONING — "at 30 days the client sees 'Congrats. Your <bank> account is
 *  seasoned.' 60 and 90 days are better" (owner calls part 3, 2026-11-07). */
export const SEASONED_DAYS = 30;
export const SEASONED_BETTER_DAYS = Object.freeze([60, 90]);

/** A business report is "new" for this many days after its pull, the same window
 *  the new-credit alert uses: a missed daily run still catches it, a backlog from
 *  before this shipped stays quiet. */
export const BUSINESS_LOOKBACK_DAYS = NEW_CREDIT_LOOKBACK_DAYS;
/** How many of the newest pulls that hold business reports are read. Two are
 *  compared; the rest let a business that was not on the newest pull still find
 *  its own last two reports. */
export const BUSINESS_PULLS_READ = 6;

/** THE WEEK. The weekly text goes Monday morning and tells the seven days before. */
export const WEEK_DAYS = 7;
/** A deposit and a same-size withdrawal on two of the client's own accounts this
 *  many days apart are one move between their own accounts, not money in. */
export const OWN_TRANSFER_MATCH_DAYS = 3;
/** Plaid's own words for a move between the client's own accounts. */
export const OWN_TRANSFER_CATEGORY = /^TRANSFER_IN_(ACCOUNT_TRANSFER|SAVINGS)\b/i;

/** No dollar sign, no run of three or more digits (an amount or account digits),
 *  no "ending 1234" card mask. Days, counts, dates and the 10% rule pass. */
export function lockScreenSafe(text) {
  const s = String(text ?? "");
  if (/\$/.test(s)) return false;
  if (/\d{3,}/.test(s)) return false;
  if (/\d[\d,]*\.\d{2}\b/.test(s)) return false;
  if (/\bending\s+\d/i.test(s)) return false;
  return true;
}

/** "1 card" / "3 cards". */
export function count(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
