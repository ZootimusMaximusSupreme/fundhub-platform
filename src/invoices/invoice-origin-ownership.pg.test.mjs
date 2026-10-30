// A61: verify buyer, sale and round before creating a receivable.
// Disposable localhost/fundhub_ci ONLY; rollback and +tag synthetic buyers.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { createInvoice } from "./index.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(u.hostname) &&
      u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

describe("A61 invoice source ownership in disposable Postgres", {
  skip: SCRATCH ? false : "CI localhost/fundhub_ci only"
}, () => {
  let db, oa, ob, ca, ca2, cb, sa, sa2, sb, ra, ra2, rx, rb;
  const make = async ({ orgId = oa, clientId = ca, saleId = null,
    fundingRoundId = null, idempotencyKey = null } = {}) =>
    createInvoice(db, { orgId, clientId, saleId, fundingRoundId,
      idempotencyKey, source: "funding_success_fee", amount: 125 });

  before(async () => {
    db = await pool().connect();
    await db.query("BEGIN");
    const org = async suffix => (await db.query(
      "INSERT INTO orgs(slug,name) VALUES ($1,$2) RETURNING id",
      ["ci-ar-origin-" + suffix + randomUUID(), "CI AR Origin " + suffix]
    )).rows[0].id;
    oa = await org("a");
    ob = await org("b");
    const buyer = async (orgId, suffix) => (await db.query(
      "INSERT INTO clients(org_id,first_name,last_name,email) VALUES ($1,'AR','Origin',$2) RETURNING id",
      [orgId, "ar-origin+" + suffix + randomUUID() + "@example.invalid"]
    )).rows[0].id;
    ca = await buyer(oa, "a"); ca2 = await buyer(oa, "a2");
    cb = await buyer(ob, "b");
    const product = async (orgId, suffix) => (await db.query(
      "INSERT INTO products(org_id,code,name,category) VALUES ($1,$2,$3,'funding') RETURNING id",
      [orgId, "ci-ar-origin-" + suffix, "CI AR Origin " + suffix]
    )).rows[0].id;
    const pa = await product(oa, "a"), pb = await product(ob, "b");
    const sale = async (orgId, clientId, productId) => (await db.query(
      "INSERT INTO sales(org_id,client_id,product_id,agreed_price) VALUES ($1,$2,$3,1000) RETURNING id",
      [orgId, clientId, productId]
    )).rows[0].id;
    sa = await sale(oa, ca, pa); sa2 = await sale(oa, ca2, pa);
    sb = await sale(ob, cb, pb);
    const round = async (orgId, clientId, n) => (await db.query(
      "INSERT INTO funding_rounds(org_id,client_id,round_number,status) VALUES ($1,$2,$3,'started') RETURNING id",
      [orgId, clientId, n]
    )).rows[0].id;
    ra = await round(oa, ca, 1); ra2 = await round(oa, ca, 2);
    rx = await round(oa, ca2, 1); rb = await round(ob, cb, 1);
    await db.query(
      "INSERT INTO funding_round_sales(org_id,funding_round_id,sale_id,link_method) VALUES ($1,$2,$3,'explicit')",
      [oa, ra, sa]
    );
  });
  after(async () => {
    if (db) { await db.query("ROLLBACK").catch(() => {}); db.release(); }
    await close();
  });
  test("allows exact same-buyer linked fee invoice", async () => {
    const row = await make({saleId: sa,fundingRoundId: ra});
    assert.equal(row?.org_id, oa);
    assert.equal(row?.sale_id, sa);
    assert.equal(row?.funding_round_id, ra);
  });
  test("rejects a foreign org buyer", async () => {
    assert.equal(await make({clientId: cb}), null);
  });
  test("rejects foreign and wrong-buyer sale", async () => {
    assert.equal(await make({saleId: sb}), null);
    assert.equal(await make({saleId: sa2}), null);
  });
  test("rejects foreign and wrong-buyer funding round", async () => {
    assert.equal(await make({fundingRoundId: rb}), null);
    assert.equal(await make({fundingRoundId: rx}), null);
  });
  test("rejects own-buyer unlinked sale+round", async () => {
    assert.equal(await make({saleId: sa,fundingRoundId: ra2}), null);
  });
  test("allows unlinked legacy draft only without refs; duplicate key stays deduped", async () => {
    const key = "ci-ar-origin:" + randomUUID();
    assert.equal((await make({idempotencyKey: key}))?.org_id, oa);
    assert.equal(await make({idempotencyKey: key}), null);
  });
  test("none of the cross-buyer attempted invoices persisted", async () => {
    const row = (await db.query(
      `SELECT count(*)::int AS n FROM invoices WHERE org_id=$1 AND
       (client_id=$2 OR sale_id=$3 OR sale_id=$4 OR funding_round_id=$5 OR funding_round_id=$6)`,
      [oa, cb, sb, sa2, rb, rx]
    )).rows[0];
    assert.equal(row.n, 0);
  });
});
