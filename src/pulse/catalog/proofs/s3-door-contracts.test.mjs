// Checks the slice S3 route proofs: every entry names exactly one customer-data
// row of the coverage map, its handler tests exist and really call a handler,
// and a row whose words changed is not proved by an old entry.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { makeRecipe } from "../door-recipes.mjs";
import {
  S3_DOOR_CONTRACTS,
  S3_DOOR_CONTRACTS_EVIDENCE,
  s3DoorProof,
  s3DoorRowId,
} from "./s3-door-contracts.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const MAP_FILES = ["routes-0.json", "routes-1.json", "routes-2.json", "routes-3.json"];

function mapRows() {
  return MAP_FILES.flatMap((sourceFile) =>
    JSON.parse(readFileSync(new URL(`ops/workflows/coverage-every-surface-2026-10-10/${sourceFile}`, ROOT), "utf8"))
      .map((row) => ({ sourceFile, row })));
}

test("every entry is one exact customer-data route row of the coverage map", () => {
  const rows = mapRows();
  const ids = S3_DOOR_CONTRACTS.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "an id is listed twice");
  for (const entry of S3_DOOR_CONTRACTS) {
    const hits = rows.filter(({ sourceFile, row }) => s3DoorRowId(sourceFile, row) === entry.id);
    assert.equal(hits.length, 1, `${entry.id} must match exactly one map row`);
    assert.equal(hits[0].row.impact, "customerData", entry.id);
    assert.match(hits[0].row.surface, /^route:/, entry.id);
  }
});

test("each handler test file exists and calls a real api/ handler", () => {
  const files = new Set(S3_DOOR_CONTRACTS.flatMap((entry) => entry.tests));
  assert.ok(files.size > 0);
  for (const file of files) {
    assert.ok(existsSync(new URL(file, ROOT)), `${file} is missing`);
    const text = readFileSync(new URL(file, ROOT), "utf8");
    assert.match(text, /(?:from |import\()\s*"\.\.\/\.\.\/api\/[^"]+\.mjs"/, `${file} imports no api/ handler`);
    assert.match(text, /\btest\(/, `${file} has no test`);
    assert.doesNotMatch(file, /\.pg\.test\.mjs$/, "a Postgres test is not a stand-in proof");
  }
});

test("a proved row leaves the red route monitor and names its test files", () => {
  const rows = mapRows();
  for (const entry of S3_DOOR_CONTRACTS) {
    const { sourceFile, row } = rows.find((candidate) => s3DoorRowId(candidate.sourceFile, candidate.row) === entry.id);
    const proof = s3DoorProof(sourceFile, row);
    assert.equal(proof.depth, "deep");
    assert.equal(proof.asserts, row.control);
    assert.ok(proof.evidence.startsWith(S3_DOOR_CONTRACTS_EVIDENCE));
    for (const file of entry.tests) assert.ok(proof.evidence.includes(file), `${entry.id} evidence names ${file}`);
    const recipe = makeRecipe(sourceFile, row);
    assert.doesNotMatch(recipe.proof.evidence, /gap-door-batch-routes\.mjs/, entry.id);
    assert.equal(recipe.proof.verdict, undefined, entry.id);
  }
});

test("the same route with different words, or another file, stays unproved", () => {
  const { sourceFile, row } = mapRows().find((candidate) =>
    s3DoorRowId(candidate.sourceFile, candidate.row) === S3_DOOR_CONTRACTS[0].id);
  assert.equal(s3DoorProof(sourceFile, { ...row, control: `${row.control} and also more` }), null);
  assert.equal(s3DoorProof("routes-3.json", row), null);
  assert.equal(s3DoorProof(sourceFile, { surface: row.surface, control: "" }), null);
});
