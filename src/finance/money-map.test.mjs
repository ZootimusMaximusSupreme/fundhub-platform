// Money Map assembler — unit tests. No database, no browser, no clock.
//
// WHAT THESE ARE FOR. src/finance/money-map.mjs is the one place the six
// sections of the owner's money screen are assembled, and every rule it applies
// is a rule about NOT SAYING SOMETHING WE DO NOT KNOW. Those are exactly the
// rules that look fine in review and fail quietly in production, because the
// failure mode is a plausible number rather than an exception.
//
// So the assertions below are mostly negative: a null does NOT become 0.00, a
// credit line's headroom does NOT become cash, an unclassified account is NOT
// counted as the client's, a partial total DOES say it is a floor, and a
// utilization figure ALWAYS names the engine that produced it.

import { test } from "node:test";
import assert from "node:assert";

import { moneyMap, ENGINES, DEPOSITORY, billRowToDetected } from "./money-map.mjs";
import { detectIncome } from "../banking/income.mjs";

const AS_OF = "2026-07-31";

/* Row builders. pg hands bigint back as a STRING, so the money columns here are
   strings on purpose — a helper that passed numbers would test a shape the
   endpoint never produces. */
const tradeline = (o = {}) => ({
  id: "t1",
  lender: "Amex",
  kind: "revolving",
  credit_limit_cents: "750000",
  balance_cents: "150000",
  apr: "0.1899",
  account_ref: "4444555566667777",
  closed_at: null,
  ...o
});

const liability = (o = {}) => ({
  id: "l1",
  tradeline_id: "t1",
  as_of: "2026-07-20",
  payment_due_date: "2026-08-12",
  minimum_payment_cents: "3500",
  statement_balance_cents: "150000",
  current_balance_cents: "150000",
  past_due_cents: "0",
  last_payment_cents: null,
  last_payment_date: null,
  statement_date: "2026-07-15",
  payment_status: "current",
  source: "crs",
  ...o
});

const account = (o = {}) => ({
  id: "b1",
  name: "Everyday Checking",
  official_name: null,
  mask: "1234",
  account_type: "depository",
  account_subtype: "checking",
  available_balance_cents: "240000",
  current_balance_cents: "240000",
  credit_limit_cents: null,
  entity_kind: "personal",
  entity_kind_source: "plaid",
  closed_at: null,
  ...o
});

const bill = (o = {}) => ({
  id: "r1",
  bank_account_id: "b1",
  client_id: "c1",
  merchant_key: "netflix",
  merchant_display: "NETFLIX.COM",
  cadence: "monthly",
  // NEGATIVE. 086's CHECK makes a bill an outflow.
  typical_amount_cents: "-1599",
  next_expected_on: "2026-08-04",
  next_expected_unknown_reason: null,
  confidence_pct: 90,
  confidence_label: "high",
  is_business: null,
  occurrence_count: 6,
  first_seen_on: "2026-02-04",
  last_seen_on: "2026-07-04",
  ...o
});

const run = (o = {}) => moneyMap({ asOf: AS_OF, horizonDays: 30, ...o });

/* ── the shape holds when there is nothing at all ─────────────────────── */

test("no rows at all: every section answers, nothing is invented", () => {
  const out = run();

  assert.equal(out.empty.everything, true);
  assert.equal(out.counts.tradelines, 0);
  assert.equal(out.cards.rows.length, 0);
  assert.equal(out.bills.rows.length, 0);
  assert.equal(out.alerts.count, 0);

  // The one thing that must NOT happen: a zero standing in for an unknown.
  assert.equal(out.cards.minimum_payments_total.display, null);
  assert.equal(out.cashflow.opening.display, null);
  assert.equal(out.cashflow.closing.display, null);
});

test("no depository account is a stated refusal, not an empty projection", () => {
  const out = run({ bankAccounts: [account({ account_type: "credit" })] });
  assert.equal(out.cashflow.ok, false);
  assert.equal(out.cashflow.reason.code, "NO_DEPOSITORY_ACCOUNTS");
  assert.equal(out.cashflow.total_in.display, null);
  assert.equal(out.cashflow.closing.display, null);
});

