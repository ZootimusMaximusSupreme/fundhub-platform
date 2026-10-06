// Test bank v2 — the Plaid SANDBOX custom user that scripts/plaid-sandbox-link.mjs
// links with `--preset mixed`. Pure: today in, config out. No network, no db.
//
// Format: https://plaid.com/docs/sandbox/user-custom/ — override_accounts, each
// with meta, transactions (date_transacted, date_posted, amount, description,
// currency), and for cards a `liability` object with the fields Plaid documents
// for `type: "credit"` plus an inflow_model whose statement and payment days give
// Plaid a statement date and a due date to report on /liabilities/get.
//
// PLAID'S SIGN: a POSITIVE amount is money OUT, negative is money IN. The ingest
// (src/banking/plaid-transactions.mjs) flips it to this repo's convention.
//
// Dates are the last 90 days ending YESTERDAY. Plaid treats a future
// date_posted as pending, so nothing here is in the future. Plaid caps a custom
// user near 250 transactions / 55 KB; this one is well under both.
//
// Account names say personal/business so a person can tell them apart on the
// screen. entity_kind still stays 'unknown' until a human sets it (082).

const DAY_MS = 86_400_000;
const iso = (d) => d.toISOString().slice(0, 10);

export function buildMixedSandboxUser({ today = new Date() } = {}) {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - DAY_MS);
  const start = new Date(end.getTime() - 90 * DAY_MS);

  /* Charges happen up to the day before yesterday and post the next day, so
     every charge posts exactly one day later and none posts in the future.
     (Clamping the last post date instead made one rent post a day early and
     knocked a clean monthly bill down to an irregular one.) */
  const days = [];
  for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) days.push(new Date(t));
  /** Every day in the window on this day of the month. */
  const monthly = (dom) => days.filter((d) => d.getUTCDate() === dom);
  /** Every day in the window on this weekday (0 = Sunday). */
  const weekly = (wd) => days.filter((d) => d.getUTCDay() === wd);
  /** A small repeatable wobble so weekly amounts are not identical. */
  const wobble = (i, spread) => Math.round((((i * 37) % 11) - 5) / 5 * spread * 100) / 100;

  /** Posts the next day. */
  const txn = (date, amount, description) => ({
    date_transacted: iso(date),
    date_posted: iso(new Date(date.getTime() + DAY_MS)),
    amount,
    description,
    currency: "USD"
  });

  const personalChecking = [
    ...monthly(1).map((d) => txn(d, 2500, "Oakwood Apartments Rent")),
    ...monthly(12).map((d) => txn(d, 180, "GEICO Auto Insurance")),
    ...monthly(1).map((d) => txn(d, -5000, "Payroll Direct Deposit Brightline Consulting")),
    ...monthly(15).map((d) => txn(d, -5000, "Payroll Direct Deposit Brightline Consulting"))
  ];
  const businessChecking = [
    ...weekly(5).map((d, i) => txn(d, -(3000 + wobble(i, 150)), "Stripe payout")),
    ...monthly(3).map((d) => txn(d, 300, "HubSpot Software Subscription")),
    ...monthly(5).map((d) => txn(d, 1800, "Regus Office Rent"))
  ];
  const personalVisa = [
    ...weekly(6).map((d, i) => txn(d, 85 + wobble(i, 20), "Whole Foods Market")),
    ...weekly(2).filter((_, i) => i % 2 === 0).map((d, i) => txn(d, 45 + wobble(i, 8), "Shell Gas Station")),
    ...monthly(9).map((d) => txn(d, 15.49, "Netflix"))
  ];
  const businessAmex = [
    ...monthly(2).map((d) => txn(d, 420, "Amazon Web Services")),
    ...monthly(20).map((d) => txn(d, 120, "Staples Office Supplies")),
    ...weekly(3).filter((_, i) => i % 2 === 1).map((d, i) => txn(d, 35 + wobble(i, 10), "Uber Trip")),
    txn(new Date(end.getTime() - 40 * DAY_MS), 640, "Delta Air Lines")
  ];

  return {
    override_accounts: [
      { type: "depository", subtype: "checking", starting_balance: 4210.55,
        meta: { name: "Personal Checking", mask: "1101" },
        transactions: personalChecking },
      { type: "depository", subtype: "checking", starting_balance: 18750.0,
        meta: { name: "Business Checking", mask: "2202" },
        transactions: businessChecking },
      { type: "credit", subtype: "credit card", starting_balance: 1320.4,
        meta: { name: "Personal Visa", mask: "3303", limit: 8000 },
        transactions: personalVisa,
        inflow_model: {
          type: "monthly-balance-payment", payment_day_of_month: 21, statement_day_of_month: 25,
          transaction_name: "Personal Visa Payment"
        },
        liability: {
          type: "credit", purchase_apr: 24.99, cash_apr: 29.99, balance_transfer_apr: 19.99, special_apr: 0,
          last_payment_amount: 450, minimum_payment_amount: 40
        } },
      { type: "credit", subtype: "credit card", starting_balance: 5400.0,
        meta: { name: "Business Amex", mask: "4404", limit: 25000 },
        transactions: businessAmex,
        inflow_model: {
          type: "monthly-balance-payment", payment_day_of_month: 10, statement_day_of_month: 15,
          transaction_name: "Business Amex Payment"
        },
        liability: {
          type: "credit", purchase_apr: 18.24, cash_apr: 27.24, balance_transfer_apr: 18.24, special_apr: 0,
          last_payment_amount: 1200, minimum_payment_amount: 135
        } }
    ]
  };
}

export default { buildMixedSandboxUser };
