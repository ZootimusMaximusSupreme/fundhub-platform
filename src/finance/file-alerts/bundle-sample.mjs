// One fictional client for the alerts bundle's screen tests and browser tests.
// Every name, card, business and amount is made up ("Sample ..."). The `bundle`
// is built by the REAL builder (alertsBundlePayload) over these rows, so a screen
// test is checked against the same contract the endpoint answers.
//
// Not used by any live path. Nothing here reads a database or sends.

import { alertsBundlePayload } from "./bundle.mjs";

export const SAMPLE_NOW = new Date("2026-11-06T16:00:00Z");

export function sampleSnap() {
  return {
    today: "2026-11-06",
    asOf: SAMPLE_NOW.toISOString(),
    overview: {
      debt: {
        cards: [
          { account_id: "card-a", name: "Sample Card A", mask: "4404", kind: "personal", balance_cents: 240000, limit_cents: 800000, used_pct: 30, due_on: "2026-12-10" },
          { account_id: "card-b", name: "Sample Card B", mask: "0002", kind: "business", balance_cents: 25000, limit_cents: 500000, used_pct: 5, due_on: "2026-11-30" },
          { account_id: "card-c", name: "Sample Card C", mask: "0003", kind: "personal", balance_cents: 1000, limit_cents: null, used_pct: null, due_on: null }
        ]
      },
      accounts: [{ id: "p-chk", type: "depository", kind: "personal" }, { id: "b-chk", type: "depository", kind: "business" }]
    },
    cycleByAccount: new Map([
      ["card-a", { statement_close_day: 16, promo_ends_on: "2027-01-05", promo_apr: 0, promo_source: "client" }],
      ["card-b", { statement_close_day: 20 }]
    ]),
    meta: [{ id: "p-chk", plaid_item_id: "item-1" }, { id: "b-chk", plaid_item_id: "item-2" }]
  };
}

const report = (score, fsr) => ({
  name: "Sample Cedar LLC", state: "AZ",
  report: { data: { scoreInformation: { commercialScore: { score }, fsrScore: { score: fsr } } } }
});

export function sampleStore(over = {}) {
  return {
    readBundleSettings: async () => ({ card_over_10: true, business_credit: true, weekly_money: true, saved: false }),
    fundedState: async () => ({ funded: true, approvals: 1 }),
    listBusinesses: async () => [{ id: "biz-1", name: "Sample Cedar LLC", entity_data: { state: "AZ" } }],
    businessPulls: async () => [
      { id: "p-new", created_at: "2026-11-05T15:00:00Z", result: { environment: "production", businessReports: [report(55, 34)] } },
      { id: "p-old", created_at: "2026-10-06T15:00:00Z", result: { environment: "production", businessReports: [report(42, 30)] } }
    ],
    openedBankAccounts: async () => [{ id: "r1", bank_name: "Sample Bank", opened_on: "2026-10-25", state: "done" }],
    openStepCount: async () => 3,
    weekTransactions: async () => [{ bank_account_id: "p-chk", amount_cents: 750000, posted_on: "2026-10-28", category: null }],
    bundleAlerts: async () => [{ kind: "weekly_money", dedupe_key: "fpa:week:sample:2026-11-02", sent_at: "2026-11-02T16:05:00Z" }],
    setBundleAlertEnabled: async () => ({}),
    ...over
  };
}

/** The `bundle` object GET /api/money/alerts?part=bundle answers, as JSON. */
export async function sampleBundle() {
  const b = await alertsBundlePayload(null, { orgId: "sample-org", clientId: "sample-client", now: SAMPLE_NOW, env: {} }, {
    bundleStore: sampleStore(),
    snap: sampleSnap(),
    readSettings: async () => ({ payment_timing: true })
  });
  return JSON.parse(JSON.stringify(b));
}
