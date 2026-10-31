// Exact stale-clear / re-claim interleave. Disposable GitHub CI Postgres ONLY.
// No production data, PostGrid, SMS, credit, payment, or actual mail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { clearStuckSendClaim } from "./send.mjs";

const url = process.env.DATABASE_URL || "";
const scratch = (() => {
  if (process.env.CI !== "true" || !url) return false;
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)
      && parsed.pathname === "/fundhub_ci";
  } catch { return false; }
})();

test("stale repair-mail reconcile read cannot clear a newer active send claim",
  { skip: !scratch ? "requires CI disposable Postgres /fundhub_ci" : false },
  async () => {
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    let connection;
    try {
      connection = await pool.connect();
      await connection.query("BEGIN");
      await connection.query(`CREATE TEMP TABLE dispute_letters (
        id uuid PRIMARY KEY, org_id uuid NOT NULL, client_id uuid NOT NULL,
        case_id uuid, status text NOT NULL, mailed_at timestamptz,
        send_claimed_at timestamptz, postgrid_letter_id text,
        send_claim_cleared_at timestamptz, send_claim_cleared_by uuid,
        send_claim_cleared_reason text
      ) ON COMMIT DROP`);
      await connection.query(`CREATE TEMP TABLE repair_decision_log (
        org_id uuid, client_id uuid, case_id uuid, decision text, payload jsonb
      ) ON COMMIT DROP`);
      const orgId = randomUUID();
      const clientId = randomUUID();
      const letterId = randomUUID();
      const staffId = randomUUID();
      await connection.query(`INSERT INTO dispute_letters
        (id, org_id, client_id, status, send_claimed_at)
        VALUES ($1, $2, $3, 'sending', clock_timestamp() - interval '1 hour')`,
        [letterId, orgId, clientId]);
      const old = (await connection.query(`SELECT send_claimed_at::text AS token
        FROM dispute_letters WHERE id = $1`, [letterId])).rows[0].token;

      let interleaved = false;
      const staleReader = {
        query: async (sql, params = []) => {
          const result = await connection.query(sql, params);
          if (!interleaved && /SELECT id, client_id, case_id, status, mailed_at, send_claimed_at/.test(String(sql))) {
            interleaved = true;
            // Staff B releases the OLD unknown send after checking provider.
            await connection.query(`UPDATE dispute_letters SET status='ready',
              send_claimed_at=NULL WHERE id=$1 AND org_id=$2`, [letterId, orgId]);
            // A different send request now legitimately owns a NEW claim.
            await connection.query(`UPDATE dispute_letters SET status='sending',
              send_claimed_at=clock_timestamp() WHERE id=$1 AND org_id=$2`, [letterId, orgId]);
          }
          return result;
        }
      };
      const stale = await clearStuckSendClaim(staleReader, {
        orgId, letterId, staffId, reason: "synthetic provider reconciliation", minAgeMinutes: 0
      });
      assert.equal(interleaved, true, "the old snapshot was genuinely read");
      assert.equal(stale.ok, false, "the stale actor must not release the newer attempt");
      assert.equal(stale.reason, "not_claimed");
      let state = (await connection.query(`SELECT status, send_claimed_at,
        send_claimed_at::text AS token, mailed_at FROM dispute_letters WHERE id=$1`,
        [letterId])).rows[0];
      assert.equal(state.status, "sending");
      assert.ok(state.send_claimed_at, "new claim remains held, so no second mail can start");
      assert.notEqual(state.token, old, "new and old claims are distinct");
      assert.equal(state.mailed_at, null, "no provider was invoked");

      const foreign = await clearStuckSendClaim(connection, {
        orgId: randomUUID(), letterId, staffId, reason: "synthetic foreign", minAgeMinutes: 0
      });
      assert.equal(foreign.reason, "not_found", "foreign organization cannot clear claim");

      // A properly scoped actor with the CURRENT token can still reconcile.
      await connection.query(`UPDATE dispute_letters SET send_claimed_at =
        clock_timestamp() - interval '1 hour' WHERE id = $1`, [letterId]);
      const valid = await clearStuckSendClaim(connection, {
        orgId, letterId, staffId, reason: "synthetic provider did not accept", minAgeMinutes: 0
      });
      assert.equal(valid.ok, true, "correct current claim can still be cleared");
      state = (await connection.query(`SELECT status, send_claimed_at,
        send_claim_cleared_by, mailed_at FROM dispute_letters WHERE id=$1`,
        [letterId])).rows[0];
      assert.equal(state.status, "ready");
      assert.equal(state.send_claimed_at, null);
      assert.equal(state.send_claim_cleared_by, staffId);
      assert.equal(state.mailed_at, null);
      assert.equal((await clearStuckSendClaim(connection, {
        orgId, letterId, staffId, reason: "replay", minAgeMinutes: 0
      })).reason, "not_claimed", "clear replay is idempotently refused");
    } finally {
      if (connection) {
        await connection.query("ROLLBACK").catch(() => {});
        connection.release();
      }
      await pool.end();
    }
  }
);
