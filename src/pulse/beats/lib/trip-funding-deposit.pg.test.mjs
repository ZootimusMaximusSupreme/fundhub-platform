// READ-ONLY disposable-Postgres regression for trip:funding cash truth.
// All source tables below are synthetic CTEs; no real sale, payment or provider write.
import test from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../../../db.mjs";
import { FUNDING_DEPOSIT_LATERAL_SQL, TRIP_SQL, toTripRow } from "./trip-funding-truth.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "33333333-3333-4333-8333-333333333333";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const SALE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SALE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PAID_AT = "2026-10-30T12:00:00Z";

function payment({ org = ORG, sale = SALE, kind = "deposit", amount = 200, at = PAID_AT } = {}) {
  return `SELECT '${org}'::uuid, '${sale}'::uuid, '${kind}'::text,
    ${Number(amount)}::numeric, '${at}'::timestamptz`;
}

function probe(payments, { status = "active", demo = false, category = "funding", secondFundingSale = false } = {}) {
  const emptyPayment = `SELECT NULL::uuid, NULL::uuid, NULL::text,
    NULL::numeric, NULL::timestamptz WHERE false`;
  return `
    WITH
      targets(id) AS (VALUES ('${CLIENT}'::uuid)),
      products(id, org_id, category) AS (
        VALUES ('${PRODUCT}'::uuid, '${ORG}'::uuid, '${category}'::text)
      ),
      sales(id, org_id, client_id, product_id, sold_at, status, is_demo) AS (
        VALUES ('${SALE}'::uuid, '${ORG}'::uuid, '${CLIENT}'::uuid,
          '${PRODUCT}'::uuid, '2026-10-29T10:00:00Z'::timestamptz,
          '${status}'::text, ${demo}::boolean)
        ${secondFundingSale ? `, ('${OTHER_SALE}'::uuid, '${ORG}'::uuid, '${CLIENT}'::uuid,
          '${PRODUCT}'::uuid, '2026-10-30T10:00:00Z'::timestamptz,
          'active'::text, false::boolean)` : ""}
      ),
      sale_payments(org_id, sale_id, kind, amount, paid_at) AS (
        ${[emptyPayment, ...payments.map(payment)].join("\nUNION ALL\n")}
      )
    SELECT dep.at AS deposit_paid_at FROM targets t
    ${FUNDING_DEPOSIT_LATERAL_SQL}
  `;
}

test("trip:funding may not equate a signed sale with a paid funding deposit", () => {
  assert.ok(TRIP_SQL.includes(FUNDING_DEPOSIT_LATERAL_SQL));
  assert.match(FUNDING_DEPOSIT_LATERAL_SQL, /FROM sale_payments sp/);
  assert.match(FUNDING_DEPOSIT_LATERAL_SQL, /sp\.org_id = s\.org_id AND sp\.sale_id = s\.id/);
  assert.match(FUNDING_DEPOSIT_LATERAL_SQL, /sp\.kind = 'deposit'/);
  assert.match(FUNDING_DEPOSIT_LATERAL_SQL, /sp\.kind = 'refund'/);
  assert.match(FUNDING_DEPOSIT_LATERAL_SQL, /net_front_end_cash > 0/);
  assert.doesNotMatch(FUNDING_DEPOSIT_LATERAL_SQL, /min\(s\.sold_at\)/);
  assert.equal(toTripRow({ diagnostic_paid_at: PAID_AT, sales_stage: "diagnostic_paid",
    sales_card_at: PAID_AT, deposit_paid_at: null }).facts.deposit_paid, undefined);
});

const hasDisposablePg = Boolean(process.env.DATABASE_URL);
test("trip funding deposit requires an owned, net-positive receipt and starts clock at cash arrival", {
  skip: !hasDisposablePg && "No disposable PostgreSQL configured"
}, async () => {
  const cases = [
    ["signed but unpaid sale", [], null],
    ["other tenant's receipt", [{ org: OTHER_ORG }], null],
    ["different sale's receipt", [{ sale: OTHER_SALE }], null],
    ["older unpaid offer must not displace a later paid funding sale",
      [{ sale: OTHER_SALE }], PAID_AT, { secondFundingSale: true }],
    ["success fee is not a deposit", [{ kind: "success_fee" }], null],
    ["installment alone is not an initial deposit", [{ kind: "installment" }], null],
    ["zero-dollar deposit", [{ amount: 0 }], null],
    ["actual deposit, paid AFTER signing", [{}], PAID_AT],
    ["partial refund still leaves net cash", [{}, { kind: "refund", amount: 50 }], PAID_AT],
    ["fully refunded deposit is not paid", [{}, { kind: "refund", amount: 200 }], null],
    ["net over-refund does not start a grace timer", [{}, { kind: "refund", amount: 300 }], null],
    ["later installment without a deposit is not enough",
      [{ kind: "installment", amount: 300 }], null],
    ["cross-org deposit cannot offset a same-org refund",
      [{ kind: "refund", amount: 200 }, { org: OTHER_ORG }], null]
  ];
  for (const [label, receipts, expected, options] of cases) {
    const result = await db.query(probe(receipts, options), [ORG]);
    assert.equal(result.rows.length, 1, label);
    const actual = result.rows[0].deposit_paid_at;
    assert.equal(actual ? new Date(actual).toISOString() : null, expected ? new Date(expected).toISOString() : null, label);
  }
  for (const [label, override] of [
    ["cancelled sale", { status: "cancelled" }],
    ["refunded sale", { status: "refunded" }],
    ["demo sale", { demo: true }],
    ["nonfunding product", { category: "consulting" }]
  ]) {
    const result = await db.query(probe([{}], override), [ORG]);
    assert.equal(result.rows[0].deposit_paid_at, null, label);
  }
});

test.after(async () => {
  if (hasDisposablePg) await close();
});
