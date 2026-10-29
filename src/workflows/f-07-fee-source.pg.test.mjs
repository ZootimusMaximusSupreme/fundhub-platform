// Read-only F-07 provenance SQL against disposable CI PostgreSQL.
// Tables below are transaction-local TEMP shadows; no real customer/provider writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { validateFundedFeeSource } from "./f-07-funding-locked.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      url.pathname === "/fundhub_ci";
  } catch { return false; }
})();

test("F-07 funded sale and round are tied to same org, client and active funding product (real PG)",
  { skip: !SCRATCH }, async () => {
    const conn = await pool().connect();
    try {
      await conn.query("BEGIN");
      await conn.query(`CREATE TEMP TABLE funding_rounds (id uuid, org_id uuid, client_id uuid)`);
      await conn.query(`CREATE TEMP TABLE funding_round_sales (funding_round_id uuid, org_id uuid, sale_id uuid)`);
      await conn.query(`CREATE TEMP TABLE sales (id uuid, org_id uuid, client_id uuid, product_id uuid, status text)`);
      await conn.query(`CREATE TEMP TABLE products (id uuid, org_id uuid, category text)`);

      const org = randomUUID(), foreignOrg = randomUUID();
      const client = randomUUID(), foreignClient = randomUUID();
      const round = randomUUID(), foreignRound = randomUUID();
      const sale = randomUUID(), foreignSale = randomUUID(), nonfundingSale = randomUUID();
      const fundingProduct = randomUUID(), blueprintProduct = randomUUID();

      await conn.query(
        `INSERT INTO products(id,org_id,category) VALUES ($1,$2,'funding'),($3,$2,'blueprint')`,
        [fundingProduct, org, blueprintProduct]
      );
      await conn.query(
        `INSERT INTO funding_rounds(id,org_id,client_id) VALUES ($1,$2,$3),($4,$5,$6)`,
        [round, org, client, foreignRound, foreignOrg, foreignClient]
      );
      await conn.query(
        `INSERT INTO sales(id,org_id,client_id,product_id,status)
         VALUES ($1,$2,$3,$4,'active'),($5,$2,$6,$4,'active'),($7,$2,$3,$8,'active')`,
        [sale, org, client, fundingProduct, foreignSale, foreignClient, nonfundingSale, blueprintProduct]
      );
      await conn.query(
        `INSERT INTO funding_round_sales(funding_round_id,org_id,sale_id) VALUES ($1,$2,$3)`,
        [round, org, sale]
      );

      const check = async (overrides = {}) =>
        validateFundedFeeSource(conn, {
          orgId: org, clientId: client, saleId: sale, fundingRoundId: round,
          rail: "card_stacking", ...overrides
        });

      assert.equal((await check()).ok, true, "owned funding sale linked to owned round");
      assert.equal((await check()).ok, true, "exact replay is safe");
      assert.equal((await check({ saleId: foreignSale })).ok, false, "another customer sale denied");
      assert.equal((await check({ saleId: nonfundingSale })).ok, false, "Blueprint sale denied");
      assert.equal((await check({ clientId: foreignClient })).ok, false, "another client denied");
      assert.equal((await check({ orgId: foreignOrg })).ok, false, "another org denied");
      assert.equal((await check({ fundingRoundId: foreignRound })).ok, false, "foreign round denied");

      await conn.query("UPDATE sales SET status = 'cancelled' WHERE id=$1", [sale]);
      assert.equal((await check()).ok, false, "cancelled sale may not trigger a new invoice");
    } finally {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
      await close();
    }
  });
