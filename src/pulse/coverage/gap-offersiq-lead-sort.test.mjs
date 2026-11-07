import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CHECK_IDS, FINISHED_RECEIPTS_SQL, NOTHING_TO_JUDGE, RECEIPT_LIMIT,
  checkOffersIqLeadSort, gapChecks, judgeOffersIqLeadSort, naVerify
} from "./gap-offersiq-lead-sort.mjs";
import { OFFERSIQ_LEAD_SORT_CONFIG, OFFERSIQ_STARTER_RULES } from "../../finance/offersiq-lead-sort-config.mjs";
import { classifyOffersIqReceipt } from "../../finance/offersiq-lead-sort.mjs";
import { verifyNa } from "../na-conditions.mjs";
import { pinBeatSource } from "../beats/contract.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const queryResult = rows => ({ rows });
const readRows = rows => async () => queryResult(rows);

function configuredFixture() {
  const config = structuredClone(OFFERSIQ_LEAD_SORT_CONFIG);
  for (const [index, fact] of config.facts.entries()) {
    if (fact.enabled && !fact.attributeCode) fact.attributeCode = `SYNTHETIC_${index}`;
  }
  const receipt = { outcome: "matched", rule_set_id: 1677, environment: "production", identity_fingerprint: "a".repeat(64),
    request_id: "20000000-0000-4000-8000-000000000001", individual_results:
    config.facts.filter(fact => fact.enabled).flatMap(fact => fact.ranges.map((range, index) => ({
      attributeCode: fact.attributeCode, attributeName: fact.attributeName,
      operator: range.operator, expectedValue: range.expectedValue,
      passed: index === 0, status: index === 0 ? "PASSED" : "FAILED"
    }))) };
  receipt.individual_results.push(...config.screeningGuards.map(guard => ({
    attributeCode: guard.attributeCode, attributeName: guard.attributeName,
    operator: guard.operator, expectedValue: guard.expectedValue,
    passed: guard.factKey !== "creditScore", status: guard.factKey === "creditScore" ? "FAILED" : "PASSED"
  })));
  const result = classifyOffersIqReceipt(receipt, config);
  return { config, saved: {
    rule_set_id: 1677, environment: "production", identity_fingerprint: receipt.identity_fingerprint, receipt,
    lead_sort_bucket: result.bucket, lead_sort_points: result.points,
    lead_sort_version: result.version, lead_sort_reasons: result.reasons, lead_sort_result: result
  } };
}

const starterFixture = (ruleSetId = 1677, environment = "production") => ({
  rule_set_id: ruleSetId, environment, identity_fingerprint: "a".repeat(64), receipt: { outcome: "matched", rule_set_id: ruleSetId, environment, identity_fingerprint: "a".repeat(64),
    request_id: "20000000-0000-4000-8000-000000000001",
    individual_results: OFFERSIQ_STARTER_RULES.map(rule => ({ ...rule, passed: true, status: "PASSED" })) }
});

