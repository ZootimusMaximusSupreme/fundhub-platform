// Scratch Postgres proof for the simulated personal + Experian Business path.
// One transaction is rolled back. We call only the two CRM handlers; emitting
// through the full bus could run C-06 and cross the fulfillment door.

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

import { isLocalScratchDatabaseUrl } from "../../src/verification/scratch-guard.mjs";
import { runTierEngineFromCrsResult } from "../../src/finance/crs-tier.mjs";
import { scoreBuyerTotal } from "../../src/finance/crs-pull.mjs";
import { newInquiriesFor } from "../../src/finance/crs-map.mjs";
import { ingestCrsResult } from "../../src/tradelines/store.mjs";
import { onAnalysisCompleted, onDecisionRendered } from "../../src/handlers/client-lifecycle.mjs";
import { buildScenarioPayload, saveScenarioBusinesses } from "./push-credit.mjs";

const SCRATCH = isLocalScratchDatabaseUrl(process.env.DATABASE_URL);
const IDENTITY = {
  first: "Test", middle: null, last: "Sample", dob: "1980-01-01",
  current: { line1: "100 Test Ave", city: "Denton", state: "TX", postal_code: "76205" },
  priors: [], employer: null
};

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
         VALUES ($1, 'Test', 'Sample', $2, 'sim-linked', false) RETURNING id`, [orgId, email]
      )).rows[0].id;
      await c.query(
        `INSERT INTO cards (org_id, client_id, pipeline_id, stage_id)
         VALUES ($1, $2, $3, $4)`, [orgId, clientId, pipelineId, bookedId]
      );
      const { payload, businesses } = buildScenarioPayload(profile, {
        email, name: "Test Sample", identity: IDENTITY
      }, "seasoned_clean");
      await saveScenarioBusinesses(tx, {
        orgId, clientId, businesses, email, businessScenario: "seasoned_clean",
        databaseUrl: process.env.DATABASE_URL
      });
      const { tierResult, fundingEstimate } = scoreBuyerTotal(runTierEngineFromCrsResult, payload, {
        submittedName: "Test Sample"
      });
      payload.outcome = tierResult.outcome;
      payload.preapprovals = {
        ...tierResult.preapprovals,
        totalBusiness: fundingEstimate - Number(tierResult.preapprovals.totalPersonal || 0),
        totalCombined: fundingEstimate
      };
      const crs = (await c.query(
        `INSERT INTO crs_results (org_id, client_id, result, outcome_tier, is_demo)
         VALUES ($1, $2, $3::jsonb, $4, true) RETURNING *`,
        [orgId, clientId, JSON.stringify(payload), tierResult.outcome]
      )).rows[0];
      const ingested = await ingestCrsResult(tx, crs);
      assert.ok(ingested.ingested > 0, `${profile} should save real normalized tradeline rows`);

      const base = { orgId, clientId };
      await onAnalysisCompleted({ ...base, name: "analysis.completed", payload: {
        crsResultId: crs.id, source: "crs", scores: payload.scores,
        newInquiries: newInquiriesFor(payload), outcomeTier: tierResult.outcome,
        simulated: true
      } }, tx);
      await onDecisionRendered({ ...base, name: "decision.rendered", payload: {
        crsResultId: crs.id, source: "crs", outcomeTier: tierResult.outcome,
        fundingEstimate, simulated: true
      } }, tx);

      const saved = (await c.query(
        `SELECT c.outcome_tier, c.custom_fields, ps.key AS stage,
                r.result, (SELECT count(*)::int FROM businesses b WHERE b.client_id = c.id) AS businesses
           FROM clients c JOIN cards cd ON cd.client_id = c.id
           JOIN pipeline_stages ps ON ps.id = cd.stage_id
           JOIN crs_results r ON r.client_id = c.id
          WHERE c.id = $1`, [clientId]
      )).rows[0];
      assert.equal(saved.outcome_tier, tierResult.outcome);
      assert.equal(Number(saved.custom_fields.total_funding_estimate), fundingEstimate);
      assert.equal(Number(saved.custom_fields.analyzer_prequal_amount), fundingEstimate);
      assert.equal(saved.stage, "decision_rendered");
      assert.equal(saved.businesses, 1);
      assert.equal(saved.result.simulated, true);
      assert.equal(saved.result.businessReports[0].name, businesses[0].name);
      results.push({ profile, tier: saved.outcome_tier, estimate: fundingEstimate, stage: saved.stage });
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
