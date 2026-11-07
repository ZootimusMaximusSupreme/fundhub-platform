// Whop plans — the plans a client pays Fundhub on Whop, shown like the Clarity plans on
// Payments, with a phone alert before each charge. Finance OS unit W (owner ask
// 2026-11-07: track "all the other ones that I offer over at" Whop).
//
// THIS FILE NEVER TALKS TO WHOP, so the Payments read and the phone-alert pass can use it
// without loading network code. The daily read that fills whop_memberships
// (db/migrations/584) is ./whop-plans-sync.mjs. Here:
//   1. listWhopPlans — one client's plans, org_id AND client_id on the query.
//   2. whopPlanView / whopPhoneView / whopPlansBlock — what the Payments section paints. Pure.
//   3. rowFromMembership / checkoutClientOf — the pure half of the daily read: a Whop
//      membership's facts, and the client a Fundhub checkout named in its metadata.
//
// MONEY IS INTEGER CENTS. NULL is unknown, never 0. Personal and business money are never
// added together here: a Whop plan is one charge on one plan.
//
// "LEFT TO PAY" ON A SPLIT-PAY PLAN is payments left (Whop's count) times the next charge
// (Whop's renewal price). It is labelled an estimate on the screen: a promo can change a
// later charge.

import {
  nextCharge, splitPay, whopLabel, whopMoneyToCents, arizonaDay, dayOf,
  OPEN_STATUSES, WHOP_PUSH_DAYS_BEFORE
} from "../pulse/beats/lib/whop-plan-push.mjs";
import { daysBetween } from "../pulse/beats/lib/card-due-helpers.mjs";

export { planWhopPush, whopIdOfKey, isWhopKey, nextCharge, whopLabel } from "../pulse/beats/lib/whop-plan-push.mjs";

export const STATUSES = Object.freeze(["trialing", "active", "past_due", "completed", "canceled", "expired", "unresolved"]);
export const MATCHED_BY = Object.freeze(["fundhub_checkout", "email"]);
/** How far ahead the Payments "Coming up" list reaches (the overview's own window). */
export const UPCOMING_DAYS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBERSHIP_ID = /^mem_[A-Za-z0-9]{1,64}$/;
const ACCOUNT_ID = /^biz_[A-Za-z0-9]{1,64}$/;
const PRODUCT_ID = /^prod_[A-Za-z0-9]{1,64}$/;
const VARIANT_ID = /^plan_[A-Za-z0-9]{1,64}$/;

const int = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const isoOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const intIn = (v, lo, hi) => {
  const n = int(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

/* ───────────────────────── screen (pure) ───────────────────────── */

/** Days between charges → short words, or null. Whop's own periods get their names
 *  (Whop writes a 30-day plan as "/ month"); anything else is said in days. */
export function cadenceWords(days) {
  const n = int(days);
  if (!Number.isInteger(n) || n < 1) return null;
  const named = { 1: "Daily", 7: "Weekly", 14: "Every 2 weeks", 30: "Monthly", 90: "Every 3 months", 180: "Every 6 months", 365: "Yearly" };
  return named[n] || `Every ${n} days`;
}

/**
 * whopPlanView(row, today) → one plan as the Payments section paints it, or null when
 * there is nothing to show (no charge coming, not late, not ending, not paid off).
 *
 * state: late | paid_off | ending | trial | due_soon | upcoming | checking
 *   checking — the charge day on file has passed and Whop has not been read since, so
 *   the screen says it is checking instead of showing an old day as the next one.
 */
export function whopPlanView(row = {}, today) {
  const status = String(row.status || "");
  if (!OPEN_STATUSES.includes(status) || row.unlinked_at) return null;
  const next = nextCharge(row);
  const split = splitPay(row);
  const perCharge = int(row.renewal_cents);
  const days = int(row.billing_period_days);
  const periodEnd = dayOf(row.period_end_on) || arizonaDay(row.current_period_end);
  const daysAway = next.on ? daysBetween(today, next.on) : null;

  let state;
  if (status === "past_due") state = "late";
  else if (next.reason === "paid_off") state = "paid_off";
  else if (next.reason === "ending") state = periodEnd ? "ending" : null;
  else if (!next.on) state = null; // does not renew, or nothing to pay: not a payment
  else if (daysAway === null || daysAway < 0) state = "checking";
  else if (status === "trialing") state = "trial";
  else if (daysAway <= WHOP_PUSH_DAYS_BEFORE) state = "due_soon";
  else state = "upcoming";
  if (!state) return null;

  const showNext = Boolean(next.on) && state !== "checking";
  return {
    id: row.id ?? null,
    provider: "whop",
    name: whopLabel(row),
    status,
    state,
    next: showNext ? { due_on: next.on, amount_cents: next.amountCents, days_away: daysAway } : null,
    ends_on: state === "ending" ? periodEnd : null,
    // What a charge is. Null when Whop sent no price, or not in dollars.
    amount_cents: Number.isSafeInteger(perCharge) ? perCharge : null,
    cadence: Number.isInteger(days) && days > 0 ? { days, words: cadenceWords(days) } : null,
    split: split ? { required: split.required, paid: split.paid, left: split.left } : null,
    // Split pay only: payments left x the next charge. An estimate (see the header).
    left_cents: !split ? null : state === "paid_off" ? 0
      : Number.isSafeInteger(perCharge) && perCharge > 0 ? split.left * perCharge : null,
    invoice: row.collection_method === "send_invoice",
    // How the plan was tied to this client; the screen shows it to staff only.
    matched_by: MATCHED_BY.includes(row.matched_by) ? row.matched_by : null,
    synced_at: isoOrNull(row.synced_at)
  };
}

function addDays(iso, n) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t + n * 86_400_000).toISOString().slice(0, 10) : null;
}

