// Intro rate countdown — days left on each card's intro rate, and the payoff per
// month that clears it in time. Alerts bundle, unit AL (owner go part 4, idea 2).
//
// PURE. No database, no clock. SCREEN ONLY: the 60 / 30 / 7 day texts stay with
// the promo alert (./promo.mjs), and nothing here texts a second time.
//
// THE PROMO IS READ THE WAY ./promo.mjs READS IT, with its own functions, so the
// countdown, the Settings card and the text say one amount: the end date and rate
// typed in on the card's statement-cycle row (migration 471), promoPct() for the
// rate, payoffAtRate() for the monthly amount and nextPromoAlert() for the day the
// next promo text can go.
//
// THE MONTHLY AMOUNT USES THE PROMO RATE (Codex design review, binding, 2026-11-07:
// a no-interest amount is never said to clear a balance that is charged interest).
// 0% is the balance split evenly, rounded up. A known rate above 0% adds that rate's
// interest each month (APR ÷ 12), and the amount is the level payment that reaches
// zero on the last payment, rounded up. With no rate on file the interest is
// unknown: the even split is only the least it can be, `monthly_is_floor` says so,
// and the screen shows it as "at least", never as a payoff.
//
// Money is integer cents. With no balance on file there is no monthly amount:
// it stays null and the screen says where to look.

import { daysBetween, parseIsoDate } from "../../banking/statement-cycles.mjs";
import { nextPromoAlert, promoPct, payoffAtRate } from "./promo.mjs";
import { isoDay, toCentsOrNull } from "./common.mjs";

/* The rate and payoff helpers live with the promo alert; kept importable from here too. */
export { promoPct, payoffAtRate };

/**
 * introCountdown(card, cycle, { today }) → null when the card has no promo on
 * file, else the countdown.
 *
 *   zero_rate         true only when the stored rate is exactly 0; null when no rate given
 *   ended             the end date has passed (days_left < 0); no payoff then
 *   monthly_cents     what clears the balance by the last payment, at the promo rate
 *   monthly_is_floor  true when no rate is on file: monthly_cents is the least, not a payoff
 */
export function introCountdown(card = {}, cycle = null, { today } = {}) {
  const endsOn = isoDay(cycle?.promo_ends_on);
  if (!endsOn || !parseIsoDate(today)) return null;
  const daysLeft = daysBetween(today, endsOn);
  if (daysLeft === null) return null;
  const balance = toCentsOrNull(card.balance_cents);
  const aprPct = promoPct(cycle?.promo_apr);
  const ended = daysLeft < 0;
  const payoff = ended ? null : payoffAtRate({ balanceCents: balance, daysLeft, aprPct });
  return {
    account_id: card.account_id ?? null,
    name: card.name ?? null,
    mask: card.mask ?? null,
    kind: card.kind ?? null,
    ends_on: endsOn,
    days_left: daysLeft,
    ended,
    apr_pct: aprPct,
    zero_rate: aprPct === null ? null : aprPct === 0,
    balance_cents: balance,
    nothing_owed: balance !== null && balance <= 0,
    payments_left: payoff ? payoff.payments : null,
    monthly_cents: payoff ? payoff.monthly_cents : null,
    monthly_is_floor: payoff ? payoff.monthly_is_floor : false,
    next_text: ended ? null : nextPromoAlert(endsOn, today),
    source: cycle?.promo_source ?? null
  };
}

/** Every card with a promo: running ones soonest first, ended ones last. */
export function introCountdowns(cards = [], cycleOf = () => null, { today } = {}) {
  const rows = (Array.isArray(cards) ? cards : [])
    .map((c) => introCountdown(c, cycleOf(c), { today }))
    .filter(Boolean);
  return rows.sort((a, b) => {
    if (a.ended !== b.ended) return a.ended ? 1 : -1;
    return a.ended ? b.days_left - a.days_left : a.days_left - b.days_left;
  });
}

export default introCountdown;
