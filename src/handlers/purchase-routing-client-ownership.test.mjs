// A purchase event's client ID must belong to the event's organization before
// paid-sale, card, tag, or fulfillment work is even considered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findClient, onPurchaseRoute } from "./purchase-routing.mjs";

test("an explicit foreign-org client ID stops before any sale or card lookup", async () => {
  const queries = [];
  const db = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    }
  };
  const result = await onPurchaseRoute({
    name: "payment.received", orgId: "org-A", clientId: "client-B", payload: {}
  }, db);
  assert.equal(result.routed, false);
  assert.equal(result.reason, "no_client");
  assert.equal(queries.length, 1, "no sale, card or fulfillment queries after identity refusal");
  assert.match(queries[0].sql, /FROM clients WHERE id = \$1 AND org_id = \$2/);
  assert.deepEqual(queries[0].params, ["client-B", "org-A"]);
});

test("an owned client ID reaches payment-category check but does not invent paid work", async () => {
  const queries = [];
  const db = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("FROM clients WHERE id")) return { rows: [{ id: "client-A" }] };
      if (sql.includes("FROM sales s")) return { rows: [] };
      throw new Error("unexpected query: " + sql);
    }
  };
  const result = await onPurchaseRoute({
    name: "payment.received", orgId: "org-A", clientId: "client-A", payload: {}
  }, db);
  assert.equal(result.routed, false);
  assert.equal(result.reason, "no_product_path");
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].params, ["client-A", "org-A"]);
  assert.deepEqual(queries[1].params, ["org-A", "client-A"]);
});

test("email-only fallback still resolves inside the exact organization", async () => {
  const queries = [];
  const db = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [{ id: "client-email" }] };
    }
  };
  const id = await findClient(db, {
    orgId: "org-A", payload: { email: " Buyer@Example.Test " }
  });
  assert.equal(id, "client-email");
  assert.deepEqual(queries[0].params, ["org-A", "buyer@example.test"]);
  assert.match(queries[0].sql, /WHERE org_id = \$1 AND lower\(email\) = \$2/);
});

test("missing organization never queries or creates a client", async () => {
  const db = { query: async () => { throw new Error("must not query"); } };
  assert.equal(await findClient(db, { clientId: "client-A" }), null);
});
