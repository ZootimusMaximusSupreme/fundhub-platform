// A pipeline column's funding estimate: unknown stays unknown.
//
// Measured 2026-10-05 on production: the sales rail's New Lead column (8 cards)
// and Survey Complete (2 cards) had not one funding estimate between them, and
// both read "$0 funding est." because the column summed `amount || 0`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stageAmount } from "../../api/dashboard/pipeline.mjs";

test("cards with no amount on any of them: unknown (null), not 0", () => {
  assert.equal(stageAmount([{ amount: null }, { amount: null }]), null);
});

test("an empty column is a real 0", () => {
  assert.equal(stageAmount([]), 0);
  assert.equal(stageAmount(undefined), 0);
});

test("known amounts sum; unknown ones add nothing", () => {
  assert.equal(stageAmount([{ amount: 4200 }, { amount: null }, { amount: 800 }]), 5000);
  assert.equal(stageAmount([{ amount: 0 }]), 0, "a known zero is still a known zero");
});
