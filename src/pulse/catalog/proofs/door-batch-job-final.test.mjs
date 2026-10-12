import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { makeRecipe } from "../door-recipes.mjs";
import {
  CHECK_IDS,
  FINAL_JOB_GAP_ROWS,
  gapChecks,
} from "../../coverage/gap-door-batch-jobs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/jobs.json");

function fakeDb() {
  return {
    calls: [],
    async query(sql, params = []) {
      this.calls.push({ sql: String(sql), params });
      return { rows: [], rowCount: 0 };
    },
  };
}

test("jobs without a non-empty final-result proof stay on exact red monitors", () => {
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) =>
    makeRecipe("jobs.json", row).proof?.evidence.includes("door-batch-job-final.test.mjs")
  );
  assert.equal(rows.length, 13);
  assert.deepEqual(
    new Set(rows.map((row) => row.surface)),
    new Set(FINAL_JOB_GAP_ROWS.map((row) => row.surface))
  );

  for (const row of rows) {
    const recipe = makeRecipe("jobs.json", row);
    assert.equal(recipe.proof.verdict, "red", row.surface);
    assert.equal(recipe.proof.depth, "e2e", row.surface);
    assert.match(recipe.proof.evidence, /gap-door-batch-jobs\.mjs/, row.surface);
    assert.match(
      recipe.proof.asserts,
      /stays red until a non-empty fake-data run judges this named final result$/,
      row.surface
    );
  }
});

test("the job lane accepts the live scope function and a direct database", async () => {
  for (const kind of ["scope", "db"]) {
    const db = fakeDb();
    const ctx = kind === "scope" ? { scope: (fn) => fn(db) } : { db };
    const checks = await gapChecks(ctx);

    assert.equal(checks.length, CHECK_IDS.length, kind);
    assert.equal(db.calls.length, 1, kind);
    assert.equal(checks[0].id, "door-batch:ad-video-worker-result", kind);
    assert.equal(checks[0].status, "PASS", kind);
    assert.deepEqual(checks.slice(1).map((check) => check.status), Array(13).fill("FAIL"), kind);
    assert.deepEqual(
      new Set(checks.slice(1).map((check) => check.id)),
      new Set(FINAL_JOB_GAP_ROWS.map((row) => row.id)),
      kind
    );
  }
});
