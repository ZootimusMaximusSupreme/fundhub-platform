// F-03 current card-stacking submission gate with disposable real SQL.
// CI LOCAL TEST DB ONLY; TEMP tables inside transaction, always rolled back.
// No production records, live provider delivery, or external side effects.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { currentSubmittedCardStackingRound } from "./f-03-round-submitted.mjs";

const connectionString = process.env.DATABASE_URL;
let safe = false;
try {
  const url = new URL(connectionString);
  safe = ["localhost", "127.0.0.1", "::1", "[::1"].includes(url.hostname)
    && /(?:test|scratch|_ci)(?:$|_)/i.test(url.pathname);
} catch { /* Do not connect to unverified/prod database. */ }
const options = { skip: safe ? false : "local CI/test/scratch PostgreSQL only; production refused" };
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

test("F-03 real PostgreSQL: current-only round submission, stage and tenant gates, replay", options, async () => {
  const conn = await pool.connect();
  const orgA = randomUUID(), orgB = randomUUID();
  const clientA = randomUUID(), clientB = randomUUID();
  const pipelineA = randomUUID(), pipelineB = randomUUID();
  const submittedStageA = randomUUID(), approvedStageA = randomUUID(), submittedStageB = randomUUID();
  const gate = (roundNumber = 1, clientId = clientA, orgId = orgA, rail = "card_stacking") =>
    currentSubmittedCardStackingRound(conn, {
      orgId, clientId, payload: { rail, source: rail, roundNumber }
    });
  try {
    await conn.query("BEGIN");
    // TEMP tables shadow production names in this connection. ROLLBACK means
    // no fixtures persist after the test.
    await conn.query("CREATE TEMP TABLE funding_rounds (org_id uuid, client_id uuid, round_number integer, status text) ON COMMIT DROP");
    await conn.query("CREATE TEMP TABLE pipelines (id uuid, org_id uuid, key text) ON COMMIT DROP");
    await conn.query("CREATE TEMP TABLE pipeline_stages (id uuid, org_id uuid, pipeline_id uuid, key text) ON COMMIT DROP");
    await conn.query("CREATE TEMP TABLE cards (org_id uuid, client_id uuid, pipeline_id uuid, stage_id uuid) ON COMMIT DROP");

    await conn.query(
      "INSERT INTO pipelines (id, org_id, key) VALUES ($1,$2,'funding_card_stacking'),($3,$4,'funding_card_stacking')",
      [pipelineA, orgA, pipelineB, orgB]
    );
    await conn.query(
      "INSERT INTO pipeline_stages (id,org_id,pipeline_id,key) VALUES ($1,$2,$3,'round_submitted'),($4,$2,$3,'approved'),($5,$6,$7,'round_submitted')",
      [submittedStageA, orgA, pipelineA, approvedStageA, submittedStageB, orgB, pipelineB]
    );
    await conn.query(
      "INSERT INTO cards(org_id,client_id,pipeline_id,stage_id) VALUES ($1,$2,$3,$4),($5,$2,$6,$7)",
      [orgA, clientA, pipelineA, submittedStageA, orgB, pipelineB, submittedStageB]
    );
    await conn.query(
      "INSERT INTO funding_rounds(org_id,client_id,round_number,status) VALUES ($1,$2,1,'started'),($3,$2,8,'started'),($3,$4,1,'started')",
      [orgA, clientA, orgB, clientB]
    );

    const before = (await conn.query("SELECT COUNT(*)::int AS count FROM cards")).rows[0].count;
    assert.deepEqual(await gate(1), { ok: true, legacyUnverified: false });
    assert.deepEqual(await gate(1), { ok: true, legacyUnverified: false });
    assert.equal((await conn.query("SELECT COUNT(*)::int AS count FROM cards")).rows[0].count, before);

    // Other org round #8 MUST NOT influence this tenant's current round.
    assert.deepEqual(await gate(8), { ok: false, reason: "stale_round_submission" });
    assert.deepEqual(await gate(1, clientB), { ok: false, reason: "funding_round_not_found" });

    // A second round makes a late notice for round 1 stale.
    await conn.query(
      "INSERT INTO funding_rounds(org_id,client_id,round_number,status) VALUES ($1,$2,2,'started')", [orgA, clientA]
    );
    assert.deepEqual(await gate(1), { ok: false, reason: "stale_round_submission" });
    assert.deepEqual(await gate(2), { ok: true, legacyUnverified: false });
    await conn.query("DELETE FROM funding_rounds WHERE org_id=$1 AND round_number=2", [orgA]);

    for (const status of ["funded", "closed", "completed", "cancelled", "canceled"]) {
      await conn.query(
        "UPDATE funding_rounds SET status=$1 WHERE org_id=$2 AND client_id=$3", [status, orgA, clientA]
      );
      assert.deepEqual(await gate(1), { ok: false, reason: "round_terminal" }, status);
    }
    await conn.query(
      "UPDATE funding_rounds SET status='started' WHERE org_id=$1 AND client_id=$2", [orgA, clientA]
    );

    // Card has already moved on, or no longer exists: no stale submission.
    await conn.query(
      "UPDATE cards SET stage_id=$1 WHERE org_id=$2 AND client_id=$3", [approvedStageA, orgA, clientA]
    );
    assert.deepEqual(await gate(1), { ok: false, reason: "card_not_submitted" });
    await conn.query("DELETE FROM cards WHERE org_id=$1 AND client_id=$2", [orgA, clientA]);
    assert.deepEqual(await gate(1), { ok: false, reason: "card_not_submitted" });

    // Preserve historical legacy-provider path, without inventing receipts.
    assert.deepEqual(await gate(42, clientA, orgA, "legacy_provider"),
      { ok: true, legacyUnverified: true });
  } finally {
    await conn.query("ROLLBACK");
    conn.release();
  }
});
