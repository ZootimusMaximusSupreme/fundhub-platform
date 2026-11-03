import { test } from "node:test";
import assert from "node:assert/strict";
import handler, { requireBlueprintPlanScope } from "../../api/blueprint/business-plans.mjs";
import { BusinessPlanError } from "../blueprint/business-plans.mjs";
const ORG = "11111111-1111-4111-8111-111111111111", CLIENT = "22222222-2222-4222-8222-222222222222", OTHER = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-02T18:00:00Z");
function response() { return { code: null, body: null, headers: {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader(k, v) { this.headers[k] = v; return this; } }; }
async function call({ method = "GET", body, query = {}, principal = { kind: "client", orgId: ORG, clientId: CLIENT }, active = true, exists = true, error = null } = {}) {
  const calls = { reads: [], writes: [], eligibility: [], queries: [] }; const res = response();
  const deps = { db: { query: async (sql, args) => { calls.queries.push({ sql, args }); return { rows: exists ? [{ x: 1 }] : [] }; } }, now: () => NOW,
    requirePrincipal: async (_req, r, kinds) => { if (!principal) { r.status(401).json({ ok: false, error: "unauthorized" }); return null; } if (!kinds.includes(principal.kind)) { r.status(403).json({ ok: false, error: "forbidden" }); return null; } return principal; },
    isBlueprintCoachClient: async (_db, scope) => { calls.eligibility.push(scope); return active; },
    readBusinessPlans: async (_db, scope) => { calls.reads.push(scope); if (error) throw error; return { businesses: [], startedAt: null }; },
    writeBusinessPlans: async (_db, scope, action, input, options) => { calls.writes.push({ scope, action, input, options }); if (error) throw error; return { businesses: [{ id: "saved" }] }; }
  };
  await handler({ method, body, query }, res, deps); return { res, calls, deps };
}
test("unauthenticated/staff/unlinked sessions cannot read or mutate buyer plans", async () => {
  for (const principal of [null, { kind: "staff", orgId: ORG, clientId: CLIENT }, { kind: "client", orgId: ORG, clientId: null }]) {
    const { res, calls } = await call({ principal, method: "POST", body: { action: "save_settings", started: true } });
    assert.ok([401, 403].includes(res.code)); assert.equal(calls.writes.length, 0); assert.equal(calls.reads.length, 0);
  }
});
test("active paid Blueprint year and same-org client existence are required", async () => {
  let out = await call({ active: false }); assert.equal(out.res.code, 403); assert.equal(out.res.body.error, "blueprint_access_inactive"); assert.equal(out.calls.reads.length, 0);
  out = await call({ exists: false }); assert.equal(out.res.code, 404); assert.equal(out.calls.eligibility.length, 0);
});
test("GET ignores caller client IDs and uses server time/session scope", async () => {
  const { res, calls } = await call({ query: { client_id: OTHER, org_id: OTHER } });
  assert.equal(res.code, 200); assert.equal(calls.reads[0].clientId, CLIENT); assert.equal(calls.reads[0].orgId, ORG); assert.equal(calls.eligibility[0].asOf, NOW);
});
test("POST rejects identity/proof overrides before passing a write", async () => {
  for (const field of ["org_id", "orgId", "client_id", "clientId", "accountId", "staffId", "reviewed", "verified"]) {
    const { res, calls } = await call({ method: "POST", body: { action: "save_settings", [field]: OTHER } }); assert.equal(res.code, 400); assert.equal(calls.writes.length, 0);
  }
});
test("settings, business, progress and evidence commands keep exact input and session ownership", async () => {
  for (const body of [
    { action: "save_settings", started: true, targetBusinessCount: 4, availableCashCents: 0 },
    { action: "save_business", business: { name: "Cedar LLC", activity: "Local cleaning." } },
    { action: "save_step", stepKey: "business_profile", status: "reported_complete", note: "Done by me." },
    { action: "attach_evidence", businessId: OTHER, kind: "formation", documentId: OTHER }
  ]) {
    const { res, calls } = await call({ method: "POST", body }); assert.equal(res.code, 200); assert.equal(calls.writes.length, 1); assert.equal(calls.writes[0].scope.clientId, CLIENT); assert.equal(calls.writes[0].scope.orgId, ORG); assert.equal(calls.writes[0].options.now, NOW);
    const { action, ...fields } = body; assert.equal(calls.writes[0].action, action); assert.deepEqual(calls.writes[0].input, action === "save_business" ? fields.business : fields);
  }
});
test("malformed payload and unsupported methods do not write", async () => {
  for (const body of [null, [], "bad"]) { const { res, calls } = await call({ method: "POST", body }); assert.equal(res.code, 400); assert.equal(calls.writes.length, 0); }
  const { res, calls } = await call({ method: "DELETE" }); assert.equal(res.code, 405); assert.equal(res.headers.allow, "GET, POST"); assert.equal(calls.queries.length, 0);
});
test("domain error is clear; unexpected failures do not reveal internal data", async () => {
  let out = await call({ error: new BusinessPlanError("evidence_not_found", "Upload the document first.", 404) }); assert.equal(out.res.code, 404); assert.equal(out.res.body.message, "Upload the document first.");
  out = await call({ error: new Error("private db detail") }); assert.equal(out.res.code, 500); assert.equal(JSON.stringify(out.res.body).includes("private db detail"), false);
});
test("shared aggregator auth helper returns the exact approved scope", async () => {
  const { deps } = await call(); const res = response(); const scope = await requireBlueprintPlanScope({ method: "GET" }, res, deps); assert.deepEqual(scope, { orgId: ORG, clientId: CLIENT, now: NOW });
});
