// Real Postgres SQL proof for strict explicit round selection and tenant scope.
// ONLY a local CI/scratch database is permitted. All fixture rows live in one
// transaction's temporary table and are rolled back; providers are never used.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  roundFor, guardFundedAmount, emitCardStackingRoundTransition
} from "./card-stacking-rounds.mjs";

const connectionString = process.env.DATABASE_URL;
let safe = false;
try {
  const url = new URL(connectionString);
  safe = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(url.pathname);
} catch { /* no configured nonproduction database */ }
const options = { skip: safe ? false : "requires a local CI/test/scratch Postgres; production refused" };
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

test("round 2 must not borrow round 1 or another organization's approvals (real Postgres)", options, async () => {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    // Shadow the real table in only this session. No production or permanent
    // test-schema row can be touched, even if the test throws.
    await db.query("CREATE TEMP TABLE funding_rounds AS SELECT * FROM public.funding_rounds WITH NO DATA");
    const org = randomUUID();
    const otherOrg = randomUUID();
    const client = randomUUID();
    const firstRoundId = randomUUID();
    const otherOrgRoundId = randomUUID();
    await db.query(`INSERT INTO funding_rounds (id, org_id, client_id, round_number, status)
      VALUES ($1, $2, $3, 1, 'approved'), ($4, $5, $3, 2, 'approved')`,
    [firstRoundId, org, client, otherOrgRoundId, otherOrg]);

    assert.equal((await roundFor(db, { orgId: org, clientId: client })).id, firstRoundId);
    assert.equal((await roundFor(db, { orgId: org, clientId: client, roundNumber: 1 })).id, firstRoundId);
    assert.equal((await roundFor(db, { orgId: otherOrg, clientId: client, roundNumber: 2 })).id, otherOrgRoundId);
    assert.equal(await roundFor(db, { orgId: org, clientId: client, roundNumber: 2 }), null,
      "a different organization's round 2 and this client's old round 1 are both forbidden");

    const gate = await guardFundedAmount(db, {
      orgId: org, clientId: client, roundNumber: 2, fundedAmount: 25000
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, "funding_round_not_found");

    const emitted = await emitCardStackingRoundTransition(db, {
      orgId: org, clientId: client, stageKey: "funded", roundNumber: 2, fundedAmount: 25000
    });
    assert.equal(emitted.emitted, false);
    assert.equal(emitted.reason, "funding_round_not_found");
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
