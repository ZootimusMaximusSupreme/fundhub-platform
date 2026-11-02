import { test } from "node:test";
import assert from "node:assert/strict";
import { dealMath } from "./deal-math.mjs";

test("dealMath requires org", () => {
  assert.throws(() => dealMath({}), /orgId required/);
});

test("dealMath credits the deposit toward the total success fee", () => {
  const out = dealMath({
    orgId: "org-1",
    deposit: 500,
    feePercent: 10,
    debts: 200,
    minPercent: 3,
    drawn: 10000
  });
  assert.equal(out.fees, 1000);
  assert.equal(out.net, 10000 - 1000 - 200);
  assert.equal(out.monthly, 300);
});

test("dealMath does not invent a draw — zero drawn stays zero", () => {
  const out = dealMath({ orgId: "org-1", deposit: 500, feePercent: 10, debts: 0, drawn: 0 });
  assert.equal(out.drawn, 0);
  assert.equal(out.net, -500);
  assert.equal(out.monthly, 0);
});

test("deposit above estimated fee does not invent a refund or another fee", () => {
  const out = dealMath({ orgId: "org-1", deposit: 3000, feePercent: 10, drawn: 10000 });
  assert.equal(out.fees, 3000);
  assert.equal(out.net, 7000);
});
