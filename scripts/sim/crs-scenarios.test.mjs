import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { buildScenarioPayload, assertBusinessScenarioSafe, saveScenarioBusinesses } from "./push-credit.mjs";
import { BUSINESS_SCENARIOS, buildBusinessScenario } from "./crs-scenarios.mjs";
import { runTierEngineFromCrsResult } from "../../src/finance/crs-tier.mjs";
import { scoreBuyerTotal } from "../../src/finance/crs-pull.mjs";
import { businessScoreFromPulls } from "../../src/http/client-detail.mjs";
import { scoreCompanyReports } from "../../src/underwrite/letter-pack.mjs";
import { newInquiriesFor } from "../../src/finance/crs-map.mjs";
import { onAnalysisCompleted, onDecisionRendered } from "../../src/handlers/client-lifecycle.mjs";

const IDENTITY = {
  first: "Test", middle: null, last: "Sample", dob: "1980-01-01",
  current: { line1: "100 Test Ave", city: "Denton", state: "TX", postal_code: "76205" },
  priors: [], employer: null
};

function personalWithBusiness(key) {
  const pulledAt = new Date().toISOString();
  const { payload, businesses } = buildScenarioPayload("fundable", {
    name: "Test Sample", email: "test+sim@example.invalid", identity: IDENTITY, pulledAt
  }, key);
  return { result: payload, businesses };
}

test("push-credit's optional CLI assembly leaves the old personal-only payload unchanged", () => {
  const options = { name: "Test Sample", email: "test+sim@example.invalid", identity: IDENTITY };
  const plain = buildScenarioPayload("fundable", options, null);
  const withBusiness = buildScenarioPayload("fundable", options, "seasoned_clean");
  assert.equal(plain.payload.businessReports, undefined);
  assert.deepEqual(plain.businesses, []);
  assert.equal(withBusiness.payload.businessReports.length, 1);
  assert.equal(withBusiness.businesses.length, 1);
  assert.equal(withBusiness.payload.businessReports[0].name, withBusiness.businesses[0].name);
});

test("every fictional business identity matches its stored Experian-shaped report", () => {
  for (const key of Object.keys(BUSINESS_SCENARIOS)) {
    const { result, businesses } = personalWithBusiness(key);
    assert.equal(result.businessReports.length, businesses.length, key);
    for (let i = 0; i < businesses.length; i++) {
      const saved = businesses[i];
      const pulled = result.businessReports[i];
      assert.equal(pulled.name, saved.name);
      assert.equal(pulled.state, saved.entity_data.state);
      assert.equal(pulled.ageMonths, saved.age_months);
      assert.equal(pulled.report.data.businessHeader.businessName, saved.name);
      assert.equal(pulled.report.data.businessHeader.address.addressLine1, saved.entity_data.address_line1);
      assert.equal(pulled.report.data.businessFacts.stateOfIncorporation, saved.entity_data.state);
      assert.match(saved.entity_data.ein_last4, /^\d{4}$/);
      assert.equal(pulled.report.simulated, true);
      const credit = businessScoreFromPulls([{ result, created_at: result.pulledAt }], saved);
      assert.equal(credit.found, true);
      assert.equal(credit.sample, true);
      assert.equal(credit.intelliscore, pulled.report.data.scoreInformation.commercialScore.score);
    }
  }
});

test("two clean businesses add business dollars once each while personal funding counts once", () => {
  const { result, businesses } = personalWithBusiness("two_clean");
  const opts = { submittedName: "Test Sample", formData: { name: "Test Sample", email: "test+sim@example.invalid" } };
  const { tierResult, fundingEstimate } = scoreBuyerTotal(runTierEngineFromCrsResult, result, opts);
  const scored = scoreCompanyReports(result, opts);
  assert.equal(scored.length, 2);
  assert.ok(scored.every((row) => row.error === null));
  assert.ok(scored.every((row) => row.business.final > 0));
  assert.equal(fundingEstimate, tierResult.preapprovals.totalPersonal + scored.reduce((n, row) => n + row.business.final, 0));
  assert.equal(businesses.length, 2);
  assert.equal(result.environment, "simulated");
  assert.equal(result.simulated, true);
  assert.ok(newInquiriesFor(result).length > 0, "the existing analysis.completed inquiry input is still present");
});