/**
 * whopPhoneView(view, summary, today) → { due_on, alert_on, reason, sent } or null.
 * The same answer D2's planPhoneView gives a Clarity plan (api/money/payments.mjs), from
 * the same phone summary (src/push/finance-alerts.mjs phoneSummary). Pure.
 */
export function whopPhoneView(view, summary, today) {
  if (!summary || !view) return null;
  const on = summary.enabled !== false && !summary.opted_out;
  const daysBefore = Number.isInteger(summary.days_before) ? summary.days_before : WHOP_PUSH_DAYS_BEFORE;
  const sent = (Array.isArray(summary.sent) ? summary.sent : [])
    .find((a) => view.next && String(a.subject_id) === String(view.id) && a.about_on === view.next.due_on);
  if (view.state === "late") {
    return { due_on: null, alert_on: null, reason: on ? "late" : summary.opted_out ? "opted_out" : "phone_alerts_off", sent: null };
  }
  if (!view.next) return null;
  const until = view.next.days_away;
  return {
    due_on: view.next.due_on,
    alert_on: !on || until === null || until < 0 ? null : until <= daysBefore ? today : addDays(view.next.due_on, -daysBefore),
    reason: !on ? (summary.opted_out ? "opted_out" : "phone_alerts_off") : null,
    sent: sent ? sent.state : null
  };
}

/** Next Whop charges inside the Payments "Coming up" window, in the overview's row shape. */
export function whopUpcoming(views = [], { windowDays = UPCOMING_DAYS } = {}) {
  return (Array.isArray(views) ? views : [])
    .filter((v) => v && v.next && v.next.days_away !== null && v.next.days_away >= 0 && v.next.days_away < windowDays)
    .map((v) => ({ type: "whop", name: v.name, on: v.next.due_on, amount_cents: v.next.amount_cents, plan_id: v.id }));
}

/**
 * whopPlansBlock(rows, summary, today) → the `whop` block of GET /api/money/payments:
 *   { plans: [view + phone], count, late_count, next: { due_on, amount_cents, name } | null,
 *     upcoming: [...], synced_at }
 * null when the rows could not be read (the screen then claims nothing).
 */
export function whopPlansBlock(rows, summary, today) {
  if (!Array.isArray(rows)) return null;
  const plans = rows.map((r) => whopPlanView(r, today)).filter(Boolean)
    .map((v) => ({ ...v, phone: whopPhoneView(v, summary, today) }));
  const next = plans.filter((p) => p.next).sort((a, b) => String(a.next.due_on).localeCompare(String(b.next.due_on)))[0] || null;
  const synced = plans.map((p) => p.synced_at).filter(Boolean).sort()[0] || null;
  return {
    plans,
    count: plans.length,
    late_count: plans.filter((p) => p.state === "late").length,
    next: next ? { due_on: next.next.due_on, amount_cents: next.next.amount_cents, name: next.name } : null,
    upcoming: whopUpcoming(plans),
    // The oldest read among the plans shown: "Updated from Whop" on the screen.
    synced_at: synced
  };
}

