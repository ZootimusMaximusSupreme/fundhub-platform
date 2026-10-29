// Fulfillment A50: disposable CI Postgres. All test rows live in TEMP shadow
// tables inside ROLLBACK; hard-gated to local fundhub_ci, never Supabase.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { findRoundForFundedEvent, onRoundFundedMoney } from "./money-chain.mjs";

const LOCAL = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

describe("round.funded exact owned round — disposable PostgreSQL", { skip: !LOCAL }, () => {
  let conn, db, orgA, orgB, buyerA, buyerB, roundA, roundB;
  before(async () => {
    conn = await pool().connect();
    await conn.query("BEGIN");
    await conn.query("CREATE TEMP TABLE clients (LIKE public.clients INCLUDING ALL) ON COMMIT DROP");
    await conn.query("CREATE TEMP TABLE funding_rounds (LIKE public.funding_rounds INCLUDING ALL) ON COMMIT DROP");
    db = { query:(...args)=>conn.query(...args) };
    [orgA,orgB]=[randomUUID(),randomUUID()];
    const insertBuyer=async (org,email) => (await db.query(
      "INSERT INTO clients (org_id,first_name,email) VALUES ($1,'Synthetic',$2) RETURNING id",
      [org,email]
    )).rows[0].id;
    buyerA=await insertBuyer(orgA,`funded-owner+${randomUUID()}@example.invalid`);
    buyerB=await insertBuyer(orgA,`funded-other+${randomUUID()}@example.invalid`);
    const insertRound=async (org,client,n) => (await db.query(
      "INSERT INTO funding_rounds (org_id,client_id,round_number,status,product) VALUES ($1,$2,$3,'approved','alt_fin') RETURNING id",
      [org,client,n]
    )).rows[0].id;
    roundA=await insertRound(orgA,buyerA,1);
    roundB=await insertRound(orgA,buyerB,1);
  });
  after(async () => {
    if (conn) { await conn.query("ROLLBACK").catch(()=>{}); conn.release(); }
    await close();
  });
  const evt=(org,client,payload)=>({name:"round.funded",id:randomUUID(),orgId:org,clientId:client,payload});
  test("foreign org, wrong buyer, stale round number and unknown IDs refuse without writes", async () => {
    const fixtures=[
      evt(orgB,buyerA,{fundingRoundId:roundA,fundedAmount:30000}),
      evt(orgA,buyerB,{fundingRoundId:roundA,fundedAmount:30000}),
      evt(orgA,buyerA,{fundingRoundId:roundA,roundNumber:2,fundedAmount:30000}),
      evt(orgA,buyerA,{fundingRoundId:randomUUID(),roundNumber:1,fundedAmount:30000}),
      evt(orgA,buyerA,{fundedAmount:30000})
    ];
    for(const input of fixtures) {
      const out=await onRoundFundedMoney(input,db);
      assert.equal(out.done,false,`unexpected success ${JSON.stringify(input)}`);
      assert.equal(out.reason,"no_prior_round");
    }
    const rows=(await db.query("SELECT id,status,funded_amount FROM funding_rounds ORDER BY id")).rows;
    assert.equal(rows.length,2);
    assert.ok(rows.every(r=>r.status==="approved" && r.funded_amount===null));
  });
  test("legitimate same-org paths bind exact round and never steal the other buyer", async () => {
    const byId=await findRoundForFundedEvent(db,evt(orgA,buyerA,{fundingRoundId:roundA,roundNumber:1}));
    assert.equal(byId.id,roundA);
    const byNumber=await findRoundForFundedEvent(db,evt(orgA,buyerB,{roundNumber:1}));
    assert.equal(byNumber.id,roundB);
    assert.equal(await findRoundForFundedEvent(db,evt(orgA,buyerA,{roundNumber:2})),null);
    assert.equal(await findRoundForFundedEvent(db,evt(orgB,buyerA,{roundNumber:1})),null);
  });
});
