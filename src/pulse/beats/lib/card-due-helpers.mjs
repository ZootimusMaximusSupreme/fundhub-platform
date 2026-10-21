// Small pure helpers the card-due planners need, copied into the beat library.
//
// WHY A COPY. The planners in ./card-due-plan.mjs are run by the daily job
// (src/workflows/finance-os-card-due-reminders.mjs, through the re-export in
// src/banking/card-due-reminders.mjs) and by the hourly beat money-alerts. A file under
// src/pulse/beats/lib may import only from this folder, so the helpers it needs live here too.
//
// THE ORIGINALS STAY WHERE THEY ARE and every other caller keeps using them:
//   fromCents                                    src/commissions/money.mjs
//   daysInMonth, clampDayToMonth, parseIsoDate,
//   formatIsoDate, nextOccurrence, daysBetween,
//   nextDueDate, UNKNOWN_REASONS                 src/banking/statement-cycles.mjs
// Each body below is the original's code, unchanged (only comments are shorter). card-due-helpers.test.mjs runs both
// copies on many inputs (month ends, leap years, bad input, null, undefined) and fails on any
// difference, so the two cannot drift apart.
//
// PURE. No database, no clock, no I/O. Dates are "YYYY-MM-DD" strings (see statement-cycles.mjs
// for why). A day past the end of a month clamps to the last day of that month.

/** Integer cents -> fixed 2dp string. Copy of fromCents in src/commissions/money.mjs. */
export function fromCents(cents) {
  if (!Number.isInteger(cents)) throw new TypeError(`fromCents: not an integer: ${cents}`);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/** Days in a month. `month` is 1-12. Copy of daysInMonth in src/banking/statement-cycles.mjs. */
export function daysInMonth(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new TypeError(`daysInMonth: bad year/month: ${year}/${month}`);
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Clamp a day-of-month to a real day in that month. Copy of clampDayToMonth. */
export function clampDayToMonth(year, month, day) {
  const last = daysInMonth(year, month);
  return day > last ? last : day;
}

/** "YYYY-MM-DD" -> { year, month, day }, or null if it is not one. Copy of parseIsoDate. */
export function parseIsoDate(iso) {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** { year, month, day } -> "YYYY-MM-DD". Copy of formatIsoDate. */
export function formatIsoDate({ year, month, day }) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The next date on or after `fromIso` that falls on `day`, month-end rule applied. Copy of nextOccurrence. */
export function nextOccurrence(day, fromIso) {
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const from = parseIsoDate(fromIso);
  if (!from) return null;

  const thisMonth = clampDayToMonth(from.year, from.month, day);
  if (thisMonth >= from.day) {
    return formatIsoDate({ year: from.year, month: from.month, day: thisMonth });
  }

  const year = from.month === 12 ? from.year + 1 : from.year;
  const month = from.month === 12 ? 1 : from.month + 1;
  return formatIsoDate({ year, month, day: clampDayToMonth(year, month, day) });
}

/** Whole days from `fromIso` to `toIso`; null if either is unparseable. Copy of daysBetween. */
export function daysBetween(fromIso, toIso) {
  const a = parseIsoDate(fromIso), b = parseIsoDate(toIso);
  if (!a || !b) return null;
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86400000);
}

/** Why a date could not be computed. Copy of UNKNOWN_REASONS. */
export const UNKNOWN_REASONS = {
  NO_DUE_DAY: "no_payment_due_day",
  NO_CLOSE_DAY: "no_statement_close_day",
  BAD_TODAY: "invalid_reference_date"
};

/** nextDueDate(cycle, { today }) -> { dueOn, daysAway, unknownReason }. Copy of nextDueDate. */
export function nextDueDate(cycle, { today } = {}) {
  const none = (unknownReason) => ({ dueOn: null, daysAway: null, unknownReason });

  if (!parseIsoDate(today)) return none(UNKNOWN_REASONS.BAD_TODAY);

  const day = cycle?.payment_due_day;
  if (day === null || day === undefined) return none(UNKNOWN_REASONS.NO_DUE_DAY);

  const dueOn = nextOccurrence(Number(day), today);
  if (!dueOn) return none(UNKNOWN_REASONS.NO_DUE_DAY);

  return { dueOn, daysAway: daysBetween(today, dueOn), unknownReason: null };
}
