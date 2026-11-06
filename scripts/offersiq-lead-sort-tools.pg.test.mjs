import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../src/verification/scratch-guard.mjs";
import { safeOffersIqSummary } from "../src/finance/offersiq.mjs";
import { OFFERSIQ_LEAD_SORT_CONFIG } from "../src/finance/offersiq-lead-sort-config.mjs";
import { persistOffersIqLeadSort } from "../src/finance/offersiq-lead-sort-store.mjs";
import { rescoreFinishedOffersIq, reevaluateFinishedOffersIq } from "./offersiq-lead-sort-tools.mjs";

const connectionString = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

function testConfig(version) {
  const config = structuredClone(OFFERSIQ_LEAD_SORT_CONFIG);
  config.version = version;
  for (const [index, fact] of config.facts.entries()) {
    if (fact.enabled !== false) fact.attributeCode ||= `TEST_ATTRIBUTE_${index}`;
  }
  return config;
}

function decisionFor(config, score) {
  const conditions = config.facts.filter(fact => fact.enabled !== false).flatMap(fact => {
    const chosen = fact.key === "creditScore" ? `score_${score}` : fact.ranges[0].id;
    return fact.ranges.map(range => ({ attributeCode: fact.attributeCode,
      attributeName: fact.attributeName, operator: range.operator, expectedValue: range.expectedValue,
      status: range.id === chosen ? "PASSED" : "FAILED", passed: range.id === chosen }));
  });
  const counts = { totalConditions: conditions.length,
    passedConditions: conditions.filter(row => row.passed).length,
    failedConditions: conditions.filter(row => !row.passed).length, unverifiableConditions: 0 };
  return { outcome: "matched", requestId: randomUUID(), ruleSetId: 1232,
    decisionStatus: "APPROVED", overallDecision: true,
    ruleEvaluation: { ruleSetId: 1232, ...counts, individualResults: conditions,
      rootGroup: { operator: "OR", passed: true, status: "PASSED", ...counts, conditions, groups: [] } } };
}

