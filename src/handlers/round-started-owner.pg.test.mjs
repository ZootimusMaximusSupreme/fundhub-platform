// F-00/F-07 disposable PostgreSQL ownership proof: TEMP shadow tables + ROLLBACK only.
// Never run against production: CI=true + exact local host /fundhub_ci required.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { ensureFundingRound, ensureFundingRoundSaleLink } from "./money-chain.mjs";

const LOCAL = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();
describe("round.started belongs to exact org and client — disposable PostgreSQL",
  { skip: !LOCAL }, () => {
  let conn, db, orgA, orgB, buyerA, buyerB, buyerC, roundA, roundB, originalEventId;
  before(async () => {
    conn = await pool().connect();
    await conn.query("BEGIN");
    await conn.query("CREATE TEMP TABLE clients (LIKE public.clients INCLUDING ALL) ON COMMIT DROP");
    await conn.query("CREATE TEMP TABLE funding_rounds (LIKE public.funding_rounds INCLUDING ALL) ON COMMIT DROP");
    db = { query: (...args) => conn.query(...args) };
    [orgA, orgB] = [randomUUID(), randomUUID()];
    const buyer = async (org) => (await db.query(
      "INSERT INTO clients (org_id,first_name,email,ghl_contact_id,is_demo) VALUES ($1,'Synthetic',$2,'synthetic-ghl',true) RETURNING id",
      [org, `round-started-${randomUUID()}@example.invalid`]
    )).rows[0].id;
    buyerA = await buyer(orgA); buyerB = await buyer(orgA); buyerC = await buyer(orgB);
    originalEventId = randomUUID();
    roundA = (await db.query(
      "INSERT INTO funding_rounds (org_id,client_id,round_number,status,product,source_event_id) VALUES ($1,$2,1,'started','card_stacking',$3) RETURNING id",
      [orgA, buyerA, originalEventId]
    )).rows[0].id;
    roundB = (await db.query(
      "INSERT INTO funding_rounds (org_id,client_id,round_number,status,product) VALUES ($1,$2,1,'started','card_stacking') RETURNING id",
      [orgA, buyerB]
    )).rows[0].id;
  });
  after(async () => {
    if (conn) { await conn.query("ROLLBACK").catch(() => {}); conn.release(); }
    await close();
  });
  const evt = (orgId, clientId, payload = {}, id = randomUUID()) =>
    ({ name: "round.started", id, orgId, clientId, payload });

  test("foreign, wrong-client, and stale exact references refuse with no changed rounds", async () => {
    const fixtures = [
      evt(orgB, buyerC, { fundingRoundId: roundA }),
      evt(orgA, buyerB, { fundingRoundId: roundA }),
      evt(orgA, buyerA, { fundingRoundId: randomUUID(), roundNumber: 1 }),
      evt(orgA, buyerA, { roundNumber: 0 }),
      evt(orgA, buyerA, { roundNumber: 1.25 })
    ];
    for (const fixture of fixtures) {
      const out = await ensureFundingRound(db, fixture);
      assert.equal(out.round, null, "foreign or malformed event must not return a round");
    }
    const got = (await db.query("SELECT id,org_id,client_id,status FROM funding_rounds ORDER BY id")).rows;
    assert.equal(got.length, 2);
    assert.ok(got.every(r => r.status === "started"));
  });
  test("owned round, correct numeric fallback, and another buyer's reused event ID stay scoped", async () => {
    const a = await ensureFundingRound(db, evt(orgA, buyerA, { fundingRoundId: roundA }));
    const b = await ensureFundingRound(db, evt(orgA, buyerA, { roundNumber: 1 }));
    const other = await ensureFundingRound(db, evt(orgA, buyerB, { roundNumber: 1 }, originalEventId));
    assert.equal(a.round?.id, roundA);
    assert.equal(b.round?.id, roundA);
    assert.equal(other.round?.id, roundB);
  });

  test("explicit sale link belongs to buyer and org, replay returns original sale — disposable PG", async () => {
    await db.query("CREATE TEMP TABLE products (id uuid PRIMARY KEY, org_id uuid, category text) ON COMMIT DROP");
    await db.query("CREATE TEMP TABLE sales (id uuid PRIMARY KEY, org_id uuid, client_id uuid, product_id uuid, status text) ON COMMIT DROP");
    await db.query("CREATE TEMP TABLE funding_round_sales (org_id uuid, funding_round_id uuid UNIQUE, sale_id uuid, link_method text) ON COMMIT DROP");
    const [fundingProduct, foreignProduct, repairProduct, ownSale, wrongBuyerSale, foreignSale, repairSale] =
      Array.from({ length: 7 }, () => randomUUID());
    await db.query(
      "INSERT INTO products(id,org_id,category) VALUES ($1,$4,'funding'),($2,$5,'funding'),($3,$4,'repair')",
      [fundingProduct, foreignProduct, repairProduct, orgA, orgB]
    );
    await db.query(
      "INSERT INTO sales(id,org_id,client_id,product_id,status) VALUES ($1,$5,$6,$8,'active'),($2,$5,$7,$8,'active'),($3,$9,$10,$11,'active'),($4,$5,$6,$12,'active')",
      [ownSale, wrongBuyerSale, foreignSale, repairSale, orgA, buyerA, buyerB,
        fundingProduct, orgB, buyerC, foreignProduct, repairProduct]
    );
    const args = { orgId: orgA, clientId: buyerA, roundId: roundA };
    for (const explicitSaleId of [wrongBuyerSale, foreignSale, repairSale]) {
      assert.equal(await ensureFundingRoundSaleLink(db, { ...args, explicitSaleId }), null);
    }
    assert.equal((await db.query("SELECT count(*)::int AS n FROM funding_round_sales")).rows[0].n, 0);
    assert.equal(await ensureFundingRoundSaleLink(db, { ...args, explicitSaleId: ownSale }), ownSale);
    assert.equal(await ensureFundingRoundSaleLink(db, { ...args, explicitSaleId: wrongBuyerSale }), ownSale);
    const rows = (await db.query("SELECT org_id, funding_round_id, sale_id FROM funding_round_sales")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].org_id, orgA);
    assert.equal(rows[0].funding_round_id, roundA);
    assert.equal(rows[0].sale_id, ownSale);
  });

});
