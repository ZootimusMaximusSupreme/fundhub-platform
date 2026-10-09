// Regression: the 22 dead letters of 2026-08-21 — no Postgres.
//
// WHAT FAILED. Between 00:34 and 01:08 UTC on 2026-08-21, 21 deposit.paid
// (onDepositPaidMoney) and 1 payment.received (onPaymentReceivedMoney) events
// died with: null value in column "product_id" of relation "sale_payments"
// violates not-null constraint. Every one was an audit probe with an
// @example.test / @example.com address, run from a laptop checkout.
//
// WHY. 247_commission_money_chain_identity.sql (PR #117, commit 8bb2af72) made
// sale_payments.product_id NOT NULL; it was recorded applied on production at
// 2026-08-20 22:51 UTC. The stored error stacks point at money-chain.mjs:346
// (ensureSalePayment), :524 (recordPurchase) and :656 (onPaymentReceivedMoney):
// those line numbers are the money-chain.mjs from BEFORE 8bb2af72, whose INSERT
// INTO sale_payments had no product_id column at all. Old code, new schema.
//
// WHAT THIS PINS. The payloads below are copied field for field from two of
// the stored failed_events rows. The fake database enforces the same NOT NULL
// that production does (Postgres code 23502). Today's handlers must write
// sale_payments with the sale's product_id, and when no product can be found
// they must write no sale_payments row at all rather than a null one.

import { test, describe } from "node:test";
import assert from "node:assert";
import { onDepositPaidMoney, onPaymentReceivedMoney } from "./money-chain.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = "11111111-2222-4333-8444-555555555555";
const PRODUCT = { id: "99999999-8888-4777-8666-555555555555", org_id: ORG, code: "card-stacking-dfy", name: "Card Stacking DFY", category: "funding", default_price: "5000.00", default_success_fee_percent: "10.00" };

// failed_events 9ce8a127-d490-4e1a-8b9c-9b42d18af2b8 (onDepositPaidMoney)
const STORED_DEPOSIT = {
  id: "1b92afd3-5e19-4a85-b6c8-ef3ac2ad968d",
  name: "deposit.paid",
  orgId: ORG,
  clientId: null,
  payload: {
    name: "No Closer Client",
    email: "audit-blk6-1787272496358@example.test",
    amount: 3000,
    source: "commas",
    product: "deposit",
    productName: "Consulting Services Deposit",
    providerRef: "audit-blk6-1787272496358_dep"
  }
};

// failed_events dd7d051f-707d-4475-b841-7673418d2ea8 (onPaymentReceivedMoney).
// The stored row has no event_id; a bus event always carries one.
const STORED_PAYMENT = {
  id: "a271664c-b535-43cc-9b4f-20345273bb00",
  name: "payment.received",
  orgId: ORG,
  clientId: null,
  payload: {
    email: "adv-blk5a-1.1@example.test",
    amount: 500,
    source: "commas",
    product: "deposit",
    closerId: "34b656fa-5a4b-40cc-bb99-0e84213c6ecf",
    productName: "Consulting Services Deposit",
    providerRef: "adv-blk5a-1_p2"
  }
};

/* A database that knows one client, optionally one product and one existing
   sale, and refuses a sale_payments row without product_id exactly the way
   Postgres did on 2026-08-21. Anything it does not model answers no rows. */
