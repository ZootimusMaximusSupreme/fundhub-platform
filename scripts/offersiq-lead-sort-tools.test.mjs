import test from "node:test";
import assert from "node:assert/strict";
import { OFFERSIQ_SANDBOX_IDENTITIES } from "../src/finance/offersiq-contract.mjs";
import { parseLeadSortArgs, assertToolCrsEnvironment, rescoreFinishedOffersIq,
  reevaluateFinishedOffersIq } from "./offersiq-lead-sort-tools.mjs";
import { sandboxPreviousReceipts, verifyOffersIqSandbox } from "./offersiq-lead-sort-sandbox.mjs";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const config = { version: "tool-test-v1" };
const sandboxEnv = { CRS_API_HOST: "api-sandbox.stitchcredit.com", CRS_API_USERNAME: "sandbox-test", CRS_API_PASSWORD: "sandbox-test" };
const productionEnv = { CRS_API_HOST: "mware.crscreditapi.com", CRS_API_USERNAME: "production-test", CRS_API_PASSWORD: "production-test", CRS_ALLOW_LIVE: "true" };
const classify = summary => ({ bucket: "blueprint", points: summary.points ?? 20,
  version: config.version, reasons: [], ruleListStatus: summary.ruleListStatus ?? "matched" });
const summarize = decision => ({ outcome: decision.outcome, points: decision.points,
  decision_status: decision.decisionStatus, ruleListStatus: decision.ruleListStatus ?? "matched" });
const row = (n, environment = "sandbox") => ({ id: id(n), org_id: id(900), rule_set_id: 1232,
  environment, identity_fingerprint: "a".repeat(64), provider_request_id: id(100 + n),
  normalized_response: { points: n, rule_set_id: 1232, environment, identity_fingerprint: "a".repeat(64) },
  finished_at: "2026-11-06T12:00:00Z", status: "matched" });

function scanDatabase(rows) {
  const queries = [];
  return { queries, async query(sql, params) {
    queries.push({ sql, params });
    assert.match(sql.trim(), /^SELECT/);
    if (sql.includes("WHERE provider_request_id")) {
      return { rows: rows.filter(r => r.provider_request_id === params[0] && r.environment === params[1]
        && (!params[2] || r.org_id === params[2])) };
    }
    const [environment, orgId, cursor, limit] = params;
    return { rows: rows.filter(r => r.environment === environment && (!orgId || r.org_id === orgId)
      && (!cursor || r.id > cursor)).slice(0, limit) };
  } };
}

function freeClientHarness(responseFor = requestId => ({ ok: true, requestId,
  decision: { ruleSetId: 1232, outcome: "matched" } })) {
  const calls = [];
  let clients = 0;
  return { calls, get clients() { return clients; }, createClient() {
    clients++;
    return { async reevaluateOffersIq(args) { calls.push(args); return responseFor(args.requestId); },
      evaluateOffersIq() { assert.fail("a free rerun must never start a new evaluation"); } };
  } };
}

test("tool defaults are a read-only sandbox preview and strict options reject unsafe input", () => {
  assert.deepEqual(parseLeadSortArgs([]), { apply: false, environment: "sandbox", pageSize: 100,
    orgId: null, loadedProofRequest: null, ruleSetId: null, receiptFile: null, help: false });
  assert.throws(() => parseLeadSortArgs(["--apply", "--page-size", "0"]), /page size/);
  assert.throws(() => parseLeadSortArgs(["--environment", "prod"]), /environment/);
  assert.throws(() => parseLeadSortArgs(["--org", "wrong"]), /UUID/);
  assert.throws(() => parseLeadSortArgs(["--environment", "production"], { sandboxOnly: true }), /sandbox/);
});

test("CRS credentials cannot be repointed to the other environment", () => {
  assert.throws(() => assertToolCrsEnvironment(productionEnv, "sandbox"), /host/);
  assert.throws(() => assertToolCrsEnvironment(sandboxEnv, "production"), /host/);
  assert.throws(() => assertToolCrsEnvironment({ CRS_API_HOST: sandboxEnv.CRS_API_HOST }, "sandbox"), /credentials/);
  assert.strictEqual(assertToolCrsEnvironment(sandboxEnv, "sandbox"), sandboxEnv);
  assert.equal(sandboxEnv.CRS_API_USERNAME, "sandbox-test");
});

