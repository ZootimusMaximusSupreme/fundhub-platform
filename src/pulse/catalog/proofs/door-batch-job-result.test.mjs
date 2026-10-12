import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { makeRecipe } from "../door-recipes.mjs";
import { evaluateJobReceipt } from "../../coverage/gap-door-batch-jobs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/jobs.json");

function resolveTest(reference) {
  if (reference.includes("/")) return fs.existsSync(path.join(ROOT, reference));
  const roots = ["src", "scripts", "netlify", "api", "e2e"];
  const pending = roots.map((root) => path.join(ROOT, root));
  while (pending.length) {
    const dir = pending.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.name === reference) return true;
    }
  }
  return false;
}

test("one job pass checks real workflow triggers, handlers, result tests, and receipt kind", async () => {
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) => {
    if (row.repeats_row_in) return false;
    return makeRecipe("jobs.json", row).proof?.evidence.includes("door-batch-job-result.test.mjs");
  });
  assert.ok(rows.length >= 35, `expected a shared job batch, got ${rows.length}`);

  for (const row of rows) {
    const file = path.join(ROOT, row.file);
    assert.equal(fs.existsSync(file), true, `${row.surface}: ${row.file}`);
    const loaded = await import(pathToFileURL(file).href);
    const result = evaluateJobReceipt(row, loaded);
    assert.equal(result.ok, true, `${row.surface}: ${result.problems.join(", ")}`);
    assert.equal(result.resultTests.every(resolveTest), true, `${row.surface}: missing result test`);
    assert.equal(["workflow-run", "job-heartbeat"].includes(result.receipt), true, row.surface);

    const recipe = makeRecipe("jobs.json", row);
    const sensitive = ["money", "customerMessage", "customerData"].includes(row.impact);
    assert.equal(recipe.proof.depth, sensitive ? "deep" : "e2e", row.surface);
    assert.equal(recipe.proof.asserts, row.control, row.surface);
  }
});

test("job proof refuses missing result tests and mismatched triggers", () => {
  const row = {
    surface: "workflow:door-proof",
    file: "src/workflows/door-proof.mjs",
    trigger: "events door.opened",
    evidence: "nothing executable",
    impact: "customerData",
  };
  const result = evaluateJobReceipt(row, {
    doorProof: { opts: { id: "door-proof", triggers: [{ event: "wrong.event" }] } },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems, ["job has no focused result test", "event triggers do not match the map"]);
});