test("operator tools rescore every scratch row and free-rerun receipts without changing paid checks or setter cache", {
  skip: !isLocalScratchDatabaseUrl(connectionString)
}, async () => {
  const pool = new pg.Pool({ connectionString });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const role = (await db.query("SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.equal(role.current_user, "fundhub_app");
    assert.equal(role.rolsuper || role.rolbypassrls, false);
    const orgId = (await db.query("INSERT INTO orgs(slug,name) VALUES($1,'Synthetic tools') RETURNING id", [`offersiq-tools-${randomUUID()}`])).rows[0].id;
    const staffId = (await db.query("INSERT INTO staff(org_id,name,role,status) VALUES($1,'Synthetic setter','setter','active') RETURNING id", [orgId])).rows[0].id;
    const config = testConfig("tools-pg-v1");
    const clientIds = [];
    const rows = [];
    const cache = { offersiq: { outcome: "matched", marker: "original" }, keep: true };
    for (let index = 0; index < 5; index++) {
      const clientId = (await db.query("INSERT INTO clients(org_id,first_name,last_name,is_demo,custom_fields) VALUES($1,'Synthetic','Tools',true,$2::jsonb) RETURNING id", [orgId, JSON.stringify(cache)])).rows[0].id;
      clientIds.push(clientId);
      const decision = decisionFor(config, 700);
      const summary = safeOffersIqSummary(decision, { ruleSetId: 1232, environment: "sandbox",
        fingerprint: "a".repeat(64), checkedAt: "2026-11-06T18:00:00Z" });
      const row = (await db.query(`INSERT INTO offersiq_requests(org_id,client_id,requester_staff_id,
        operation_id,rule_set_id,environment,identity_fingerprint,identity_source,address_confirmed_at,
        consent_terms_url,consent_version,consent_accepted_at,status,normalized_response,provider_request_id,finished_at)
        VALUES($1,$2,$3,$4,1232,'sandbox',$5,'setter_confirmed',now(),'https://example.test/terms','synthetic',now(),
        'matched',$6::jsonb,$7,now()) RETURNING id, provider_request_id`, [orgId, clientId, staffId,
        randomUUID(), summary.identity_fingerprint, JSON.stringify(summary), summary.request_id])).rows[0];
      rows.push({ ...row, summary });
    }
    const options = { db, orgId, pageSize: 2, config, persist: persistOffersIqLeadSort };
    const preview = await rescoreFinishedOffersIq(options);
    assert.equal(preview.scanned, 5);
    assert.equal(preview.written, 0);
    assert.equal(preview.buckets.blueprint, 5);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM offersiq_requests WHERE org_id=$1 AND lead_sort_bucket IS NOT NULL", [orgId])).rows[0].n), 0);
    const applied = await rescoreFinishedOffersIq({ ...options, apply: true });
    assert.equal(applied.written, 5);
    const originalPoints = (await db.query("SELECT lead_sort_points FROM offersiq_requests WHERE org_id=$1 LIMIT 1", [orgId])).rows[0].lead_sort_points;
    const changedConfig = testConfig("tools-pg-v2");
    changedConfig.points.blueprint[0].maximum = 0;
    await rescoreFinishedOffersIq({ ...options, config: changedConfig, apply: true });
    const changed = (await db.query("SELECT lead_sort_points, lead_sort_version FROM offersiq_requests WHERE org_id=$1", [orgId])).rows;
    assert.ok(changed.every(row => row.lead_sort_version === "tools-pg-v2"));
    assert.ok(changed.every(row => row.lead_sort_points < originalPoints), "lower score weight changes every row");
    const providerCalls = [];
    const rerun = await reevaluateFinishedOffersIq({ ...options, apply: true,
      loadedProofRequest: rows[0].provider_request_id, summarize: safeOffersIqSummary,
      env: { CRS_API_HOST: "api-sandbox.stitchcredit.com", CRS_API_USERNAME: "synthetic", CRS_API_PASSWORD: "synthetic" },
      createClient: () => ({ async reevaluateOffersIq(args) {
        providerCalls.push(args);
        const decision = decisionFor(config, 800);
        return { ok: true, requestId: decision.requestId, decision };
      }, evaluateOffersIq() { assert.fail("no paid replacement in free rerun"); } }) });
    assert.equal(rerun.loadedRuleListVerified, true);
    assert.equal(rerun.written, 5);
    assert.equal(providerCalls.length, 5);
    const stored = (await db.query("SELECT * FROM offersiq_requests WHERE org_id=$1", [orgId])).rows;
    for (const row of stored) {
      const before = rows.find(original => original.id === row.id);
      assert.deepEqual(row.normalized_response, before.summary);
      assert.equal(row.provider_request_id, before.provider_request_id);
      assert.equal(row.status, "matched");
      assert.equal(row.lead_sort_bucket, "super_prime");
      assert.equal(row.lead_sort_version, config.version);
      assert.notDeepEqual(row.lead_sort_receipt, before.summary);
    }
    await rescoreFinishedOffersIq({ ...options, apply: true });
    const rescored = (await db.query("SELECT lead_sort_bucket FROM offersiq_requests WHERE org_id=$1", [orgId])).rows;
    assert.ok(rescored.every(row => row.lead_sort_bucket === "super_prime"), "rescore uses the retained free receipt");
    const clients = (await db.query("SELECT custom_fields FROM clients WHERE id=ANY($1::uuid[])", [clientIds])).rows;
    assert.ok(clients.every(client => JSON.stringify(client.custom_fields) === JSON.stringify(clients[0].custom_fields)));
    assert.deepEqual(clients[0].custom_fields, cache);
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    db.release();
    await pool.end();
  }
});

test("rescore stores Can't tell for legacy SQL-null and malformed receipts without fabricating provider proof", {
  skip: !isLocalScratchDatabaseUrl(connectionString)
}, async () => {
  const pool = new pg.Pool({ connectionString });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const role = (await db.query("SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.equal(role.current_user, "fundhub_app");
    assert.equal(role.rolsuper || role.rolbypassrls, false);
    const orgId = (await db.query("INSERT INTO orgs(slug,name) VALUES($1,'Synthetic legacy tools') RETURNING id", [`offersiq-legacy-${randomUUID()}`])).rows[0].id;
    const staffId = (await db.query("INSERT INTO staff(org_id,name,role,status) VALUES($1,'Synthetic setter','setter','active') RETURNING id", [orgId])).rows[0].id;
    for (const receipt of [null, false]) {
      const clientId = (await db.query("INSERT INTO clients(org_id,first_name,last_name,is_demo,custom_fields) VALUES($1,'Synthetic','Legacy',true,'{}'::jsonb) RETURNING id", [orgId])).rows[0].id;
      await db.query(`INSERT INTO offersiq_requests(org_id,client_id,requester_staff_id,operation_id,
        rule_set_id,environment,identity_fingerprint,identity_source,address_confirmed_at,
        consent_terms_url,consent_version,consent_accepted_at,status,normalized_response,finished_at)
        VALUES($1,$2,$3,$4,1232,'sandbox',$5,'setter_confirmed',now(),'https://example.test/terms','synthetic',now(),
        'error',$6::jsonb,now())`, [orgId, clientId, staffId, randomUUID(), "b".repeat(64),
        receipt === null ? null : JSON.stringify(receipt)]);
    }
    const result = await rescoreFinishedOffersIq({ db, orgId, pageSize: 1, apply: true, persist: persistOffersIqLeadSort });
    assert.equal(result.written, 2);
    assert.equal(result.buckets.can_not_tell, 2);
    const stored = (await db.query("SELECT * FROM offersiq_requests WHERE org_id=$1 ORDER BY normalized_response NULLS FIRST", [orgId])).rows;
    assert.deepEqual(stored.map(row => row.normalized_response), [null, false]);
    assert.ok(stored.every(row => row.lead_sort_bucket === "can_not_tell" && row.lead_sort_points === 0
      && row.provider_request_id === null && row.lead_sort_receipt === null && row.status === "error"));
    const summary = { outcome: "error", rule_set_id: 1232, environment: "sandbox",
      identity_fingerprint: "b".repeat(64), request_id: null, checked_at: new Date().toISOString() };
    await assert.rejects(persistOffersIqLeadSort(db, stored[1].id, orgId, summary,
      { expectedSourceReceipt: null }), /changed_or_missing/, "SQL-null guard must reject a now-nonnull source");
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    db.release();
    await pool.end();
  }
});
