// Slice 1 (money routes): the price ladder, the locked-tile save and the
// ClickFunnels map. Each test runs the REAL api/ handler against a stand-in
// database and judges exactly which values are written, and which are refused.
import assert from "node:assert/strict";
import test from "node:test";

import tiles from "../../../../api/content/tiles.mjs";
import products from "../../../../api/products.mjs";
import sloConnections from "../../../../api/slo-connections.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import {
  ORG_ID, fakeDb, makeRes, req, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";

const PRODUCT_ID = "ab000000-0000-4000-8000-000000000001";
const VIDEO_ID = "0d000000-0000-4000-8000-000000000001";

async function run(handler, request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

// ── products: the ladder ──────────────────────────────────────────────────
const CURRENT = {
  id: PRODUCT_ID, org_id: ORG_ID, code: "funding_bundle", name: "Funding Bundle", category: "funding",
  default_price: "3000", min_price: "2000", max_price: "5000", price_is_variable: true, default_success_fee_percent: "10",
};

const echoUpdate = [/UPDATE products SET/, (sql, p) => [{
  ...CURRENT, name: p[2], category: p[3], default_price: p[4], min_price: p[5], max_price: p[6],
  price_is_variable: p[7], default_success_fee_percent: p[8] ?? CURRENT.default_success_fee_percent,
}]];

test("products save writes the default, minimum, maximum and success-fee percent for the session's company", async () => {
  assert.equal(ROUTES.products, products);
  const { res, fake } = await run(products, req("POST", {
    body: {
      action: "save", code: "funding_bundle", name: "Funding Bundle Plus", default_price: 3500,
      min_price: 2500, max_price: 6000, default_success_fee_percent: 12.5,
    },
  }), [staffSession({ role: "sales_manager" }), [/SELECT \* FROM products/, [CURRENT]], echoUpdate]);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(
    [res.body.product.default_price, res.body.product.min_price, res.body.product.max_price, res.body.product.default_success_fee_percent],
    [3500, 2500, 6000, 12.5],
  );
  const [update] = fake.find(/UPDATE products SET/);
  assert.deepEqual(update.params, [ORG_ID, PRODUCT_ID, "Funding Bundle Plus", "funding", 3500, 2500, 6000, true, 12.5]);
});

test("products create files a new product with a unique code, the typed band and the next sort slot", async () => {
  const { res, fake } = await run(products, req("POST", {
    body: { action: "create", name: "DIY Letters", category: "repair", default_price: 1000, min_price: 900, max_price: 1100, price_is_variable: false },
  }), [
    staffSession(),
    [/SELECT 1 FROM products WHERE org_id/, (sql, p) => (p[1] === "diy_letters" ? [{ one: 1 }] : [])],
    [/MAX\(sort_order\)/, [{ m: 40 }]],
    [/INSERT INTO products/, (sql, p) => [{ id: PRODUCT_ID, org_id: p[0], code: p[1], name: p[2], category: p[3], default_price: p[4], min_price: p[5], max_price: p[6], price_is_variable: p[7], sort_order: p[9] }]],
  ]);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.product.code, "diy_letters_2", "a clashing code gets a numbered suffix, never overwrites");
  const [insert] = fake.find(/INSERT INTO products/);
  assert.deepEqual(insert.params, [ORG_ID, "diy_letters_2", "DIY Letters", "repair", 1000, 900, 1100, false, null, 50]);
});

test("products refuse a minimum above the maximum, a missing product and a closer; the ladder is not touched", async () => {
  const refused = async (body, rules, status, error) => {
    const { res, fake } = await run(products, req("POST", { body }), rules);
    assert.equal(res.statusCode, status, JSON.stringify(body));
    assert.equal(res.body.error, error);
    assert.equal(fake.find(/UPDATE products|INSERT INTO products/).length, 0);
  };
  const owner = [staffSession(), [/SELECT \* FROM products/, [CURRENT]], echoUpdate];
  await refused({ action: "save", code: "funding_bundle", min_price: 9000, max_price: 100 }, owner, 400, "invalid_price_band");
  await refused({ action: "save", code: "nope", name: "x" }, [staffSession(), [/SELECT \* FROM products/, []]], 404, "not_found");
  await refused({ action: "save", code: "funding_bundle", name: "x" }, [staffSession({ role: "closer" })], 403, "forbidden");
});

// ── content/tiles: the locked tiles and the tier-to-video map ────────────
const TILE_READS = [
  [/FROM entitlement_catalog/, [{ code: "metro2-letter-pack", name: "Letters", description: "Two more rounds.", display_price_cents: 45000, active: false, sort_order: 50 }]],
  [/FROM content_videos/, [{ id: VIDEO_ID, title: "Welcome", mime_type: "video/mp4", byte_size: 12, created_at: "2026-10-01T00:00:00Z" }]],
  [/FROM content_tier_map/, [{ tier_code: "default", video_id: VIDEO_ID }]],
  [/FROM products/, []],
];

