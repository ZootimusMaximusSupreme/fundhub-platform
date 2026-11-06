// Real loopback Postgres, effective unprivileged role, synthetic rows rolled back.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../../verification/scratch-guard.mjs";
import { OFFERSIQ_LEAD_SORT_CONFIG, OFFERSIQ_STARTER_RULES } from "../../finance/offersiq-lead-sort-config.mjs";
import { classifyOffersIqReceipt } from "../../finance/offersiq-lead-sort.mjs";
import { persistOffersIqLeadSort } from "../../finance/offersiq-lead-sort-store.mjs";
import { checkOffersIqLeadSort, FINISHED_RECEIPTS_SQL, gapChecks, naVerify, NOTHING_TO_JUDGE } from "./gap-offersiq-lead-sort.mjs";

const dsn = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const options = { skip: !isLocalScratchDatabaseUrl(dsn) && "local scratch app-role database required" };

async function fixtures(run) {
  const db = new pg.Client({ connectionString: dsn });
  await db.connect();
  try {
    await db.query("BEGIN");
    const role = (await db.query("SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.equal(role.current_user, "fundhub_app");
    assert.equal(role.rolsuper || role.rolbypassrls, false);
    await run(db);
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
}

async function company(db) {
  const orgId = (await db.query("INSERT INTO orgs(slug,name) VALUES($1,'Synthetic sort heartbeat') RETURNING id", [`sort-heartbeat-${randomUUID()}`])).rows[0].id;
  const staffId = (await db.query("INSERT INTO staff(org_id,name,role,status) VALUES($1,'Synthetic setter','setter','active') RETURNING id", [orgId])).rows[0].id;
  const clientId = (await db.query("INSERT INTO clients(org_id,first_name,last_name,is_demo) VALUES($1,'Synthetic','Heartbeat',true) RETURNING id", [orgId])).rows[0].id;
  return { orgId, staffId, clientId };
}

function receipt(conditions = [], ruleSetId = 1677, environment = "production") {
  return { outcome: "matched", rule_set_id: ruleSetId, environment,
    identity_fingerprint: randomBytes(32).toString("hex"), request_id: randomUUID(),
    individual_results: conditions };
}

async function save(db, org, summary, status = "matched") {
  return (await db.query(`INSERT INTO offersiq_requests(org_id,client_id,requester_staff_id,operation_id,
      rule_set_id,environment,identity_fingerprint,identity_source,address_confirmed_at,
      consent_terms_url,consent_version,consent_accepted_at,status,normalized_response,provider_request_id,finished_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,'setter_confirmed',now(),'https://example.test/terms','synthetic',now(),$8,$9::jsonb,$10,now()) RETURNING id`,
  [org.orgId, org.clientId, org.staffId, randomUUID(), summary.rule_set_id, summary.environment,
    summary.identity_fingerprint, status, JSON.stringify(summary), summary.request_id])).rows[0].id;
}

function probe(db, orgId, config) {
  const read = (sql, params) => {
    assert.equal(sql, FINISHED_RECEIPTS_SQL);
    assert.deepEqual(params, [orgId]);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|BEGIN|COMMIT|SET)\b/);
    return db.query(sql, params);
  };
  return checkOffersIqLeadSort({ read, orgId, config });
}

function configuredReceipt() {
  const config = structuredClone(OFFERSIQ_LEAD_SORT_CONFIG);
  for (const [index, fact] of config.facts.entries()) {
    if (fact.enabled && !fact.attributeCode) fact.attributeCode = `SYNTHETIC_${index}`;
  }
  const summary = receipt(config.facts.filter(fact => fact.enabled).flatMap(fact => fact.ranges.map((range, index) => ({
    attributeCode: fact.attributeCode, attributeName: fact.attributeName,
    operator: range.operator, expectedValue: range.expectedValue,
    passed: index === 0, status: index === 0 ? "PASSED" : "FAILED"
  }))));
  summary.individual_results.push(...config.screeningGuards.map(guard => ({
    attributeCode: guard.attributeCode, attributeName: guard.attributeName,
    operator: guard.operator, expectedValue: guard.expectedValue,
    passed: guard.factKey !== "creditScore", status: guard.factKey === "creditScore" ? "FAILED" : "PASSED"
  })));
  return { config, summary };
}

test("real app-role heartbeat proves empty and exact starter waits and excludes a foreign org", options, () => fixtures(async db => {
  const own = await company(db), foreign = await company(db);
  await save(db, foreign, receipt());
  assert.equal((await probe(db, own.orgId)).status, "na", "foreign bad receipt is never read for this org");
  for (const [ruleSetId, environment] of [[1677, "production"], [1232, "sandbox"]]) {
    await save(db, own, receipt(OFFERSIQ_STARTER_RULES.map(rule => ({ ...rule, passed: true, status: "PASSED" })), ruleSetId, environment));
  }
  const [starter] = await gapChecks({ db, orgId: own.orgId });
  assert.equal(starter.status, "na");
  assert.equal(starter.na.args.why, "starter_only");
  assert.equal(await naVerify[NOTHING_TO_JUDGE](starter.na.args, { db }), true);
  await save(db, own, receipt());
  const bad = await probe(db, own.orgId);
  assert.equal(bad.status, "FAIL");
  assert.match(bad.detail, /1 saved OffersIQ checks have a rule list mismatch/);
  assert.equal(await naVerify[NOTHING_TO_JUDGE](starter.na.args, { db }), false);
  assert.equal(JSON.stringify(bad).includes(foreign.orgId), false);
}));

test("real app-role heartbeat catches missing, stale and mismatched sort data and reads free-rerun receipt", options, () => fixtures(async db => {
  const org = await company(db);
  const { summary, config } = configuredReceipt();
  const id = await save(db, org, summary);
  assert.equal(classifyOffersIqReceipt(summary, config).ruleListStatus, "matched");
  const missing = await probe(db, org.orgId, config);
  assert.equal(missing.status, "FAIL");
  assert.match(missing.detail, /1 have no complete bucket/);
  await persistOffersIqLeadSort(db, id, org.orgId, summary, { config });
  assert.equal((await probe(db, org.orgId, config)).status, "PASS");
  assert.equal((await probe(db, org.orgId, { ...config, version: "synthetic-next-version" })).status, "FAIL");
  const changed = { ...summary, request_id: randomUUID(), individual_results: summary.individual_results.slice(1) };
  await persistOffersIqLeadSort(db, id, org.orgId, changed, { config, reevaluated: true });
  assert.equal((await probe(db, org.orgId, config)).status, "FAIL", "the effective free-rerun receipt is judged before the unchanged paid receipt");
  const stored = (await db.query("SELECT normalized_response FROM offersiq_requests WHERE id=$1 AND org_id=$2", [id, org.orgId])).rows[0];
  assert.deepEqual(stored.normalized_response, summary);
}));

test("real app-role no-file receipt has Can't tell without a false rule-drift alert", options, () => fixtures(async db => {
  const org = await company(db);
  const summary = { ...receipt(), outcome: "needs_review", reason: "INSUFFICIENT_DATA", decision_status: "INSUFFICIENT_DATA" };
  delete summary.individual_results;
  const id = await save(db, org, summary, "needs_review");
  const missing = await probe(db, org.orgId);
  assert.equal(missing.status, "FAIL");
  assert.match(missing.detail, /0 saved OffersIQ checks have a rule list mismatch; 1 have no complete bucket/);
  await persistOffersIqLeadSort(db, id, org.orgId, summary);
  assert.equal((await probe(db, org.orgId)).status, "PASS");
}));

test("real app-role heartbeat rejects a swapped identity before any configured, starter or no-file exemption", options, () => fixtures(async db => {
  const configured = configuredReceipt();
  const noFile = { ...receipt(), outcome: "needs_review", reason: "INSUFFICIENT_DATA", decision_status: "INSUFFICIENT_DATA" };
  delete noFile.individual_results;
  const starter = receipt(OFFERSIQ_STARTER_RULES.map(rule => ({ ...rule, passed: true, status: "PASSED" })));
  for (const [summary, config, expected] of [
    [configured.summary, configured.config, "PASS"], [starter, undefined, "na"], [noFile, undefined, "PASS"]
  ]) {
    const org = await company(db);
    const id = await save(db, org, summary, summary.outcome);
    if (expected === "PASS") await persistOffersIqLeadSort(db, id, org.orgId, summary, { config });
    assert.equal((await probe(db, org.orgId, config)).status, expected);
    const swapped = { ...summary, identity_fingerprint: randomBytes(32).toString("hex") };
    await db.query("UPDATE offersiq_requests SET lead_sort_receipt=$3::jsonb WHERE id=$1 AND org_id=$2", [id, org.orgId, JSON.stringify(swapped)]);
    const bad = await probe(db, org.orgId, config);
    assert.equal(bad.status, "FAIL");
    assert.match(bad.detail, /1 saved OffersIQ checks have a rule list mismatch/);
    assert.equal(JSON.stringify(bad).includes(swapped.identity_fingerprint), false);
  }
}));
