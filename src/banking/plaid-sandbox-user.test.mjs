// Test bank v2 config. Pure; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMixedSandboxUser } from "./plaid-sandbox-user.mjs";

const TODAY = new Date("2026-10-06T15:00:00Z");
const user = buildMixedSandboxUser({ today: TODAY });
const all = user.override_accounts.flatMap((a) => a.transactions ?? []);

test("inside Plaid's custom-user limits (~250 transactions, ~55 KB)", () => {
  assert.ok(all.length > 40 && all.length < 250, `got ${all.length}`);
  assert.ok(JSON.stringify(user).length < 55_000);
});

test("nothing posts in the future, and every charge posts the next day", () => {
  for (const t of all) {
    assert.ok(t.date_posted <= "2026-10-05", `${t.description} posts ${t.date_posted}`);
    const gap = (Date.parse(t.date_posted) - Date.parse(t.date_transacted)) / 86_400_000;
    assert.equal(gap, 1, `${t.description} ${t.date_transacted}`);
  }
});

test("Plaid's sign: rent is positive (money out), payroll and Stripe are negative (money in)", () => {
  assert.ok(all.filter((t) => /Rent/.test(t.description)).every((t) => t.amount > 0));
  assert.ok(all.filter((t) => /Payroll|Stripe/.test(t.description)).every((t) => t.amount < 0));
});

test("three months: three rents, six paychecks, weekly Stripe payouts", () => {
  assert.equal(all.filter((t) => t.description === "Oakwood Apartments Rent").length, 3);
  assert.ok(all.filter((t) => /Payroll/.test(t.description)).length >= 5);
  assert.ok(all.filter((t) => t.description === "Stripe payout").length >= 12);
});

test("both cards carry liability data and a statement/payment day", () => {
  const cards = user.override_accounts.filter((a) => a.type === "credit");
  assert.equal(cards.length, 2);
  for (const c of cards) {
    assert.equal(c.liability.type, "credit");
    assert.ok(c.liability.purchase_apr > 0);
    assert.ok(c.liability.minimum_payment_amount > 0);
    assert.ok(c.inflow_model.payment_day_of_month >= 1 && c.inflow_model.payment_day_of_month <= 28);
    assert.ok(c.inflow_model.statement_day_of_month >= 1);
  }
});