/* ───────────────────────── one client's plans ───────────────────────── */

export const PLAN_COLS = `id, product_title, status, renewal_cents, renewal_currency, billing_period_days,
  split_pay_required, split_pay_paid, collection_method, cancel_at_period_end, current_period_end,
  period_end_on::text AS period_end_on, canceled_at, expires_at, matched_by, synced_at, unlinked_at`;

/** listWhopPlans(conn, { orgId, clientId }) → the client's open Whop plans, soonest first. */
export async function listWhopPlans(conn, { orgId, clientId }) {
  if (!UUID.test(String(orgId || "")) || !UUID.test(String(clientId || ""))) return [];
  const r = await conn.query(
    `SELECT ${PLAN_COLS}
       FROM whop_memberships
      WHERE org_id = $1 AND client_id = $2
        AND unlinked_at IS NULL
        AND status IN ('trialing', 'active', 'past_due')
      ORDER BY period_end_on NULLS LAST, created_at, id
      LIMIT 100`,
    [orgId, clientId]
  );
  return r.rows;
}

/* ──────────── the pure half of the daily read (./whop-plans-sync.mjs) ──────────── */

/** One Whop membership → the columns migration 584 stores, or null when it cannot be one. Pure. */
export function rowFromMembership(m = {}, { accountId = null } = {}) {
  if (!m || !MEMBERSHIP_ID.test(String(m.id || ""))) return null;
  const status = String(m.status || "");
  if (!STATUSES.includes(status)) return null;
  const product = m.product && typeof m.product === "object" ? m.product : {};
  const title = typeof product.title === "string" ? product.title.trim().slice(0, 200) : "";
  const productId = PRODUCT_ID.test(String(m.product_id || "")) ? m.product_id
    : PRODUCT_ID.test(String(product.id || "")) ? product.id : null;
  const account = m.account && typeof m.account === "object" && ACCOUNT_ID.test(String(m.account.id || "")) ? m.account.id
    : ACCOUNT_ID.test(String(accountId || "")) ? accountId : null;
  const required = intIn(m.split_pay_required_payments, 1, 1000);
  const paidRaw = intIn(m.split_pay_current_payments, 0, 1000);
  const paid = paidRaw === null ? null : required === null ? paidRaw : Math.min(paidRaw, required);
  const renewal = m.renewal_price && typeof m.renewal_price === "object" ? m.renewal_price : null;
  const currency = renewal && /^[a-z]{3}$/i.test(String(renewal.currency || "")) ? String(renewal.currency).toLowerCase() : null;
  const periodEnd = isoOrNull(m.current_period_end);
  return {
    whop_membership_id: m.id,
    whop_account_id: account,
    whop_product_id: productId,
    whop_variant_id: VARIANT_ID.test(String(m.variant_id || "")) ? m.variant_id : null,
    product_title: title || null,
    status,
    renewal_cents: whopMoneyToCents(renewal),
    renewal_currency: currency,
    billing_period_days: intIn(m.billing_period_days, 1, 3660),
    split_pay_required: required,
    split_pay_paid: paid,
    collection_method: ["charge_automatically", "send_invoice"].includes(m.collection_method) ? m.collection_method : null,
    cancel_at_period_end: m.cancel_at_period_end === true,
    current_period_end: periodEnd,
    period_end_on: arizonaDay(periodEnd),
    canceled_at: isoOrNull(m.canceled_at),
    expires_at: isoOrNull(m.expires_at),
    whop_created_at: isoOrNull(m.created_at),
    whop_updated_at: isoOrNull(m.updated_at)
  };
}

/** The client a Fundhub checkout named in the membership's metadata, read off it. Pure. */
export function checkoutClientOf(m = {}) {
  const meta = m && m.metadata && typeof m.metadata === "object" && !Array.isArray(m.metadata) ? m.metadata : {};
  const orgId = UUID.test(String(meta.fh_org_id || "")) ? String(meta.fh_org_id) : null;
  const clientId = UUID.test(String(meta.fh_client_id || "")) ? String(meta.fh_client_id) : null;
  return orgId && clientId ? { orgId, clientId } : null;
}

export default {
  cadenceWords, whopPlanView, whopPhoneView, whopUpcoming, whopPlansBlock,
  listWhopPlans, rowFromMembership, checkoutClientOf
};
