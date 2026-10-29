// F-07 fee-source provenance: no provider effects or production database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFundedFeeSource, handle } from "./f-07-funding-locked.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const SALE = "33333333-3333-4333-8333-333333333333";
const ROUND = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const context = { orgId: ORG, clientId: CLIENT, saleId: SALE, fundingRoundId: ROUND, rail: "card_stacking" };

test("F-07 requires both sale and round IDs on card-stacking funded events", async () => {
  const db = { query: async () => { throw Error("missing refs must not touch SQL"); } };
  for (const args of [
    { ...context, saleId: null }, { ...context, fundingRoundId: null },
    { ...context, saleId: null, fundingRoundId: null }
  ]) {
    const out = await validateFundedFeeSource(db, args);
    assert.deepEqual(out, { ok: false, reason: "fee_source_missing" });
  }
  assert.equal(
    (await validateFundedFeeSource(db, { ...context, saleId: "not-a-uuid" })).reason,
    "fee_source_invalid_ref"
  );
});

test("F-07 verifies the same organization, buyer, round, active sale and funding product", async () => {
  let called = false;
  const db = {
    async query(sql, params) {
      called = true;
      assert.match(sql, /FROM funding_rounds fr/);
      assert.match(sql, /frs\.funding_round_id = fr\.id/);
      assert.match(sql, /s\.client_id = fr\.client_id/);
      assert.match(sql, /pr\.category = 'funding'/);
      assert.match(sql, /s\.status = 'active'/);
      assert.deepEqual(params, [ROUND, ORG, CLIENT, SALE]);
      return { rows: [{ id: ROUND }] };
    }
  };
  assert.deepEqual(await validateFundedFeeSource(db, context), { ok: true, legacyUnverified: false });
  assert.equal(called, true);
});

test("F-07 refuses wrong-sale funded events before any message, task, invoice or client change", async () => {
  const db = pgFake({ clients: [{
    id: CLIENT, org_id: ORG, email: "f07-test@example.invalid", custom_fields: {}
  }] });
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/FROM funding_rounds fr/.test(sql)) {
      // The correct round exists, but the submitted sale does not own it.
      assert.deepEqual(params, [ROUND, ORG, CLIENT, OTHER]);
      return { rows: [] };
    }
    return query(sql, params);
  };
  const event = ev("round.funded", {
    rail: "card_stacking", saleId: OTHER, fundingRoundId: ROUND,
    approvedAmount: 90000, feePercent: 10
  }, { orgId: ORG, clientId: CLIENT, id: "f07-foreign-sale" });
  const out = await handle({ event, db, step: fakeStep() });
  assert.equal(out.done, false);
  assert.equal(out.reason, "fee_source_mismatch");
  assert.equal(db.messages.length, 0);
  assert.equal(db.invoices.length, 0);
  assert.equal(db.tasks.length, 0);
  assert.deepEqual(db.clients[0].custom_fields, {});
});

test("F-07 refuses unreferenced card-stacking event before sending", async () => {
  const db = pgFake({ clients: [{ id: CLIENT, org_id: ORG, email: "f07-test@example.invalid" }] });
  const out = await handle({
    event: ev("round.funded", {
      rail: "card_stacking", approvedAmount: 90000, feePercent: 10
    }, { orgId: ORG, clientId: CLIENT, id: "f07-unreferenced" }),
    db, step: fakeStep()
  });
  assert.equal(out.done, false);
  assert.equal(out.reason, "fee_source_missing");
  assert.equal(db.messages.length, 0);
  assert.equal(db.invoices.length, 0);
});

test("legacy provider event without references is visibly classified as unverified", async () => {
  const db = { query: async () => { throw Error("no reference lookup expected"); } };
  assert.deepEqual(
    await validateFundedFeeSource(db, { orgId: ORG, clientId: CLIENT }),
    { ok: true, legacyUnverified: true }
  );
});
