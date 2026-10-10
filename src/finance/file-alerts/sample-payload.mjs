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

const acct = (over) => ({
  id: "x", name: "x", official_name: null, mask: null, provider: "plaid",
  account_type: "credit", account_subtype: "credit card",
  available_balance_cents: null, current_balance_cents: 0, credit_limit_cents: null,
  entity_kind: "personal", entity_kind_source: "staff_reviewed", entity_kind_set_at: null, entity_id: null,
  closed_at: null, institution_name: "First Platypus Bank (Plaid sandbox — test data)", ...over
});

export const SAMPLE_ACCOUNTS = [
  acct({ id: PERSONAL_CHECKING, name: "Personal Checking", mask: "1101", account_type: "depository", account_subtype: "checking", current_balance_cents: 421055 }),
  acct({ id: BUSINESS_CHECKING, name: "Business Checking", mask: "2202", entity_kind: "business", account_type: "depository", account_subtype: "checking", current_balance_cents: 1875000 }),
  acct({ id: AMEX, name: "Business Amex", mask: "4404", entity_kind: "business", current_balance_cents: 540000, credit_limit_cents: 2500000 }),
  acct({ id: VISA, name: "Personal Visa", mask: "3303", entity_kind: "personal", current_balance_cents: 132040, credit_limit_cents: 800000 }),
  acct({ id: SBA, name: "SBA Loan", mask: null, provider: "manual", entity_kind: "business", account_type: "loan", account_subtype: null, current_balance_cents: 4800000, institution_name: null })
];

export const SAMPLE_CYCLES = [
  { bank_account_id: AMEX, statement_close_day: 15, payment_due_day: 15, minimum_payment_cents: 27000, source: "provider", raw: {},
    promo_ends_on: "2026-12-06", promo_apr: "0.00000", promo_source: "staff", promo_set_at: "2026-10-01T15:00:00.000Z" },
  { bank_account_id: VISA, statement_close_day: null, payment_due_day: 25, minimum_payment_cents: 6602, source: "manual", raw: {} },
  { bank_account_id: SBA, statement_close_day: null, payment_due_day: 1, minimum_payment_cents: 105000, source: "manual", raw: {} }
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
      if (/FROM entities/.test(s)) return { rows: [] };
      if (/FROM account_statement_cycles s/.test(s)) return { rows: SAMPLE_CYCLES.map((row) => ({ row })) };
      if (/FROM card_liabilities l/.test(s)) return { rows: [] };
      if (/FROM clarity_payments p/.test(s)) return { rows: [{ plan_id: "p1", kind: "clarity", owed_to: "Fundhub LLC", label: null, seq: 2, due_on: "2026-10-03", left_cents: 65000 }] };
      throw new Error(`unexpected sql in the sample: ${s.slice(0, 100)}`);
    }
  };
  const store = {
    readSettings: async () => ({ payment_timing: true, promo_end: true, cash_reserve: true, new_credit: true, saved: false, updated_by_kind: null, updated_at: null }),
    listAlerts: async () => SAMPLE_ALERTS,
    reserveState: async () => ({ open: new Map([["personal", { id: SAMPLE_ALERTS[0].id }]]), episodes: new Map([["personal", 1]]) })
  };
  return fileAlertsPayload(conn, { orgId: SAMPLE_ORG, clientId: SAMPLE_CLIENT, now: new Date(SAMPLE_NOW), env: {} }, {
    store,
    isOptedOut: async () => false,
    isBlueprint: async () => true,
    financeOsEntitlement: async () => ({ entitled: true, subscriptionId: "sub-1", reason: null })
  });
}

export default buildSamplePayload;
