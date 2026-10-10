// Alert 2 — a card's promo rate is about to end.
//
// The offer (owner-set 2026-09-29): "After funding, the client gets alerts 60, 30
// and 7 days before each 0% promo ends, along with a payoff or transfer plan."
// The end date is typed in by the client or staff — Plaid sends no promo date —
// and stored on the card's statement-cycle row (db/migrations/471).
//
// PURE. No database, no clock: `today` is a parameter.
//
// THE THRESHOLDS. 60, 30 and 7 days. A threshold fires on its own day and on the
// two days after, so a missed daily run does not lose the alert — and never
// earlier, so a date typed in with 45 days left skips the 60-day alert (it is
// already past) and the first text is the 30-day one.
//
// ONE TEXT PER CARD PER THRESHOLD. The key carries the card, the end date and the
// threshold. Correcting the end date makes a new key, so the corrected date gets
// its own 60 / 30 / 7.
//
// THE PAYOFF LINE IS ARITHMETIC ON STORED NUMBERS, NEVER A GUESS. The balance is
// the card's current balance. The number of monthly payments left is the days left
// divided by 30, rounded, and never less than one (60 days is two payments, 30 or
// fewer is one: pay all of it). The monthly amount is the balance divided by that,
// rounded UP, so the plan clears it with a little to spare. No interest is
// modelled — the text says "about". With no balance on file there is no payoff
// line: it says where to look instead of making a number up.

import { parseIsoDate, daysBetween } from "../../banking/statement-cycles.mjs";
import {
  TEMPLATES, PROMO_THRESHOLDS, PROMO_WINDOW_DAYS, PROMO_MAX_YEARS_AHEAD,
  cardWords, dollars, shortDate, wholeDollarsUp, inDays, isoDay, addDaysIso, toCentsOrNull
} from "./common.mjs";

/** How many monthly payments fit before the promo ends. At least one. */
export function paymentsLeft(daysLeft) {
  if (!Number.isFinite(daysLeft)) return 1;
  return Math.max(1, Math.round(daysLeft / 30));
}

/** The payoff plan for a balance and the days left, or null with no balance to pay. */
export function promoPayoff({ balanceCents, daysLeft } = {}) {
  const balance = toCentsOrNull(balanceCents);
  if (balance === null || balance <= 0) return null;
  const payments = paymentsLeft(daysLeft);
  return { payments, monthly_cents: Math.ceil(balance / payments), total_cents: balance };
}

/** The sentence after the date. */
export function payoffDetail(balanceCents, daysLeft) {
  const balance = toCentsOrNull(balanceCents);
  if (balance === null) return " Open your Money page to see what you still owe.";
  const plan = promoPayoff({ balanceCents: balance, daysLeft });
  const owe = ` You still owe ${dollars(balance)}.`;
  if (plan.payments === 1) return `${owe} Pay all of it before then to clear it in time.`;
  return `${owe} Pay about ${wholeDollarsUp(plan.monthly_cents)} a month for the next ${plan.payments} months to clear it in time.`;
}

/** The threshold a count of days left falls in, or null. */
export function thresholdFor(daysLeft) {
  if (!Number.isInteger(daysLeft)) return null;
  return PROMO_THRESHOLDS.find((t) => daysLeft <= t && daysLeft > t - PROMO_WINDOW_DAYS) ?? null;
}

/** The next alert date for a promo ending on `endsOn`, as of `today`: the first
 *  threshold whose day has not passed. Null when all of them have. */
export function nextPromoAlert(endsOn, today) {
  if (!parseIsoDate(endsOn) || !parseIsoDate(today)) return null;
  for (const t of PROMO_THRESHOLDS) {
    const on = addDaysIso(endsOn, -t);
    if (on && daysBetween(today, on) >= 0) return { threshold: t, on };
  }
  return null;
}

/**
 * planPromoEnd(card, cycle, { today }) → { alert, reason, ... }
 *
 *   card   one entry of the overview's debt.cards (account_id, name, mask, balance_cents)
 *   cycle  that card's account_statement_cycles row (promo_ends_on), or null
 */
