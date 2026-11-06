import { test } from "node:test";
import assert from "node:assert/strict";
import { currentClientRepairRound, generateClientRepairLetters } from "./client-repair.mjs";
import handler from "../../api/blueprint/repair.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const scope = { orgId: id, clientId: id, accountId: id, engagement: { id, status: "active", executionOwner: "client" } };
function response() { return { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

test("repair round follows item outcomes and never advances on a client completion claim", () => {
  assert.equal(currentClientRepairRound([], []), "R1");
  assert.equal(currentClientRepairRound([], [{ round: "R1", status: "open" }]), "R1");
  assert.equal(currentClientRepairRound([{ round: "R1", status: "sent" }], [{ id }]), null);
  assert.equal(currentClientRepairRound([{ round: "R1", status: "sent" }, { round: "R2", status: "escalated" }], [{ id }]), "R2");
  assert.equal(currentClientRepairRound([{ round: "R3", status: "verified" }], [{ id }]), null);
  assert.equal(currentClientRepairRound([{ round: "R6", status: "deleted" }], [{ id }]), null);
});

test("full package starts existing full repair machinery with included zero allocation and no staff identity", async () => {
  let enrolled = null, generated = null;
  const db = { async query() { return { rows: [] }; } };
  const deps = { readActiveServices: async () => [], hasDisputeAuthorization: async () => true,
    evaluateDocGate: async () => ({ complete: true, missing: [] }), loadVerifiedIdentity: async () => ({ legalName: "Fixture Buyer", address: "1 Fixture St" }),
    documentStore: {}, enrollRepairProgram: async (_db, args) => { enrolled = args; return { ok: true }; },
    analyzeAndGenerate: async (_db, args) => { generated = args; return { ok: true, letters: [], documents: null }; } };
  const result = await generateClientRepairLetters(db, scope, {}, deps);
  assert.equal(result.status, "prepared"); assert.equal(enrolled.program, "full");
  assert.equal(enrolled.priceTotal, 0); assert.equal(enrolled.amountPaid, 0); assert.equal(enrolled.staffId, undefined);
  assert.equal(generated.round, "R1"); assert.equal(generated.staffId, undefined);
});

test("repair gateway rejects arbitrary rounds, staff flags, client clear and foreign identity fields", async () => {
  let calls = 0;
  const deps = { requireBlueprintFulfillmentScope: async () => scope,
    services: { generate: async () => { calls++; return { ok: true }; } } };
  for (const body of [{ action: "generate", round: "R6" }, { action: "generate", staffId: id },
    { action: "mark_complete" }, { action: "generate", clientId: id }]) {
    const res = response(); await handler({ method: "POST", body }, res, deps); assert.equal(res.statusCode, 400);
  }
  const res = response(); await handler({ method: "POST", body: { action: "generate", idempotencyKey: "prepare-1" } }, res, deps);
  assert.equal(calls, 1); assert.equal(res.statusCode, 200);
});