test("content/tiles save writes the tile name, copy, on-off and the display price in cents, and maps a tier to this company's video", async () => {
  assert.equal(ROUTES["content/tiles"], tiles);
  const { res, fake } = await run(tiles, req("POST", {
    body: {
      action: "save",
      tiles: [{ code: "Metro2-Letter-Pack", name: " Letters ", copy: " Two more rounds. ", price_cents: 45000, on: false }],
      map: { default: VIDEO_ID },
    },
  }), [
    staffSession({ role: "admin" }),
    [/UPDATE entitlement_catalog/, [{ code: "metro2-letter-pack" }]],
    [/SELECT id FROM content_videos WHERE org_id/, [{ id: VIDEO_ID }]],
    [/INSERT INTO content_tier_map/, []],
    ...TILE_READS,
  ]);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [update] = fake.find(/UPDATE entitlement_catalog/);
  assert.deepEqual(update.params, [ORG_ID, "metro2-letter-pack", "Letters", "Two more rounds.", false, 45000]);
  const [mapped] = fake.find(/INSERT INTO content_tier_map/);
  assert.deepEqual(mapped.params, [ORG_ID, "default", VIDEO_ID]);
  assert.equal(res.body.map.default, VIDEO_ID, "the screen redraws from what is on file");
});

test("content/tiles save refuses a fractional price, an unknown tile, a video from another company and a closer; no map row is written", async () => {
  const refused = async (body, rules, status, error, role = "owner") => {
    const { res, fake } = await run(tiles, req("POST", { body }), [staffSession({ role }), ...rules]);
    assert.equal(res.statusCode, status, JSON.stringify(body));
    if (error) assert.equal(res.body.error, error);
    assert.equal(fake.find(/INSERT INTO content_tier_map/).length, 0);
  };
  const tile = { code: "metro2-letter-pack", name: "Letters", on: true };
  await refused({ action: "save", tiles: [{ ...tile, price_cents: 12.5 }] }, [], 400, "invalid_price");
  await refused({ action: "save", tiles: [tile] }, [[/UPDATE entitlement_catalog/, []]], 400, "unknown_tile");
  await refused({ action: "save", map: { default: VIDEO_ID } }, [[/SELECT id FROM content_videos WHERE org_id/, []]], 400, "unknown_video");
  await refused({ action: "save", tiles: [tile] }, [], 403, null, "closer");
});

// ── slo-connections: what a paid ClickFunnels webhook may unlock ─────────
const CONNECTION = { name: "Course SLO", cf_funnel_id: "funnel-1", cf_product_id: "cf-prod-1", product_code: "funding" };

function connectionRules(insert) {
  return [
    staffSession({ role: "admin" }),
    [/FROM products\s+WHERE org_id = \$1::uuid AND lower\(code\)/, [{ id: PRODUCT_ID, code: "funding", name: "Funding" }]],
    [/INSERT INTO slo_connections/, insert],
  ];
}

test("slo-connections POST maps the funnel and product ids to one Fundhub product in the session's company", async () => {
  assert.equal(ROUTES["slo-connections"], sloConnections);
  const { res, fake } = await run(sloConnections, req("POST", { body: CONNECTION }), connectionRules(
    (sql, p) => [{ id: "5c000000-0000-4000-8000-000000000001", name: p[1], cf_funnel_id: p[2], cf_product_id: p[3], product_id: p[4], active: p[5] }],
  ));
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.connection.cf_funnel_id, "funnel-1");
  assert.equal(res.body.connection.product_id, PRODUCT_ID);
  assert.equal(res.body.connection.active, true);
  assert.equal(fake.find(/INSERT INTO slo_connections/)[0].params[0], ORG_ID);
});

test("slo-connections POST answers 409 for a duplicate map, 400 for a missing id or unknown product, and refuses a sales manager", async () => {
  const duplicate = Object.assign(new Error("duplicate key"), { code: "23505" });
  const dup = await run(sloConnections, req("POST", { body: CONNECTION }), connectionRules(duplicate));
  assert.equal(dup.res.statusCode, 409);
  assert.equal(dup.res.body.error, "duplicate_map");

  const missing = await run(sloConnections, req("POST", { body: { ...CONNECTION, cf_product_id: "" } }), connectionRules([]));
  assert.equal(missing.res.statusCode, 400);
  assert.equal(missing.res.body.error, "cf_product_required");
  assert.equal(missing.fake.find(/INSERT INTO slo_connections/).length, 0);

  const noProduct = connectionRules([]);
  noProduct[1] = [/FROM products/, []];
  const unknown = await run(sloConnections, req("POST", { body: CONNECTION }), noProduct);
  assert.equal(unknown.res.statusCode, 400);
  assert.equal(unknown.res.body.error, "product_required");

  const manager = connectionRules([]);
  manager[0] = staffSession({ role: "sales_manager" });
  const denied = await run(sloConnections, req("POST", { body: CONNECTION }), manager);
  assert.equal(denied.res.statusCode, 403);
});
