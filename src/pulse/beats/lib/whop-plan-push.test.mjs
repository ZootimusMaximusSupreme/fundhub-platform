// The Whop plan planner: when a Whop plan charges next, and when its phone alert is owed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  whopMoneyToCents, arizonaDay, dayOf, splitPay, nextCharge, planWhopPush, whopIdOfKey, isWhopKey,
  whopLabel, WHOP_PUSH_KIND, WHOP_PUSH_DAYS_BEFORE
} from "./whop-plan-push.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ID = "3f1c2b9a-6d4e-4f10-9a7b-1c2d3e4f5a6b";
const plan = (over = {}) => ({
  id: ID, status: "active", renewal_cents: 50000, cancel_at_period_end: false,
  split_pay_required: null, split_pay_paid: null, period_end_on: "2026-11-20",
  product_title: "Consulting Services Package", unlinked_at: null, ...over
});

test("this file imports only from its own folder (the beats/lib rule)", () => {
  const src = fs.readFileSync(path.join(HERE, "whop-plan-push.mjs"), "utf8");
  const from = [...src.matchAll(/^import[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(from.length > 0);
  for (const f of from) assert.match(f, /^\.\/[a-z-]+\.mjs$/, `${f} leaves src/pulse/beats/lib`);
});

test("Whop money is exact US cents; anything else is unknown, never 0", () => {
  assert.equal(whopMoneyToCents({ amount: "59.00", currency: "usd", decimals: 2 }), 5900);
  assert.equal(whopMoneyToCents({ amount: "59.5", currency: "USD", decimals: 2 }), 5950);
  assert.equal(whopMoneyToCents({ amount: "0.00", currency: "usd", decimals: 2 }), 0);
  assert.equal(whopMoneyToCents({ amount: "1250", currency: "usd", decimals: 2 }), 125000);
  assert.equal(whopMoneyToCents({ amount: "59.00", currency: "eur", decimals: 2 }), null);
  assert.equal(whopMoneyToCents({ amount: "59", currency: "usd", decimals: 0 }), null);
  assert.equal(whopMoneyToCents({ amount: "-1.00", currency: "usd", decimals: 2 }), null);
  assert.equal(whopMoneyToCents({ amount: "1.234", currency: "usd", decimals: 2 }), null);
  assert.equal(whopMoneyToCents({ amount: 59, currency: "usd", decimals: 2 }), null);
  assert.equal(whopMoneyToCents(null), null);
});

test("a Whop timestamp becomes its Arizona calendar day (UTC-7, no daylight saving)", () => {
  assert.equal(arizonaDay("2026-11-20T03:00:00Z"), "2026-11-19");
  assert.equal(arizonaDay("2026-11-20T07:00:00Z"), "2026-11-20");
  assert.equal(arizonaDay("2026-07-01T06:59:59Z"), "2026-06-30");
  assert.equal(arizonaDay(new Date("2026-03-09T12:00:00Z")), "2026-03-09");
  assert.equal(arizonaDay("not a date"), null);
  assert.equal(arizonaDay(null), null);
  assert.equal(dayOf("2026-11-20"), "2026-11-20");
  assert.equal(dayOf("2026-02-30"), null);
});

test("split pay counts come off the row; missing paid means none yet", () => {
  assert.deepEqual(splitPay({ split_pay_required: 6, split_pay_paid: 2 }), { required: 6, paid: 2, left: 4 });
  assert.deepEqual(splitPay({ split_pay_required: 6, split_pay_paid: null }), { required: 6, paid: 0, left: 6 });
  assert.deepEqual(splitPay({ split_pay_required: 6, split_pay_paid: 9 }), { required: 6, paid: 6, left: 0 });
  assert.equal(splitPay({ split_pay_required: null }), null);
});

test("the next charge is the period end, only when every fact says Whop will charge", () => {
  assert.deepEqual(nextCharge(plan()), { on: "2026-11-20", amountCents: 50000 });
  assert.deepEqual(nextCharge(plan({ status: "trialing" })), { on: "2026-11-20", amountCents: 50000 });
  assert.deepEqual(nextCharge(plan({ period_end_on: null, current_period_end: "2026-11-21T03:00:00Z" })),
    { on: "2026-11-20", amountCents: 50000 });
  assert.equal(nextCharge(plan({ status: "past_due" })).reason, "late");
  assert.equal(nextCharge(plan({ status: "canceled" })).reason, "not_billing");
  assert.equal(nextCharge(plan({ status: "completed" })).reason, "not_billing");
  assert.equal(nextCharge(plan({ cancel_at_period_end: true })).reason, "ending");
  assert.equal(nextCharge(plan({ renewal_cents: null })).reason, "does_not_renew");
  assert.equal(nextCharge(plan({ renewal_cents: 0 })).reason, "nothing_to_pay");
  assert.equal(nextCharge(plan({ split_pay_required: 6, split_pay_paid: 6 })).reason, "paid_off");
  // A finished split-pay plan is paid off even when Whop has dropped its renewal price.
  assert.equal(nextCharge(plan({ split_pay_required: 6, split_pay_paid: 6, renewal_cents: null })).reason, "paid_off");
  assert.deepEqual(nextCharge(plan({ split_pay_required: 6, split_pay_paid: 5 })), { on: "2026-11-20", amountCents: 50000 });
  assert.equal(nextCharge(plan({ period_end_on: null, current_period_end: null })).reason, "no_charge_day");
});

test("a phone alert is owed from 3 days before the charge through the day itself", () => {
  assert.equal(WHOP_PUSH_DAYS_BEFORE, 3);
  const owed = planWhopPush(plan(), { today: "2026-11-17" });
  assert.deepEqual(owed, {
    push: true, kind: "plan_due", reason: null, key: `whop:${ID}:2026-11-20`,
    subjectId: ID, planId: ID, label: "Consulting Services Package", dueOn: "2026-11-20", daysAway: 3
  });
  assert.equal(planWhopPush(plan(), { today: "2026-11-20" }).push, true);
  assert.equal(planWhopPush(plan(), { today: "2026-11-20" }).daysAway, 0);
  assert.deepEqual(planWhopPush(plan(), { today: "2026-11-16" }),
    { push: false, kind: WHOP_PUSH_KIND, reason: "not_yet", dueOn: "2026-11-20", daysAway: 4 });
  assert.deepEqual(planWhopPush(plan(), { today: "2026-11-21" }),
    { push: false, kind: WHOP_PUSH_KIND, reason: "charge_day_passed", dueOn: "2026-11-20", daysAway: -1 });
});

test("no alert when Whop will not charge, the plan is not tied, or the input is bad", () => {
  const today = "2026-11-18";
  assert.equal(planWhopPush(plan({ status: "past_due" }), { today }).reason, "late");
  assert.equal(planWhopPush(plan({ cancel_at_period_end: true }), { today }).reason, "ending");
  assert.equal(planWhopPush(plan({ split_pay_required: 4, split_pay_paid: 4 }), { today }).reason, "paid_off");
  assert.equal(planWhopPush(plan({ renewal_cents: null }), { today }).reason, "does_not_renew");
  assert.equal(planWhopPush(plan({ unlinked_at: "2026-11-01T00:00:00Z" }), { today }).reason, "not_tied_to_this_client");
  assert.equal(planWhopPush(plan({ id: "mem_abc" }), { today }).reason, "no_plan");
  assert.equal(planWhopPush(null, { today }).reason, "no_plan");
  assert.equal(planWhopPush(plan(), { today: "11/18/2026" }).reason, "bad_today");
});

test("the key names the plan and the day, and reads back", () => {
  const key = planWhopPush(plan(), { today: "2026-11-19" }).key;
  assert.equal(isWhopKey(key), true);
  assert.equal(whopIdOfKey(key), ID);
  assert.equal(isWhopKey("plan:abc:2026-11-20"), false);
  assert.equal(whopIdOfKey("whop:not-a-uuid:2026-11-20"), null);
  assert.equal(whopIdOfKey(`whop:${ID}`), null);
});

test("the label is Whop's product name, else a plain name", () => {
  assert.equal(whopLabel({ product_title: "  Funding Program  " }), "Funding Program");
  assert.equal(whopLabel({ product_title: "" }), "Whop plan");
  assert.equal(whopLabel({}), "Whop plan");
});
