import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateCompanyCash, readCompanyCash, validateObligation } from "./company-cash.mjs";

const NOW = new Date("2026-11-12T17:00:00Z");
const bank = { selected_for_cash: true, business_confirmed_at: NOW.toISOString(),
  account_type: "depository", currency_code: "USD", available_balance_cents: "100000",
  current_balance_cents: "100000",
  balance_as_of: "2026-11-12T16:00:00Z" };
const crs = { kind: "crs", billing_month: "2026-11-01", amount_cents: "1185",
  invoice_verified_at: "2026-11-11T00:00:00Z", invoice_covers_through_on: "2026-11-10",
  status: "approved" };
const reviews = [
  { kind: "ad", billing_month: "2026-11-01", status: "approved", amount_cents: 0 },
  { kind: "tech", billing_month: "2026-11-01", status: "approved", amount_cents: 0 }
];

test("cash subtracts only verified unpaid commitments from selected business bank", () => {
  const out = calculateCompanyCash({ account: bank, asOf: NOW, obligations: [
    crs, { kind: "ad", billing_month: "2026-11-01", status: "approved", amount_cents: "30000" },
    { kind: "ad", billing_month: "2026-11-01", status: "planned", amount_cents: "99999" },
    { kind: "tech", billing_month: "2026-11-01", status: "planned", amount_cents: "2499", due_on: "2026-11-22" },
    { kind: "tech", billing_month: "2026-12-01", status: "planned", amount_cents: "9999", due_on: "2026-12-01" },
    ...reviews
  ], metaSpendCents: 45555, processorReceiptsCents: 99000 });
  assert.equal(out.available_cents, 66316);
  assert.equal(out.bank_available_cents, 100000);
  assert.equal(out.bank_posted_cents, 100000);
  assert.equal(out.meta_spend_cents, 45555);
  assert.equal(out.processor_receipts_cents, 99000);
});

test("missing CRS invoice and unpriced real pulls never make an exact balance", () => {
  const out = calculateCompanyCash({ account: bank, asOf: NOW, pulls: [
    { status: "fulfilled", provider: "crs_softview", cost_cents: null },
    { status: "fulfilled", provider: "crs_softview", cost_cents: 395 },
    { status: "failed", provider: "crs_softview", cost_cents: 395 },
    { status: "fulfilled", provider: "internal", cost_cents: 395 }
  ] });
  assert.equal(out.available_cents, null);
  assert.equal(out.known_remaining_cents, 100000);
  assert.equal(out.crs_fulfilled_pull_count, 2);
  assert.equal(out.crs_unpriced_pull_count, 1);
  assert.equal(out.crs_priced_pull_cents, 395);
  assert.deepEqual(out.missing, ["ad_review", "tech_review", "crs_invoice", "crs_uncovered_pull_cost"]);
});

test("paid invoice stops deduction only with posted matched debit", () => {
  const paid = { ...crs, status: "paid", paid_transaction_posted: true };
  assert.equal(calculateCompanyCash({ account: bank, asOf: NOW, obligations: [paid, ...reviews] }).available_cents, 100000);
  const unverified = calculateCompanyCash({ account: bank, asOf: NOW,
    obligations: [{ ...paid, paid_transaction_posted: false }, ...reviews] });
  assert.equal(unverified.available_cents, null);
  assert.ok(unverified.missing.includes("crs_payment_unverified"));
});

test("personal, missing, stale or unconfirmed bank never yields available cash", () => {
  for (const invalid of [
    null, { ...bank, selected_for_cash: false }, { ...bank, business_confirmed_at: null },
    { ...bank, balance_as_of: "2026-10-01T00:00:00Z" },
    { ...bank, currency_code: "CAD" }, { ...bank, holder_category: "personal" },
    { ...bank, current_balance_cents: null }
  ]) {
    const out = calculateCompanyCash({ account: invalid, asOf: NOW, obligations: [crs, ...reviews] });
    assert.equal(out.available_cents, null);
    assert.ok(out.missing.includes("business_bank_balance"));
  }
});

test("owner obligation entry requires a real amount for approved ads and verified CRS invoice", () => {
  assert.equal(validateObligation({ kind: "ad", label: "Colin", status: "approved" }), null);
  assert.equal(validateObligation({ kind: "crs", label: "CRS", billing_month: "2026-11-01",
    invoice_verified: true }), null);
  assert.equal(validateObligation({ kind: "crs", label: "CRS", billing_month: "2026-11-01",
    source_ref: "invoice-1", amount_cents: 1185, invoice_verified: true,
    invoice_covers_through_on: "2026-11-10" }, NOW).amount, 1185);
  assert.equal(validateObligation({ kind: "tech", label: "No tech bills", amount_cents: 0,
    status: "approved" }), null, "even explicit zero needs a reviewed month");
});

test("blank or boolean amounts never become verified zero dollar obligations", () => {
  for (const amount_cents of ["", " ", false, true]) {
    assert.equal(validateObligation({ kind: "crs", label: "CRS", billing_month: "2026-11-01",
      source_ref: "invoice-1", amount_cents, invoice_verified: true,
      invoice_covers_through_on: "2026-11-10" }, NOW), null);
    assert.equal(validateObligation({ kind: "ad", label: "Ad", billing_month: "2026-11-01",
      status: "approved", amount_cents }), null);
  }
  assert.equal(calculateCompanyCash({ account: bank, asOf: NOW, obligations: [
    { ...crs, amount_cents: "" }, ...reviews
  ] }).available_cents, null);
});

