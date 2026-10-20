import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  financeOsEntitlement,
  FINANCE_OS_TIER,
  ensureFinanceOsForBlueprintPurchase
} from "./finance-os-entitlement.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const SUB = "33333333-3333-3333-3333-333333333333";

/** Records the query and hands back a queued row, or none. */
function fakeDb(rows = []) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows };
    }
  };
}

describe("financeOsEntitlement", () => {
  test("both orgId and clientId are required — no query is issued without them", async () => {
    for (const args of [{}, { orgId: ORG }, { clientId: CLIENT }]) {
      const db = fakeDb();
      const r = await financeOsEntitlement(db, args);
      assert.equal(r.entitled, false);
      assert.equal(r.subscriptionId, null);
      assert.deepEqual(db.calls, []);
    }
  });

  test("an active row entitles the client", async () => {
    const db = fakeDb([{ id: SUB }]);
    const r = await financeOsEntitlement(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(r.entitled, true);
    assert.equal(r.subscriptionId, SUB);
    assert.equal(r.reason, null);
  });

  test("no matching row is not entitled, with a stated reason", async () => {
    const db = fakeDb([]);
    const r = await financeOsEntitlement(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(r.entitled, false);
    assert.equal(r.subscriptionId, null);
    assert.match(r.reason, /no active/);
  });

  test("the query scopes on org, client, tier and status='active' — not on client alone", async () => {
    const db = fakeDb([{ id: SUB }]);
    await financeOsEntitlement(db, { orgId: ORG, clientId: CLIENT });
    const [{ text, params }] = db.calls;
    assert.match(text, /org_id\s*=\s*\$1/);
    assert.match(text, /client_id\s*=\s*\$2/);
    assert.match(text, /tier\s*=\s*\$3/);
    assert.match(text, /status\s*=\s*'active'/);
    assert.equal(params[0], ORG);
    assert.equal(params[1], CLIENT);
    assert.equal(params[2], FINANCE_OS_TIER);
  });

  test("the window check covers effective_from/effective_to, not just status", async () => {
    // A cancelled-but-not-yet-superseded row (status='active' with
    // effective_to in the past would be a data bug, but the query must not
    // rely on status alone to find the LIVE row — 075's own convention).
    const db = fakeDb([{ id: SUB }]);
    await financeOsEntitlement(db, { orgId: ORG, clientId: CLIENT, asOf: new Date("2026-01-01") });
    const [{ text, params }] = db.calls;
    assert.match(text, /effective_from\s*<=\s*\$4/);
    assert.match(text, /effective_to IS NULL OR effective_to\s*>\s*\$4/);
    assert.match(text, /current_period_start IS NULL OR current_period_start <= \$4/);
    assert.match(text, /current_period_end IS NULL OR current_period_end > \$4/);
    assert.deepEqual(params[3], new Date("2026-01-01"));
  });

  test("price_cents being unset is not part of the gate — the query never mentions it", async () => {
    const db = fakeDb([{ id: SUB }]);
    await financeOsEntitlement(db, { orgId: ORG, clientId: CLIENT });
    assert.doesNotMatch(db.calls[0].text, /price_cents/);
  });
});

describe("ensureFinanceOsForBlueprintPurchase", () => {
  test("skips non-blueprint products", async () => {
    const db = fakeDb([]);
    const r = await ensureFinanceOsForBlueprintPurchase(db, {
      orgId: ORG,
      clientId: CLIENT,
      productCode: "diy-letter-pack"
    });
    assert.equal(r.created, false);
    assert.equal(r.reason, "not_blueprint_product");
  });

  test("skips when already entitled", async () => {
    const db = fakeDb([{ id: SUB }]);
    const r = await ensureFinanceOsForBlueprintPurchase(db, {
      orgId: ORG,
      clientId: CLIENT,
      productCode: BLUEPRINT_PRODUCT_CODE
    });
    assert.equal(r.created, false);
    assert.equal(r.reason, "already_entitled");
    assert.equal(r.subscriptionId, SUB);
  });
});
