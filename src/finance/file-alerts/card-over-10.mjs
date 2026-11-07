// Card rule after funding — warn before a card would report over 10% at its
// statement close. Alerts bundle, unit AL (owner go part 4, idea 1, 2026-11-07:
// "card rules after funding (warn before any card goes over 10% at statement close)").
//
// PURE. No database, no clock: `today` is a parameter.
//
// WHO IT IS FOR. A client with at least one confirmed approval (an application
// at status Approved, not excluded, with an amount over zero — the one basis
// migration 382 keeps funding_rounds.approved_amount on). Before funding, the
// checklist's paydown steps and the pay-before-close text do this job.
//
// WHEN IT TEXTS. The first daily pass on which a card's balance is over 10% of
// its limit while its next statement close is still ahead. That is the earliest
// warning there can be. ONE TEXT PER CARD PER CYCLE: the key is the card and the
// close date.
//
// IT DOES NOT DOUBLE THE PAY-BEFORE-CLOSE TEXT. Inside that text's window (3 days
// by default, FILE_ALERT_PAY_BEFORE_CLOSE_DAYS) the older text already says "pay
// about $X to get under 10%", so this one stays quiet — unless the client switched
// that text off, in which case this is the only warning left and it goes.
//
// THE WORDS. No amount, no card name, no digits: the text shows on a locked phone.
// The card, the balance and what to pay are on the Alerts screen.

import { nextStatementClose, parseIsoDate } from "../../banking/statement-cycles.mjs";
import { PAYDOWN_TARGET_FRACTION } from "../../waypoints/definitions.mjs";
import { PAY_BEFORE_CLOSE_DAYS_DEFAULT, cardWords, shortDate, usedPercent, toCentsOrNull } from "./common.mjs";
import { BUNDLE_TEMPLATES, CARD_TARGET_PCT, lockScreenSafe } from "./bundle-common.mjs";

/**
 * cardRule(card, cycle, { today }) → where one card stands against the 10% rule.
 *
 *   state  'over'      the balance is over 10% of the limit
 *          'under'     at or under 10%
 *          'unknown'   no balance or no limit on file (unknown_reason says which)
 */
export function cardRule(card = {}, cycle = null, { today } = {}) {
  const balance = toCentsOrNull(card.balance_cents);
  const limit = toCentsOrNull(card.limit_cents);
  const close = nextStatementClose(cycle ?? {}, { today });
  const base = {
    account_id: card.account_id ?? null,
    name: card.name ?? null,
    mask: card.mask ?? null,
    kind: card.kind ?? null,
    balance_cents: balance,
    limit_cents: limit,
    used_pct: usedPercent(balance, limit),
    target_pct: CARD_TARGET_PCT,
    target_cents: null,
    pay_to_target_cents: null,
    closes_on: close.closesOn,
    days_to_close: close.daysAway,
    close_unknown_reason: close.closesOn ? null : close.unknownReason,
    state: "unknown",
    unknown_reason: null
  };
  if (limit === null || limit <= 0) return { ...base, unknown_reason: "no_limit" };
  if (balance === null) return { ...base, unknown_reason: "no_balance" };
  const target = Math.round(limit * PAYDOWN_TARGET_FRACTION);
  const over = balance > target;
  return {
    ...base,
    target_cents: target,
    pay_to_target_cents: over ? balance - target : 0,
    state: over ? "over" : "under"
  };
}

/** The sentence. One place, so the template test can render it. */
export function overTenBody(when) {
  return `Fundhub reminder: one of your cards is over ${CARD_TARGET_PCT}% of its limit. ` +
    `Pay it under ${CARD_TARGET_PCT}% before its statement closes ${when} so a low balance reports. ` +
    "Open Fundhub to see which card.";
}

/**
 * planCardOver10(card, cycle, opts) → { alert: false, reason } | the alert
 *
 *   opts.today               "YYYY-MM-DD"
 *   opts.funded              true once the client has a confirmed approval
 *   opts.payBeforeCloseDays  the pay-before-close text's window (default 3)
 *   opts.payBeforeCloseOn    false when the client switched that text off
 */
export function planCardOver10(card, cycle, {
  today, funded = false, payBeforeCloseDays = PAY_BEFORE_CLOSE_DAYS_DEFAULT, payBeforeCloseOn = true
} = {}) {
  const skip = (reason, extra = {}) => ({ alert: false, kind: "card_over_10", reason, ...extra });
  if (!parseIsoDate(today)) return skip("bad_today");
  if (!card || !card.account_id) return skip("no_card");
  if (!funded) return skip("not_funded");

  const rule = cardRule(card, cycle, { today });
  if (rule.state === "unknown") return skip(rule.unknown_reason);
  if (rule.state !== "over") return skip("under_target");
  if (!rule.closes_on) return skip(rule.close_unknown_reason || "no_statement_close_day");
  if (payBeforeCloseOn && rule.days_to_close <= payBeforeCloseDays) {
    return skip("pay_before_close_text_covers_it", { closesOn: rule.closes_on });
  }

  const when = rule.days_to_close === 0 ? "today" : `on ${shortDate(rule.closes_on)}`;
  const body = overTenBody(when);
  if (!lockScreenSafe(body)) return skip("unsafe_words");
  return {
    alert: true,
    kind: "card_over_10",
    key: `fpa:over10:${card.account_id}:${rule.closes_on}`,
    templateKey: BUNDLE_TEMPLATES.card_over_10,
    bankAccountId: card.account_id,
    // For the screen and the logs only. The text never names the card.
    label: cardWords(card),
    threshold: CARD_TARGET_PCT,
    dueOn: rule.closes_on,
    tags: { when },
    body,
    detail: {
      closes_on: rule.closes_on,
      days_to_close: rule.days_to_close,
      balance_cents: rule.balance_cents,
      limit_cents: rule.limit_cents,
      used_pct: rule.used_pct,
      target_cents: rule.target_cents,
      pay_to_target_cents: rule.pay_to_target_cents
    }
  };
}

export default planCardOver10;
