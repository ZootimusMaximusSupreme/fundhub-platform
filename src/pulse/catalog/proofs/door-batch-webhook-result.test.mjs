import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { makeRecipe } from "../door-recipes.mjs";
import { evaluateWebhookGate } from "../../coverage/gap-door-batch-webhooks.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/webhooks.json");

test("one webhook pass calls every selected signature or credential gate without provider writes", async () => {
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) => {
    if (row.repeats_row_in) return false;
    return makeRecipe("webhooks.json", row).proof?.evidence.includes("door-batch-webhook-result.test.mjs");
  });
  assert.ok(rows.length >= 9, `expected a shared webhook batch, got ${rows.length}`);
  for (const row of rows) {
    const result = await evaluateWebhookGate(row);
    assert.equal(result.ok, true, `${row.surface}: ${result.problems.join(", ")}`);
    const recipe = makeRecipe("webhooks.json", row);
    const sensitive = ["money", "customerMessage", "customerData"].includes(row.impact);
    assert.equal(recipe.proof.depth, sensitive ? "deep" : "e2e", row.surface);
    assert.equal(recipe.proof.asserts, row.control, row.surface);
  }
});

test("an unverified webhook scheme maps to an exact executable red checker", () => {
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8"));
  const lendflow = rows.find((row) => row.surface === "webhook:POST /api/webhooks/lendflow");
  const recipe = makeRecipe("webhooks.json", lendflow);
  assert.equal(recipe.mode, "test");
  assert.match(recipe.proof.evidence, /door-batch-webhook-red\.test\.mjs/);
  assert.equal(recipe.proof.asserts, lendflow.control);
});
