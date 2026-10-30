// CAPITAL BLUEPRINT ACCEPTANCE — POSITIVE REGRESSION (2026-10-30).
//
// The independent 12-month included FinanceOS service survives a preexisting
// one-month paid subscription. These assertions prove source behavior only.
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
const BLUEPRINT_GRANT = "44444444-4444-4444-4444-444444444444";
const MONTHLY_START = new Date("2026-10-01T00:00:00Z");
const MONTHLY_END = new Date("2026-11-01T00:00:00Z");
const BLUEPRINT_PAID = new Date("2026-10-29T00:00:00Z");
const INCLUDED_END = new Date("2027-10-29T00:00:00Z");

function inMonthlyPeriod(asOf) {
  const n = new Date(asOf).valueOf();
  return n >= MONTHLY_START.valueOf() && n < MONTHLY_END.valueOf();
}

function inBlueprintYear(asOf) {
  const n = new Date(asOf).valueOf();
  return n >= BLUEPRINT_PAID.valueOf() && n < INCLUDED_END.valueOf();
}

function isolatedMonthlyDb() {
  const calls = [];
  return {
    calls,
    async query(sql, args = []) {
      calls.push({ sql, args });
      if (/^\s*WITH blueprint_access/i.test(sql)) {
        // Source-level SQL contract pins the grant to a successful transaction.
        assert.match(sql, /resolve_product_id/);
        assert.match(sql, /e\.revoked_at IS NULL/);
        assert.match(sql, /paid\.org_id = b\.org_id AND paid\.client_id = b\.client_id/);
        return { rows: inMonthlyPeriod(args[1]) ? [{
          subscription_id: MONTHLY_SUB, org_id: ORG, client_id: CLIENT,
          current_period_start: MONTHLY_START
        }] : inBlueprintYear(args[1]) ? [{
          subscription_id: BLUEPRINT_GRANT, org_id: ORG, client_id: CLIENT,
          current_period_start: BLUEPRINT_PAID
        }] : [] };
      }
      if (/FROM\s+subscriptions\b/i.test(sql)) {
        // financeOsEntitlement()'s own date-scoped subscription lookup.
        return { rows: inMonthlyPeriod(args[3]) ? [{ id: MONTHLY_SUB }] : [] };
      }
      if (/FROM\s+entitlements\s+e/i.test(sql)) {
        assert.match(sql, /t\.org_id = e\.org_id AND t\.client_id = e\.client_id/);
        assert.match(sql, /interval '12 months'/);
        return { rows: args[0] === ORG && args[1] === CLIENT && inBlueprintYear(args[2])
          ? [{ id: BLUEPRINT_GRANT }] : [] };
      }
      throw new Error("Unexpected query in read-only Blueprint collision harness");
    }
  };
}

test("BP-06: monthly FinanceOS billing is unchanged and Blueprint included access lasts 12 months", async () => {
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
  assert.equal(afterMonthlyEnds.entitled, true);
  assert.equal(afterMonthlyEnds.subscriptionId, BLUEPRINT_GRANT);
  assert.equal((await financeOsEntitlement(db, { orgId: ORG, clientId: CLIENT,
    asOf: new Date("2027-10-28T00:00:00Z") })).entitled, true);
  assert.equal((await financeOsEntitlement(db, { orgId: ORG, clientId: CLIENT,
    asOf: INCLUDED_END })).entitled, false);
});

test("BP-14: a Blueprint buyer remains monthly-refresh eligible after separate monthly plan expiry", async () => {
  const db = isolatedMonthlyDb();
  assert.equal((await dueClients(db, BLUEPRINT_PAID)).length, 1,
    "the existing monthly subscription is eligible in its paid window");
  const duringBlueprintYear = new Date("2026-11-30T00:00:00Z");
  assert.ok(duringBlueprintYear < INCLUDED_END);
  assert.equal((await dueClients(db, duringBlueprintYear))[0].subscription_id, BLUEPRINT_GRANT);
  assert.deepEqual(await dueClients(db, INCLUDED_END), []);
  assert.equal(db.calls.some(({ sql }) => /\bINSERT\b|\bUPDATE\b/i.test(sql)), false,
    "harness performs no writes");
});
