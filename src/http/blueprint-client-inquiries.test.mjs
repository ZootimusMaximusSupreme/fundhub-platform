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
    { action: "launch_call", caseId: "case", verified: true }]) {
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