test("dedicated OffersIQ credentials take precedence in a copied environment", () => {
  const env = { ...productionEnv, CRS_OFFERSIQ_API_HOST: "api-sandbox.stitchcredit.com",
    CRS_OFFERSIQ_API_USERNAME: "offersiq-sandbox", CRS_OFFERSIQ_API_PASSWORD: "offersiq-secret",
    CRS_OFFERSIQ_ALLOW_LIVE: "off" };
  const selected = assertToolCrsEnvironment(env, "sandbox");
  assert.equal(selected.CRS_API_USERNAME, "offersiq-sandbox");
  assert.equal(selected.CRS_API_HOST, "api-sandbox.stitchcredit.com");
  assert.equal(selected.CRS_ALLOW_LIVE, "off");
  assert.equal(env.CRS_API_USERNAME, "production-test");
  assert.throws(() => assertToolCrsEnvironment({ ...env, CRS_OFFERSIQ_API_PASSWORD: "" }, "sandbox"), /credentials/);
});

test("rescore visits every finished page, uses reevaluated receipt, and preview writes nothing", async () => {
  const rows = [row(1), row(2), row(3), row(4), row(5)];
  rows[2].lead_sort_receipt = { ...rows[2].normalized_response, points: 88 };
  const db = scanDatabase([...rows, row(6, "production")]);
  const seen = [];
  const result = await rescoreFinishedOffersIq({ db, pageSize: 2, config,
    classify(summary) { seen.push(summary.points); return classify(summary); },
    persist() { assert.fail("preview must never persist"); } });
  assert.equal(result.scanned, 5);
  assert.equal(result.written, 0);
  assert.deepEqual(seen, [1, 2, 88, 4, 5]);
  assert.equal(db.queries.length, 3);
  assert.deepEqual(db.queries.map(q => q.params[2]), [null, id(2), id(4)]);
});

test("rescore apply calls ranking storage for every org-scoped row without replacing provider data", async () => {
  const rows = [row(1), row(2), { ...row(3), org_id: id(901) }];
  const writes = [];
  const result = await rescoreFinishedOffersIq({ db: scanDatabase(rows), apply: true, pageSize: 1,
    orgId: id(900), config, classify, persist: async (...args) => writes.push(args) });
  assert.equal(result.written, 2);
  assert.deepEqual(writes.map(args => args[1]), [id(1), id(2)]);
  assert.deepEqual(writes[0].at(-1), { config, expectedSourceReceipt: rows[0].normalized_response });
});

test("legacy missing or malformed receipts get only safe metadata and an exact source guard", async () => {
  const rows = [null, false, ["untrusted"]].map((receipt, index) => ({ ...row(index + 1),
    rule_set_id: "1232", status: "error", provider_request_id: null, normalized_response: receipt }));
  const writes = [];
  const result = await rescoreFinishedOffersIq({ db: scanDatabase(rows), apply: true,
    persist: async (...args) => writes.push(args) });
  assert.equal(result.buckets.can_not_tell, 3);
  assert.equal(result.written, 3);
  for (const [index, args] of writes.entries()) {
    assert.deepEqual(args[3], { outcome: "error", rule_set_id: 1232, environment: "sandbox",
      identity_fingerprint: "a".repeat(64), request_id: null, checked_at: "2026-11-06T12:00:00.000Z" });
    assert.deepEqual(args[4].expectedSourceReceipt, rows[index].normalized_response);
  }
});

test("free reevaluation preview never creates a CRS client or calls a provider", async () => {
  const provider = freeClientHarness();
  const result = await reevaluateFinishedOffersIq({ db: scanDatabase([row(1), row(2)]),
    environment: "production", config, classify, createClient: provider.createClient });
  assert.equal(result.scanned, 0);
  assert.equal(result.providerCalls, 0);
  assert.equal(provider.clients, 0);
});