test("asOf and horizonDays are required and are not guessed", () => {
  assert.throws(() => moneyMap({ horizonDays: 30 }), /asOf/);
  assert.throws(() => moneyMap({ asOf: "not-a-date", horizonDays: 30 }), /asOf/);
  assert.throws(() => moneyMap({ asOf: AS_OF }), /horizonDays/);
  assert.throws(() => moneyMap({ asOf: AS_OF, horizonDays: 0 }), /horizonDays/);
});

/* ── unknown is unknown, all the way to the display string ────────────── */

test("an unreported minimum payment is null, never 0.00", () => {
  const out = run({
    tradelines: [tradeline()],
    liabilities: [liability({ minimum_payment_cents: null })]
  });
  const card = out.cards.rows[0];
  assert.equal(card.minimum_payment.cents, null);
  assert.equal(card.minimum_payment.display, null);
});

test("a total over cards with holes in it is a FLOOR and says so", () => {
  const out = run({
    tradelines: [tradeline(), tradeline({ id: "t2", lender: "Chase" })],
    liabilities: [
      liability(),
      liability({ id: "l2", tradeline_id: "t2", minimum_payment_cents: null })
    ]
  });
  const total = out.cards.minimum_payments_total;
  assert.equal(total.display, "35.00");
  assert.equal(total.basis.partial, true);
  assert.equal(total.basis.counted, 1);
  assert.equal(total.basis.unknown, 1);
  assert.equal(total.basis.lines, 2);
});

test("a card with no liability row is counted and named, not treated as nothing due", () => {
  const out = run({ tradelines: [tradeline()], liabilities: [] });
  assert.equal(out.cards.rows[0].has_liability, false);
  assert.equal(out.cards.rows[0].due_date, null);
  assert.equal(out.cards.without_liability_row, 1);
  assert.equal(out.cards.rows[0].minimum_payment.display, null);
});

test("a due date in the past is reported as overdue and raises its own alert", () => {
  const out = run({
    tradelines: [tradeline()],
    liabilities: [liability({ payment_due_date: "2026-07-01" })]
  });
  assert.equal(out.cards.rows[0].overdue, true);
  assert.equal(out.cards.rows[0].days_until_due, -30);
  const overdue = out.alerts.rows.filter((r) => r.kind === "payment_due_date_passed");
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].engine, "liabilities");
});

test("days_until_due is null, not 0, when no due date was reported", () => {
  const out = run({
    tradelines: [tradeline()],
    liabilities: [liability({ payment_due_date: null })]
  });
  assert.equal(out.cards.rows[0].days_until_due, null);
  assert.equal(out.cards.rows[0].overdue, null);
  assert.equal(out.cards.without_due_date, 1);
});

/* ── a credit line is not cash ─────────────────────────────────────────── */

test("DEPOSITORY admits only 'depository' — a null account type is not cash", () => {
  assert.equal(DEPOSITORY({ account_type: "depository" }), true);
  assert.equal(DEPOSITORY({ account_type: "credit" }), false);
  assert.equal(DEPOSITORY({ account_type: null }), false);
  assert.equal(DEPOSITORY({}), false);
  assert.equal(DEPOSITORY(null), false);
});

test("a credit line's headroom never reaches the cash projection", () => {
  const out = run({
    bankAccounts: [
      account(),
      account({ id: "b2", name: "Card", account_type: "credit",
                available_balance_cents: "900000", current_balance_cents: "-90000" })
    ]
  });
  assert.equal(out.cashflow.accounts_used.length, 1);
  assert.equal(out.cashflow.accounts_used[0].id, "b1");
  assert.equal(out.cashflow.opening.display, "2400.00");   // 2400, not 2400 + 9000
  const skipped = out.cashflow.accounts_skipped.map((s) => s.id);
  assert.deepEqual(skipped, ["b2"]);
  assert.match(out.cashflow.accounts_skipped[0].reason, /headroom, not money in the bank/);
});

test("an account whose kind the bank never gave is skipped and the reason is stated", () => {
  const out = run({ bankAccounts: [account(), account({ id: "b9", account_type: null })] });
  const skipped = out.cashflow.accounts_skipped.find((s) => s.id === "b9");
  assert.ok(skipped);
  assert.match(skipped.reason, /never said what kind of account/);
});

