// Alerts and repeat bills the client adds by hand — the shared pure planner. When
// each one is next, and whether a phone alert is owed today. No database, no clock,
// no send. Finance OS CFO build, unit AL2 (owner ask 2026-11-07: "they can add
// alerts too... add recurring expenses").
//
// ONE PLANNER, THREE CLOCKS, like ./phone-alert-plan.mjs: the daily file-alerts pass
// (src/finance/file-alerts/run.mjs, through src/finance/file-alerts/custom.mjs, which
// re-exports every name here), the morning check and the hourly beat
// (./phone-alerts-truth.mjs) all decide "is a push owed?" with this code. A file in
// this folder may import only from this folder.
//
// THE ROWS are finance_custom_alerts (db/migrations/583_finance_custom_alerts.sql):
//   cadence 'once'      on start_on, one time
//           'weekly'    every 7 days, counted from start_on
//           'biweekly'  every 14 days, counted from start_on
//           'monthly'   on day_of_month; a day past a month's end lands on its last
//                       day (the same month-end rule as every card due day)
//           'annual'    on start_on's month and day, every year
//
// ONE PUSH PER DATE. The key is custom:<id>:<date>; the queued row's provider_ref is
// finance-push:<key> under the unique (org_id, provider_ref) index. The push goes in
// the same window as every other payment alert: 0 to REMIND_DAYS_BEFORE days ahead.
//
// NOTHING IS GUESSED. A date that cannot be read is no date; a one-time alert whose
// day has passed has no next date.

import { REMIND_DAYS_BEFORE } from "./card-due-plan.mjs";
import {
  parseIsoDate, formatIsoDate, nextOccurrence, daysBetween, clampDayToMonth
} from "./card-due-helpers.mjs";

/** The phone alert kind of each row kind. */
export const CUSTOM_PHONE_KINDS = Object.freeze({ alert: "custom_alert", bill: "custom_bill" });
export const CUSTOM_CADENCES = Object.freeze(["once", "weekly", "biweekly", "monthly", "annual"]);
/** An alert repeats monthly or goes once; a bill repeats. */
export const ALERT_CADENCES = Object.freeze(["once", "monthly"]);
export const BILL_CADENCES = Object.freeze(["weekly", "biweekly", "monthly", "annual"]);
export const CUSTOM_KEY_PREFIX = "custom:";
/** The push goes the same number of days ahead as every other payment alert. */
export const CUSTOM_PUSH_DAYS_BEFORE = REMIND_DAYS_BEFORE;

const STEP_DAYS = Object.freeze({ weekly: 7, biweekly: 14 });

/** A `date` column or a string as "YYYY-MM-DD", or null. node-postgres hands a `date`
 *  back as LOCAL midnight, so the local parts are the stored day. */
export function customDay(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  return parseIsoDate(s) ? s : null;
}

function addDays(iso, n) {
  const d = parseIsoDate(iso);
  if (!d) return null;
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return formatIsoDate({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}

function dayOfMonth(row) {
  const n = Number(row && row.day_of_month);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

/**
 * nextCustomOn(row, today) → "YYYY-MM-DD" on or after today, or null.
 */
export function nextCustomOn(row, today) {
  if (!row || !parseIsoDate(today)) return null;
  const cadence = String(row.cadence || "");
  if (cadence === "monthly") {
    const day = dayOfMonth(row);
    return day === null ? null : nextOccurrence(day, today);
  }
  const start = customDay(row.start_on);
  if (!start) return null;
  if (cadence === "once") return daysBetween(today, start) >= 0 ? start : null;
  if (cadence === "weekly" || cadence === "biweekly") {
    const step = STEP_DAYS[cadence];
    const behind = daysBetween(start, today);
    if (behind <= 0) return start;
    return addDays(start, Math.ceil(behind / step) * step);
  }
  if (cadence === "annual") {
    const s = parseIsoDate(start);
    const t = parseIsoDate(today);
    for (const year of [t.year, t.year + 1]) {
      if (year < s.year) continue;
      const on = formatIsoDate({ year, month: s.month, day: clampDayToMonth(year, s.month, s.day) });
      if (daysBetween(today, on) >= 0 && daysBetween(start, on) >= 0) return on;
    }
    // A start more than a year ahead: the start itself is next.
    return daysBetween(today, start) >= 0 ? start : null;
  }
  return null;
}

/**
 * isCustomOccurrence(row, on) → true when `on` is one of the row's dates. The
 * dispatcher asks this before it sends, so a push queued for a date the client
 * has since moved is not sent.
 */
export function isCustomOccurrence(row, on) {
  const day = parseIsoDate(on);
  if (!row || !day) return false;
  const cadence = String(row.cadence || "");
  if (cadence === "monthly") {
    const d = dayOfMonth(row);
    return d !== null && day.day === clampDayToMonth(day.year, day.month, d);
  }
  const start = customDay(row.start_on);
  if (!start) return false;
  const since = daysBetween(start, on);
  if (since === null || since < 0) return false;
  if (cadence === "once") return since === 0;
  if (cadence === "weekly" || cadence === "biweekly") return since % STEP_DAYS[cadence] === 0;
  if (cadence === "annual") {
    const s = parseIsoDate(start);
    return day.month === s.month && day.day === clampDayToMonth(day.year, s.month, s.day);
  }
  return false;
}

/** What it is called on the screen and in the logs: its own name, never a guess. */
export function customLabel(row = {}) {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (name) return name;
  return row.kind === "bill" ? "Your bill" : "Your alert";
}

/** The phone alert kind for a row, or null for a kind this planner does not know. */
export function customPhoneKind(row = {}) {
  return CUSTOM_PHONE_KINDS[row.kind] || null;
}

/**
 * planCustomPush(row, { today }) → { push, kind, reason, ... }
 *
 * `row` is one finance_custom_alerts row (id, kind, name, cadence, day_of_month,
 * start_on, phone_alert, archived_at).
 */
export function planCustomPush(row, { today } = {}) {
  const kind = customPhoneKind(row) || "custom_alert";
  const skip = (reason, extra = {}) => ({ push: false, kind, reason, ...extra });
  if (!parseIsoDate(today)) return skip("bad_today");
  if (!row || !row.id || !customPhoneKind(row)) return skip("no_item");
  if (row.archived_at) return skip("removed");
  if (row.phone_alert === false) return skip("phone_alert_off");
  const on = nextCustomOn(row, today);
  if (!on) return skip(row.cadence === "once" ? "date_passed" : "no_next_date");
  const daysAway = daysBetween(today, on);
  if (daysAway > CUSTOM_PUSH_DAYS_BEFORE) return skip("not_yet", { dueOn: on, daysAway });
  return {
    push: true,
    kind,
    reason: null,
    key: `${CUSTOM_KEY_PREFIX}${row.id}:${on}`,
    subjectId: String(row.id),
    label: customLabel(row),
    dueOn: on,
    daysAway
  };
}

export default planCustomPush;
