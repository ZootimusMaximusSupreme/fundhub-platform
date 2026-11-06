import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/blueprint/inquiries.mjs";

function response() { return { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
const scope = { orgId: "org", clientId: "client", accountId: "account", engagement: { status: "active", executionOwner: "client" } };

test("only known inquiry actions accept the authenticated scope, and client clear/spoof fields refuse", async () => {
  let calls = 0;
  const deps = { requireBlueprintFulfillmentScope: async () => scope,
    services: { recordSubmission: async (_db, received) => { calls++; assert.equal(received, scope); return { ok: true }; } } };
  for (const body of [{ action: "mark_cleared", caseId: "case" },
    { action: "record_submission", caseId: "case", clientId: "someone-else" },
    { action: "launch_call", caseId: "case", verified: true },
    { action: "record_submission", caseId: "case", portalUrl: "https://example.test" },
    { action: "record_submission", caseId: "case", documentUploadUrl: "https://example.test" }]) {
    const res = response(); await handler({ method: "POST", body }, res, deps);
    assert.equal(res.statusCode, 400);
  }
  const res = response(); await handler({ method: "POST", body: { action: "record_submission", caseId: "case", reference: "ref", receiptDocumentId: "doc" } }, res, deps);
  assert.equal(res.statusCode, 200); assert.equal(calls, 1);
});

test("ended engagement cannot mutate, while GET remains a scoped read", async () => {
  let writes = 0;
  const deps = { requireBlueprintFulfillmentScope: async () => ({ ...scope, engagement: { status: "completed" } }),
    services: { read: async () => ({ ok: true, cases: [] }), checkEvidence: async () => { writes++; } } };
  const ended = response(); await handler({ method: "POST", body: { action: "check_evidence", caseId: "case" } }, ended, deps);
  assert.equal(ended.statusCode, 409); assert.equal(writes, 0);
  const read = response(); await handler({ method: "GET" }, read, deps);
  assert.deepEqual(read.body, { ok: true, cases: [] });
});

test("saved-evidence check accepts request metadata without granting client proof or identity", async () => {
  let calls = 0;
  const deps = { requireBlueprintFulfillmentScope: async () => scope,
    services: { checkEvidence: async (_db, received, input) => {
      calls++; assert.equal(received, scope); assert.equal(input.caseId, "case"); return { ok: true, removed: 0 };
    } } };
  const res = response();
  await handler({ method: "POST", body: { action: "check_evidence", caseId: "case", idempotencyKey: "saved-check-1" } }, res, deps);
  assert.equal(res.statusCode, 200); assert.equal(calls, 1); assert.equal(res.body.removed, 0);
  const forbidden = response();
  await handler({ method: "POST", body: { action: "check_evidence", caseId: "case", idempotencyKey: "saved-check-1", verified: true } }, forbidden, deps);
  assert.equal(forbidden.statusCode, 400); assert.equal(calls, 1);
});

test("inquiry API scopes managed funding writes to the case service", async () => {
  const managed = { ...scope, engagement: { ...scope.engagement, executionOwner: "fundhub" } };
  const deps = { requireBlueprintFulfillmentScope: async (_req, _res, options) => {
    assert.equal(options.allowManagedWrites, true); return managed;
  }, services: { checkEvidence: async (_db, received) => { assert.equal(received, managed); return { ok: true }; } } };
  const res = response(); await handler({ method: "POST", body: { action: "check_evidence", caseId: "case" } }, res, deps);
  assert.equal(res.statusCode, 200);
});

test("inquiry GET distinguishes initial bureau disputes from Experian supporting uploads without writing", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const ownScope = { ...scope, orgId: id, clientId: id, accountId: id };
  const rows = ["EX", "EQ", "TU", "unknown"].map(bureau => ({ id, selected_bureaus_raw: bureau, case_status: "Queued" }));
  const queries = [];
  const deps = { requireBlueprintFulfillmentScope: async () => ownScope,
    db: { query: async sql => { queries.push(sql); return { rows: /SELECT \* FROM inquiry_removal_cases/.test(sql) ? rows : [] }; } },
    readActiveServices: async () => [], evaluateDocGate: async () => ({ complete: true, missing: [] }), verifiedIdentity: async () => null };
  const res = response(); await handler({ method: "GET" }, res, deps);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.cases.map(row => [row.bureau, row.portalUrl, row.documentUploadUrl]), [
    ["EX", "https://www.experian.com/help/dispute-credit/", "https://www.experian.com/consumer/upload/"],
    ["EQ", "https://www.equifax.com/personal/credit-report-services/credit-dispute/", null],
    ["TU", "https://www.transunion.com/credit-disputes/dispute-your-credit", null],
    ["unknown", null, null]
  ]);
  assert.equal(queries.every(sql => /^SELECT\b/i.test(sql.trim())), true);
  assert.equal(res.body.cases.every(row => row.call.canLaunch === false), true, "links do not bypass reviewed identity");
});
