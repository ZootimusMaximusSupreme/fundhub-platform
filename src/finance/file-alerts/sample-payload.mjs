// The sample GET /api/money/alerts payload — one realistic client, built through the
// REAL snapshot reader and the REAL payload builder over fixed rows.
//
// It exists so the screen's author has one file to build against
// (src/finance/file-alerts/file-alerts.fixture.json) and so a test can prove that file
// IS what the API returns (read.test.mjs). The same pattern as
// src/finance/money-overview.fixture.json.
//
// ONE CLIENT, ONE STORY (CLAUDE.md "sample clients make sense"): a business owner with
// a Business Amex that closes on the 15th and carries a promo ending Dec 6, a personal
// Visa the client has not told us the close day of, a checking account of each kind,
// an SBA loan, and a Fundhub payment plan of $650. Every number follows from those
// rows: personal cash $4,210.55 is under six months of personal payments ($66.02 Visa
// + $650.00 plan = $716.02 a month, $4,296.12 for six), so the personal cash alert is
// open; business cash is far above its need.
//
// PHONE ALERTS (unit D): the same client has the iPhone app set up and two repeat
// bills paid from business checking. Google Workspace ($72.00 a month) is marked
// Important and charges Oct 14, two days out, so its phone alert was queued at the
// 07:30 UTC pass and waits for 9 a.m. Arizona (16:00 UTC). QuickBooks Online is not
// marked, so it gets no phone alert. The Amex statement close on Oct 15 is texted
// and has its phone alert waiting too. No card has a bank-reported due date yet, so
// no due-date phone alert is set.
//
// THE ORGANIZED BOARD (unit AL2): the business accounts sit in one business,
// "Sample Co LLC", so the board has two scopes, Personal and Sample Co LLC. The client
// added two things by hand: a personal alert, "Move money to savings", on the 14th
// of each month (two days out, so its phone alert waits for 9 a.m. too), and a
// business bill, "Office rent", $1,200.00 on the 1st. The bill cleanup read finds
// QuickBooks Online went from $80.00 to $90.00 on Sep 28 (its price now, $90.00) and
// Google Workspace charged $72.00 twice, Sep 14 and Sep 15. The Chase business
// checking on the Blueprint plan opened Sep 30: day 12 of 30, seasoned Oct 30.
// The smart alerts follow from those rows: pay $2,900 on the Amex by Oct 13 to report
// under 10% at the Oct 15 close (it is also due that day), personal cash low, the price
// jump, the double charge and the seasoning count. The Visa has no close day, so its
// pay-by date comes from its due date: pay $520.40 by Oct 23 (due Oct 25) to get under
// 10%. The bank logo read finds no saved Plaid logo for the sandbox bank and no bank
// book row for it, so the accounts show their names only; the Chase row on the plan
// carries the bank book's own Chase file.

import { fileAlertsPayload } from "./read.mjs";
import { ACCOUNT_SQL } from "../money-overview.mjs";

export const SAMPLE_ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
export const SAMPLE_CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
export const SAMPLE_NOW = "2026-10-12T12:00:00.000Z";

const AMEX = "b81cc6c2-dddd-440c-9d5b-ae1c42d5724e";
const VISA = "ef4e1149-3fc5-4e2c-9fa2-331c16da9a17";
const PERSONAL_CHECKING = "c5f61f5c-1111-4b1c-8c32-0a6c4a1f0b11";
const BUSINESS_CHECKING = "d7a81c3e-2222-4c2d-9d43-1b7d5b2f1c22";
const SBA = "6af70e59-db5c-4220-95b7-69f6a4a87ff8";
export const SAMPLE_BUSINESS = "5b0c7e1a-3d2f-4a6b-9c8d-7e6f5a4b3c21";
const SAVINGS_ALERT = "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e1";
const OFFICE_RENT = "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e2";

const acct = (over) => ({
  id: "x", name: "x", official_name: null, mask: null, provider: "plaid",
  account_type: "credit", account_subtype: "credit card",
  available_balance_cents: null, current_balance_cents: 0, credit_limit_cents: null,
  entity_kind: "personal", entity_kind_source: "staff_reviewed", entity_kind_set_at: null, entity_id: null,
  closed_at: null, institution_name: "First Platypus Bank (Plaid sandbox — test data)", ...over
});