test("a closed depository account is excluded from the projection", () => {
  const out = run({ bankAccounts: [account({ closed_at: "2026-01-01T00:00:00Z" })] });
  assert.equal(out.cashflow.ok, false);
  assert.equal(out.cashflow.reason.code, "NO_DEPOSITORY_ACCOUNTS");
});

/* ── unknown entity kind is never folded into personal ─────────────────── */

test("balances stay grouped and unclassified money is never the client's", () => {
  const out = run({
    bankAccounts: [
      account(),
      account({ id: "b2", name: "Unplaced", entity_kind: "unknown", current_balance_cents: "900000" })
    ]
  });
  const personal = out.balances.groups.find((g) => g.key === "personal");
  const unknown = out.balances.groups.find((g) => g.key === "unknown");
  assert.equal(personal.current.display, "2400.00");
  assert.equal(unknown.current.display, "9000.00");
  assert.equal(out.balances.needs_classification, true);
  // The rule banking-surface.mjs exists to enforce: no combined figure anywhere.
  assert.equal(out.balances.total, undefined);
  assert.equal(out.balances.combined, undefined);
});

test("a projection that pools more than one entity kind says so", () => {
  const mixed = run({
    bankAccounts: [
      account(),
      account({ id: "b2", name: "Unplaced", entity_kind: "unknown", current_balance_cents: "900000" })
    ]
  });
  assert.equal(mixed.cashflow.mixes_entity_kinds, true);
  assert.deepEqual(mixed.cashflow.entity_census, { personal: 1, business: 0, unknown: 1 });

  const single = run({ bankAccounts: [account()] });
  assert.equal(single.cashflow.mixes_entity_kinds, false);
});

test("an unrecognised entity_kind reads as unknown, never as personal", () => {
  const out = run({ bankAccounts: [account({ entity_kind: "PERSONAL_MAYBE" })] });
  assert.equal(out.cashflow.accounts_used[0].entity_kind, "unknown");
});

/* ── an unknown balance stops the projection rather than understating it ── */

test("one unknown account balance refuses the whole projection", () => {
  const out = run({
    bankAccounts: [account(), account({ id: "b2", current_balance_cents: null })]
  });
  assert.equal(out.cashflow.ok, false);
  assert.equal(out.cashflow.reason.code, "UNKNOWN_BALANCE");
  assert.equal(out.cashflow.opening.display, null);
  assert.equal(out.cashflow.total_out_committed.display, null);
});

/* ── bills ─────────────────────────────────────────────────────────────── */

test("a stored bill is negative and is shown as a positive amount going out", () => {
  const out = run({ bankAccounts: [account()], recurringBills: [bill()] });
  const r = out.bills.rows[0];
  assert.equal(r.typical_amount.cents, 1599);
  assert.equal(r.typical_amount.display, "15.99");
  assert.equal(r.direction, "out");
});

test("a bill with no next date carries the detector's reason instead of a date", () => {
  const out = run({
    bankAccounts: [account()],
    recurringBills: [bill({
      next_expected_on: null,
      next_expected_unknown_reason: "two_occurrences_is_a_guess_not_a_cadence"
    })]
  });
  const r = out.bills.rows[0];
  assert.equal(r.next_expected_on, null);
  assert.equal(r.next_expected_unknown_reason, "two_occurrences_is_a_guess_not_a_cadence");
  assert.equal(r.in_window, 0);
  assert.equal(r.in_window_total.display, null);
  assert.equal(out.bills.without_next_date, 1);
  assert.ok(out.notes.some((n) => n.code === "bills_not_projected"));
});

test("a bill on an account this client does not hold is shown and flagged", () => {
  const out = run({
    bankAccounts: [account()],
    recurringBills: [bill({ id: "r2", bank_account_id: "somewhere-else" })]
  });
  assert.equal(out.bills.rows[0].account_on_file, false);
  assert.equal(out.bills.rows[0].account_label, null);
  assert.equal(out.bills.accounts_not_on_file, 1);
});