test("the same business report follows different personal-credit tiers and CRM decisions", () => {
  const options = {
    name: "Test Sample", email: "test+sim@example.invalid", identity: IDENTITY,
    pulledAt: new Date().toISOString()
  };
  const funding = buildScenarioPayload("fundable", options, "seasoned_clean").payload;
  const repair = buildScenarioPayload("repair-full", options, "seasoned_clean").payload;
  const score = (payload) => scoreBuyerTotal(runTierEngineFromCrsResult, payload, { submittedName: "Test Sample" });
  const funded = score(funding);
  const damaged = score(repair);
  assert.deepEqual(funding.businessReports, repair.businessReports, "only personal credit differs");
  assert.notEqual(funded.tierResult.outcome, damaged.tierResult.outcome);
  assert.ok(funded.fundingEstimate > damaged.fundingEstimate);
  assert.notDeepEqual(funding.scores, repair.scores);
});

test("mixed and blocked reports reach the real scorer without creating false business funding", () => {
  for (const key of ["lien_stressed", "inactive", "mixed"]) {
    const { result } = personalWithBusiness(key);
    const scored = scoreCompanyReports(result, { submittedName: "Test Sample" });
    assert.ok(scored.every((row) => row.error === null), key);
    for (const row of scored.filter((row) => row.name !== "Cedar Mesa Consulting LLC")) {
      assert.equal(row.business.final, 0, key);
      assert.equal(row.signals.hardBlock.blocked, true, key);
    }
    const { tierResult, fundingEstimate } = scoreBuyerTotal(runTierEngineFromCrsResult, result, { submittedName: "Test Sample" });
    const expectedBusiness = scored.reduce((n, row) => n + row.business.final, 0);
    assert.equal(fundingEstimate, tierResult.preapprovals.totalPersonal + expectedBusiness, key);
  }
});

// Handler-level proof only: no event bus, database, document pack, or fulfillment runs.
test("a simulated CRS result reaches the existing CRM event handlers and stops at Decision Rendered", async () => {
  const { result } = personalWithBusiness("mixed");
  const { tierResult, fundingEstimate } = scoreBuyerTotal(runTierEngineFromCrsResult, result, {
    submittedName: "Test Sample"
  });
  const client = { id: "sim-client", org_id: "sim-org", email: "test+sim@example.invalid",
    ghl_contact_id: "already-linked", custom_fields: {}, outcome_tier: null };
  const crs = { id: "sim-crs", org_id: client.org_id, client_id: client.id, result };
  const card = { id: "sim-card", stage_id: "booked" };
  const writes = [];
  const db = {
    async query(sql, params = []) {
      const q = String(sql);
      if (/SELECT id, ghl_contact_id, email, phone, first_name, last_name/.test(q)) return { rows: [client] };
      if (/SELECT id, org_id, client_id FROM crs_results/.test(q)) return { rows: [crs] };
      if (/UPDATE crs_results/.test(q)) {
        crs.result = { ...crs.result, ...JSON.parse(params[1]) };
        writes.push("analysis.completed");
        return { rows: [] };
      }
      if (/UPDATE clients SET outcome_tier/.test(q)) {
        client.outcome_tier = params[1];
        writes.push("outcome_tier");
        return { rows: [] };
      }
      if (/UPDATE clients SET custom_fields/.test(q)) {
        Object.assign(client.custom_fields, JSON.parse(params[1]));
        writes.push("funding_estimate");
        return { rows: [] };
      }
      if (/SELECT email, custom_fields->>'slo_ref'/.test(q)) return { rows: [{ email: client.email, slo_ref: null }] };
      if (/FROM pipeline_stages/.test(q)) return { rows: [{ stage_id: "decision_rendered", pipeline_id: "sales", sort_order: 6 }] };
      if (/SELECT ps.key AS stage_key/.test(q)) return { rows: [{ stage_key: "booked", sort_order: 2 }] };
      if (/SELECT id FROM cards/.test(q)) return { rows: [card] };
      if (/UPDATE cards SET stage_id/.test(q)) {
        card.stage_id = params[1];
        writes.push("sales_card");
        return { rows: [] };
      }
      // The optional waypoint review has no rows in this in-memory fixture.
      if (/\bSELECT\b/i.test(q)) return { rows: [] };
      throw new Error(`unexpected CRM write: ${q.slice(0, 80)}`);
    }
  };
  const base = { orgId: client.org_id, clientId: client.id };
  await onAnalysisCompleted({ ...base, name: "analysis.completed", payload: {
    crsResultId: crs.id, scores: result.scores, newInquiries: newInquiriesFor(result),
    outcomeTier: tierResult.outcome, simulated: true
  } }, db);
  await onDecisionRendered({ ...base, name: "decision.rendered", payload: {
    crsResultId: crs.id, outcomeTier: tierResult.outcome, fundingEstimate,
    simulated: true
  } }, db);
  assert.equal(crs.result.simulated, true);
  assert.equal(crs.result.businessReports.length, 2);
  assert.equal(client.outcome_tier, tierResult.outcome);
  assert.equal(client.custom_fields.total_funding_estimate, fundingEstimate);
  assert.equal(client.custom_fields.analyzer_prequal_amount, fundingEstimate);
  assert.equal(card.stage_id, "decision_rendered");
  assert.deepEqual(writes, ["analysis.completed", "outcome_tier", "funding_estimate", "sales_card"]);
});

