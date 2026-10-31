// F-04 card-stacking approval notice guard: real disposable CI PostgreSQL only.
// TEMP rows in a single rollback transaction; no live messages, cards or customers.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { approvedCardStackingRound } from "./f-05-inquiry-cleanup-gate.mjs";

const safe = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname) &&
      u.pathname === "/fundhub_ci";
  } catch { return false; }
})();
const pool = safe ? new pg.Pool({ connectionString: process.env.DATABASE_URL,
  max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

test("F-04 notice gate only accepts the same-tenant current nonterminal card-stacking round (real PG)",
  { skip: !safe }, async () => {
    const conn = await pool.connect();
    const org = randomUUID(), otherOrg = randomUUID();
    const client = randomUUID(), otherClient = randomUUID();
    const check = (roundNumber, overrides = {}) => approvedCardStackingRound(conn, {
      orgId: org, clientId: client,
      payload: { rail: "card_stacking", roundNumber, ...overrides }
    });
    try {
      await conn.query("BEGIN");
      await conn.query(`CREATE TEMP TABLE funding_rounds (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL,
        client_id uuid NOT NULL,
        round_number integer NOT NULL,
        status text NOT NULL
      ) ON COMMIT DROP`);
      await conn.query(`INSERT INTO funding_rounds(org_id,client_id,round_number,status)
        VALUES ($1,$2,1,'approved'),($1,$2,2,'approved'),
               ($3,$2,3,'approved'),($1,$4,4,'approved')`,
        [org, client, otherOrg, otherClient]);
      assert.deepEqual(await check(1), { ok: false, reason: "stale_round_approval" });
      assert.deepEqual(await check(2), { ok: true });
      assert.deepEqual(await check(3), { ok: false, reason: "stale_round_approval" },
        "foreign org round cannot become the customer's current round");
      assert.deepEqual(await check(null), { ok: false, reason: "invalid_round_number" });
      for (const status of ["funded", "closed", "completed", "cancelled", "canceled"]) {
        await conn.query("UPDATE funding_rounds SET status=$1 WHERE org_id=$2 AND client_id=$3 AND round_number=2",
          [status, org, client]);
        assert.deepEqual(await check(2), { ok: false, reason: "round_terminal" }, status);
      }
      await conn.query("DELETE FROM funding_rounds WHERE org_id=$1 AND client_id=$2", [org, client]);
      assert.deepEqual(await check(2), { ok: false, reason: "funding_round_not_found" });
    } finally {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
    }
  });