export const SAMPLE_ACCOUNTS = [
  acct({ id: PERSONAL_CHECKING, name: "Personal Checking", mask: "1101", account_type: "depository", account_subtype: "checking", current_balance_cents: 421055 }),
  acct({ id: BUSINESS_CHECKING, name: "Business Checking", mask: "2202", entity_kind: "business", entity_id: SAMPLE_BUSINESS, account_type: "depository", account_subtype: "checking", current_balance_cents: 1875000 }),
  acct({ id: AMEX, name: "Business Amex", mask: "4404", entity_kind: "business", entity_id: SAMPLE_BUSINESS, current_balance_cents: 540000, credit_limit_cents: 2500000 }),
  acct({ id: VISA, name: "Personal Visa", mask: "3303", entity_kind: "personal", current_balance_cents: 132040, credit_limit_cents: 800000 }),
  acct({ id: SBA, name: "SBA Loan", mask: null, provider: "manual", entity_kind: "business", entity_id: SAMPLE_BUSINESS, account_type: "loan", account_subtype: null, current_balance_cents: 4800000, institution_name: null })
];

export const SAMPLE_ENTITIES = [{ id: SAMPLE_BUSINESS, kind: "business", name: "Sample Co LLC" }];

/* What the client added by hand (finance_custom_alerts, migration 583). */
export const SAMPLE_CUSTOM = [
  { id: SAVINGS_ALERT, kind: "alert", name: "Move money to savings", amount_cents: null, cadence: "monthly", day_of_month: 14,
    start_on: null, scope: "personal", entity_id: null, phone_alert: true, created_by: "client", updated_by: "client",
    archived_at: null, created_at: "2026-10-02T15:00:00.000Z", updated_at: "2026-10-02T15:00:00.000Z" },
  { id: OFFICE_RENT, kind: "bill", name: "Office rent", amount_cents: 120000, cadence: "monthly", day_of_month: 1,
    start_on: null, scope: "business", entity_id: SAMPLE_BUSINESS, phone_alert: true, created_by: "client", updated_by: "client",
    archived_at: null, created_at: "2026-10-02T15:05:00.000Z", updated_at: "2026-10-02T15:05:00.000Z" }
];

/* The bill cleanup read's answer (src/banking/bill-cleanup.mjs findBillProblems shape) for the two bills. */
export const SAMPLE_CLEANUP = {
  ok: true, as_of: "2026-10-12", window_days: 90, checked_bills: 2, capped: false,
  flags: [
    { key: `price_jump:${BUSINESS_CHECKING}:quickbooks online:2026-09-28`, kind: "price_jump", name: "quickbooks online",
      merchant_key: "quickbooks online", cadence: "monthly", bank_account_id: BUSINESS_CHECKING, account_name: "Business Checking",
      account_mask: "2202", money_kind: "business", on: "2026-09-28", from_cents: 8000, to_cents: 9000, change_cents: 1000,
      charges: [{ on: "2026-07-28", amount_cents: 8000 }, { on: "2026-08-28", amount_cents: 8000 }, { on: "2026-09-28", amount_cents: 9000 }] },
    { key: `double_charge:${BUSINESS_CHECKING}:google workspace:2026-09-15`, kind: "double_charge", name: "google workspace",
      merchant_key: "google workspace", cadence: "monthly", bank_account_id: BUSINESS_CHECKING, account_name: "Business Checking",
      account_mask: "2202", money_kind: "business", on: "2026-09-14", amount_cents: 7200,
      charges: [{ on: "2026-09-14", amount_cents: 7200 }, { on: "2026-09-15", amount_cents: 7200 }] }
  ]
};

/* One bank on the Blueprint plan (readRelationships line) and its seasoning clock. */
export const SAMPLE_RELATIONSHIPS = [
  { id: "7e1d2c3b-4a59-4687-8796-a5b4c3d2e1f0", bank: "Chase", bank_key: "chase", account_kind: "business",
    container_id: SAMPLE_BUSINESS, container_name: "Sample Co LLC", status: "open", opened_on: "2026-09-30", days_open: 12 }
];
export const SAMPLE_CLOCK = {
  relationship_id: "7e1d2c3b-4a59-4687-8796-a5b4c3d2e1f0", bank: "Chase", bank_key: "chase", account_kind: "business",
  lender_id: null, logo_path: "/assets/lenders/chase.png", opened_on: "2026-09-30", target_days: 30, better_days: [60, 90],
  book_days: null, day: 12, milestone: "seasoning", seasoned: false, seasoned_on: "2026-10-30",
  next_mark: { days: 30, on: "2026-10-30" }, congrats: null, text: "Day 12 of 30. Seasoned on Oct 30, 2026."
};

