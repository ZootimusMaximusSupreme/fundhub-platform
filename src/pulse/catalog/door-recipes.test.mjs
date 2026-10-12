import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { makeRecipe, supports } from "./door-recipes.mjs";

const MAP_ROOT = new URL("../../../ops/workflows/coverage-every-surface-2026-10-10/", import.meta.url);
const SOURCE_FILES = [
  "routes-0.json",
  "routes-1.json",
  "routes-2.json",
  "routes-3.json",
  "jobs.json",
  "webhooks.json",
  "keys.json",
];
const MODES = new Set(["read-only", "test", "receipt", "manual-red"]);

async function loadRows(sourceFile) {
  return JSON.parse(await readFile(new URL(sourceFile, MAP_ROOT), "utf8"));
}

test("every mapped door gets a complete recipe", async () => {
  let recipeCount = 0;

  for (const sourceFile of SOURCE_FILES) {
    const rows = await loadRows(sourceFile);
    for (const row of rows) {
      assert.equal(supports(sourceFile, row), true, `${sourceFile}: ${row.surface}`);
      const recipe = makeRecipe(sourceFile, row);
      assert.equal(recipe.sourceFile, sourceFile);
      assert.equal(recipe.surface, row.surface);
      assert.equal(typeof recipe.family, "string");
      assert.equal(MODES.has(recipe.mode), true, `${row.surface}: ${recipe.mode}`);
      assert.equal(typeof recipe.target, "string");
      assert.ok(recipe.target.length > 0, `${row.surface}: target`);
      assert.equal(typeof recipe.expected, "string");
      assert.ok(recipe.expected.length > 0, `${row.surface}: expected`);
      assert.equal(typeof recipe.schedule, "string");
      assert.ok(recipe.schedule.length > 0, `${row.surface}: schedule`);
      assert.equal(typeof recipe.safe, "boolean");
      recipeCount += 1;
    }
  }

  assert.equal(recipeCount, 1_017);
});

test("route recipes use route methods and keep writes out of read-only mode", async () => {
  const rows = await loadRows("routes-0.json");
  const read = rows.find((row) => row.surface === "route:ad-videos");
  const write = rows.find((row) => row.methods?.includes("POST"));

  assert.deepEqual(makeRecipe("routes-0.json", read), {
    family: "route",
    mode: "read-only",
    target: "ad-videos",
    expected: "GET matches the declared route contract",
    schedule: "on-command",
    safe: true,
    sourceFile: "routes-0.json",
    surface: "route:ad-videos",
  });
  assert.equal(makeRecipe("routes-0.json", write).mode, "test");
  assert.equal(makeRecipe("routes-0.json", write).safe, false);
});

test("job recipes preserve trigger and schedule metadata as receipts", async () => {
  const rows = await loadRows("jobs.json");
  const workflow = rows.find((row) => row.surface === "workflow:af-01-affiliate-drip");
  const scheduledFunction = rows.find((row) => row.surface === "function:pulse-hourly");

  assert.equal(makeRecipe("jobs.json", workflow).schedule, "cron */15 * * * *");
  assert.equal(makeRecipe("jobs.json", workflow).mode, "receipt");
  assert.equal(makeRecipe("jobs.json", scheduledFunction).schedule, "7 * * * *");
});

test("webhooks use door and signature metadata without touching a provider", async () => {
  const rows = await loadRows("webhooks.json");
  const commas = rows.find((row) => row.surface === "webhook:POST /api/webhooks/commas");
  const lendflow = rows.find((row) => row.surface === "webhook:POST /api/webhooks/lendflow");

  assert.equal(makeRecipe("webhooks.json", commas).target, "/api/webhooks/commas");
  assert.match(makeRecipe("webhooks.json", commas).expected, /HMAC-SHA256/);
  assert.equal(makeRecipe("webhooks.json", lendflow).mode, "manual-red");
});

test("key recipes use names only and never claim secret proof", async () => {
  const rows = await loadRows("keys.json");
  const key = rows.find((row) => row.surface === "env:ADAPTERS_DRY_RUN");
  const recipe = makeRecipe("keys.json", key);

  assert.equal(recipe.target, "ADAPTERS_DRY_RUN");
  assert.equal(recipe.mode, "manual-red");
  assert.match(recipe.expected, /without reading its value/);
});

test("unrelated maps are not supported", () => {
  assert.equal(supports("buttons.json", { surface: "button:test" }), false);
  assert.throws(() => makeRecipe("buttons.json", { surface: "button:test" }), /Unsupported/);
});