export function planPromoEnd(card, cycle, { today } = {}) {
  const skip = (reason, extra = {}) => ({ alert: false, kind: "promo_end", reason, ...extra });
  if (!parseIsoDate(today)) return skip("bad_today");
  if (!card || !card.account_id) return skip("no_card");

  const endsOn = isoDay(cycle?.promo_ends_on);
  if (!endsOn) return skip("no_promo");
  const daysLeft = daysBetween(today, endsOn);
  if (daysLeft === null) return skip("bad_promo_date");
  if (daysLeft < 0) return skip("promo_ended", { endsOn, daysLeft });

  const threshold = thresholdFor(daysLeft);
  if (threshold === null) return skip("not_in_window", { endsOn, daysLeft });

  const balance = toCentsOrNull(card.balance_cents);
  // Nothing owed, nothing to clear. Unknown still goes: the date is worth knowing.
  if (balance !== null && balance <= 0) return skip("nothing_owed", { endsOn, daysLeft });

  const label = cardWords(card);
  const date = shortDate(endsOn);
  const days = inDays(daysLeft);
  const detail = payoffDetail(balance, daysLeft);
  const payoff = promoPayoff({ balanceCents: balance, daysLeft });
  return {
    alert: true,
    kind: "promo_end",
    key: `fpa:promo:${card.account_id}:${endsOn}:${threshold}`,
    templateKey: TEMPLATES.promo_end,
    bankAccountId: card.account_id,
    label,
    threshold,
    dueOn: endsOn,
    daysLeft,
    tags: { card: label, date, days, detail },
    body: `Fundhub reminder: the promo rate on your ${label} ends ${date} (${days}).${detail}`,
    detail: {
      promo_ends_on: endsOn,
      days_left: daysLeft,
      threshold,
      balance_cents: balance,
      payments_left: payoff ? payoff.payments : null,
      monthly_cents: payoff ? payoff.monthly_cents : null,
      promo_apr: cycle?.promo_apr === null || cycle?.promo_apr === undefined ? null : Number(cycle.promo_apr)
    }
  };
}

/* ------------------------------------------------------------------ *
 * Input — a promo typed in by the client or staff
 * ------------------------------------------------------------------ */

export class PromoInputError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
    this.code = "invalid_input";
  }
}

/**
 * readPromoInput(body, { today }) → { endsOn, aprFraction }
 *
 *   ends_on  "YYYY-MM-DD", today or later, no more than five years out. null or ""
 *            clears the promo (endsOn: null).
 *   apr_pct  the promo rate as a percent, 0 to 100 (0 = a 0% promo). Optional.
 *            Read as a percent ALWAYS — never guessed to be a fraction, so 0.5
 *            is half a percent, not fifty. Stored as a fraction like `apr`.
 *
 * Throws PromoInputError naming the field. Nothing is trimmed into shape and
 * nothing is guessed: a date that is not a calendar date is refused.
 */
export function readPromoInput(body = {}, { today } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const rawEnds = b.ends_on;
  if (rawEnds === null || rawEnds === undefined || String(rawEnds).trim() === "") {
    return { endsOn: null, aprFraction: null };
  }
  const endsOn = String(rawEnds).trim();
  if (!parseIsoDate(endsOn)) throw new PromoInputError("ends_on", "ends_on must be a real date like 2026-12-06");
  const left = daysBetween(today, endsOn);
  if (left === null) throw new PromoInputError("ends_on", "today's date could not be read");
  if (left < 0) throw new PromoInputError("ends_on", "that date has already passed");
  if (left > PROMO_MAX_YEARS_AHEAD * 366) {
    throw new PromoInputError("ends_on", `that date is more than ${PROMO_MAX_YEARS_AHEAD} years away — check the year`);
  }

  let aprFraction = null;
  const rawApr = b.apr_pct;
  if (rawApr !== null && rawApr !== undefined && String(rawApr).trim() !== "") {
    const n = typeof rawApr === "number" ? rawApr : Number(String(rawApr).replace(/[%\s]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new PromoInputError("apr_pct", "apr_pct must be a percent from 0 to 100 (0 for a 0% promo)");
    }
    aprFraction = Math.round((n / 100) * 1e5) / 1e5;
  }
  return { endsOn, aprFraction };
}

export default planPromoEnd;
