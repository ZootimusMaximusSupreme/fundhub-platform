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
  ORG_ID, OTHER_ORG_ID, fakeDb, makeRes, req, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";
import { clause, rolesLetIn, shelf } from "./s1-proof-kit.mjs";

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
const FOREIGN_PRODUCT_ID = "ab000000-0000-4000-8000-0000000000ff";
// The other company's product has the SAME code and is listed first, so a
// company condition taken out of the SQL puts it on top.
const THEIRS = { ...CURRENT, id: FOREIGN_PRODUCT_ID, org_id: OTHER_ORG_ID, name: "Their Funding Bundle", default_price: "9" };
const ORG_CLAUSE = clause(/org_id = \$1::uuid/, (row, [org]) => row.org_id === org);
const productLookup = [/SELECT \* FROM products/, shelf([THEIRS, CURRENT], [
  ORG_CLAUSE,
  clause(/lower\(code\) = lower\(\$2\)/, (row, p) => row.code.toLowerCase() === String(p[1]).toLowerCase()),
])];

const echoUpdate = [/UPDATE products SET/, (sql, p) => shelf([THEIRS, CURRENT], [
  ORG_CLAUSE,
  clause(/AND id = \$2::uuid/, (row, params) => row.id === params[1]),
])(sql, p).map((row) => ({
  ...row, name: p[2], category: p[3], default_price: p[4], min_price: p[5], max_price: p[6],
  price_is_variable: p[7], default_success_fee_percent: p[8] ?? row.default_success_fee_percent,
}))];

test("products save writes the default, minimum, maximum and success-fee percent for the session's company only", async () => {
  assert.equal(ROUTES.products, products);
  const { res, fake } = await run(products, req("POST", {
    body: {
      action: "save", code: "funding_bundle", name: "Funding Bundle Plus", default_price: 3500,
      min_price: 2500, max_price: 6000, default_success_fee_percent: 12.5,
    },
  }), [staffSession({ role: "sales_manager" }), productLookup, echoUpdate]);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.product.id, PRODUCT_ID, "this company's product, not the other company's with the same code");
  assert.deepEqual(
    [res.body.product.default_price, res.body.product.min_price, res.body.product.max_price, res.body.product.default_success_fee_percent],
    [3500, 2500, 6000, 12.5],
  );
  const [update] = fake.find(/UPDATE products SET/);
  assert.deepEqual(update.params, [ORG_ID, PRODUCT_ID, "Funding Bundle Plus", "funding", 3500, 2500, 6000, true, 12.5]);
});

test("products create files a new product with a unique code in this company, the typed band and the next sort slot", async () => {
  const taken = shelf([
    { org_id: ORG_ID, code: "diy_letters" },
    { org_id: OTHER_ORG_ID, code: "diy_letters_2" },
  ], [ORG_CLAUSE, clause(/lower\(code\) = lower\(\$2\)/, (row, p) => row.code === String(p[1]).toLowerCase())]);
  const { res, fake } = await run(products, req("POST", {
    body: { action: "create", name: "DIY Letters", category: "repair", default_price: 1000, min_price: 900, max_price: 1100, price_is_variable: false },
  }), [
    staffSession(),
    [/SELECT 1 FROM products WHERE org_id/, taken],
    [/MAX\(sort_order\)/, [{ m: 40 }]],
    [/INSERT INTO products/, (sql, p) => [{ id: PRODUCT_ID, org_id: p[0], code: p[1], name: p[2], category: p[3], default_price: p[4], min_price: p[5], max_price: p[6], price_is_variable: p[7], sort_order: p[9] }]],
  ]);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.product.code, "diy_letters_2", "a clashing code gets a numbered suffix, and only this company's codes clash");
  const [insert] = fake.find(/INSERT INTO products/);
  assert.deepEqual(insert.params, [ORG_ID, "diy_letters_2", "DIY Letters", "repair", 1000, 900, 1100, false, null, 50]);
});

