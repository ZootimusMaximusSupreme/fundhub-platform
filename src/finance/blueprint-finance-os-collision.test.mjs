// CAPITAL BLUEPRINT ACCEPTANCE — KNOWN FAILURE REPRODUCTION (2026-10-29).
//
// This is deliberately a *negative* acceptance test: it demonstrates the
// current source's under-delivery rather than certifying the product. When
// the independent 12-month included FinanceOS grant is implemented, replace
// these assertions with the desired through-year PASS contract.
// Synthetic in-memory query responses only: no payments, customer writes,
// real Postgres, credit pulls or provider calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ensureFinanceOsForBlueprintPurchase,
  financeOsEntitlement
} from "./finance-os-entitlement.mjs";
import { dueClients } from "../workflows/finance-os-pull-sweeper.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const MONTHLY_SUB = "33333333-3333-3333-3333-333333333333";
const MONTHLY_START = new Date("2026-10-01T00:00:00Z");
const MONTHLY_END = new Date("2026-11-01T00:00:00Z");
const BLUEPRINT_PAID = new Date("2026-10-29T00:00:00Z");
const INCLUDED_END = new Date("2027-10-29T00:00:00Z");

function inMonthlyPeriod(asOf) {
  const n = new Date(asOf).valueOf();
  return n >= MONTHLY_START.valueOf() && n < MONTHLY_END.valueOf();
}

function isolatedMonthlyDb() {
  const calls = [];
  return {
    calls,
    async query(sql, args = []) {
      calls.push({ sql, args });
      if (/FROM\s+subscriptions\s+s\b/i.test(sql)) {
        // The sweeper reads live subscription rows directly, not the
        // Blueprint purchase/entitlements ledger.
        return { rows: inMonthlyPeriod(args[1])
          ? [{
              subscription_id: MONTHLY_SUB,
              org_id: ORG,
              client_id: CLIENT,
              current_period_start: MONTHLY_START
            }]
          : [] };
      }
      if (/FROM\s+subscriptions\b/i.test(sql)) {
        // financeOsEntitlement()'s own date-scoped subscription lookup.
        return { rows: inMonthlyPeriod(args[3]) ? [{ id: MONTHLY_SUB }] : [] };
      }
      throw new Error("Unexpected query in read-only Blueprint collision harness");
    }
  };
}

test("KNOWN BP-06 FAIL: a monthly FinanceOS plan active at Blueprint purchase prevents the 12-month grant", async () => {
  const db = isolatedMonthlyDb();
  const result = await ensureFinanceOsForBlueprintPurchase(db, {
    orgId: ORG, clientId: CLIENT, paidAt: BLUEPRINT_PAID,
    productCode: BLUEPRINT_PRODUCT_CODE
  });
  assert.equal(result.created, false);
  assert.equal(result.reason, "already_entitled");
  assert.equal(result.subscriptionId, MONTHLY_SUB);
  assert.equal(db.calls.some(({ sql }) => /\bINSERT\b/i.test(sql)), false,
    "no independent 12-month included entitlement was created");
  assert.ok(INCLUDED_END > MONTHLY_END, "the purchased included year extends beyond monthly expiry");

  const afterMonthlyEnds = await financeOsEntitlement(db, {
    orgId: ORG, clientId: CLIENT, asOf: new Date("2026-11-02T00:00:00Z")
  });
  assert.equal(afterMonthlyEnds.entitled, false,
    "KNOWN GAP: buyer loses FinanceOS while the paid Blueprint year is still active");
});

test("KNOWN BP-14 FAIL: the subscription-only monthly sweeper also loses the Blueprint buyer after monthly expiry", async () => {
  const db = isolatedMonthlyDb();
  assert.equal((await dueClients(db, BLUEPRINT_PAID)).length, 1,
    "the existing monthly subscription is eligible in its paid window");
  const duringBlueprintYear = new Date("2026-11-30T00:00:00Z");
  assert.ok(duringBlueprintYear < INCLUDED_END);
  assert.deepEqual(await dueClients(db, duringBlueprintYear), [],
    "KNOWN GAP: no 12-month included grant makes the monthly refresh candidate disappear");
  assert.equal(db.calls.some(({ sql }) => /\bINSERT\b|\bUPDATE\b/i.test(sql)), false,
    "harness performs no writes");
});