test("bills are gathered across every account, not just one", () => {
  const out = run({
    bankAccounts: [account(), account({ id: "b2", name: "Savings" })],
    recurringBills: [bill(), bill({ id: "r2", bank_account_id: "b2", merchant_key: "spotify" })]
  });
  assert.equal(out.bills.bills, 2);
  assert.equal(out.bills.accounts_covered, 2);
});

/* ── cash flow ─────────────────────────────────────────────────────────── */

test("money in is zero by construction and the screen is told to say so", () => {
  const out = run({ bankAccounts: [account()], recurringBills: [bill()] });
  assert.equal(out.cashflow.ok, true);
  assert.equal(out.cashflow.total_in.display, "0.00");
  assert.ok(out.notes.some((n) => n.code === "no_income_modelled"));
});

/* ── money coming in (Finance OS CFO build, unit C) ────────────────────── */

/* A biweekly paycheck into b1, found by src/banking/income.mjs from rows. */
const paycheckIncome = () => {
  const rows = [];
  for (let t = Date.parse("2026-02-06T00:00:00Z"), i = 0; t <= Date.parse("2026-07-24T00:00:00Z"); t += 14 * 86_400_000, i += 1) {
    rows.push({ bank_account_id: "b1", provider_transaction_id: `pay${i}`, amount_cents: "180000",
      posted_on: new Date(t).toISOString().slice(0, 10), merchant_name: "ACME CORP PAYROLL" });
  }
  return detectIncome(rows, { now: AS_OF, accounts: [account()] });
};

test("found paydays go on the calendar; at the org's confidence floor they move the balance", () => {
  const income = paycheckIncome();
  assert.equal(income.items[0].next_expected_on, "2026-08-07");
  const out = run({ bankAccounts: [account()], recurringBills: [bill()], thresholds: { confidenceFloor: 0.75 }, income });
  /* Aug 7 and Aug 21 land inside Jul 31 – Aug 29. */
  assert.equal(out.cashflow.total_in.cents, 360000);
  assert.equal(out.cashflow.closing.cents, 240000 + 360000 - 1599);
  assert.ok(out.notes.some((n) => n.code === "income_modelled"));
  assert.ok(!out.notes.some((n) => n.code === "no_income_modelled"));
  assert.equal(out.income.engine_label, ENGINES.income);
  assert.equal(out.income.placed, 1);
  assert.equal(out.income.confirmed, 1);
  assert.equal(out.income.by_kind.personal.monthly_cents, 360000);
  assert.equal(out.income.items[0].on_the_calendar, true);
});

test("with no confidence floor set, a found paycheck is shown but moves neither track", () => {
  const out = run({ bankAccounts: [account()], recurringBills: [bill()], income: paycheckIncome() });
  assert.equal(out.cashflow.total_in.cents, 0, "a maybe-paycheck never makes the careful line hopeful");
  assert.equal(out.income.confirmed, 0);
  assert.match(out.notes.find((n) => n.code === "income_modelled").note, /0 of them are steady enough/);
});

test("an income read that found nothing keeps the plain worst-case wording", () => {
  const out = run({ bankAccounts: [account()], income: detectIncome([], { now: AS_OF, accounts: [account()] }) });
  assert.equal(out.cashflow.total_in.cents, 0);
  assert.match(out.notes.find((n) => n.code === "no_income_modelled").note, /No repeat deposit was found/);
  const failed = run({ bankAccounts: [account()], income: { ok: false, reason: "read_failed" } });
  assert.deepEqual([failed.income.unavailable, failed.income.reason], [true, "read_failed"]);
  assert.ok(failed.notes.some((n) => n.code === "no_income_modelled"));
  assert.equal(run({ bankAccounts: [account()] }).income, null, "no income read passed: nothing claimed");
});

test("a bill inside the window moves the closing balance by exactly its amount", () => {
  const out = run({
    bankAccounts: [account()], recurringBills: [bill()],
    // 089's configured floor. The bill is 90% confident, so it is committed.
    thresholds: { confidenceFloor: 0.75 }
  });
  assert.equal(out.cashflow.opening.cents, 240000);
  assert.equal(out.cashflow.total_out_committed.cents, 1599);
  assert.equal(out.cashflow.closing.cents, 240000 - 1599);
  assert.equal(out.cashflow.closing.display, "2384.01");
});

