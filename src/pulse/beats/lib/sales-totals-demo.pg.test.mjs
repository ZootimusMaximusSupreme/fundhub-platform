// SELECT-only Postgres proof: CTE rows shadow real tables, no live DB mutations.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { FLOOR_CASH_SQL, FLOOR_BOOKED_SQL, FLOOR_OUTCOMES_SQL,
         DEPOSIT_TO_FUNDED_SQL, depositToFundedSql } from "./sales-totals-truth.mjs";

const HAS_CI_DB = process.env.CI === "true" && Boolean(process.env.DATABASE_URL);
const ORG = "00000000-0000-0000-0000-0000000000a1";
const STAFF = "00000000-0000-0000-0000-0000000000c1";
const args = [ORG, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"];

// No INSERT, no test rows in production. All SQL queries below read only
// these temporary CTE fixtures, not actual clients, outcomes or events.
const fixtures = `
WITH clients(id, org_id, is_demo, funded) AS (
  VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-0000000000a1'::uuid,false,false),
  ('00000000-0000-0000-0000-000000000002'::uuid,'00000000-0000-0000-0000-0000000000a1'::uuid,true,false),
  ('00000000-0000-0000-0000-000000000003'::uuid,'00000000-0000-0000-0000-0000000000a1'::uuid,false,true),
  ('00000000-0000-0000-0000-000000000004'::uuid,'00000000-0000-0000-0000-0000000000b1'::uuid,false,true)
),
call_outcomes(org_id, client_id, staff_id, is_demo, logged_at, outcome, transaction_id, cash_collected_cents) AS (
  VALUES
  ('00000000-0000-0000-0000-0000000000a1'::uuid,'00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-0000000000c1'::uuid,false,'2026-10-27T12:00:00Z'::timestamptz,'deposit'::text,'00000000-0000-0000-0000-0000000000d1'::uuid,10000::bigint),
  ('00000000-0000-0000-0000-0000000000a1'::uuid,'00000000-0000-0000-0000-000000000003'::uuid,'00000000-0000-0000-0000-0000000000c2'::uuid,false,'2026-10-27T12:00:00Z'::timestamptz,'deposit'::text,'00000000-0000-0000-0000-0000000000d2'::uuid,5000::bigint),
  ('00000000-0000-0000-0000-0000000000a1'::uuid,'00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-0000000000c1'::uuid,true,'2026-10-27T12:00:00Z'::timestamptz,'deposit'::text,'00000000-0000-0000-0000-0000000000d3'::uuid,900000::bigint),
  ('00000000-0000-0000-0000-0000000000a1'::uuid,'00000000-0000-0000-0000-000000000002'::uuid,'00000000-0000-0000-0000-0000000000c1'::uuid,false,'2026-10-27T12:00:00Z'::timestamptz,'deposit'::text,'00000000-0000-0000-0000-0000000000d4'::uuid,800000::bigint),
  ('00000000-0000-0000-0000-0000000000b1'::uuid,'00000000-0000-0000-0000-000000000004'::uuid,'00000000-0000-0000-0000-0000000000c1'::uuid,false,'2026-10-27T12:00:00Z'::timestamptz,'deposit'::text,'00000000-0000-0000-0000-0000000000d5'::uuid,700000::bigint),
  ('00000000-0000-0000-0000-0000000000a1'::uuid,'00000000-0000-0000-0000-000000000004'::uuid,'00000000-0000-0000-0000-0000000000c1'::uuid,false,'2026-10-27T12:00:00Z'::timestamptz,'deposit'::text,'00000000-0000-0000-0000-0000000000d6'::uuid,600000::bigint)
),
events(org_id, client_id, name, created_at, payload) AS (
  VALUES
  ('00000000-0000-0000-0000-0000000000a1'::uuid,'00000000-0000-0000-0000-000000000001'::uuid,'booking.created'::text,'2026-10-27T12:00:00Z'::timestamptz,'{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a1'::uuid,'00000000-0000-0000-0000-000000000002'::uuid,'booking.created'::text,'2026-10-27T12:00:00Z'::timestamptz,'{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a1'::uuid,'00000000-0000-0000-0000-000000000003'::uuid,'booking.created'::text,'2026-10-27T12:00:00Z'::timestamptz,'{"simulated":true}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a1'::uuid,'00000000-0000-0000-0000-000000000003'::uuid,'booking.created'::text,'2026-10-27T12:00:00Z'::timestamptz,'{"environment":"simulated"}'::jsonb),
  ('00000000-0000-0000-0000-0000000000b1'::uuid,'00000000-0000-0000-0000-000000000004'::uuid,'booking.created'::text,'2026-10-27T12:00:00Z'::timestamptz,'{}'::jsonb)
),
funding_rounds(id, client_id, org_id) AS (SELECT null::uuid, null::uuid, null::uuid WHERE false),
funding_closeout(funding_round_id) AS (SELECT null::uuid WHERE false)
`;

test("real Postgres read-only: demo, foreign-tenant and simulated rows do not count as paid Sales Floor activity", {
  skip: !HAS_CI_DB ? "requires CI Postgres" : false
}, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const query = (sql, params = args) => client.query(fixtures + sql, params);
    const [cash, outcomes, booked, funded, staffFunded] = await Promise.all([
      query(FLOOR_CASH_SQL),
      query(FLOOR_OUTCOMES_SQL),
      query(FLOOR_BOOKED_SQL),
      query(DEPOSIT_TO_FUNDED_SQL),
      query(depositToFundedSql("AND o.staff_id = $4"), [...args, STAFF])
    ]);
    assert.equal(Number(cash.rows[0].cents), 15000);
    assert.equal(Number(outcomes.rows[0].held), 2);
    assert.equal(Number(outcomes.rows[0].deposits), 2);
    assert.equal(Number(outcomes.rows[0].downsells), 0);
    assert.equal(Number(booked.rows[0].n), 1);
    assert.equal(Number(funded.rows[0].deposits), 2);
    assert.equal(Number(funded.rows[0].funded), 1);
    assert.equal(Number(staffFunded.rows[0].deposits), 1);
    assert.equal(Number(staffFunded.rows[0].funded), 0);
  } finally {
    await client.end();
  }
});