function strictDb({ product = PRODUCT, existingSale = null } = {}) {
  const salePayments = [];
  const sales = existingSale ? [existingSale] : [];
  const db = {
    salePayments,
    sales,
    query: async (sql, params = []) => {
      const text = String(sql);
      if (/FROM clients WHERE org_id = \$1 AND lower\(email\)/i.test(text)) {
        return { rows: [{ id: CLIENT, ghl_contact_id: "ghl-already-linked" }] };
      }
      if (/resolve_product_id/i.test(text)) {
        return { rows: [{ product_id: product ? product.id : null }] };
      }
      if (/FROM products WHERE id = \$1/i.test(text)) {
        return { rows: product && params[0] === product.id ? [product] : [] };
      }
      if (/FROM products WHERE org_id = \$1 AND lower\(code\)/i.test(text)) {
        return { rows: product && String(params[1]).toLowerCase() === product.code ? [{ id: product.id }] : [] };
      }
      if (/INSERT INTO sales\b/i.test(text)) {
        const row = {
          id: "sale-new", org_id: params[0], client_id: params[1], product_id: params[2],
          agreed_price: params[3], status: "active", external_ref: params[6], sale_motion: params[8]
        };
        sales.push(row);
        return { rows: [row] };
      }
      if (/FROM sales WHERE org_id = \$1 AND external_ref = \$2 LIMIT 1/i.test(text)) {
        return { rows: sales.filter((s) => s.external_ref === params[1]) };
      }
      if (/FROM sales\s+WHERE org_id = \$1 AND external_ref = \$2 AND client_id = \$3/i.test(text)) {
        return { rows: sales.filter((s) => s.external_ref === params[1]) };
      }
      if (/FROM sales\s+WHERE org_id = \$1 AND client_id = \$2 AND product_id = \$3/i.test(text)) {
        return { rows: sales.filter((s) => s.client_id === params[1] && s.product_id === params[2]) };
      }
      if (/INSERT INTO sale_payments/i.test(text)) {
        const cols = text.match(/INSERT INTO sale_payments\s*\(([^)]*)\)/i)[1]
          .split(",").map((c) => c.trim());
        const row = Object.fromEntries(cols.map((c, i) => [c, params[i] ?? null]));
        if (row.product_id == null) {
          const err = new Error('null value in column "product_id" of relation "sale_payments" violates not-null constraint');
          err.code = "23502";
          throw err;
        }
        row.id = `pay-${salePayments.length + 1}`;
        salePayments.push(row);
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
  return db;
}

describe("the 2026-08-21 dead letters cannot happen again", () => {
  test("a stored deposit.paid payload writes sale_payments with the sale's product", async () => {
    const db = strictDb();
    const out = await onDepositPaidMoney(STORED_DEPOSIT, db);
    assert.equal(out.done, true);
    assert.equal(db.salePayments.length, 1, "the deposit must land in sale_payments");
    assert.equal(db.salePayments[0].product_id, PRODUCT.id);
    assert.equal(db.salePayments[0].sale_id, "sale-new");
    assert.equal(db.salePayments[0].kind, "deposit");
  });

  test("a stored payment.received payload on an existing sale carries that sale's product", async () => {
    const db = strictDb({
      existingSale: {
        id: "sale-old", org_id: ORG, client_id: CLIENT, product_id: PRODUCT.id,
        status: "active", external_ref: "adv-blk5a-1_p1", sale_motion: null
      }
    });
    const out = await onPaymentReceivedMoney(STORED_PAYMENT, db);
    assert.equal(out.done, true);
    assert.equal(db.salePayments.length, 1, "the payment must land in sale_payments");
    assert.equal(db.salePayments[0].product_id, PRODUCT.id);
    assert.equal(db.salePayments[0].sale_id, "sale-old");
  });

  test("a replay of the same stored deposit writes no second payment", async () => {
    const db = strictDb();
    await onDepositPaidMoney(STORED_DEPOSIT, db);
    const insertOnce = db.query;
    // Second delivery: the unique keys on sale_payments turn the INSERT into a
    // no-op (ON CONFLICT DO NOTHING), and the handler finds the first row.
    db.query = async (sql, params) => {
      const text = String(sql);
      if (/INSERT INTO sale_payments/i.test(text)) return { rows: [] };
      if (/FROM sale_payments WHERE org_id = \$1 AND source_event_id = \$2/i.test(text)) {
        return { rows: db.salePayments.filter((r) => r.source_event_id === params[1]) };
      }
      return insertOnce(sql, params);
    };
    const again = await onDepositPaidMoney({ ...STORED_DEPOSIT, isRetry: true }, db);
    assert.equal(again.done, true);
    assert.equal(db.salePayments.length, 1, "a replay must not book the deposit twice");
    assert.equal(again.paymentId, db.salePayments[0].id);
  });

  test("when no product can be found, nothing is written and nothing throws", async () => {
    const db = strictDb({ product: null });
    const out = await onDepositPaidMoney(STORED_DEPOSIT, db);
    assert.equal(out.done, false);
    assert.equal(out.reason, "no_sale");
    assert.equal(db.salePayments.length, 0, "never a sale_payments row with no product");
  });
});