/* With NO configured floor there is nothing to compare a confidence against, so
   project() carries every bill as unconfirmed and reports the gap. The money
   still leaves in the worst-case track — it is the optimistic figure that
   refuses to bank on it. */
test("with no configured floor, a bill is carried as not-certain rather than assumed", () => {
  const out = run({ bankAccounts: [account()], recurringBills: [bill()] });
  assert.equal(out.cashflow.total_out_committed.cents, 0);
  assert.equal(out.cashflow.total_out_unconfirmed.cents, 1599);
  assert.equal(out.cashflow.closing.cents, 240000);
  assert.equal(out.cashflow.worst_case_lowest.cents, 240000 - 1599);
});

test("a card with a due date and no minimum is a blind spot, not a zero", () => {
  const out = run({
    bankAccounts: [account()],
    tradelines: [tradeline()],
    liabilities: [liability({ minimum_payment_cents: null })]
  });
  assert.equal(out.cashflow.ok, true);
  assert.equal(out.cashflow.blind_spots.length, 1);
  assert.equal(out.cashflow.total_out_committed.cents, 0);
});

test("a card minimum inside the window is charged on its due date", () => {
  const out = run({
    bankAccounts: [account()],
    tradelines: [tradeline()],
    liabilities: [liability()]
  });
  const dueDay = out.cashflow.days.find((d) => d.date === "2026-08-12");
  assert.ok(dueDay, "the due date should be inside a 30 day window from 2026-07-31");
  assert.equal(dueDay.out_committed.cents, 3500);
  assert.equal(out.cashflow.closing.cents, 240000 - 3500);
});

/* ── attribution: which engine said which number ───────────────────────── */

test("every utilization line names the engine that produced it", () => {
  const out = run({ tradelines: [tradeline()] });
  for (const e of out.utilization.overall) {
    assert.ok(e.engine, "an overall utilization line with no engine id");
    assert.equal(e.engine_label, ENGINES[e.engine]);
  }
  for (const c of out.utilization.per_card) {
    for (const r of c.readings) {
      assert.ok(r.engine);
      assert.equal(r.engine_label, ENGINES[r.engine]);
    }
  }
});

test("the alerts engine and the Finance OS grid both speak, separately", () => {
  const out = run({ tradelines: [tradeline()] });
  const ids = out.utilization.overall.map((e) => e.engine);
  assert.ok(ids.includes("alerts"));
  assert.ok(ids.includes("finance_os_grid"));
});

test("the funding calculator's utilization appears only when an amount was asked for", () => {
  const without = run({ tradelines: [tradeline()] });
  assert.equal(without.utilization.overall.some((e) => e.engine === "funding"), false);

  const withAmount = run({ tradelines: [tradeline()], requestedAmount: 3000 });
  assert.equal(withAmount.utilization.overall.some((e) => e.engine === "funding"), true);
});

test("the alerts engine refuses a whole-portfolio answer when a card is unknown", () => {
  const out = run({
    tradelines: [tradeline(), tradeline({ id: "t2", lender: "Chase", balance_cents: null })]
  });
  const alerts = out.utilization.overall.find((e) => e.engine === "alerts");
  assert.equal(alerts.pct, null);
  assert.equal(alerts.over, null);
  assert.equal(alerts.partial, true);
  // The measurable slice is still reported, under a name that cannot be
  // mistaken for the whole.
  assert.equal(alerts.known_portion.pct, 20);
});

test("a funding reading is not attached to a card when the lender name is ambiguous", () => {
  const out = run({
    tradelines: [
      tradeline({ id: "t1", lender: "Chase" }),
      tradeline({ id: "t2", lender: "Chase", credit_limit_cents: "300000", balance_cents: "10000" })
    ],
    requestedAmount: 1000
  });
  assert.ok(out.utilization.unmatched_funding_readings.length > 0);
  for (const c of out.utilization.per_card) {
    assert.equal(c.readings.some((r) => r.engine === "funding"), false);
  }
});

