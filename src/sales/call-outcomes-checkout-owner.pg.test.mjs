// Checkout cash must belong to the exact buyer of the paid link.
// Only runs in GitHub Actions against its disposable loopback Postgres.
// Temporary shadow tables and an always-rolled-back transaction prevent real writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool, close } from "../db.mjs";
import { paidTransactionForLink } from "./call-outcomes.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return (u.hostname === "localhost" || u.hostname === "127.0.0.1")
      && u.pathname === "/fundhub_ci";
  } catch {
    return false;
  }
})();

test("closer paid checkout cannot count another buyer's transaction as this call's cash",
  { skip: !SCRATCH }, async () => {
    const conn = await pool().connect();
    try {
      await conn.query("BEGIN");
      // Restrict all SQL to session-local fixtures; no customer or production data.
      await conn.query(`CREATE TEMP TABLE payment_links (
        id uuid PRIMARY KEY, org_id uuid, client_id uuid,
        created_by_staff_id uuid, product_id uuid
      ) ON COMMIT DROP`);
      await conn.query(`CREATE TEMP TABLE products (
        id uuid PRIMARY KEY, org_id uuid, code text
      ) ON COMMIT DROP`);
      await conn.query(`CREATE TEMP TABLE sale_payments (
        payment_link_id uuid, org_id uuid, transaction_id uuid,
        kind text, amount numeric, paid_at timestamptz
      ) ON COMMIT DROP`);
      await conn.query(`CREATE TEMP TABLE transactions (
        id uuid PRIMARY KEY, org_id uuid, client_id uuid, status text
      ) ON COMMIT DROP`);

      const orgId = "11111111-1111-4111-8111-111111111111";
      const buyer = "22222222-2222-4222-8222-222222222222";
      const otherBuyer = "33333333-3333-4333-8333-333333333333";
      const staffId = "44444444-4444-4444-8444-444444444444";
      const productId = "55555555-5555-4555-8555-555555555555";
      const linkId = "66666666-6666-4666-8666-666666666666";
      const foreignPaidTransaction = "77777777-7777-4777-8777-777777777777";
      const correctPaidTransaction = "88888888-8888-4888-8888-888888888888";
      const args = {
        orgId, clientId: buyer, staffId,
        paymentLinkId: linkId, productCode: "card-stacking-dfy"
      };

      await conn.query("INSERT INTO products (id, org_id, code) VALUES ($1,$2,$3)",
        [productId, orgId, args.productCode]);
      await conn.query(`INSERT INTO payment_links
        (id, org_id, client_id, created_by_staff_id, product_id)
        VALUES ($1,$2,$3,$4,$5)`, [linkId, orgId, buyer, staffId, productId]);
      // Inconsistent payment-link/receipt association: same company and paid,
      // but the provider transaction is for a DIFFERENT customer.
      await conn.query(`INSERT INTO transactions (id,org_id,client_id,status)
        VALUES ($1,$2,$3,'paid')`, [foreignPaidTransaction, orgId, otherBuyer]);
      await conn.query(`INSERT INTO sale_payments
        (payment_link_id,org_id,transaction_id,kind,amount,paid_at)
        VALUES ($1,$2,$3,'deposit',3000,'2026-10-28T14:00:00Z')`,
      [linkId, orgId, foreignPaidTransaction]);

      assert.equal(await paidTransactionForLink(conn, args), null,
        "same-org but other-buyer paid transaction must NEVER confirm this call");
      // Normal correctly linked payment continues working.
      await conn.query(`INSERT INTO transactions (id,org_id,client_id,status)
        VALUES ($1,$2,$3,'succeeded')`, [correctPaidTransaction, orgId, buyer]);
      await conn.query(`INSERT INTO sale_payments
        (payment_link_id,org_id,transaction_id,kind,amount,paid_at)
        VALUES ($1,$2,$3,'deposit',3000,'2026-10-28T13:00:00Z')`,
      [linkId, orgId, correctPaidTransaction]);

      assert.equal(await paidTransactionForLink(conn, args), correctPaidTransaction,
        "actual buyer's settled deposit is selected instead of newer foreign receipt");
      assert.equal(await paidTransactionForLink(conn, { ...args, clientId: otherBuyer }), null);
      assert.equal(await paidTransactionForLink(conn, {
        ...args, staffId: "99999999-9999-4999-8999-999999999999"
      }), null);
      assert.equal(await paidTransactionForLink(conn, { ...args, productCode: "repair" }), null);
      assert.equal(await paidTransactionForLink(conn, { ...args, paymentLinkId: null }), null);
    } finally {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
      await close();
    }
  });