export const SAMPLE_CYCLES = [
  { bank_account_id: AMEX, statement_close_day: 15, payment_due_day: 15, minimum_payment_cents: 27000, source: "provider", raw: {},
    promo_ends_on: "2026-12-06", promo_apr: "0.00000", promo_source: "staff", promo_set_at: "2026-10-01T15:00:00.000Z" },
  { bank_account_id: VISA, statement_close_day: null, payment_due_day: 25, minimum_payment_cents: 6602, source: "manual", raw: {} },
  { bank_account_id: SBA, statement_close_day: null, payment_due_day: 1, minimum_payment_cents: 105000, source: "manual", raw: {} }
];

export const SAMPLE_BILLS = [
  { id: "9e3c1f0a-4b2d-4c8e-9f11-2a3b4c5d6e01", bank_account_id: BUSINESS_CHECKING, merchant_key: "google workspace",
    merchant_display: "Google Workspace", cadence: "monthly", typical_amount_cents: -7200, next_expected_on: "2026-10-14",
    next_expected_unknown_reason: null, confidence_label: "high", important: true },
  { id: "9e3c1f0a-4b2d-4c8e-9f11-2a3b4c5d6e02", bank_account_id: BUSINESS_CHECKING, merchant_key: "quickbooks online",
    merchant_display: "QuickBooks Online", cadence: "monthly", typical_amount_cents: -9000, next_expected_on: "2026-10-28",
    next_expected_unknown_reason: null, confidence_label: "medium", important: false }
];

export const SAMPLE_PHONE_ALERTS = [
  { id: "5d2a7c10-3e4f-4a5b-8c6d-7e8f9a0b1c01", kind: "important_bill", kind_label: "Important bill",
    subject_id: "9e3c1f0a-4b2d-4c8e-9f11-2a3b4c5d6e01", about_on: "2026-10-14", state: "waiting", reason: null,
    send_at: "2026-10-12T16:00:00.000Z", created_at: "2026-10-12T07:30:00.000Z", updated_at: "2026-10-12T07:30:00.000Z" },
  { id: "5d2a7c10-3e4f-4a5b-8c6d-7e8f9a0b1c00", kind: "statement_close", kind_label: "Statement closes",
    subject_id: AMEX, about_on: "2026-10-15", state: "waiting", reason: null,
    send_at: "2026-10-12T16:00:00.000Z", created_at: "2026-10-12T07:30:00.000Z", updated_at: "2026-10-12T07:30:00.000Z" },
  { id: "5d2a7c10-3e4f-4a5b-8c6d-7e8f9a0b1c02", kind: "custom_alert", kind_label: "Alert you added",
    subject_id: SAVINGS_ALERT, about_on: "2026-10-14", state: "waiting", reason: null,
    send_at: "2026-10-12T16:00:00.000Z", created_at: "2026-10-12T07:30:00.000Z", updated_at: "2026-10-12T07:30:00.000Z" }
];

const SAMPLE_ALERTS = [
  {
    id: "7a1f0e22-5c0d-4e57-8f3a-0c6f1f2a3b01", kind: "cash_reserve", bank_account_id: null, subject_label: "personal cash", threshold: 6,
    due_on: null, cash_kind: "personal",
    body: "Fundhub alert: your personal cash is $4,210.55. 6 months of your personal minimum payments is $4,296.12. A missed payment can hurt your file before your next funding sequence.",
    delivery: "text", message_id: "0b3c6d2e-9a41-4f7b-8c15-2d8e4a6b7c02", task_id: null,
    sent_at: "2026-10-12T07:30:00.000Z", cleared_at: null, detail: {}
  },
  {
    id: "7a1f0e22-5c0d-4e57-8f3a-0c6f1f2a3b00", kind: "payment_timing", bank_account_id: AMEX, subject_label: "Business Amex ending 4404", threshold: 3,
    due_on: "2026-10-15", cash_kind: null,
    body: "Fundhub reminder: pay your Business Amex ending 4404 down before Oct 15. That is the day it reports to the bureaus. Balance now $5,400.00 (22% of your limit). Pay about $2,900 to get under 10%.",
    delivery: "text", message_id: "0b3c6d2e-9a41-4f7b-8c15-2d8e4a6b7c01", task_id: null,
    sent_at: "2026-10-12T07:30:00.000Z", cleared_at: null, detail: {}
  },
  {
    // The promo was typed in on Oct 1 with 66 days left, so the 60-day text went out on Oct 7.
    id: "7a1f0e22-5c0d-4e57-8f3a-0c6f1f2a3aff", kind: "promo_end", bank_account_id: AMEX, subject_label: "Business Amex ending 4404", threshold: 60,
    due_on: "2026-12-06", cash_kind: null,
    body: "Fundhub reminder: the promo rate on your Business Amex ending 4404 ends Dec 6 (in 60 days). You still owe $5,400.00. Pay about $2,700 a month for the next 2 months to clear it in time.",
    delivery: "text", message_id: "0b3c6d2e-9a41-4f7b-8c15-2d8e4a6b7c00", task_id: null,
    sent_at: "2026-10-07T07:30:00.000Z", cleared_at: null, detail: {}
  }
];