test("production free rerun needs a verified newly loaded list before any bulk call or write", async () => {
  const rows = [row(1, "production"), row(2, "production")];
  const db = scanDatabase(rows);
  const provider = freeClientHarness(requestId => ({ ok: true, requestId,
    decision: { ruleSetId: 1232, outcome: "matched", ruleListStatus: "starter" } }));
  const options = { db, apply: true, environment: "production", env: productionEnv,
    config, classify, summarize, createClient: provider.createClient,
    persist() { assert.fail("starter rules must not pass the production gate"); } };
  await assert.rejects(reevaluateFinishedOffersIq(options), /loaded-proof-request/);
  assert.equal(provider.clients, 0);
  await assert.rejects(reevaluateFinishedOffersIq({ ...options, loadedProofRequest: rows[1].provider_request_id }), /bulk reevaluation refused/);
  assert.deepEqual(provider.calls, [{ requestId: rows[1].provider_request_id }]);
  assert.equal(db.queries.length, 1, "bulk scan must wait for proof");
});

test("production proof is reused, all pages rerun for free, and only internal sort receipts are written", async () => {
  const rows = [row(1, "production"), row(2, "production"), row(3, "production")];
  const provider = freeClientHarness();
  const writes = [];
  const result = await reevaluateFinishedOffersIq({ db: scanDatabase(rows), apply: true,
    environment: "production", env: productionEnv, loadedProofRequest: rows[1].provider_request_id,
    pageSize: 1, config, classify, summarize, createClient: provider.createClient,
    persist: async (...args) => writes.push(args) });
  assert.equal(result.loadedRuleListVerified, true);
  assert.equal(result.written, 3);
  assert.equal(result.providerCalls, 3, "the proof receipt must not be reevaluated twice");
  assert.deepEqual(provider.calls.map(c => c.requestId), [rows[1].provider_request_id, rows[0].provider_request_id, rows[2].provider_request_id]);
  assert.deepEqual(writes.map(args => args.at(-1)), Array(3).fill({ config, reevaluated: true }));
  assert.deepEqual(rows.map(r => r.normalized_response.points), [1, 2, 3]);
});

test("mismatched rows stop a rerun even when the initial proof matched", async () => {
  const rows = [row(1, "production"), row(2, "production")];
  const provider = freeClientHarness(requestId => ({ ok: true, requestId,
    decision: { ruleSetId: 1232, outcome: "matched", ruleListStatus: requestId === rows[0].provider_request_id ? "matched" : "mismatch" } }));
  const writes = [];
  await assert.rejects(reevaluateFinishedOffersIq({ db: scanDatabase(rows), apply: true,
    environment: "production", env: productionEnv, loadedProofRequest: rows[0].provider_request_id,
    config, classify, summarize, createClient: provider.createClient,
    persist: async (...args) => writes.push(args) }), /no longer matches/);
  assert.equal(writes.length, 1);
});

test("a provider error or different rule set never triggers a paid replacement", async () => {
  for (const returned of [{ ok: false, status: 422 }, { ok: true, requestId: id(101), decision: { ruleSetId: 9999 } }]) {
    const provider = freeClientHarness(() => returned);
    await assert.rejects(reevaluateFinishedOffersIq({ db: scanDatabase([row(1)]), apply: true,
      env: sandboxEnv, config, classify, summarize, createClient: provider.createClient,
      persist() { assert.fail("failed rerun must not write"); } }), /free reevaluation failed/);
    assert.equal(provider.calls.length, 1);
  }
});

test("a genuine no-file response does not stop remaining free reevaluations after loaded-list proof", async () => {
  const rows = [row(1, "production"), row(2, "production"), row(3, "production")];
  const provider = freeClientHarness(requestId => ({ ok: true, requestId, decision: {
    ruleSetId: 1232, outcome: requestId === rows[1].provider_request_id ? "needs_review" : "matched",
    ...(requestId === rows[1].provider_request_id ? { decisionStatus: "INSUFFICIENT_DATA", ruleListStatus: "not_evaluated" } : {}) } }));
  const writes = [];
  const result = await reevaluateFinishedOffersIq({ db: scanDatabase(rows), apply: true,
    environment: "production", env: productionEnv, loadedProofRequest: rows[0].provider_request_id,
    config, classify, summarize, createClient: provider.createClient, persist: async (...args) => writes.push(args) });
  assert.equal(result.noFileReceipts, 1);
  assert.equal(result.written, 3);
  assert.equal(writes[1][3].decision_status, "INSUFFICIENT_DATA");
});

