// File-protection alerts — the shared words, names and numbers.
//
// The four alerts (docs/finance/file-protection-alerts.md):
//   payment_timing  pay a card down before its statement closes (that is the day
//                   the balance reports to the bureaus)
//   promo_end       a card's promo rate ends in 60, 30 or 7 days
//   cash_reserve    cash fell below six months of minimum payments
//   new_credit      a new card, loan or inquiry showed up
//
// Every number a client can be told is computed from a stored fact. Every rule
// below that is a CHOICE rather than a fact says so, and says who can change it.

import { parseIsoDate, formatIsoDate } from "../../banking/statement-cycles.mjs";

export { dollars, shortDate } from "../../banking/card-due-reminders.mjs";
// A `date` column or an ISO string -> "YYYY-MM-DD", read as text (not a local midnight).
export { isoDay } from "../clarity-payments.mjs";

export const KINDS = Object.freeze(["payment_timing", "promo_end", "cash_reserve", "new_credit"]);

/** Plain words for the screen, one per kind. */
export const KIND_LABELS = Object.freeze({
  payment_timing: "Pay before the statement closes",
  promo_end: "Promo rate ending",
  cash_reserve: "Cash cushion",
  new_credit: "New credit"
});

/** The SMS template key for each kind (db/migrations/471_file_protection_alerts.sql). */
export const TEMPLATES = Object.freeze({
  payment_timing: "SMS-FILE-PROTECT-PAY-BEFORE-CLOSE",
  promo_end: "SMS-FILE-PROTECT-PROMO-END",
  cash_reserve: "SMS-FILE-PROTECT-CASH-RESERVE",
  new_credit: "SMS-FILE-PROTECT-NEW-CREDIT"
});

/** Where a CSM task for a new-credit alert comes from. Not "money-agent": an open
 *  money-agent task pauses the money helper's texts (src/finance/money-agent.mjs),
 *  and a new card must not stop payment reminders. */
export const TASK_SOURCE = "blueprint-file-protection";
export const TASK_ROLE = "csm";

/* ------------------------------------------------------------------ *
 * Choices
 * ------------------------------------------------------------------ */

/** PAY BEFORE CLOSE — how many days ahead of the statement close the text goes.
 *
 *  The repo has no rule for this number (searched src/, docs/ and the offer —
 *  "which day to pay each card before a round" names no lead time). So it is a
 *  setting, not a fact. The default is 3: it matches the card-due reminder window
 *  next door (REMIND_DAYS_BEFORE in src/banking/card-due-reminders.mjs), and a
 *  card payment usually takes one to three days to post, so 3 days of notice is
 *  the shortest that still lets the payment land before the close.
 *  Change it with FILE_ALERT_PAY_BEFORE_CLOSE_DAYS (1 to 10). */
export const PAY_BEFORE_CLOSE_DAYS_DEFAULT = 3;
export const PAY_BEFORE_CLOSE_DAYS_MAX = 10;

export function readPayBeforeCloseDays(env = {}) {
  const raw = env && env.FILE_ALERT_PAY_BEFORE_CLOSE_DAYS;
  if (raw === undefined || raw === null || String(raw).trim() === "") return PAY_BEFORE_CLOSE_DAYS_DEFAULT;
  const n = Number(String(raw).trim());
  return Number.isInteger(n) && n >= 1 && n <= PAY_BEFORE_CLOSE_DAYS_MAX ? n : PAY_BEFORE_CLOSE_DAYS_DEFAULT;
}

/** PROMO END — the owner-set offer: alerts 60, 30 and 7 days before it ends. */
export const PROMO_THRESHOLDS = Object.freeze([60, 30, 7]);
/** A threshold fires on its day and the two days after it was missed, never
 *  earlier. A promo end date typed in with 45 days left skips the 60 alert, as it
 *  should: it is already past. */
export const PROMO_WINDOW_DAYS = 3;
/** The furthest ahead a promo end date may be typed in. Past this it is a typo. */
export const PROMO_MAX_YEARS_AHEAD = 5;

/** CASH CUSHION — owner-set offer: six months of minimum payments. */
export const RESERVE_MONTHS = 6;
/** Fundhub's own payment plans (Clarity Payments, 443) have no personal or
 *  business tag, so they are counted against ONE cash kind, never both. Personal:
 *  the plan is owed by the client as a person. Change this constant if the owner
 *  decides otherwise. */
export const CLARITY_CASH_KIND = "personal";
/** A cash balance older than this is treated as unknown, not as today's cash.
 *  The Plaid balance feed does not refresh daily yet, so this is a sanity bound
 *  against alerting on a year-old link-time number, not a freshness promise.
 *  A balance with no stated date (a hand-entered account) is allowed — the
 *  overview shows those as current too. */
export const CASH_STALE_AFTER_DAYS = 30;

/** NEW CREDIT — a new account on a linked login is only "new" after the login's
 *  first read. Accounts created within this many minutes of the login itself are
 *  the baseline, not new credit. */
export const NEW_ACCOUNT_BASELINE_MINUTES = 60;
/** And only an account or pull seen this recently is alerted. A daily job that
 *  misses a day still catches it; a backlog from before this shipped stays quiet. */
export const NEW_CREDIT_LOOKBACK_DAYS = 3;

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

/** What a card is called in a text. Its name and last four, so two cards with
 *  one name are told apart. Never a guessed lender. */
export function cardWords(row = {}) {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const mask = row.mask === null || row.mask === undefined ? "" : String(row.mask).trim();
  if (name && mask) return `${name} ending ${mask}`;
  if (name) return name;
  if (mask) return `card ending ${mask}`;
  return "credit card";
}

/** 2900 dollars as "$2,900". Rounds UP to the next whole dollar: it is used for
 *  "pay about", where a little over is safe and a little under is not. */
export function wholeDollarsUp(cents) {
  const dollarsUp = Math.ceil(Math.max(0, Number(cents)) / 100);
  return `$${String(dollarsUp).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** "in 7 days" / "in 1 day". */
export function inDays(n) {
  return `in ${n} ${n === 1 ? "day" : "days"}`;
}

/** Percent of a limit, whole number. Null when either is unknown or the limit is 0. */
export function usedPercent(balanceCents, limitCents) {
  if (!Number.isFinite(balanceCents) || !Number.isFinite(limitCents) || limitCents <= 0) return null;
  return Math.round((Math.max(0, balanceCents) * 100) / limitCents);
}

export const toCentsOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** Milliseconds from a Date, an ISO string or a number. NaN-safe: null if unreadable. */
export function toMs(v) {
  if (v === null || v === undefined || v === "") return null;
  const ms = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}

export const DAY_MS = 86_400_000;

/** An ISO date n days from another. UTC arithmetic on whole days, no clock. */
export function addDaysIso(iso, n) {
  const d = parseIsoDate(iso);
  if (!d) return null;
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return formatIsoDate({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}
