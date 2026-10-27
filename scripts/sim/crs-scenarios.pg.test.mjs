// Scratch Postgres proof for the simulated personal + Experian Business path.
// One transaction is rolled back. We call only the two CRM handlers; emitting
// through the full bus could run C-06 and cross the fulfillment door.

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

import { isLocalScratchDatabaseUrl } from "../../src/verification/scratch-guard.mjs";
import { runCrmOnlyScenario } from "./push-credit.mjs";

const SCRATCH = isLocalScratchDatabaseUrl(process.env.DATABASE_URL);
test("scratch CRS save and CRM handler path keeps fundable and repair decisions distinct", {
  skip: SCRATCH ? false : "local scratch DATABASE_URL required; no production connection permitted"
}, async () => {
  // Check again at execution so changing DATABASE_URL after module import cannot
  // open a production connection. The client never escapes this transaction.
  assert.equal(isLocalScratchDatabaseUrl(process.env.DATABASE_URL), true);
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    const tx = { query: (...args) => c.query(...args) };
    const slug = `sim-crs-pg-${randomUUID()}`;
    const orgId = (await c.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'Simulated CRS PgTest') RETURNING id`, [slug]
    )).rows[0].id;
    const pipelineId = (await c.query(
      `INSERT INTO pipelines (org_id, key, name) VALUES ($1, 'sales', 'Sales') RETURNING id`, [orgId]
    )).rows[0].id;
    const bookedId = (await c.query(
      `INSERT INTO pipeline_stages (org_id, pipeline_id, key, name, sort_order)
       VALUES ($1, $2, 'booked', 'Booked', 2) RETURNING id`, [orgId, pipelineId]
    )).rows[0].id;
    await c.query(
      `INSERT INTO pipeline_stages (org_id, pipeline_id, key, name, sort_order)
       VALUES ($1, $2, 'decision_rendered', 'Decision Rendered', 6)`, [orgId, pipelineId]
    );

    const results = [];
    for (const profile of ["fundable", "repair-full"]) {
      const email = `buyer+sim-${profile}-${randomUUID()}@example.invalid`;
      const clientId = (await c.query(
        `INSERT INTO clients (org_id, first_name, last_name, email, ghl_contact_id, is_demo)
         VALUES ($1, 'Simulated', 'Buyer', $2, NULL, false) RETURNING id`, [orgId, email]
      )).rows[0].id;
      await c.query(
        `INSERT INTO cards (org_id, client_id, pipeline_id, stage_id)
         VALUES ($1, $2, $3, $4)`, [orgId, clientId, pipelineId, bookedId]
      );
      const decision = await runCrmOnlyScenario(tx, {
        orgId, email, profileKey: profile, businessScenario: "seasoned_clean",
        databaseUrl: process.env.DATABASE_URL
      });
      assert.equal(decision.dry, false);
      assert.equal(decision.clientId, clientId);

      const saved = (await c.query(
        `SELECT c.outcome_tier, c.custom_fields, ps.key AS stage,
                r.result, (SELECT count(*)::int FROM businesses b WHERE b.client_id = c.id) AS businesses
           FROM clients c JOIN cards cd ON cd.client_id = c.id
           JOIN pipeline_stages ps ON ps.id = cd.stage_id
           JOIN crs_results r ON r.client_id = c.id
          WHERE c.id = $1`, [clientId]
      )).rows[0];
      assert.equal(saved.outcome_tier, decision.outcomeTier);
      assert.equal(Number(saved.custom_fields.total_funding_estimate), decision.fundingEstimate);
      assert.equal(Number(saved.custom_fields.analyzer_prequal_amount), decision.fundingEstimate);
      assert.equal(saved.stage, "decision_rendered");
      assert.equal(saved.businesses, 1);
      assert.equal(saved.result.simulated, true);
      assert.equal(saved.result.bureaus.EX.creditFiles[0].aliases[0].firstName, "SIMULATED");
      assert.equal(saved.result.bureaus.EX.creditFiles[0].aliases[0].lastName, "BUYER");
      assert.equal(saved.result.businessReports[0].name, "Cedar Mesa Consulting LLC");
      const savedLines = (await c.query(`SELECT count(*)::int AS n FROM tradelines WHERE client_id = $1`, [clientId])).rows[0].n;
      assert.ok(savedLines > 0, `${profile} should save normalized tradelines`);
      results.push({ profile, tier: saved.outcome_tier, estimate: decision.fundingEstimate, stage: saved.stage });
    }
    assert.notEqual(results[0].tier, results[1].tier, "personal credit changes the CRM tier");
    assert.ok(results[0].estimate > results[1].estimate, "personal credit changes the CRM amount");
    assert.deepEqual(results.map((r) => r.stage), ["decision_rendered", "decision_rendered"],
      "the current sales card stage is shared by both tiers");
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
});
