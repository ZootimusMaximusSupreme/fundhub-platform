import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { makeRecipe } from "../door-recipes.mjs";
import {
  evaluateWebhookGate,
  gapChecks,
} from "../../coverage/gap-door-batch-webhooks.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/webhooks.json");

test("the two known webhook gaps have exact executable red-or-result checks", async () => {
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) =>
    makeRecipe("webhooks.json", row).proof?.evidence.includes("door-batch-webhook-red.test.mjs")
  );
  assert.deepEqual(rows.map((row) => row.surface).sort(), [
    "webhook:POST /api/webhooks/lendflow",
    "webhook:POST netlify/functions/ad-video-worker-background",
  ]);

  for (const row of rows) {
    const gate = await evaluateWebhookGate(row);
    assert.equal(gate.ok, true, row.surface + ": " + gate.problems.join(", "));
  }

  const checks = await gapChecks({
    scope: {
      run: async (fn) => fn({
        query: async () => ({ rows: [{ stuck_create_n: 0, stuck_export_n: 0 }] }),
      }),
    },
  });
  assert.equal(checks.find((row) => row.id === "door-batch:webhook-lendflow-contract").status, "FAIL");
  assert.equal(checks.find((row) => row.id === "door-batch:webhook-ad-video-worker").status, "PASS");
});
