import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DISPLAY_PROOF_CASES, displayProofFor } from "./display-proof-cases.mjs";
import {
  DISPLAY_RESULT_LANE,
  isTrackedDisplayControl,
} from "./display-saved-result.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");

function rowsFor(sourceFile) {
  return JSON.parse(fs.readFileSync(path.join(MAP_DIR, sourceFile), "utf8"));
}

const DISPLAY_MAPS = [
  "desks-a.json", "desks-b.json", "desks-c.json", "desks-d.json",
  "desks-e.json", "desks-f.json", "public-pages.json",
];

test("every display proof case names one exact map row and real executable tests", () => {
  const keys = new Set();

  for (const proofCase of DISPLAY_PROOF_CASES) {
    const key = `${proofCase.sourceFile}\0${proofCase.surface}\0${proofCase.control}`;
    assert.equal(keys.has(key), false, `duplicate display proof case: ${key}`);
    keys.add(key);

    const matches = rowsFor(proofCase.sourceFile).filter(
      (row) => row.surface === proofCase.surface && row.control === proofCase.control,
    );
    assert.equal(matches.length, 1, `display proof case must match one row: ${key}`);
    assert.ok(["deep", "e2e"].includes(proofCase.depth));
    assert.ok(proofCase.tests.length > 0, `${key} has no executable test`);

    for (const file of proofCase.tests) {
      assert.ok(file.endsWith(".test.mjs"), `${file} is not a test`);
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} does not exist`);
      assert.ok(proofCase.evidence.includes(file), `${file} is missing from proof evidence`);
    }

    const proof = displayProofFor(proofCase.sourceFile, matches[0]);
    assert.equal(proof.depth, proofCase.depth);
    const expectedEvidence = proof.verdict === "red" && proofCase.evidence.includes(DISPLAY_RESULT_LANE)
      ? DISPLAY_RESULT_LANE
      : proofCase.evidence;
    assert.equal(proof.evidence, expectedEvidence);
    assert.equal(proof.asserts, matches[0].control);
    if (proof.verdict !== undefined) assert.equal(proof.verdict, "red");
  }
});

test("unmapped display rows stay red instead of trusting test names in map evidence", () => {
  const exactKeys = new Set(DISPLAY_PROOF_CASES.map(
    (entry) => `${entry.sourceFile}\0${entry.surface}\0${entry.control}`,
  ));
  let redCount = 0;

  for (const sourceFile of DISPLAY_MAPS) {
    for (const row of rowsFor(sourceFile)) {
      if (row.repeats_row_in || !isTrackedDisplayControl(row)) continue;
      const proof = displayProofFor(sourceFile, row);
      if (proof?.verdict === "red") redCount += 1;

      const key = `${sourceFile}\0${row.surface}\0${row.control}`;
      if (exactKeys.has(key)) continue;
      assert.equal(proof?.verdict, "red", `${key}: unmapped evidence must stay red`);
      assert.equal(proof?.evidence, DISPLAY_RESULT_LANE, `${key}: wrong red proof lane`);
    }
  }

  assert.equal(redCount, 1_015, "Display red count changed; inspect every new exact proof");
});

test("the focused proof test runs every executable test named by every case", () => {
  const files = [...new Set(DISPLAY_PROOF_CASES.flatMap((proofCase) => proofCase.tests))].sort();
  const env = { ...process.env, NODE_ENV: "test" };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: ROOT,
    encoding: "utf8",
    env,
  });

  assert.equal(
    result.status,
    0,
    `display proof tests failed\n${result.stdout || ""}\n${result.stderr || ""}`,
  );
});
