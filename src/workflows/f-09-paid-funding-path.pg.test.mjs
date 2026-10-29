// Verify the F-09 stale-tier exception uses a genuinely paid funding sale.
// Isolated GitHub Actions localhost PostgreSQL ONLY. TEMP tables, ROLLBACK,
// no production customers, messages, bank applications, bureau or charges.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { purchasedCategories } from "../handlers/purchase-routing.mjs";

const allowed = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname)
      && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

test("F-09 paid-funding override refuses unsigned/unpaid, fully refunded and foreign sales (real PG)",
  { skip: allowed ? false : "requires CI loopback fundhub_ci scratch PostgreSQL" }, async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("CREATE TEMP TABLE sales (id uuid, org_id uuid, client_id uuid, status text, product_id uuid)");
      await db.query("CREATE TEMP TABLE products (id uuid, category text)");
      await db.query("CREATE TEMP TABLE sale_payments (org_id uuid, sale_id uuid, kind text, amount numeric)");
      const org = randomUUID(), client = randomUUID();
      const otherOrg = randomUUID(), otherClient = randomUUID();
      const fundingProduct = randomUUID(), repairProduct = randomUUID();
      const fundingSale = randomUUID(), otherSale = randomUUID(), repairSale = randomUUID();
      await db.query("INSERT INTO products(id,category) VALUES ($1,'funding'),($2,'repair')",
        [fundingProduct, repairProduct]);
      await db.query(
        "INSERT INTO sales(id,org_id,client_id,status,product_id) VALUES ($1,$2,$3,'active',$4),($5,$6,$7,'active',$4),($8,$2,$3,'active',$9)",
        [fundingSale, org, client, fundingProduct, otherSale, otherOrg, otherClient, repairSale, repairProduct]);
      const read = () => purchasedCategories(db, org, client);
      assert.equal((await read()).funding, false, "signed but unpaid funding must not qualify");
      await db.query("INSERT INTO sale_payments(org_id,sale_id,kind,amount) VALUES ($1,$2,'deposit',300000)", [org, fundingSale]);
      assert.equal((await read()).funding, true, "actual funding deposit enables the override");
      assert.equal((await purchasedCategories(db, otherOrg, client)).funding, false, "foreign org must not qualify");
      await db.query("INSERT INTO sale_payments(org_id,sale_id,kind,amount) VALUES ($1,$2,'refund',300000)", [org, fundingSale]);
      assert.equal((await read()).funding, false, "fully refunded same sale cannot qualify");
      await db.query("INSERT INTO sale_payments(org_id,sale_id,kind,amount) VALUES ($1,$2,'installment',5000)", [org, fundingSale]);
      assert.equal((await read()).funding, true, "net-positive partially refunded same sale remains paid");
      await db.query("UPDATE sales SET status='cancelled' WHERE id=$1", [fundingSale]);
      assert.equal((await read()).funding, false, "cancelled sale cannot authorize funding execution");
      await db.query("INSERT INTO sale_payments(org_id,sale_id,kind,amount) VALUES ($1,$2,'deposit',20000)", [org, repairSale]);
      assert.deepEqual(await read(), { funding: false, repair: true, categories: ["repair"] },
        "paid repair must not authorize funding no-path review");
    } finally {
      await db.query("ROLLBACK").catch(() => {});
      db.release();
      await pool.end();
    }
  });
