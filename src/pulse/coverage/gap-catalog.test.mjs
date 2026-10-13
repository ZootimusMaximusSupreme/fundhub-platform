import test from "node:test";
import assert from "node:assert/strict";

import catalog from "../catalog/generated.json" with { type: "json" };
import {
  CHECK_IDS,
  EXPECTED_REPEATS,
  MIN_MAPPED_ROWS,
  MIN_UNIQUE_ITEMS,
  gapChecks,
  judgeCatalog
} from "./gap-catalog.mjs";
import { GAP_FILES } from "./modules.mjs";

test("catalog lane is bundled and the saved map cannot shrink", async () => {
  assert.ok(GAP_FILES.some(([name]) => name === "gap-catalog.mjs"));
  assert.ok(catalog.rows >= MIN_MAPPED_ROWS);
  assert.equal(catalog.repeats, EXPECTED_REPEATS);
  assert.ok(catalog.unique >= MIN_UNIQUE_ITEMS);
  assert.equal(catalog.items.length, catalog.unique);
  assert.equal(new Set(catalog.items.map((item) => item.id)).size, catalog.unique);
  assert.equal(catalog.counts.wired + catalog.counts.red, catalog.unique);
});

test("catalog lane keeps every unproved item red", async () => {
  const rows = await gapChecks();
  assert.deepEqual(rows.map((item) => item.id), [...CHECK_IDS]);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].status, catalog.counts.red ? "FAIL" : "PASS");
  assert.match(rows[1].detail, new RegExp(`${catalog.counts.red} remain red|All ${catalog.unique}`));
});

test("catalog lane fails on missing rows, duplicate ids, and weak proof", () => {
  const weak = {
    rows: MIN_MAPPED_ROWS - 1,
    repeats: EXPECTED_REPEATS,
    unique: 2,
    counts: { wired: 1, red: 1 },
    items: [{ id: "same" }, { id: "same" }]
  };
  const rows = judgeCatalog(weak);
  assert.deepEqual(rows.map((item) => item.status), ["FAIL", "FAIL", "FAIL"]);
  assert.ok(rows.every((item) => typeof item.suggestedFix === "string"));
});

test("catalog lane passes only when the complete map has proof for every item", () => {
  const complete = {
    rows: MIN_MAPPED_ROWS,
    repeats: EXPECTED_REPEATS,
    unique: MIN_UNIQUE_ITEMS,
    counts: { wired: MIN_UNIQUE_ITEMS, red: 0 },
    hourlyUncoveredSurfaces: [],
    items: Array.from({ length: MIN_UNIQUE_ITEMS }, (_, index) => ({ id: `item-${index}` }))
  };
  assert.deepEqual(judgeCatalog(complete).map((item) => item.status), ["PASS", "PASS", "PASS"]);
});


test("hourly coverage gaps stay red and missing build data is never a pass", () => {
  const uncovered = judgeCatalog({ ...catalog, hourlyUncoveredSurfaces: ["route:money/payments"] })[2];
  assert.equal(uncovered.status, "FAIL");
  assert.match(uncovered.detail, /1 customer or money/);
  assert.match(uncovered.detail, /route:money\/payments/);
  assert.equal(judgeCatalog({ ...catalog, hourlyUncoveredSurfaces: undefined })[2].status, "FAIL");
  assert.equal(judgeCatalog({ ...catalog, hourlyUncoveredSurfaces: [] })[2].status, "PASS");
});
