import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import handler from "../../api/finance/property-report.mjs";
const principal = { kind: "staff", role: "funding_advisor", orgId: randomUUID(), staffId: randomUUID() };
const clientId = randomUUID();
function res() { return { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(v) { this.code = v; return this; }, json(v) { this.body = v; return this; } }; }
function deps(extra = {}) { return { requirePrincipal: async () => principal, db: { query: async () => ({ rows: [{}] }) },
  getPropertyReport: async () => ({ status: 200, body: { ok: true, status: "empty" } }),
  orderPropertyReport: async () => ({ status: 200, body: { ok: true, status: "completed" } }), ...extra }; }
test("property route admits approved primary staff roles and same-org reads only", async () => {
  for (const role of ["owner", "admin", "funding_advisor"]) {
    const response = res(); await handler({ method: "GET", query: { client_id: clientId } }, response, deps({ requirePrincipal: async () => ({ ...principal, role }) }));
    assert.equal(response.code, 200); assert.equal(response.headers["Cache-Control"], "no-store");
  }
  for (const role of ["closer", "setter", "csm", "sales_manager"]) {
    const response = res(); await handler({ method: "GET", query: { client_id: clientId } }, response, deps({ requirePrincipal: async () => ({ ...principal, role }) }));
    assert.equal(response.code, 403);
  }
  const foreign = res(); await handler({ method: "GET", query: { client_id: clientId } }, foreign, deps({ db: { query: async () => ({ rows: [] }) } }));
  assert.equal(foreign.code, 404);
});
test("property route refuses browser identity and tenant overrides", async () => {
  for (const field of ["org_id", "identity", "ssn", "dob", "firstName", "simulate"]) {
    const response = res(); await handler({ method: "POST", body: { client_id: clientId, [field]: "untrusted" } }, response, deps());
    assert.equal(response.code, 400);
  }
});
test("property GET never reaches order and POST carries separate property permission only", async () => {
  let writes = 0;
  const options = deps({ orderPropertyReport: async (_db, actor, args) => {
    writes++; assert.equal(actor.orgId, principal.orgId); assert.equal(args.clientId, clientId); assert.equal(args.consentAccepted, true);
    return { status: 202, body: { ok: true, status: "in_flight" } };
  } });
  await handler({ method: "GET", query: { client_id: clientId } }, res(), options); assert.equal(writes, 0);
  const response = res(); await handler({ method: "POST", body: { client_id: clientId, operation_id: randomUUID(), consent_accepted: true, consent_version: "property-report-2026-11-06" } }, response, options);
  assert.equal(response.code, 202); assert.equal(writes, 1);
});
