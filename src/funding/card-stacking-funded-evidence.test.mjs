// Funded is never inferred from bank approval. No database or provider writes in these tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFundedAmount, emitCardStackingRoundTransition } from "./card-stacking-rounds.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "00000000-0000-4000-8000-000000000002";
const noDatabaseReads = { query() { throw new Error("approval-only test must not query a database"); } };

test("funded resolver refuses approval-only and absent funding, preserving explicit amount", async () => {
  for (const input of [
    {}, { approvedAmount: 35000 }, { fundingRoundId: "ignored", approvedAmount: 35000 },
    { fundedAmount: null, approvedAmount: 35000 },
    { fundedAmount: 0, approvedAmount: 35000 },
    { fundedAmount: -1, approvedAmount: 35000 },
    { fundedAmount: "not-a-number", approvedAmount: 35000 },
    { fundedAmount: Infinity, approvedAmount: 35000 }
  ]) {
    assert.equal(await resolveFundedAmount(noDatabaseReads, input), null, JSON.stringify(input));
  }
  assert.equal(await resolveFundedAmount(noDatabaseReads, { fundedAmount: 30000, approvedAmount: 35000 }), 30000);
});

test("direct funded event emitter refuses missing/invalid funded amount before any DB or messages", async () => {
  for (const fundedAmount of [undefined, null, "", 0, -5, "NaN", Infinity]) {
    const out = await emitCardStackingRoundTransition(noDatabaseReads, {
      orgId: ORG, clientId: CLIENT, stageKey: "funded", roundNumber: 1,
      approvedAmount: 35000, fundedAmount
    });
    assert.equal(out.emitted, false, String(fundedAmount));
    assert.equal(out.reason, "funded_amount_required");
    assert.equal(out.eventName, "round.funded");
  }
});
