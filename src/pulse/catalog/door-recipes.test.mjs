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
      if (recipe.proof) {
        assert.equal(["e2e", "deep"].includes(recipe.proof.depth), true);
        assert.equal(typeof recipe.proof.evidence, "string");
        assert.ok(recipe.proof.evidence.length > 0);
        if (recipe.proof.evidence.includes("door-batch-key-contract.test.mjs")) {
          assert.equal(
            recipe.proof.asserts,
            `${row.env_name} has a valid env name and is referenced by repo code; no value is read`
          );
        } else if (recipe.proof.evidence.includes("door-batch-route-result.test.mjs")) {
          assert.equal(recipe.proof.depth, "e2e");
          assert.equal(recipe.proof.verdict, "red");
          assert.match(recipe.proof.asserts, new RegExp(`^${row.control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — `));
          assert.match(recipe.proof.evidence, /gap-door-batch-routes\.mjs/);
          assert.match(recipe.proof.asserts, /monitor stays red until an intended-method fake-data test judges this named result$/);
        } else if (recipe.proof.evidence.includes("door-batch-webhook-final.test.mjs")) {
          assert.equal(recipe.proof.depth, "e2e");
          assert.equal(recipe.proof.verdict, "red");
          assert.match(recipe.proof.asserts, new RegExp(`^${row.control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — `));
          assert.match(recipe.proof.evidence, /gap-door-batch-webhooks\.mjs/);
          assert.match(recipe.proof.asserts, /monitor stays red until an exact fake-data test proves this named saved result$/);
        } else if (!["route:climate/config", "route:public/rb2b-webhook"].includes(row.surface)) {
          assert.equal(recipe.proof.asserts, row.control);
        }
      } else {
        assert.equal(recipe.mode, "manual-red", `${sourceFile}: ${row.surface}`);
      }
      recipeCount += 1;
    }
  }

  assert.equal(recipeCount, 1_017);
});

test("route recipes use route methods and keep writes out of read-only mode", async () => {
  const rows = await loadRows("routes-0.json");
  const read = rows.find((row) => row.surface === "route:auth/login" && row.methods?.includes("GET"));
  const failedFocusedProof = rows.find((row) => row.surface === "route:ad-videos");
  const write = rows.find((row) => row.surface === "route:auth/login" && row.methods?.includes("POST"));

  const readRecipe = makeRecipe("routes-0.json", read);
  assert.equal(readRecipe.family, "route");
  assert.equal(readRecipe.mode, "read-only");
  assert.equal(readRecipe.target, "auth/login");
  assert.equal(readRecipe.expected, "GET matches the declared route contract");
  assert.equal(readRecipe.proof.depth, "e2e");
  assert.match(readRecipe.proof.evidence, /src\/http\/demo-logins\.test\.mjs/);
  assert.equal(makeRecipe("routes-0.json", failedFocusedProof).mode, "read-only");
  assert.match(
    makeRecipe("routes-0.json", failedFocusedProof).proof.evidence,
    /gap-door-batch-routes\.mjs/
  );
  assert.equal(makeRecipe("routes-0.json", write).mode, "test");
  assert.equal(makeRecipe("routes-0.json", write).safe, true);
});

test("job recipes preserve trigger and schedule metadata and use result plus receipt proof", async () => {
  const rows = await loadRows("jobs.json");
  const workflow = rows.find((row) => row.surface === "workflow:af-01-affiliate-drip");
  const scheduledFunction = rows.find((row) => row.surface === "function:pulse-hourly");

  assert.equal(makeRecipe("jobs.json", workflow).schedule, "cron */15 * * * *");
  assert.equal(makeRecipe("jobs.json", workflow).mode, "receipt");
  assert.equal(makeRecipe("jobs.json", workflow).proof.depth, "deep");
  assert.match(makeRecipe("jobs.json", workflow).proof.evidence, /door-batch-job-result\.test\.mjs/);
  assert.equal(makeRecipe("jobs.json", scheduledFunction).schedule, "7 * * * *");
  assert.equal(makeRecipe("jobs.json", scheduledFunction).mode, "receipt");
});

test("webhooks use door and signature metadata without touching a provider", async () => {
  const rows = await loadRows("webhooks.json");
  const commas = rows.find((row) => row.surface === "webhook:POST /api/webhooks/commas");
  const lendflow = rows.find((row) => row.surface === "webhook:POST /api/webhooks/lendflow");

  assert.equal(makeRecipe("webhooks.json", commas).target, "/api/webhooks/commas");
  assert.match(makeRecipe("webhooks.json", commas).expected, /HMAC-SHA256/);
  assert.equal(makeRecipe("webhooks.json", lendflow).mode, "test");
  assert.match(makeRecipe("webhooks.json", lendflow).proof.evidence, /door-batch-webhook-red\.test\.mjs/);
});

test("key recipes prove watched names without reading secret values", async () => {
  const rows = await loadRows("keys.json");
  const key = rows.find((row) => row.surface === "env:ADAPTERS_DRY_RUN");
  const recipe = makeRecipe("keys.json", key);

  assert.equal(recipe.target, "ADAPTERS_DRY_RUN");
  assert.equal(recipe.mode, "read-only");
  assert.equal(recipe.proof.depth, "deep");
  assert.match(recipe.proof.evidence, /gap-keys\.mjs/);
  assert.match(recipe.expected, /without reading its value/);

  const healthChecked = rows.find((row) => row.surface === "env:AD_TOKEN_ENC_KEY");
  assert.equal(makeRecipe("keys.json", healthChecked).mode, "read-only");
  assert.equal(makeRecipe("keys.json", healthChecked).proof.depth, "deep");
  assert.match(makeRecipe("keys.json", healthChecked).proof.evidence, /door-batch-key-health\.test\.mjs/);

  const contract = rows.find((row) => row.surface === "env:AD_VIDEO_BROLL_STILLS");
  const contractRecipe = makeRecipe("keys.json", contract);
  assert.equal(contractRecipe.mode, "read-only");
  assert.equal(contractRecipe.proof.depth, "e2e");
  assert.match(contractRecipe.proof.evidence, /door-batch-key-contract\.test\.mjs/);
  assert.match(contractRecipe.proof.asserts, /no value is read/);
});

test("shared route harness proves only the two safe public reads it calls", async () => {
  const rows1 = await loadRows("routes-1.json");
  const rows2 = await loadRows("routes-2.json");
  const rb2b = rows1.find(
    (row) => row.surface === "route:public/rb2b-webhook" && row.methods?.includes("GET")
  );
  const climate = rows2.find((row) => row.surface === "route:climate/config");

  for (const [file, row] of [["routes-1.json", rb2b], ["routes-2.json", climate]]) {
    const recipe = makeRecipe(file, row);
    assert.equal(recipe.mode, "read-only");
    assert.equal(recipe.proof.depth, "e2e");
    assert.match(recipe.proof.evidence, /door-batch-route-contract\.test\.mjs/);
  }
});

test("unrelated maps are not supported", () => {
  assert.equal(supports("buttons.json", { surface: "button:test" }), false);
  assert.throws(() => makeRecipe("buttons.json", { surface: "button:test" }), /Unsupported/);
});