test("every alert row names its engine, and the two sources are counted apart", () => {
  const out = run({
    bankAccounts: [account()],
    tradelines: [tradeline()],
    liabilities: [liability()],
    recurringBills: [bill()],
    reminders: [{
      id: "rem1", reminder_kind: "statement_closed", subject_kind: "card_liability",
      subject_label: "Amex", body: "The statement closes.", surface_at: "2026-08-01T00:00:00Z",
      acknowledged_at: null
    }]
  });
  for (const r of out.alerts.rows) {
    assert.ok(r.engine, "an alert row with no engine id");
    assert.equal(r.engine_label, ENGINES[r.engine]);
  }
  assert.equal(out.alerts.by_engine.reminders, 1);
  assert.ok(out.alerts.by_engine.cashflow >= 2);
});

/* ── funding ───────────────────────────────────────────────────────────── */

test("an unknown card balance overstates headroom, and that is said out loud", () => {
  const out = run({
    tradelines: [tradeline({ id: "t2", lender: "Chase", balance_cents: null })]
  });
  const caveat = out.funding.caveats.find((c) => c.code === "balance_unknown_read_as_zero");
  assert.ok(caveat, "an unknown balance must produce a caveat");
  assert.equal(caveat.count, 1);
  // The conservative figure sits next to it, and it is UNKNOWN rather than a
  // number, because the grid refuses to count a line that did not report both.
  assert.equal(out.funding.conservative_available.display, null);
});

test("a card with no credit limit is dropped from the funding maths and counted", () => {
  const out = run({ tradelines: [tradeline({ credit_limit_cents: null })] });
  const caveat = out.funding.caveats.find((c) => c.code === "limit_unknown_card_dropped");
  assert.ok(caveat);
  assert.equal(caveat.count, 1);
});

test("no requested amount means no draw plan, not a zero draw plan", () => {
  const out = run({ tradelines: [tradeline()] });
  assert.equal(out.funding.requested_amount, null);
  assert.equal(out.funding.allocation, null);
  assert.equal(out.funding.guardrail, null);
});

test("closed and instalment lines are left out of the funding maths and counted", () => {
  const out = run({
    tradelines: [
      tradeline(),
      tradeline({ id: "t2", closed_at: "2026-01-01T00:00:00Z" }),
      tradeline({ id: "t3", kind: "installment" })
    ]
  });
  assert.equal(out.funding.cards_considered, 1);
  assert.equal(out.funding.cards_excluded_closed_or_installment, 2);
});

/* ── small readers ─────────────────────────────────────────────────────── */

test("an account reference is masked to the last four digits", () => {
  const out = run({ tradelines: [tradeline({ account_ref: "4444555566667777" })] });
  assert.equal(out.cards.rows[0].ref_mask, "••7777");
});

test("billRowToDetected keeps the sign and carries the stored anchor day", () => {
  const b = billRowToDetected(bill({ anchor_day_of_month: 31 }));
  assert.equal(b.typicalAmountCents, -1599);
  assert.equal(b.nextExpectedDate, "2026-08-04");
  assert.equal(b.anchorDayOfMonth, 31);
  // A row written before migration 090 has none, and null is the right answer —
  // the seam then falls back to the day in next_expected_on, exactly as before.
  assert.equal(billRowToDetected(bill()).anchorDayOfMonth, null);
});

/* THE MONTH-END DRIFT MIGRATION 090 EXISTS TO STOP. A bill charged on the 31st
   has its next date CLAMPED to the 30th in a short month. Anchoring the series
   on that clamped value pins the bill to the 30th forever — one day early, every
   month, with nothing on the screen saying it is an estimate. */