test("invoice cutoff covers earlier unpriced pulls and withholds later unknown costs", () => {
  const covered = { status: "fulfilled", provider: "crs_softview", cost_cents: null,
    resolved_at: "2026-11-10T03:00:00Z" };
  const later = { ...covered, resolved_at: "2026-11-11T17:00:00Z" };
  assert.equal(calculateCompanyCash({ account: bank, asOf: NOW,
    obligations: [crs, ...reviews], pulls: [covered] }).available_cents, 98815);
  const unknown = calculateCompanyCash({ account: bank, asOf: NOW,
    obligations: [crs, ...reviews], pulls: [covered, later] });
  assert.equal(unknown.available_cents, null);
  assert.ok(unknown.missing.includes("crs_uncovered_pull_cost"));
  const priced = calculateCompanyCash({ account: bank, asOf: NOW,
    obligations: [crs, ...reviews], pulls: [{ ...later, cost_cents: 395 }] });
  assert.equal(priced.crs_reserve_cents, 1580);
  assert.equal(priced.available_cents, 98420);
  const sameDayLater = calculateCompanyCash({ account: bank, asOf: NOW,
    obligations: [crs, ...reviews], pulls: [{ ...covered, resolved_at: "2026-11-11T01:00:00Z" }] });
  assert.equal(sameDayLater.available_cents, null, "a later pull on the invoice day is not covered");
});

test("invoice cutoff cannot be after verification or use an impossible calendar date", () => {
  assert.equal(validateObligation({ kind: "crs", label: "CRS", billing_month: "2026-11-01",
    source_ref: "invoice-1", amount_cents: 1185, invoice_verified: true,
    invoice_covers_through_on: "2026-11-13" }, NOW), null);
  assert.equal(validateObligation({ kind: "crs", label: "CRS", billing_month: "2026-02-01",
    source_ref: "invoice-1", amount_cents: 1185, invoice_verified: true,
    invoice_covers_through_on: "2026-02-31", due_on: "2026-02-31" }, NOW), null);
  const impossible = calculateCompanyCash({ account: bank, asOf: NOW, obligations: [
    { ...crs, invoice_covers_through_on: "2026-11-12",
      invoice_verified_at: "2026-11-11T00:00:00Z" }, ...reviews
  ] });
  assert.equal(impossible.available_cents, null);
});

test("cash month follows Phoenix at UTC month boundary", () => {
  const asOf = new Date("2026-11-01T00:30:00Z");
  const out = calculateCompanyCash({ account: { ...bank, balance_as_of: asOf.toISOString() },
    asOf, obligations: [
      { ...crs, billing_month: "2026-10-01", invoice_covers_through_on: "2026-10-31",
        invoice_verified_at: "2026-11-01T00:00:00Z" },
      { kind: "ad", billing_month: "2026-10-01", status: "approved", amount_cents: 0 },
      { kind: "tech", billing_month: "2026-10-01", status: "approved", amount_cents: 0 }
    ] });
  assert.equal(out.month, "2026-10-01");
  assert.equal(out.available_cents, 98815);
});

test("company read takes one repeatable-read snapshot for bank, obligations and pulls", async () => {
  const commands = [];
  let released = false;
  let acquired = false;
  const client = { release() { released = true; }, async query(sql, params) {
    commands.push({ sql, params });
    return { rows: [] };
  } };
  const db = { totalCount: 1, async connect() { acquired = true; return client; }, async query() {
    throw new Error("pool.query would escape the snapshot");
  } };
  const out = await readCompanyCash(db, { orgId: "00000000-0000-4000-8000-000000000001",
    asOf: NOW, metaSpend: async () => { assert.equal(acquired, false); return null; } });
  assert.equal(out.summary.available_cents, null);
  assert.match(commands[0].sql, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(commands.at(-1).sql, /COMMIT/);
  assert.ok(commands.some(command => /FROM company_bank_accounts/.test(command.sql)));
  assert.ok(commands.some(command => /FROM company_cash_obligations/.test(command.sql)));
  assert.ok(commands.some(command => /FROM soft_pull_requests/.test(command.sql)));
  assert.equal(released, true);
});

test("planned or unpriced review rows cannot make company cash look complete", () => {
  const out = calculateCompanyCash({ account: bank, asOf: NOW, obligations: [
    crs,
    { kind: "ad", billing_month: "2026-11-01", status: "planned", amount_cents: 0 },
    { kind: "tech", billing_month: "2026-11-01", status: "planned", amount_cents: null, due_on: null }
  ] });
  assert.equal(out.available_cents, null);
  assert.ok(out.missing.includes("ad_review"));
  assert.ok(out.missing.includes("tech_review"));
  assert.ok(out.missing.includes("tech_amount"));
  assert.ok(out.missing.includes("tech_due_date"));
});

test("past unpaid approved ad and overdue tech commitments still reduce this month", () => {
  const out = calculateCompanyCash({ account: bank, asOf: NOW, obligations: [
    crs, ...reviews,
    { kind: "ad", billing_month: "2026-10-01", status: "approved", amount_cents: 5000 },
    { kind: "tech", billing_month: "2026-10-01", status: "approved",
      amount_cents: 1500, due_on: "2026-10-28" }
  ] });
  assert.equal(out.available_cents, 92315);
});

test("pending bank hold is not subtracted twice through Plaid available balance", () => {
  const out = calculateCompanyCash({ account: { ...bank, available_balance_cents: 90000 },
    asOf: NOW, obligations: [
      crs, reviews[1],
      { kind: "ad", billing_month: "2026-11-01", status: "approved", amount_cents: 10000 }
    ] });
  assert.equal(out.bank_posted_cents, 100000);
  assert.equal(out.bank_available_cents, 90000);
  assert.equal(out.available_cents, 88815);
});