test("OffersIQ sort heartbeat has a literal list, an org-scoped bounded read and no provider call", async () => {
  assert.deepEqual(CHECK_IDS, ["offersiq-lead-sort:integrity"]);
  assert.match(FINISHED_RECEIPTS_SQL, /r\.org_id = \$1::uuid/);
  assert.match(FINISHED_RECEIPTS_SQL, /c\.org_id = r\.org_id/);
  assert.match(FINISHED_RECEIPTS_SQL, /COALESCE\(r\.lead_sort_receipt, r\.normalized_response\)/);
  assert.match(FINISHED_RECEIPTS_SQL, /'matched', 'not_matched', 'needs_review', 'error'/);
  assert.doesNotMatch(FINISHED_RECEIPTS_SQL, /\b(?:INSERT|UPDATE|DELETE|BEGIN|COMMIT|SET)\b/);
  const source = fs.readFileSync(fileURLToPath(new URL("../beats/lib/offersiq-lead-sort-truth.mjs", import.meta.url)), "utf8");
  assert.deepEqual(pinBeatSource(source, { role: "lib" }), []);
  assert.doesNotMatch(source, /crs-client|reevaluateOffersIq|orderOffersIq|fetch\s*\(/);
});

test("OffersIQ sort imports remain pure and cannot hide I/O outside the heartbeat box", () => {
  for (const name of ["offersiq-lead-sort.mjs", "offersiq-lead-sort-config.mjs"]) {
    const source = fs.readFileSync(fileURLToPath(new URL(`../../finance/${name}`, import.meta.url)), "utf8");
    assert.deepEqual(pinBeatSource(source, { role: "lib" }), [], name);
  }
});

test("no finished checks is a fresh verified nothing-to-judge result", async () => {
  const [row] = await gapChecks({ orgId: ORG, db: { query: readRows([]) } });
  assert.equal(row.status, "na");
  assert.equal(row.na.code, NOTHING_TO_JUDGE);
  assert.equal(row.na.args.why, "no_finished_receipts");
  assert.equal(row.na.args.version, OFFERSIQ_LEAD_SORT_CONFIG.version);
  assert.equal(await naVerify[NOTHING_TO_JUDGE](row.na.args, { db: { query: readRows([]) } }), true);
  assert.equal(await naVerify[NOTHING_TO_JUDGE](row.na.args, { db: { query: readRows([{}]) } }), false);
  assert.equal(await naVerify[NOTHING_TO_JUDGE]({ ...row.na.args, version: "old" }, { db: { query: readRows([]) } }), false);
  assert.equal(await naVerify[NOTHING_TO_JUDGE]({ ...row.na.args, check: "unrelated-check" }, { db: { query: readRows([]) } }), false);
});

test("the pulse audit recognizes the wait code and asks the lane to re-read it", async () => {
  const [result] = await gapChecks({ orgId: ORG, db: { query: readRows([]) } });
  const row = { ...result, sliceId: "gap-offersiq-lead-sort" };
  let reads = 0;
  const verified = await verifyNa(row, {
    laneNaVerify: (_slice, code, args) => naVerify[code](args, {
      db: { query: async () => { reads += 1; return queryResult([]); } }
    })
  });
  assert.equal(verified.ok, true);
  assert.equal(reads, 1);
  const noProof = await verifyNa({ ...row, na: { ...row.na, args: { ...row.na.args, check: "wrong" } } }, {});
  assert.equal(noProof.ok, false);
});

test("a failed or malformed read cannot become a pass or a verified wait", async () => {
  for (const read of [async () => { throw new Error("private value"); }, async () => ({}), async () => ({ rows: null })]) {
    const result = await checkOffersIqLeadSort({ read, orgId: ORG });
    assert.equal(result.status, "FAIL");
    assert.doesNotMatch(result.detail, /private value/);
  }
  assert.equal((await checkOffersIqLeadSort({ orgId: ORG })).status, "skip");
  assert.equal((await checkOffersIqLeadSort({ read: readRows([]), orgId: "bad" })).status, "skip");
});

test("the lane uses the staff scope before the shared pool and always binds one org", async () => {
  const seen = [];
  const rows = await gapChecks({
    orgId: ORG,
    db: { query() { throw new Error("unscoped pool used"); } },
    scope: fn => fn({ query: async (sql, params) => { seen.push({ sql, params }); return queryResult([]); } })
  });
  assert.equal(rows[0].status, "na");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].sql, FINISHED_RECEIPTS_SQL);
  assert.deepEqual(seen[0].params, [ORG]);
});

test("an arbitrary three-rule receipt or a missing receipt stays red", () => {
  for (const saved of [
    {},
    { rule_set_id: 1677, environment: "production", receipt: { rule_set_id: 1677, environment: "production", individual_results: [{}, {}, {}] } },
    { rule_set_id: 1677, environment: "production", receipt: { rule_set_id: 1232, environment: "sandbox", individual_results: [] } }
  ]) {
    const result = judgeOffersIqLeadSort([saved], { orgId: ORG });
    assert.equal(result.status, "FAIL");
    assert.match(result.detail, /rule list mismatch/);
    assert.match(result.suggestedFix, /Never start a paid check/);
  }
});

test("a truncated ledger is red instead of silently treating the visible rows as complete", () => {
  const result = judgeOffersIqLeadSort(Array(RECEIPT_LIMIT + 1).fill({}), { orgId: ORG });
  assert.equal(result.status, "FAIL");
  assert.match(result.detail, /full ledger was not proved/);
});

test("only the exact known starter list on its environment gets the verified wait", async () => {
  for (const starter of [starterFixture(), starterFixture(1232, "sandbox")]) {
    const result = judgeOffersIqLeadSort([starter], { orgId: ORG });
    assert.equal(result.status, "na");
    assert.equal(result.na.args.why, "starter_only");
    assert.equal(await naVerify[NOTHING_TO_JUDGE](result.na.args, { db: { query: readRows([starter]) } }), true);
    const changed = structuredClone(starter);
    changed.receipt.individual_results[0].expectedValue += 1;
    assert.equal(judgeOffersIqLeadSort([changed], { orgId: ORG }).status, "FAIL");
    assert.equal(await naVerify[NOTHING_TO_JUDGE](result.na.args, { db: { query: readRows([changed]) } }), false);
  }
  assert.equal(judgeOffersIqLeadSort([starterFixture(1677, "sandbox")], { orgId: ORG }).status, "FAIL");
  assert.equal(judgeOffersIqLeadSort([starterFixture(1232, "production")], { orgId: ORG }).status, "FAIL");
});

