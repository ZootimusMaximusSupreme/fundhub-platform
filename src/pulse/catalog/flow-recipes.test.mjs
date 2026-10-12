import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { makeRecipe, supports } from "./flow-recipes.mjs";

const MAPS = Object.freeze([
  ["messages.json", "../../../ops/workflows/coverage-every-surface-2026-10-10/messages.json"],
  ["journeys.json", "../../../ops/workflows/coverage-every-surface-2026-10-10/journeys.json"],
  ["agents.json", "../../../ops/workflows/coverage-every-surface-2026-10-10/agents.json"],
]);

const MODES = new Set(["read-only", "test", "receipt", "manual-red"]);
const RECIPE_KEYS = ["expected", "family", "mode", "safe", "schedule", "sourceFile", "surface", "target"];

function load(relativePath) {
  return JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

test("every flow map row gets one valid safe recipe", () => {
  let total = 0;

  for (const [sourceFile, relativePath] of MAPS) {
    const rows = load(relativePath);
    for (const row of rows) {
      assert.equal(supports(sourceFile, row), true, `${sourceFile}: ${row.surface}`);

      const recipe = makeRecipe(sourceFile, row);
      assert.deepEqual(Object.keys(recipe).sort(), RECIPE_KEYS, `${sourceFile}: ${row.surface}`);
      assert.equal(typeof recipe.family, "string");
      assert.equal(MODES.has(recipe.mode), true, `${sourceFile}: ${row.surface}`);
      assert.equal(recipe.target, row.surface);
      assert.equal(typeof recipe.expected, "string");
      assert.notEqual(recipe.expected.length, 0);
      assert.equal(recipe.schedule, "daily");
      assert.equal(recipe.safe, true);
      assert.equal(recipe.sourceFile, sourceFile);
      assert.equal(recipe.surface, row.surface);
      total += 1;
    }
  }

  assert.equal(total, 653);
});

test("message rows below deep stay visibly red", () => {
  const rows = load(MAPS[0][1]);
  for (const row of rows.filter((candidate) => candidate.coverage !== "deep")) {
    assert.equal(makeRecipe("messages.json", row).mode, "manual-red", row.surface);
  }
});

test("journey steps below deep stay visibly red", () => {
  const rows = load(MAPS[1][1]);
  for (const row of rows.filter((candidate) => candidate.coverage !== "deep")) {
    assert.equal(makeRecipe("journeys.json", row).mode, "manual-red", row.surface);
  }
});

test("agent modes never claim receipt proof", () => {
  const rows = load(MAPS[2][1]);
  const expectedModes = { deep: "read-only", e2e: "test", ping: "read-only", none: "manual-red" };

  for (const row of rows) {
    const recipe = makeRecipe("agents.json", row);
    assert.equal(recipe.mode, expectedModes[row.coverage], row.surface);
    assert.notEqual(recipe.mode, "receipt", row.surface);
  }
});

test("unknown sources and malformed rows are rejected", () => {
  assert.equal(supports("buttons.json", { surface: "button:x" }), false);
  assert.equal(supports("messages.json", {}), false);
  assert.throws(() => makeRecipe("buttons.json", { surface: "button:x" }), /Unsupported flow recipe row/);
});