test("unknown cases and invalid report dates fail before a payload can be stored", () => {
  assert.throws(() => buildBusinessScenario("made_up"), /unknown business scenario/);
  assert.throws(() => buildBusinessScenario("seasoned_clean", { asOf: "bad" }), /asOf must be a date/);
});

test("the CLI scenario fence refuses production URLs and non-sim people before any business write", async () => {
  const safe = { databaseUrl: "postgres://test:test@127.0.0.1:5432/fundhub_scratch", email: "buyer+sim-01@example.invalid", businessScenario: "two_clean" };
  assert.doesNotThrow(() => assertBusinessScenarioSafe(safe));
  assert.throws(() => assertBusinessScenarioSafe({ ...safe, databaseUrl: "postgres://test:test@prod.example/fundhub" }), /local scratch database/);
  assert.throws(() => assertBusinessScenarioSafe({ ...safe, email: "buyer@example.invalid" }), /\+sim email/);
  assert.throws(() => assertBusinessScenarioSafe({ ...safe, businessScenario: "made_up" }), /unknown business scenario/);
  let called = 0;
  const db = { async query() { called++; return { rows: [] }; } };
  await assert.rejects(saveScenarioBusinesses(db, { ...safe, databaseUrl: "postgres://test:test@prod.example/fundhub", orgId: "org", clientId: "client", businesses: [] }), /local scratch database/);
  await assert.rejects(saveScenarioBusinesses(db, { ...safe, orgId: "org", clientId: "client", businesses: [] }), /do not match/);
  assert.equal(called, 0, "the guard must run before DELETE or INSERT");
});

test("scratch business identities use the existing businesses row shape and only replace earlier fixture rows", async () => {
  const { businesses } = personalWithBusiness("two_clean");
  const statements = [];
  const db = { async query(sql, params) { statements.push({ sql: String(sql), params }); return { rows: [] }; } };
  await saveScenarioBusinesses(db, {
    orgId: "org", clientId: "sim-client", businesses,
    databaseUrl: "postgres://test:test@localhost:5432/fundhub_test",
    email: "buyer+sim-01@example.invalid", businessScenario: "two_clean"
  });
  assert.equal(statements.length, 3);
  assert.match(statements[0].sql, /DELETE FROM businesses/);
  assert.match(statements[0].sql, /entity_data->>'source' = 'simulated_crs'/);
  for (let i = 0; i < businesses.length; i++) {
    const write = statements[i + 1];
    assert.match(write.sql, /INSERT INTO businesses \(org_id, client_id, name, age_months, entity_data\)/);
    assert.equal(write.params[2], businesses[i].name);
    assert.equal(JSON.parse(write.params[4]).source, "simulated_crs");
  }
});

test("a failed business-row write rolls back its fixture replacement", async () => {
  const statements = [];
  const tx = {
    async query(sql) {
      const q = String(sql);
      statements.push(q);
      if (/INSERT INTO businesses/.test(q)) throw new Error("insert failed");
      return { rows: [] };
    },
    release() { statements.push("release"); }
  };
  const db = { async connect() { return tx; } };
  await assert.rejects(saveScenarioBusinesses(db, {
    orgId: "org", clientId: "sim-client",
    businesses: buildBusinessScenario("seasoned_clean").businesses,
    databaseUrl: "postgres://test:test@localhost:5432/fundhub_test",
    email: "buyer+sim-01@example.invalid", businessScenario: "seasoned_clean"
  }), /insert failed/);
  assert.equal(statements[0], "BEGIN");
  assert.ok(statements.some((q) => /DELETE FROM businesses/.test(q)));
  assert.deepEqual(statements.slice(-2), ["ROLLBACK", "release"]);
});

test("the --dry exit stays ahead of identity, business, credit and event writes", () => {
  const main = readFileSync(new URL("./push-credit.mjs", import.meta.url), "utf8").split("async function main()")[1];
  const dry = main.indexOf('if (dry) { console.log("dry run — nothing written")');
  assert.ok(dry >= 0);
  for (const write of ["await storeIdentity(db", "await saveScenarioBusinesses(db", "INSERT INTO crs_results", 'await emit(db, "analysis.completed"']) {
    assert.ok(main.indexOf(write) > dry, `${write} must stay after --dry exits`);
  }
});
