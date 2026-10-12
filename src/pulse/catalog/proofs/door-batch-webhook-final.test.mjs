import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gapChecks } from "../../coverage/gap-door-batch-webhooks.mjs";
import { makeRecipe } from "../door-recipes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/webhooks.json");
test("the four no-op webhook proofs stay red until their named saved result is tested", async () => {
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) =>
    makeRecipe("webhooks.json", row).proof?.evidence.includes("door-batch-webhook-final.test.mjs")
  );
  assert.deepEqual(rows.map((row) => row.surface).sort(), [
    "webhook:GET /api/documents/[id]",
    "webhook:GET|POST /api/contracts/sign",
    "webhook:POST /api/webhooks/mailgun-events",
    "webhook:POST /api/webhooks/twilio-status",
  ]);
  for (const row of rows) {
    const proof = makeRecipe("webhooks.json", row).proof;
    assert.equal(proof.depth, "e2e");
    assert.equal(proof.verdict, "red");
    assert.match(proof.evidence, /gap-door-batch-webhooks\.mjs/);
    assert.match(proof.asserts, new RegExp(`^${row.control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — `));
    assert.match(proof.asserts, /monitor stays red until an exact fake-data test proves this named saved result$/);
  }

  const checks = await gapChecks({
    scope: {
      run: async (fn) => fn({
        query: async () => ({ rows: [{ stuck_create_n: 0, stuck_export_n: 0 }] }),
      }),
    },
  });
  for (const row of rows) {
    const check = checks.find((item) => item.surface === row.surface);
    assert.ok(check, `${row.surface}: exact red monitor missing`);
    assert.equal(check.status, "FAIL", row.surface);
  }
});
