// Checks the batch 25 route proofs: every entry names exactly one route row of the coverage map, its
// handler test files exist and really call a handler, a row whose words changed is not proved by an
// old entry, and a route row that is not listed stays on the red route monitor.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { makeRecipe } from "../door-recipes.mjs";
import {
  FIN_B25_DOOR_CONTRACTS,
  FIN_B25_DOOR_EVIDENCE,
  finB25DoorProof,
  finB25DoorRowId,
} from "./fin-b25-door-contracts.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const MAP_FILES = ["routes-0.json", "routes-1.json", "routes-2.json", "routes-3.json"];

function mapRows() {
  return MAP_FILES.flatMap((sourceFile) =>
    JSON.parse(readFileSync(new URL(`ops/workflows/coverage-every-surface-2026-10-10/${sourceFile}`, ROOT), "utf8"))
      .map((row) => ({ sourceFile, row })));
}

test("every entry is one exact route row of the coverage map, and none is a money or customer row", () => {
  const rows = mapRows();
  const ids = FIN_B25_DOOR_CONTRACTS.map((entry) => entry.id);
  assert.equal(ids.length, 40);
  assert.equal(new Set(ids).size, ids.length, "an id is listed twice");
  for (const entry of FIN_B25_DOOR_CONTRACTS) {
    const hits = rows.filter(({ sourceFile, row }) => finB25DoorRowId(sourceFile, row) === entry.id);
    assert.equal(hits.length, 1, `${entry.id} must match exactly one map row`);
    assert.match(hits[0].row.surface, /^route:/, entry.id);
    assert.ok(["staffOnly", "none"].includes(hits[0].row.impact), `${entry.id}: money and customer rows need a deeper check than this one`);
  }
});

test("each handler test file exists, calls a real api/ handler, is not a Postgres test, and is not skipped", () => {
  const files = new Set(FIN_B25_DOOR_CONTRACTS.flatMap((entry) => entry.tests));
  assert.equal(files.size, 10);
  for (const file of files) {
    assert.ok(existsSync(new URL(file, ROOT)), `${file} is missing`);
    const text = readFileSync(new URL(file, ROOT), "utf8");
    assert.match(text, /(?:from |import\()\s*"\.\.\/\.\.\/api\/[^"]+\.mjs"/, `${file} imports no api/ handler`);
    assert.ok((text.match(/^\s*test\(/gm) || []).length >= 2, `${file} holds fewer than two tests`);
    assert.doesNotMatch(text, /\b(?:test|describe|it)\.(?:skip|todo|only)\b|\bskip:\s*true|\btodo:\s*true/, `${file} skips, parks or narrows a test`);
    assert.doesNotMatch(file, /\.pg\.test\.mjs$/, "a Postgres test is not a stand-in test");
  }
});

test("every handler a row names is imported by the test file the row is attached to", () => {
  const rows = mapRows();
  for (const entry of FIN_B25_DOOR_CONTRACTS) {
    const { row } = rows.find(({ sourceFile, row: candidate }) => finB25DoorRowId(sourceFile, candidate) === entry.id);
    const route = row.surface.replace(/^route:/, "");
    const text = readFileSync(new URL(entry.tests[0], ROOT), "utf8");
    assert.ok(text.includes(`api/${route}.mjs"`), `${entry.tests[0]} does not import api/${route}.mjs for ${entry.id}`);
  }
});

test("a proved row leaves the red route monitor and names its test file", () => {
  const rows = mapRows();
  for (const entry of FIN_B25_DOOR_CONTRACTS) {
    const { sourceFile, row } = rows.find((candidate) => finB25DoorRowId(candidate.sourceFile, candidate.row) === entry.id);
    const proof = finB25DoorProof(sourceFile, row);
    assert.equal(proof.depth, "e2e");
    assert.equal(proof.asserts, row.control);
    assert.ok(proof.evidence.startsWith(FIN_B25_DOOR_EVIDENCE));
    for (const file of entry.tests) assert.ok(proof.evidence.includes(file), `${entry.id} evidence names ${file}`);
    const recipe = makeRecipe(sourceFile, row);
    assert.doesNotMatch(recipe.proof.evidence, /gap-door-batch-routes\.mjs/, entry.id);
    assert.equal(recipe.proof.verdict, undefined, entry.id);
  }
});

test("the same route with different words, or in another file, stays unproved", () => {
  const { sourceFile, row } = mapRows().find((candidate) =>
    finB25DoorRowId(candidate.sourceFile, candidate.row) === FIN_B25_DOOR_CONTRACTS[0].id);
  assert.equal(finB25DoorProof(sourceFile, { ...row, control: `${row.control} and also more` }), null);
  assert.equal(finB25DoorProof("routes-2.json", row), null);
  assert.equal(finB25DoorProof(sourceFile, { surface: row.surface, control: "" }), null);
});
