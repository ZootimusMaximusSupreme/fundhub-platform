// Whop plans — the shared pure planner. When does a client's Whop plan charge next, and
// is a phone alert owed for it today? No database, no clock, no send.
//
// Finance OS unit W (owner ask 2026-11-07: Chris's Whop plans tracked like the Clarity
// plans, "with phone alerts before each payment"). The rows are whop_memberships
// (db/migrations/584), the facts Whop states on each membership.
//
// ONE PLANNER, THREE CLOCKS. The daily file-alerts pass, the Payments read and the
// phone-alert check all decide "when is the next charge" and "is a push owed" with this
// file, so the screen, the push and the check cannot disagree about the day. A file in
// src/pulse/beats/lib may import only from this folder.
//
// THE PUSH IS A PLAN PUSH. kind plan_due: the lock screen says the fixed, approved "A
// payment on your plan is due soon. Open Fundhub to see it." (src/push/payload.mjs
// plan_payment_due) and a tap opens Payments. No amount, no product, no Whop name.
// Key: whop:<whop_memberships.id>:<charge day>, one push per plan per charge.
//
// WHEN A WHOP PLAN CHARGES. Whop charges a renewing membership at current_period_end
// (OpenAPI Membership.current_period_end: "When the current billing period renews").
// There is a next charge only when ALL of these are true, each read off the row:
//   * status is active or trialing (past_due: the last charge failed, so it is late);
//   * cancel_at_period_end is false (then that day is the day it ends, not a charge);
//   * a split-pay plan still has payments left (split_pay_paid < split_pay_required);
//   * renewal_cents is known and above 0 (Whop's renewal_price; null = does not renew);
//   * period_end_on is a real day.
// NOTHING IS INVENTED: a missing fact is a skip with its reason, never a guessed day.

import { REMIND_DAYS_BEFORE } from "./card-due-plan.mjs";
import { daysBetween, parseIsoDate } from "./card-due-helpers.mjs";

/** The push kind a Whop plan uses: the payment-plan push (see the header). */
export const WHOP_PUSH_KIND = "plan_due";
export const WHOP_KEY_PREFIX = "whop:";
/** Days ahead of the charge the push goes: the same window as every payment alert. */
export const WHOP_PUSH_DAYS_BEFORE = REMIND_DAYS_BEFORE;
/** Statuses a plan can still charge in, or be late in. */
export const OPEN_STATUSES = Object.freeze(["trialing", "active", "past_due"]);
/** Arizona is UTC-7 all year (America/Phoenix keeps no daylight saving time). */
const ARIZONA_OFFSET_MS = 7 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Whop Money object ({ amount: "59.00", currency: "usd", decimals: 2 }) → integer cents,
 *  or null when it is missing or not exact US dollars. Never 0 for unknown. */
export function whopMoneyToCents(money) {
  if (!money || typeof money !== "object") return null;
  if (String(money.currency || "").toLowerCase() !== "usd") return null;
  if (money.decimals !== 2 || typeof money.amount !== "string") return null;
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(money.amount);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** An ISO timestamp → its calendar day in Arizona ("YYYY-MM-DD"), or null. */
export function arizonaDay(ts) {
  if (ts === null || ts === undefined || ts === "") return null;
  const ms = ts instanceof Date ? ts.getTime() : Date.parse(String(ts));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms - ARIZONA_OFFSET_MS).toISOString().slice(0, 10);
}

/** A `date` column, a "YYYY-MM-DD" string or a Date → "YYYY-MM-DD", or null. node-postgres
 *  hands a `date` back as LOCAL midnight, so a Date is read by its local parts. */
export function dayOf(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  return parseIsoDate(s) ? s : null;
}

const int = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/** What the plan is called: the product name Whop shows, else "Whop plan". */
export function whopLabel(row = {}) {
  const t = typeof row.product_title === "string" ? row.product_title.trim() : "";
  return t || "Whop plan";
}

/** Split pay: { required, paid, left }, or null when the plan is not split pay. */
export function splitPay(row = {}) {
  const required = int(row.split_pay_required);
  if (!Number.isInteger(required) || required < 1) return null;
  const rawPaid = int(row.split_pay_paid);
  const paid = Number.isInteger(rawPaid) && rawPaid >= 0 ? Math.min(rawPaid, required) : 0;
  return { required, paid, left: required - paid };
}

/**
 * nextCharge(row) → { on, amountCents } or { on: null, reason }.
 * The day Whop next charges this plan and how much, from the row's own facts.
 */
export function nextCharge(row = {}) {
  const status = String(row.status || "");
  if (status === "past_due") return { on: null, reason: "late" };
  if (status !== "active" && status !== "trialing") return { on: null, reason: "not_billing" };
  if (row.cancel_at_period_end === true) return { on: null, reason: "ending" };
  // Every split payment made: paid off, whatever Whop now says the renewal is.
  const split = splitPay(row);
  if (split && split.left <= 0) return { on: null, reason: "paid_off" };
  const cents = int(row.renewal_cents);
  if (cents === null) return { on: null, reason: "does_not_renew" };
  if (!Number.isSafeInteger(cents) || cents <= 0) return { on: null, reason: "nothing_to_pay" };
  const on = dayOf(row.period_end_on) || arizonaDay(row.current_period_end);
  if (!on) return { on: null, reason: "no_charge_day" };
  return { on, amountCents: cents };
}

/**
 * planWhopPush(row, { today }) → { push, kind, reason, ... }
 *
 * `row` is one whop_memberships row (id, status, renewal_cents, split_pay_required,
 * split_pay_paid, cancel_at_period_end, period_end_on, product_title, unlinked_at).
 * Owed when Whop charges it in 0 to 3 days.
 */
export function planWhopPush(row, { today } = {}) {
  const skip = (reason, extra = {}) => ({ push: false, kind: WHOP_PUSH_KIND, reason, ...extra });
  if (!parseIsoDate(today)) return skip("bad_today");
  if (!row || !UUID.test(String(row.id || ""))) return skip("no_plan");
  if (row.unlinked_at) return skip("not_tied_to_this_client");
  const next = nextCharge(row);
  if (!next.on) return skip(next.reason);
  const daysAway = daysBetween(today, next.on);
  if (daysAway === null) return skip("no_charge_day");
  if (daysAway < 0) return skip("charge_day_passed", { dueOn: next.on, daysAway });
  if (daysAway > WHOP_PUSH_DAYS_BEFORE) return skip("not_yet", { dueOn: next.on, daysAway });
  return {
    push: true, kind: WHOP_PUSH_KIND, reason: null,
    key: `${WHOP_KEY_PREFIX}${row.id}:${next.on}`,
    subjectId: String(row.id), planId: String(row.id),
    label: whopLabel(row), dueOn: next.on, daysAway
  };
}

/** Is this phone-alert key a Whop plan's? */
export function isWhopKey(key) {
  return String(key || "").startsWith(WHOP_KEY_PREFIX);
}

/** The whop_memberships id inside a Whop key (whop:<id>:<date>), or null. */
export function whopIdOfKey(key) {
  const m = /^whop:([^:]+):\d{4}-\d{2}-\d{2}$/.exec(String(key || ""));
  return m && UUID.test(m[1]) ? m[1] : null;
}

export default planWhopPush;
