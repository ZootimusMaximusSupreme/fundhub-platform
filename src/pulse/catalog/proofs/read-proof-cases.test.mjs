import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { makeRecipe } from "../display-recipes.mjs";
import { READ_PROOF_CASES, readProofFor } from "./read-proof-cases.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const SOURCE_FILES = [
  "desks-a.json",
  "desks-b.json",
  "desks-c.json",
  "desks-d.json",
  "desks-e.json",
  "desks-f.json",
  "public-pages.json",
];

function rowsFor(sourceFile) {
  return JSON.parse(fs.readFileSync(path.join(MAP_DIR, sourceFile), "utf8"));
}

function readRows() {
  return SOURCE_FILES.flatMap((sourceFile) => rowsFor(sourceFile)
    .filter((row) => makeRecipe(sourceFile, row).family === "read")
    .map((row) => ({ sourceFile, row })));
}

test("the batch owns the exact 78 read rows that were unproved", () => {
  const rows = readRows();
  const keys = new Set(READ_PROOF_CASES.map((item) => `${item.sourceFile}\0${item.surface}\0${item.control}`));
  assert.equal(READ_PROOF_CASES.length, 78);
  assert.equal(keys.size, 78);

  const selected = rows.filter(({ sourceFile, row }) => keys.has(`${sourceFile}\0${row.surface}\0${row.control}`));
  assert.equal(selected.length, 78);
  for (const { sourceFile, row } of selected) {
    const proof = readProofFor(sourceFile, row);
    assert.ok(proof, `${sourceFile}: ${row.surface}: ${row.control}`);
    assert.equal(proof.depth, "deep");
    assert.equal(proof.asserts, row.control);
    assert.match(proof.evidence, /\.test\.mjs|src\/pulse\/coverage\/gap-catalog-reads\.mjs/);
    const recipe = makeRecipe(sourceFile, row);
    assert.deepEqual(recipe.proof, proof);
    assert.equal(recipe.safe, true);
  }
});

test("every named proof target exists and every known missing result uses the exact red lane", () => {
  let gapCount = 0;
  for (const item of READ_PROOF_CASES) {
    for (const file of item.tests) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} does not exist`);
      assert.ok(item.evidence.includes(file), `${file} is absent from proof evidence`);
    }
    if (item.evidence.includes("gap-catalog-reads.mjs")) {
      gapCount += 1;
      assert.equal(item.verdict, "red");
      assert.match(item.evidence, /gap-catalog-reads\.test\.mjs/);
    } else {
      assert.equal(item.verdict, undefined);
    }
  }
  assert.equal(gapCount, 21);
});

test("the 57 proved read rows run their real focused result tests", () => {
  const files = [...new Set(READ_PROOF_CASES
    .filter((item) => !item.evidence.includes("gap-catalog-reads.mjs"))
    .flatMap((item) => item.tests))].sort();
  assert.equal(READ_PROOF_CASES.length - 21, 57);
  assert.ok(files.length >= 20);

  const env = { ...process.env, NODE_ENV: "test" };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--test", "--test-force-exit", ...files], {
    cwd: ROOT,
    encoding: "utf8",
    env,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `read result tests failed\n${result.stdout || ""}\n${result.stderr || ""}`);
  assert.doesNotMatch(result.stdout || "", /^# skipped [1-9]\d*$/im);
});