test("old error rows without a provider request are counted and never replaced with new orders", async () => {
  const provider = freeClientHarness();
  const rows = [{ ...row(1), provider_request_id: null }, row(2)];
  const result = await reevaluateFinishedOffersIq({ db: scanDatabase(rows), apply: true,
    env: sandboxEnv, config, classify, summarize, createClient: provider.createClient, persist: async () => {} });
  assert.equal(result.skippedNoProviderRequest, 1);
  assert.equal(result.written, 1);
  assert.equal(provider.calls.length, 1);
});

test("sandbox preview is free and production host is refused before creating a client", async () => {
  const options = { ruleSetId: 1232, env: productionEnv, config, summarize, createClient() { assert.fail("must not create client"); } };
  assert.equal((await verifyOffersIqSandbox(options)).providerCalls, 0);
  await assert.rejects(verifyOffersIqSandbox({ ...options, apply: true }), /host/);
  assert.throws(() => sandboxPreviousReceipts({ environment: "production", receipts: [] }), /sandbox/);
});

test("sandbox proof sends exactly the four published identities and reuses valid old receipts", async () => {
  const calls = [];
  const client = { async evaluateOffersIq(args) {
    calls.push(args);
    return { ok: true, requestId: id(500 + calls.length), decision: { ruleSetId: 1232, outcome: "matched" } };
  }, async reevaluateOffersIq(args) {
    calls.push(args);
    return { ok: true, requestId: args.requestId, decision: { ruleSetId: 1232, outcome: "matched" } };
  } };
  const first = await verifyOffersIqSandbox({ apply: true, ruleSetId: 1232, env: sandboxEnv,
    config, classify, summarize, createClient: () => client });
  assert.equal(first.complete, true);
  assert.equal(first.loadedRuleListVerified, true);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(c => c.identity), OFFERSIQ_SANDBOX_IDENTITIES);
  for (const call of calls) {
    assert.equal(Object.hasOwn(call.identity, "ssn"), false);
    assert.equal(Object.hasOwn(call.identity, "dob"), false);
    assert.equal(call.consent.accepted, true);
  }
  calls.length = 0;
  const second = await verifyOffersIqSandbox({ apply: true, ruleSetId: 1232, env: sandboxEnv,
    previous: first, config, classify, summarize, createClient: () => client });
  assert.deepEqual(calls, first.receipts.map(receipt => ({ requestId: receipt.requestId })));
  assert.ok(second.receipts.every(receipt => receipt.source === "free_reevaluation"));
  assert.throws(() => sandboxPreviousReceipts({ ...first, receipts: [{ ...first.receipts[0], identityFingerprint: "forged" }] }), /published sandbox fixture/);
});

test("sandbox starter rules are observable without claiming the configured list is proven", async () => {
  const result = await verifyOffersIqSandbox({ apply: true, ruleSetId: 1232, env: sandboxEnv,
    config, classify, summarize, createClient: () => ({ async evaluateOffersIq() {
      return { ok: true, requestId: id(600), decision: { ruleSetId: 1232, outcome: "not_matched", ruleListStatus: "starter" } };
    } }) });
  assert.equal(result.complete, true);
  assert.equal(result.loadedRuleListVerified, false);
  assert.equal(result.receipts.length, 4);
});

test("sandbox loaded-list proof treats strict no-file outcomes as neutral and needs one full match", async () => {
  for (const [statuses, expected] of [
    [["not_evaluated", "not_evaluated", "not_evaluated", "matched"], true],
    [["not_evaluated", "not_evaluated", "not_evaluated", "not_evaluated"], false],
    [["not_evaluated", "not_evaluated", "matched", "starter"], false],
    [["not_evaluated", "not_evaluated", "matched", "mismatch"], false]
  ]) {
    let index = 0;
    const report = await verifyOffersIqSandbox({ apply: true, ruleSetId: 1232, env: sandboxEnv,
      config, classify, summarize, createClient: () => ({ async evaluateOffersIq() {
        return { ok: true, requestId: id(700 + index), decision: { ruleSetId: 1232,
          outcome: "needs_review", ruleListStatus: statuses[index++] } };
      } }) });
    assert.equal(report.loadedRuleListVerified, expected);
  }
});
