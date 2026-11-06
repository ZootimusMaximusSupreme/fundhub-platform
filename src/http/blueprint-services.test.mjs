import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/blueprint/services.mjs";
import { authorizeBlueprintReportExecution } from "../blueprint/report-allowance.mjs";
import { processBlueprintClientServices } from "../blueprint/report-requests.mjs";

const orgId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const engagement = { id: "33333333-3333-4333-8333-333333333333", status: "active", roundId: null };
function response() { return { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function dependencies(principal, over = {}) {
  const calls = [];
  const operation = async (_db, scope, input) => { calls.push({ scope, input }); return { ok: true }; };
  return { calls, db: {}, requirePrincipal: async () => principal,
    access: { requireBlueprintFulfillmentScope: async () => ({ orgId, clientId, accountId: "account", engagement }),
      getBlueprintFulfillmentAccess: async () => engagement }, requireClientInOrg: async () => true,
    services: { readBlueprintClientServices: operation, requestBlueprintHelp: operation, quoteBlueprintHelp: operation, offerBlueprintHelp: operation,
      checkoutBlueprintHelp: operation, requestBlueprintReport: operation }, ...over };
}

test("a client cannot quote a service or substitute a different client", async () => {
  const deps = dependencies({ kind: "client" });
  for (const body of [{ action: "quote", requestId: engagement.id, priceCents: 100 },
    { action: "request_help", serviceKind: "repair_full", client_id: engagement.id }]) {
    const res = response();
    await handler({ method: "POST", body }, res, deps);
    assert.ok([400, 403].includes(res.statusCode));
  }
  assert.equal(deps.calls.length, 0);
});

test("CSM can read and quote its client but cannot purchase as that client", async () => {
  const deps = dependencies({ kind: "staff", staff: { id: "staff", role: "csm", org_id: orgId } });
  const res = response();
  await handler({ method: "POST", query: { client_id: clientId }, body: { action: "quote", requestId: engagement.id, priceCents: 3200 } }, res, deps);
  assert.equal(res.statusCode, 200);
  assert.equal(deps.calls[0].scope.staffId, "staff");
  const denied = response();
  await handler({ method: "POST", query: { client_id: clientId }, body: { action: "checkout", requestId: engagement.id, authorization: true } }, denied, deps);
  assert.equal(denied.statusCode, 403);
  assert.equal(deps.calls.length, 1);
});

test("CSM can proactively quote a service before the client requests help", async () => {
  const deps = dependencies({ kind: "staff", staff: { id: "staff", role: "csm", org_id: orgId } });
  const res = response();
  await handler({ method: "POST", body: { action: "offer", client_id: clientId, serviceKind: "repair_full", priceCents: 100000, idempotencyKey: "csm_proactive_offer" } }, res, deps);
  assert.equal(res.statusCode, 200);
  assert.equal(deps.calls[0].scope.clientId, clientId);
  assert.equal(deps.calls[0].scope.staffId, "staff");
});

test("a non-CSM staff role and a completed engagement cannot change paid help", async () => {
  const deps = dependencies({ kind: "staff", staff: { id: "staff", role: "setter", org_id: orgId } });
  const res = response();
  await handler({ method: "GET", query: { client_id: clientId } }, res, deps);
  assert.equal(res.statusCode, 403);
  const client = dependencies({ kind: "client" }, { access: { requireBlueprintFulfillmentScope: async () => ({ orgId, clientId, accountId: "account", engagement: { ...engagement, status: "completed" } }) } });
  const ended = response();
  await handler({ method: "POST", body: { action: "request_report", idempotencyKey: "a_valid_request_key" } }, ended, client);
  assert.equal(ended.statusCode, 409);
  assert.equal(client.calls.length, 0);
});

test("included report execution rechecks engagement completion before the provider", async () => {
  const ledger = { org_id: orgId, client_id: clientId, blueprint_engagement_id: engagement.id, blueprint_report_kind: "included" };
  await assert.rejects(authorizeBlueprintReportExecution({ query: async () => ({ rows: [{ status: "completed" }] }) }, ledger), { code: "blueprint_report_access_ended" });
  await authorizeBlueprintReportExecution({ query: async () => ({ rows: [{ status: "completed", service_status: "in_progress", payment_ref: "paid_exact", payment_status: "staged", price_total_cents: 3200, amount_paid_cents: 3200 }] }) }, { ...ledger, blueprint_report_kind: "paid", blueprint_service_request_id: engagement.id });
});

test("paid report workers wait for live authorization and preserve uncertain outcomes", async () => {
  const row = { id: "report", org_id: orgId, client_id: clientId, blueprint_service_request_id: "service" };
  let providerCalls = 0;
  let tasks = 0;
  const db = { query: async sql => ({ rows: sql.includes("SELECT r.*") ? [row] : [] }) };
  const runPull = async () => { providerCalls++; throw new Error("provider_outcome_unknown"); };
  const waiting = await processBlueprintClientServices(db, { env: {}, runPull });
  assert.equal(waiting.waiting, 1);
  assert.equal(providerCalls, 0);
  const failed = await processBlueprintClientServices(db, { env: { CRS_ALLOW_LIVE: "1", FINANCE_OS_SYSTEM_PULL_LIVE: "1" }, runPull,
    createTaskImpl: async () => { tasks++; return { id: "task" }; } });
  assert.equal(failed.ok, false);
  assert.equal(providerCalls, 1);
  assert.equal(tasks, 1);
});
