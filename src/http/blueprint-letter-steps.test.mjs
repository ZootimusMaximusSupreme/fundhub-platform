// POST /api/blueprint/letter-mailing approve_letter / check_address — the
// fulfillment cycle's letter steps ride the existing mailing route and gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/blueprint/letter-mailing.mjs";
import { FulfillmentCycleError } from "../blueprint/fulfillment-cycle.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const DOC = "44444444-4444-4444-8444-444444444444";
const response = () => ({ code: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } });
function fixture({ active = true } = {}) {
  const calls = [];
  const mailing = Object.fromEntries(["readLetterMailing", "quoteLetterMailing", "confirmLetterMailing", "reconcileLetterMailing"]
    .map((name) => [name, async () => { calls.push(name); return { ok: true }; }]));
  return { calls, steps: [], deps: { db: { query: async () => ({ rows: [{ exists: 1 }] }) },
    requirePrincipal: async () => ({ kind: "client", orgId: ORG, clientId: CLIENT, accountId: ACCOUNT }),
    isBlueprintCoachClient: async () => active, mailing } };
}

test("approve and address check reach the letter step with the signed-in account only", async () => {
  for (const [action, step] of [["approve_letter", "approve"], ["check_address", "address"]]) {
    const f = fixture();
    const r = response();
    f.deps.saveLetterStep = async (_db, scope, input) => { f.steps.push({ scope, input }); return { ok: true, step: input.step }; };
    await handler({ method: "POST", body: { action, documentId: DOC } }, r, f.deps);
    assert.equal(r.code, 200);
    assert.deepEqual(f.steps.map((s) => s.input), [{ documentId: DOC, step }]);
    assert.equal(f.steps[0].scope.accountId, ACCOUNT);
    assert.equal(f.steps[0].scope.clientId, CLIENT);
    assert.equal(f.steps[0].scope.orgId, ORG);
    assert.deepEqual(f.calls, [], "no mailing or payment action runs");
  }
});

test("extra fields, an inactive plan and refusals never write a step", async () => {
  for (const extra of [{ clientId: CLIENT }, { versionId: "v" }, { approvedAt: "2026-01-01" }, { bureau: "EX" }]) {
    const f = fixture();
    const r = response();
    f.deps.saveLetterStep = async () => { f.steps.push(1); return { ok: true }; };
    await handler({ method: "POST", body: { action: "approve_letter", documentId: DOC, ...extra } }, r, f.deps);
    assert.equal(r.code, 400);
    assert.equal(f.steps.length, 0);
  }
  const inactive = fixture({ active: false });
  inactive.deps.saveLetterStep = async () => { inactive.steps.push(1); return { ok: true }; };
  const r = response();
  await handler({ method: "POST", body: { action: "approve_letter", documentId: DOC } }, r, inactive.deps);
  assert.equal(r.code, 403);
  assert.equal(inactive.steps.length, 0);
  const refused = fixture();
  refused.deps.saveLetterStep = async () => { throw new FulfillmentCycleError("approve_first", "Approve the letter first.", 409); };
  const rr = response();
  await handler({ method: "POST", body: { action: "check_address", documentId: DOC } }, rr, refused.deps);
  assert.equal(rr.code, 409);
  assert.deepEqual(rr.body, { ok: false, error: "approve_first", message: "Approve the letter first." });
  const broken = fixture();
  broken.deps.saveLetterStep = async () => { throw new Error("relation blueprint_letter_approvals at host db.internal"); };
  const rb = response();
  await handler({ method: "POST", body: { action: "approve_letter", documentId: DOC } }, rb, broken.deps);
  assert.equal(rb.code, 500);
  assert.doesNotMatch(JSON.stringify(rb.body), /db\.internal|relation/);
});
