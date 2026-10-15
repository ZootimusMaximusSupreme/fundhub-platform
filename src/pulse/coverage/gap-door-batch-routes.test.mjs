import assert from "node:assert/strict";
import test from "node:test";

import { makeRecipe } from "../catalog/door-recipes.mjs";
import {
  CHECK_IDS,
  EXPECTED_ROUTE_GAP_COUNTS,
  ROUTE_GAP_ROWS,
  gapChecks,
  judgeRouteGap,
} from "./gap-door-batch-routes.mjs";

test("the route gap monitor owns the exact 97 rows", () => {
  const counts = ROUTE_GAP_ROWS.reduce((out, row) => {
    out[row.sourceFile] = (out[row.sourceFile] || 0) + 1;
    return out;
  }, {});
  assert.deepEqual(counts, EXPECTED_ROUTE_GAP_COUNTS);
  assert.equal(ROUTE_GAP_ROWS.length, 97);
  assert.equal(CHECK_IDS.length, 97);
  assert.equal(new Set(CHECK_IDS).size, 97);
});

test("every missing route result emits one exact not-proved row", async () => {
  const results = await gapChecks();
  assert.equal(results.length, 97);
  for (let index = 0; index < ROUTE_GAP_ROWS.length; index += 1) {
    const source = ROUTE_GAP_ROWS[index];
    const result = results[index];
    assert.equal(result.id, source.id);
    assert.equal(result.status, "NOT_PROVED", source.id);
    assert.ok(result.detail.includes(source.surface), source.id);
    assert.ok(result.detail.includes(source.control), source.id);
    assert.match(result.detail, /No fake-data check calls .* named business result, so this route stays not proved\.$/);
    assert.doesNotMatch(result.detail, /(?:the API|the route|the business result) works/i);
  }
});

test("money and customer rows stay below deep while the exact red lane keeps them wired", () => {
  const sensitive = ROUTE_GAP_ROWS.filter((row) =>
    ["money", "customerMessage", "customerData"].includes(row.impact)
  );
  assert.ok(sensitive.length > 0);
  for (const row of sensitive) {
    const recipe = makeRecipe(row.sourceFile, row);
    assert.equal(recipe.proof.depth, "e2e", row.id);
    assert.equal(recipe.proof.verdict, "red", row.id);
    assert.match(recipe.proof.evidence, /src\/pulse\/coverage\/gap-door-batch-routes\.mjs/);
    assert.match(recipe.proof.asserts, /monitor stays red until an intended-method fake-data test judges this named result$/);
    assert.doesNotMatch(recipe.proof.asserts, /(?:the API|the route) works|business result is proved/i);
  }
});

test("a missing handler stays not proved and names the missing context", () => {
  const source = ROUTE_GAP_ROWS[0];
  const result = judgeRouteGap(source, {});
  assert.equal(result.status, "NOT_PROVED");
  assert.ok(result.detail.includes(source.surface));
  assert.ok(result.detail.includes(source.control));
  assert.match(result.detail, new RegExp(`${source.route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} handler is not registered`));
});
