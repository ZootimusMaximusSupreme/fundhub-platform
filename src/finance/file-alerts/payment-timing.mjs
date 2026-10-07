// Alert 1 — pay a card down before its statement closes.
//
// WHY THE CLOSE DATE AND NOT THE DUE DATE. A card's balance reports to the
// bureaus when the statement closes (offer, owner-set 2026-09-29: "Balances report
// on the statement date, so the system tells the client which day to pay each card
// before a round"). The due date is a different day and a different job — the card
// due reminder (src/banking/card-due-reminders.mjs) already texts about that one.
// This text is about what the lender will SEE.
//
// PURE. No database, no clock: `today` is a parameter. The close date comes from
// src/banking/statement-cycles.mjs (the month-end rule lives there and nowhere
// else) and the balance and limit from the Finance OS overview, so the number in
// the text is the number on the screen.
//
// ONE TEXT PER CARD PER CYCLE. The key is the card and the statement close date.
// The first daily pass inside the window writes it; every later pass finds it.
//
// NOTHING IS INVENTED. "Pay about $2,900 to get under 10%" is the balance minus 10%
// of the limit — the same 10% the checklist's paydown steps work to
// (PAYDOWN_TARGET_FRACTION). With no limit on file the text says the balance and
// stops. With no balance on file it says the day and stops.

import { nextStatementClose, parseIsoDate } from "../../banking/statement-cycles.mjs";
import { PAYDOWN_TARGET_FRACTION } from "../../waypoints/definitions.mjs";
import {
  TEMPLATES, PAY_BEFORE_CLOSE_DAYS_DEFAULT,
  cardWords, dollars, shortDate, wholeDollarsUp, usedPercent, toCentsOrNull
} from "./common.mjs";

const TARGET_PCT = Math.round(PAYDOWN_TARGET_FRACTION * 100);

/** The balance sentence, or "" when the balance is not known. */
export function balanceDetail(balanceCents, limitCents) {
  const balance = toCentsOrNull(balanceCents);
  if (balance === null) return { text: "", pct: null, targetCents: null, payToTargetCents: null };
  const limit = toCentsOrNull(limitCents);
  const pct = usedPercent(balance, limit);
  const targetCents = limit !== null && limit > 0 ? Math.round(limit * PAYDOWN_TARGET_FRACTION) : null;
  let text = ` Balance now ${dollars(balance)}`;
  if (pct !== null) text += ` (${pct}% of your limit)`;
  let payToTargetCents = null;
  if (targetCents !== null) {
    if (balance > targetCents) {
      payToTargetCents = balance - targetCents;
      text += `. Pay about ${wholeDollarsUp(payToTargetCents)} to get under ${TARGET_PCT}%`;
    } else {
      text += `, already under ${TARGET_PCT}%`;
    }
  }
  return { text: `${text}.`, pct, targetCents, payToTargetCents };
}

/**
 * planPaymentTiming(card, cycle, { today, daysBefore }) → { alert, reason, ... }
 *
 *   card   one entry of the overview's debt.cards (account_id, name, mask,
 *          balance_cents, limit_cents)
 *   cycle  that card's account_statement_cycles row (statement_close_day), or null
 *
 * `alert: false` always carries a `reason`, so a skipped card is explained rather
 * than silent.
 */
export function planPaymentTiming(card, cycle, { today, daysBefore = PAY_BEFORE_CLOSE_DAYS_DEFAULT } = {}) {
  const skip = (reason, extra = {}) => ({ alert: false, kind: "payment_timing", reason, ...extra });
  if (!parseIsoDate(today)) return skip("bad_today");
  if (!card || !card.account_id) return skip("no_card");

  const close = nextStatementClose(cycle ?? {}, { today });
  if (!close.closesOn) return skip(close.unknownReason);
  const { closesOn, daysAway } = close;
  if (daysAway > daysBefore) return skip("not_yet", { closesOn, daysAway });

  const balance = toCentsOrNull(card.balance_cents);
  // A known balance at or below zero has nothing to pay down. Unknown still goes:
  // the day is worth knowing even when the amount is not.
  if (balance !== null && balance <= 0) return skip("no_balance", { closesOn, daysAway });

  const label = cardWords(card);
  const when = daysAway === 0 ? `today (${shortDate(closesOn)})` : `before ${shortDate(closesOn)}`;
  const bal = balanceDetail(balance, card.limit_cents);
  return {
    alert: true,
    kind: "payment_timing",
    key: `fpa:pay:${card.account_id}:${closesOn}`,
    templateKey: TEMPLATES.payment_timing,
    bankAccountId: card.account_id,
    label,
    threshold: daysBefore,
    dueOn: closesOn,
    daysAway,
    tags: { card: label, when, detail: bal.text },
    body: `Fundhub reminder: pay your ${label} down ${when}. That is the day it reports to the bureaus.${bal.text}`,
    detail: {
      closes_on: closesOn,
      days_away: daysAway,
      days_before: daysBefore,
      balance_cents: balance,
      limit_cents: toCentsOrNull(card.limit_cents),
      used_pct: bal.pct,
      target_cents: bal.targetCents,
      pay_to_target_cents: bal.payToTargetCents
    }
  };
}

export default planPaymentTiming;