/** The sample payload, built the way the endpoint builds it. */
export async function buildSamplePayload() {
  const conn = {
    async query(sql) {
      const s = String(sql);
      if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(s)) return { rows: [{ id: SAMPLE_CLIENT, first_name: "Sample", last_name: "Client" }] };
      if (/item_created_at/.test(s)) {
        return { rows: SAMPLE_ACCOUNTS.map((a) => ({
          id: a.id, account_type: a.account_type, plaid_item_id: a.provider === "plaid" ? "item-1" : null, mask: a.mask, name: a.name, closed_at: null,
          created_at: "2026-10-06T22:57:00.000Z", balance_as_of: "2026-10-12T06:00:00.000Z", item_created_at: "2026-10-06T22:57:00.000Z"
        })) };
      }
      if (s === ACCOUNT_SQL) return { rows: SAMPLE_ACCOUNTS };
      if (/FROM entities/.test(s)) return { rows: SAMPLE_ENTITIES };
      if (/FROM account_statement_cycles s/.test(s)) return { rows: SAMPLE_CYCLES.map((row) => ({ row })) };
      if (/FROM card_liabilities l/.test(s)) return { rows: [] };
      if (/FROM clarity_payments p/.test(s)) return { rows: [{ plan_id: "p1", installment_id: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e02", kind: "clarity", owed_to: "Fundhub LLC", label: null, seq: 2, due_on: "2026-10-03", left_cents: 65000 }] };
      // The bank logo read (src/banking/institution-logos.mjs): each Plaid account's login,
      // then no saved Plaid logo and no bank book row for the sandbox bank.
      if (/JOIN plaid_items p ON p\.id = ba\.plaid_item_id/.test(s)) {
        return { rows: SAMPLE_ACCOUNTS.filter((a) => a.provider === "plaid")
          .map((a) => ({ bank_account_id: a.id, plaid_institution_id: null, institution_name: a.institution_name })) };
      }
      if (/FROM plaid_institutions/.test(s) || /FROM lenders/.test(s)) return { rows: [] };
      throw new Error(`unexpected sql in the sample: ${s.slice(0, 100)}`);
    }
  };
  const store = {
    readSettings: async () => ({ payment_timing: true, promo_end: true, cash_reserve: true, new_credit: true, phone_alerts: true, saved: false, updated_by_kind: null, updated_at: null }),
    listAlerts: async () => SAMPLE_ALERTS,
    reserveState: async () => ({ open: new Map([["personal", { id: SAMPLE_ALERTS[0].id }]]), episodes: new Map([["personal", 1]]) })
  };
  return fileAlertsPayload(conn, { orgId: SAMPLE_ORG, clientId: SAMPLE_CLIENT, now: new Date(SAMPLE_NOW), env: {} }, {
    store,
    isOptedOut: async () => false,
    isBlueprint: async () => true,
    financeOsEntitlement: async () => ({ entitled: true, subscriptionId: "sub-1", reason: null }),
    listBills: async () => SAMPLE_BILLS,
    phoneState: async () => ({ hasPhone: true, optedOut: false }),
    listPhoneAlerts: async () => SAMPLE_PHONE_ALERTS,
    listCustom: async () => SAMPLE_CUSTOM,
    loadBillCleanup: async () => SAMPLE_CLEANUP,
    readRelationships: async () => SAMPLE_RELATIONSHIPS,
    seasoningClock: (rel) => (rel.id === SAMPLE_CLOCK.relationship_id ? SAMPLE_CLOCK : null)
  });
}

export default buildSamplePayload;