test("a month-end bill keeps its 31st when the anchor day is stored", () => {
  const withAnchor = moneyMap({
    asOf: "2026-09-01", horizonDays: 150,   // through to 2027-01-28
    bankAccounts: [account()],
    recurringBills: [bill({
      merchant_key: "rent", merchant_display: "RENT",
      typical_amount_cents: "-180000",
      // September has 30 days, so the detector's prediction is already clamped.
      next_expected_on: "2026-09-30",
      anchor_day_of_month: 31
    })]
  });
  const dates = withAnchor.bills.rows[0].in_window_dates;
  assert.ok(dates.includes("2026-10-31"), `October should land on the 31st, got ${dates.join(", ")}`);
  assert.ok(dates.includes("2026-12-31"), `December should land on the 31st, got ${dates.join(", ")}`);

  const without = moneyMap({
    asOf: "2026-09-01", horizonDays: 120,
    bankAccounts: [account()],
    recurringBills: [bill({
      merchant_key: "rent", merchant_display: "RENT",
      typical_amount_cents: "-180000",
      next_expected_on: "2026-09-30",
      anchor_day_of_month: null
    })]
  });
  // Unchanged behaviour for a pre-090 row: still pinned to the 30th. Documented,
  // not fixed by a guess — the anchor cannot be recovered from a clamped date.
  assert.ok(without.bills.rows[0].in_window_dates.includes("2026-10-30"));
});

/* ── not-real money ────────────────────────────────────────────────────── */

/* The mock provider writes into the same table a real bank read would. A
   made-up balance a screen cannot tell apart from a real one is the worst thing
   that could reach this page, so the count travels with the payload. */
test("mock accounts are counted and named so the screen can warn", () => {
  const clean = run({ bankAccounts: [account()] });
  assert.equal(clean.not_real.any, false);
  assert.equal(clean.not_real.accounts, 0);
  assert.equal(clean.not_real.note, null);

  const dirty = run({
    bankAccounts: [
      account({ provider: "plaid" }),
      account({ id: "b2", name: "Made Up Savings", provider: "mock" })
    ]
  });
  assert.equal(dirty.not_real.any, true);
  assert.equal(dirty.not_real.accounts, 1);
  assert.deepEqual(dirty.not_real.labels, ["Made Up Savings"]);
  assert.match(dirty.not_real.note, /NOT REAL/);
});

test("a row from a database older than migration 091 reads as manual, not unknown", () => {
  const out = run({ bankAccounts: [account({ provider: undefined })] });
  assert.equal(out.cashflow.accounts_used[0].provider, "manual");
  assert.equal(out.not_real.any, false);
});

/* ── the org's configured thresholds ───────────────────────────────────── */

/* Migration 089 is explicit that these are two different questions:
   cashflow-seam's 0.55 asks "safe to SHOW a person as a bill", and
   cashflow_settings.confidence_floor asks "certain enough to treat as money
   DEFINITELY LEAVING". Using the lower number puts every `medium` bill in the
   committed track and overstates what is going out. */
test("a medium-confidence bill is committed under 0.55 and not under 0.75", () => {
  const medium = bill({ confidence_pct: 60, confidence_label: "medium" });

  const loose = run({ bankAccounts: [account()], recurringBills: [medium],
                      thresholds: { confidenceFloor: 0.55 } });
  assert.equal(loose.cashflow.total_out_committed.cents, 1599);
  assert.equal(loose.cashflow.total_out_unconfirmed.cents, 0);

  const strict = run({ bankAccounts: [account()], recurringBills: [medium],
                       thresholds: { confidenceFloor: 0.75 } });
  assert.equal(strict.cashflow.total_out_committed.cents, 0);
  assert.equal(strict.cashflow.total_out_unconfirmed.cents, 1599);
});

test("an unset threshold is reported as a gap, never replaced with a guess", () => {
  const out = run({ bankAccounts: [account()], recurringBills: [bill()], thresholds: {} });
  const names = out.cashflow.threshold_gaps.map((g) => g.name);
  assert.ok(names.includes("confidenceFloor"),
    "an org that has decided nothing was not told so");
  const gap = out.cashflow.threshold_gaps.find((g) => g.name === "confidenceFloor");
  assert.match(gap.note, /operator policy and needs a row/);
});

test("ENGINES is frozen and every id carries a module path a reader can open", () => {
  assert.equal(Object.isFrozen(ENGINES), true);
  for (const [id, label] of Object.entries(ENGINES)) {
    assert.match(label, /src\/|table|cashflow_reminders|recurring_bills/, `${id} names no source`);
  }
});