test("products refuse a minimum above the maximum and a missing product; only owner, admin and sales manager may touch the ladder", async () => {
  const refused = async (body, rules, status, error) => {
    const { res, fake } = await run(products, req("POST", { body }), rules);
    assert.equal(res.statusCode, status, JSON.stringify(body));
    assert.equal(res.body.error, error);
    assert.equal(fake.find(/UPDATE products|INSERT INTO products/).length, 0);
  };
  const owner = [staffSession(), productLookup, echoUpdate];
  await refused({ action: "save", code: "funding_bundle", min_price: 9000, max_price: 100 }, owner, 400, "invalid_price_band");
  await refused({ action: "save", code: "nope", name: "x" }, owner, 404, "not_found");

  const letIn = await rolesLetIn(async (role) => {
    const { res, fake } = await run(products, req("POST", { body: { action: "save", code: "funding_bundle", name: "x" } }),
      [staffSession({ role }), productLookup, echoUpdate]);
    if (res.statusCode === 403) assert.equal(fake.find(/UPDATE products|INSERT INTO products/).length, 0, `${role} was refused but the ladder moved`);
    return res.statusCode;
  });
  assert.deepEqual(letIn, ["admin", "owner", "sales_manager"]);
});

// ── content/tiles: the locked tiles and the tier-to-video map ────────────
const TILE_READS = [
  [/FROM entitlement_catalog/, [{ code: "metro2-letter-pack", name: "Letters", description: "Two more rounds.", display_price_cents: 45000, active: false, sort_order: 50 }]],
  [/FROM content_videos/, [{ id: VIDEO_ID, title: "Welcome", mime_type: "video/mp4", byte_size: 12, created_at: "2026-10-01T00:00:00Z" }]],
  [/FROM content_tier_map/, [{ tier_code: "default", video_id: VIDEO_ID }]],
  [/FROM products/, []],
];
const FOREIGN_VIDEO_ID = "0d000000-0000-4000-8000-0000000000ff";
const TILE_ROWS = [
  { org_id: OTHER_ORG_ID, code: "metro2-letter-pack" },
  { org_id: ORG_ID, code: "metro2-letter-pack" },
];

// Per call: the tile rows the UPDATE's own SQL would reach are kept in `touched`.
function tileRules(touched) {
  return [
    [/UPDATE entitlement_catalog/, (sql, p) => {
      const rows = shelf(TILE_ROWS, [
        clause(/WHERE org_id = \$1::uuid/, (row, [org]) => row.org_id === org),
        clause(/AND code = \$2/, (row, params) => row.code === params[1]),
      ])(sql, p);
      touched.push(...rows);
      return rows.map((row) => ({ code: row.code }));
    }],
    [/SELECT id FROM content_videos WHERE org_id/, shelf([{ id: VIDEO_ID, org_id: ORG_ID }, { id: FOREIGN_VIDEO_ID, org_id: OTHER_ORG_ID }], [
      clause(/WHERE org_id = \$1::uuid/, (row, [org]) => row.org_id === org),
      clause(/AND id = \$2::uuid/, (row, p) => row.id === p[1]),
    ])],
    [/INSERT INTO content_tier_map/, []],
    ...TILE_READS,
  ];
}

test("content/tiles save writes the tile name, copy, on-off and the display price in cents for this company only, and maps a tier to this company's video", async () => {
  assert.equal(ROUTES["content/tiles"], tiles);
  const touched = [];
  const { res, fake } = await run(tiles, req("POST", {
    body: {
      action: "save",
      tiles: [{ code: "Metro2-Letter-Pack", name: " Letters ", copy: " Two more rounds. ", price_cents: 45000, on: false }],
      map: { default: VIDEO_ID },
    },
  }), [staffSession({ role: "admin" }), ...tileRules(touched)]);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [update] = fake.find(/UPDATE entitlement_catalog/);
  assert.deepEqual(update.params, [ORG_ID, "metro2-letter-pack", "Letters", "Two more rounds.", false, 45000]);
  assert.deepEqual(touched, [{ org_id: ORG_ID, code: "metro2-letter-pack" }], "the other company's tile with the same code is not reached");
  const [mapped] = fake.find(/INSERT INTO content_tier_map/);
  assert.deepEqual(mapped.params, [ORG_ID, "default", VIDEO_ID]);
  assert.equal(res.body.map.default, VIDEO_ID, "the screen redraws from what is on file");
});

