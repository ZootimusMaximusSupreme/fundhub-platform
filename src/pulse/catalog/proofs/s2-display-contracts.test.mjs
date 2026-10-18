import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { S2_DISPLAY_PROOF_CASES, S2_DISPLAY_SPECS } from "./s2-display-contracts.mjs";
import { assertSpecsAreSafe, runSpecs } from "./s2-run-specs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");

function rows(sourceFile) {
  return JSON.parse(fs.readFileSync(path.join(MAP, sourceFile), "utf8"));
}

test("every slice-2 screen proof names one exact catalog row, a real spec and a real server test", () => {
  const seen = new Set();
  for (const proofCase of S2_DISPLAY_PROOF_CASES) {
    const key = `${proofCase.sourceFile}\0${proofCase.surface}\0${proofCase.control}`;
    assert.equal(seen.has(key), false, `duplicate: ${key}`);
    seen.add(key);
    const matches = rows(proofCase.sourceFile).filter(
      (row) => row.surface === proofCase.surface && row.control === proofCase.control);
    assert.equal(matches.length, 1, key);
    assert.equal(matches[0].impact, "customerMessage", key);
    for (const file of proofCase.tests) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is missing`);
      assert.doesNotMatch(file, /\.pg\.test\.mjs$/);
    }
  }
  assert.equal(seen.size, S2_DISPLAY_PROOF_CASES.length);
  assertSpecsAreSafe(S2_DISPLAY_SPECS);
});

test("the browser specs press every named control in a real page and judge the exact write", async () => {
  await runSpecs(S2_DISPLAY_SPECS, "slice-2 browser proofs");
});
