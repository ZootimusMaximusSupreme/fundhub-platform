// Sample Whop plans for tests and screenshots (Finance OS unit W). SAMPLE DATA, not a client.
//
// The `whop` block is built by the REAL back end (whopPlansBlock in src/finance/whop-plans.mjs)
// from whop_memberships-shaped rows, so the screen is tested against what the server sends.
// Dates are relative to `today`, so the states (due soon, late, ending...) hold on any day.
import { whopPlansBlock } from "../../finance/whop-plans.mjs";

const ids = {
  monthly: "a1000000-0000-4000-8000-000000000001",
  split: "a1000000-0000-4000-8000-000000000002",
  late: "a1000000-0000-4000-8000-000000000003",
  ending: "a1000000-0000-4000-8000-000000000004",
  trial: "a1000000-0000-4000-8000-000000000005"
};

function addDays(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Five sample Whop plans, one per state the screen draws. */
export function sampleWhopRows(today) {
  const base = {
    renewal_currency: "usd", collection_method: "charge_automatically", cancel_at_period_end: false,
    split_pay_required: null, split_pay_paid: null, matched_by: "email", unlinked_at: null,
    synced_at: `${today}T07:01:00.000Z`, current_period_end: null
  };
  return [
    { ...base, id: ids.monthly, product_title: "Sample Monthly Program", status: "active", renewal_cents: 50000,
      billing_period_days: 30, period_end_on: addDays(today, 2), matched_by: "fundhub_checkout" },
    { ...base, id: ids.split, product_title: "Sample Split Pay Plan", status: "active", renewal_cents: 25000,
      billing_period_days: 30, split_pay_required: 6, split_pay_paid: 2, period_end_on: addDays(today, 12) },
    { ...base, id: ids.late, product_title: "Sample Membership", status: "past_due", renewal_cents: 9900,
      billing_period_days: 30, period_end_on: addDays(today, -2) },
    { ...base, id: ids.ending, product_title: "Sample Course", status: "active", renewal_cents: 4900,
      billing_period_days: 30, cancel_at_period_end: true, period_end_on: addDays(today, 20) },
    { ...base, id: ids.trial, product_title: "Sample Community", status: "trialing", renewal_cents: 4900,
      billing_period_days: 7, period_end_on: addDays(today, 9) }
  ];
}

/** D2's phone summary shape (src/push/finance-alerts.mjs phoneSummary). */
export function samplePhoneSummary(over = {}) {
  return { enabled: true, opted_out: false, has_phone: true, days_before: 3, sent: [], ...over };
}

/** The parts of GET /api/money/payments the Whop section reads: as_of, phone, whop. */
export function sampleWhopPayload(today, { rows = sampleWhopRows(today), summary = samplePhoneSummary() } = {}) {
  return {
    ok: true,
    as_of: `${today}T16:00:00.000Z`,
    phone: { enabled: summary.enabled !== false, opted_out: !!summary.opted_out, has_phone: summary.has_phone ?? null,
      days_before: summary.days_before ?? 3, plans: {} },
    whop: whopPlansBlock(rows, summary, today)
  };
}

export const SAMPLE_WHOP_IDS = Object.freeze(ids);
