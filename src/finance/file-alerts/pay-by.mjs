// Pay-by date per card — "Pay by <date>". Alerts bundle, unit AL.
//
// Chris (owner calls part 3, 2026-11-07): "pay a couple of days BEFORE the
// statement close and the due date." A couple is two (PAY_BY_DAYS_BEFORE).
//
// PURE. No database, no clock. SCREEN ONLY: the pay-before-close text, the card
// due text and unit D's phone alerts already remind; this is the one date the
// client reads on each card row.
//
// THE TWO DATES ARE THE ONES THE OTHER ALERTS USE, so the screen cannot disagree
// with a text:
//   statement close  nextStatementClose(cycle) — the day the balance reports
//   due date         the overview card's due_on — Plaid's own due date first, then
//                    the due day (src/finance/money-overview.mjs)
// "Pay by" is two days before whichever comes first. It is never a day in the
// past: with less than two days left it is today, and `tight` says so.

import { nextStatementClose, parseIsoDate, daysBetween } from "../../banking/statement-cycles.mjs";
import { addDaysIso, isoDay } from "./common.mjs";
import { PAY_BY_DAYS_BEFORE } from "./bundle-common.mjs";

function payDay(eventOn, today, daysBefore) {
  if (!eventOn) return { on: null, tight: false };
  const ideal = addDaysIso(eventOn, -daysBefore);
  if (ideal && daysBetween(today, ideal) >= 0) return { on: ideal, tight: false };
  return { on: today, tight: true };
}

/**
 * payBy(card, cycle, { today, daysBefore }) → one card's pay-by row.
 *
 *   for  'statement_close' | 'due_date' | 'both' — which date "Pay by" protects
 *        null when neither date is on file (unknown_reason says why)
 */
export function payBy(card = {}, cycle = null, { today, daysBefore = PAY_BY_DAYS_BEFORE } = {}) {
  const base = {
    account_id: card.account_id ?? null,
    name: card.name ?? null,
    mask: card.mask ?? null,
    kind: card.kind ?? null,
    closes_on: null,
    due_on: null,
    pay_by_close_on: null,
    pay_by_due_on: null,
    pay_by_on: null,
    for: null,
    days_left: null,
    tight: false,
    unknown_reason: null
  };
  if (!parseIsoDate(today)) return { ...base, unknown_reason: "bad_today" };

  const close = nextStatementClose(cycle ?? {}, { today });
  const closesOn = close.closesOn;
  // A due date already behind us is not the next one to pay by.
  const dueRaw = isoDay(card.due_on);
  const dueOn = dueRaw && daysBetween(today, dueRaw) >= 0 ? dueRaw : null;

  const byClose = payDay(closesOn, today, daysBefore);
  const byDue = payDay(dueOn, today, daysBefore);
  const row = { ...base, closes_on: closesOn, due_on: dueOn, pay_by_close_on: byClose.on, pay_by_due_on: byDue.on };

  if (!byClose.on && !byDue.on) {
    return { ...row, unknown_reason: dueRaw ? "due_date_passed_and_no_close_day" : "no_close_or_due_date" };
  }
  let pick;
  if (byClose.on && byDue.on) {
    const gap = daysBetween(byClose.on, byDue.on);
    pick = gap === 0 ? { ...byClose, for: "both", tight: byClose.tight || byDue.tight }
      : gap > 0 ? { ...byClose, for: "statement_close" } : { ...byDue, for: "due_date" };
  } else if (byClose.on) {
    pick = { ...byClose, for: "statement_close" };
  } else {
    pick = { ...byDue, for: "due_date" };
  }
  return { ...row, pay_by_on: pick.on, for: pick.for, days_left: daysBetween(today, pick.on), tight: pick.tight };
}

/** Every card's row, soonest first; cards with no date last. */
export function payByList(cards = [], cycleOf = () => null, { today, daysBefore } = {}) {
  const rows = (Array.isArray(cards) ? cards : []).map((c) => payBy(c, cycleOf(c), { today, daysBefore }));
  return rows.sort((a, b) => {
    if (a.pay_by_on && b.pay_by_on) return a.pay_by_on < b.pay_by_on ? -1 : a.pay_by_on > b.pay_by_on ? 1 : 0;
    if (a.pay_by_on) return -1;
    if (b.pay_by_on) return 1;
    return 0;
  });
}

export default payBy;