test("a complete configured check passes and every stored sort field is checked", () => {
  const { saved, config } = configuredFixture();
  assert.equal(saved.lead_sort_result.ruleListStatus, "matched");
  assert.equal(judgeOffersIqLeadSort([saved], { orgId: ORG, config }).status, "PASS");
  for (const [key, value] of [
    ["lead_sort_bucket", "prime"], ["lead_sort_points", saved.lead_sort_points + 1],
    ["lead_sort_version", "old"], ["lead_sort_reasons", ["made up"]], ["lead_sort_result", {}]
  ]) {
    const result = judgeOffersIqLeadSort([{ ...saved, [key]: value }], { orgId: ORG, config });
    assert.equal(result.status, "FAIL", key);
    assert.match(result.detail, /1 have stale or wrong sort data/);
  }
  for (const key of ["lead_sort_bucket", "lead_sort_points", "lead_sort_version", "lead_sort_reasons", "lead_sort_result"]) {
    const result = judgeOffersIqLeadSort([{ ...saved, [key]: null }], { orgId: ORG, config });
    assert.equal(result.status, "FAIL", key);
    assert.match(result.detail, /1 have no complete bucket/);
  }
});

test("a saved Can't tell for a mismatched list stays red even if stored correctly", () => {
  const { saved, config } = configuredFixture();
  saved.receipt.individual_results.pop();
  const result = classifyOffersIqReceipt(saved.receipt, config);
  Object.assign(saved, { lead_sort_bucket: result.bucket, lead_sort_points: result.points,
    lead_sort_version: result.version, lead_sort_reasons: result.reasons, lead_sort_result: result });
  assert.equal(judgeOffersIqLeadSort([saved], { orgId: ORG, config }).status, "FAIL");
});

test("JSONB object key order does not create a false sort failure", () => {
  const { saved, config } = configuredFixture();
  saved.lead_sort_result = Object.fromEntries(Object.entries(saved.lead_sort_result).reverse());
  assert.equal(judgeOffersIqLeadSort([saved], { orgId: ORG, config }).status, "PASS");
});

test("a trustworthy no-file answer needs a saved Can't tell bucket but is not rule drift", () => {
  const receipt = { outcome: "needs_review", reason: "INSUFFICIENT_DATA", decision_status: "INSUFFICIENT_DATA",
    environment: "production", rule_set_id: 1677, identity_fingerprint: "a".repeat(64), request_id: "20000000-0000-4000-8000-000000000001" };
  const result = classifyOffersIqReceipt(receipt);
  assert.equal(result.ruleListStatus, "not_evaluated");
  const saved = { rule_set_id: 1677, environment: "production", identity_fingerprint: receipt.identity_fingerprint, receipt,
    lead_sort_bucket: result.bucket, lead_sort_points: result.points,
    lead_sort_version: result.version, lead_sort_reasons: result.reasons, lead_sort_result: result };
  assert.equal(judgeOffersIqLeadSort([saved], { orgId: ORG }).status, "PASS");
  assert.equal(judgeOffersIqLeadSort([{ ...saved, lead_sort_bucket: null }], { orgId: ORG }).status, "FAIL");
  const malformed = { ...saved, receipt: { ...receipt, individual_results: [{}] } };
  assert.equal(judgeOffersIqLeadSort([malformed], { orgId: ORG }).status, "FAIL");
  assert.equal(judgeOffersIqLeadSort([{ ...saved, client_in_org: false }], { orgId: ORG }).status, "FAIL");
  assert.equal(judgeOffersIqLeadSort([{ ...saved, identity_fingerprint: "b".repeat(64) }], { orgId: ORG }).status, "FAIL");
});

test("a receipt for another saved identity cannot pass configured, starter or no-file proof", () => {
  const { saved, config } = configuredFixture();
  for (const row of [saved, starterFixture()]) {
    assert.equal(judgeOffersIqLeadSort([{ ...row, identity_fingerprint: "b".repeat(64) }], { orgId: ORG, config }).status, "FAIL");
    assert.equal(judgeOffersIqLeadSort([{ ...row, receipt: { ...row.receipt, identity_fingerprint: "bad" } }], { orgId: ORG, config }).status, "FAIL");
    const missing = structuredClone(row);
    delete missing.receipt.identity_fingerprint;
    assert.equal(judgeOffersIqLeadSort([missing], { orgId: ORG, config }).status, "FAIL");
  }
});