test("content/tiles save refuses a fractional price, an unknown tile and another company's video, and lets only owner and admin in; no map row is written", async () => {
  const refused = async (body, rules, status, error, role = "owner") => {
    const { res, fake } = await run(tiles, req("POST", { body }), [staffSession({ role }), ...rules]);
    assert.equal(res.statusCode, status, JSON.stringify(body));
    if (error) assert.equal(res.body.error, error);
    assert.equal(fake.find(/INSERT INTO content_tier_map/).length, 0);
  };
  const tile = { code: "metro2-letter-pack", name: "Letters", on: true };
  await refused({ action: "save", tiles: [{ ...tile, price_cents: 12.5 }] }, tileRules([]), 400, "invalid_price");
  await refused({ action: "save", tiles: [{ ...tile, code: "not-a-tile" }] }, tileRules([]), 400, "unknown_tile");
  await refused({ action: "save", map: { default: FOREIGN_VIDEO_ID } }, tileRules([]), 400, "unknown_video");

  const letIn = await rolesLetIn(async (role) => {
    const { res, fake } = await run(tiles, req("POST", { body: { action: "save", tiles: [tile] } }), [staffSession({ role }), ...tileRules([])]);
    if (res.statusCode === 403) assert.equal(fake.find(/UPDATE entitlement_catalog/).length, 0, `${role} was refused but a tile changed`);
    return res.statusCode;
  });
  assert.deepEqual(letIn, ["admin", "owner"]);
});

// ── slo-connections: what a paid ClickFunnels webhook may unlock ─────────
const CONNECTION = { name: "Course SLO", cf_funnel_id: "funnel-1", cf_product_id: "cf-prod-1", product_code: "funding" };

function connectionRules(insert) {
  const FOREIGN = { id: "ab000000-0000-4000-8000-0000000000ff", org_id: OTHER_ORG_ID, code: "funding", name: "Their Funding" };
  return [
    staffSession({ role: "admin" }),
    // Both companies have a product coded "funding"; theirs is listed first.
    [/FROM products\s+WHERE org_id = \$1::uuid AND lower\(code\)/, shelf([FOREIGN, { id: PRODUCT_ID, org_id: ORG_ID, code: "funding", name: "Funding" }], [
      clause(/WHERE org_id = \$1::uuid/, (row, [org]) => row.org_id === org),
      clause(/lower\(code\) = lower\(\$2\)/, (row, p) => row.code === String(p[1]).toLowerCase()),
    ])],
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
  assert.equal(res.body.connection.product_id, PRODUCT_ID, "this company's product, not the other company's with the same code");
  assert.equal(res.body.connection.active, true);
  assert.equal(fake.find(/INSERT INTO slo_connections/)[0].params[0], ORG_ID);
});

test("slo-connections POST answers 409 for a duplicate map, 400 for a missing id or unknown product, and lets only owner and admin in", async () => {
  const duplicate = Object.assign(new Error("duplicate key"), { code: "23505" });
  const dup = await run(sloConnections, req("POST", { body: CONNECTION }), connectionRules(duplicate));
  assert.equal(dup.res.statusCode, 409);
  assert.equal(dup.res.body.error, "duplicate_map");

  const missing = await run(sloConnections, req("POST", { body: { ...CONNECTION, cf_product_id: "" } }), connectionRules([]));
  assert.equal(missing.res.statusCode, 400);
  assert.equal(missing.res.body.error, "cf_product_required");
  assert.equal(missing.fake.find(/INSERT INTO slo_connections/).length, 0);

  const unknown = await run(sloConnections, req("POST", { body: { ...CONNECTION, product_code: "not-ours" } }), connectionRules([]));
  assert.equal(unknown.res.statusCode, 400);
  assert.equal(unknown.res.body.error, "product_required");

  const letIn = await rolesLetIn(async (role) => {
    const rules = connectionRules([]);
    rules[0] = staffSession({ role });
    const { res, fake } = await run(sloConnections, req("POST", { body: CONNECTION }), rules);
    if (res.statusCode === 403) assert.equal(fake.find(/INSERT INTO slo_connections/).length, 0, `${role} was refused but a map was written`);
    return res.statusCode;
  });
  assert.deepEqual(letIn, ["admin", "owner"]);
});
