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
const PROOF_KEYS = ["asserts", "depth", "evidence"];

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
      const expectedKeys = recipe.proof ? [...RECIPE_KEYS, "proof"].sort() : RECIPE_KEYS;
      assert.deepEqual(Object.keys(recipe).sort(), expectedKeys, `${sourceFile}: ${row.surface}`);
      assert.equal(typeof recipe.family, "string");
      assert.equal(MODES.has(recipe.mode), true, `${sourceFile}: ${row.surface}`);
      assert.equal(recipe.target, row.surface);
      assert.equal(typeof recipe.expected, "string");
      assert.notEqual(recipe.expected.length, 0);
      assert.equal(recipe.schedule, "daily");
      assert.equal(recipe.safe, true);
      assert.equal(recipe.sourceFile, sourceFile);
      assert.equal(recipe.surface, row.surface);
      if (recipe.proof) {
        assert.deepEqual(Object.keys(recipe.proof).filter((key) => key !== "verdict").sort(), PROOF_KEYS, row.surface);
        if (recipe.proof.verdict !== undefined) assert.equal(recipe.proof.verdict, "red", row.surface);
        assert.equal(["e2e", "deep"].includes(recipe.proof.depth), true, row.surface);
        assert.match(recipe.proof.evidence, /\.test\.mjs\b/, row.surface);
        assert.equal(recipe.proof.asserts, row.control, row.surface);
      }
      total += 1;
    }
  }

  assert.equal(total, 653);
});

test("message rows without executable result proof stay visibly red", () => {
  const rows = load(MAPS[0][1]);
  for (const row of rows) {
    const recipe = makeRecipe("messages.json", row);
    if (!recipe.proof) {
      assert.equal(recipe.mode, "manual-red", row.surface);
      assert.equal("proof" in recipe, false, row.surface);
    }
  }
});

test("journey steps below deep stay visibly red", () => {
  const rows = load(MAPS[1][1]);
  for (const row of rows.filter((candidate) => candidate.coverage !== "deep")) {
    const recipe = makeRecipe("journeys.json", row);
    if (!recipe.proof) {
      assert.equal(recipe.mode, "manual-red", row.surface);
      assert.equal("proof" in recipe, false, row.surface);
    }
  }
});

test("agent modes never claim receipt proof", () => {
  const rows = load(MAPS[2][1]);
  const expectedModes = { deep: "read-only", e2e: "test", ping: "read-only", none: "manual-red" };

  for (const row of rows) {
    const recipe = makeRecipe("agents.json", row);
    assert.equal(recipe.mode, recipe.proof ? "test" : expectedModes[row.coverage], row.surface);
    assert.notEqual(recipe.mode, "receipt", row.surface);
  }
});

test("unknown sources and malformed rows are rejected", () => {
  assert.equal(supports("buttons.json", { surface: "button:x" }), false);
  assert.equal(supports("messages.json", {}), false);
  assert.throws(() => makeRecipe("buttons.json", { surface: "button:x" }), /Unsupported flow recipe row/);
});
