// Checks the batch 08 route proofs: every entry names exactly one customer-data row of the coverage
// map, its handler tests exist and really call a handler, a row whose words changed is not proved by
// an old entry, and the three rows this batch left red cannot be attached by mistake.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { makeRecipe } from "../door-recipes.mjs";
import {
  FIN_B08_DOOR_CONTRACTS,
  FIN_B08_DOOR_EVIDENCE,
  FIN_B08_NOT_ATTACHED,
  finB08DoorProof,
  finB08DoorRowId,
} from "./fin-b08-door-contracts.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const MAP_FILES = ["routes-0.json", "routes-1.json", "routes-2.json", "routes-3.json"];

function mapRows() {
  return MAP_FILES.flatMap((sourceFile) =>
    JSON.parse(readFileSync(new URL(`ops/workflows/coverage-every-surface-2026-10-10/${sourceFile}`, ROOT), "utf8"))
      .map((row) => ({ sourceFile, row })));
}

test("every entry is one exact customer-data route row of the coverage map", () => {
  const rows = mapRows();
  const ids = FIN_B08_DOOR_CONTRACTS.map((entry) => entry.id);
  assert.equal(ids.length, 34);
  assert.equal(new Set(ids).size, ids.length, "an id is listed twice");
  for (const entry of FIN_B08_DOOR_CONTRACTS) {
    const hits = rows.filter(({ sourceFile, row }) => finB08DoorRowId(sourceFile, row) === entry.id);
    assert.equal(hits.length, 1, `${entry.id} must match exactly one map row`);
    assert.equal(hits[0].row.impact, "customerData", entry.id);
    assert.match(hits[0].row.surface, /^route:/, entry.id);
  }
});

test("each handler test file exists, calls a real api/ handler, and is not a Postgres test", () => {
  const files = new Set(FIN_B08_DOOR_CONTRACTS.flatMap((entry) => entry.tests));
  assert.ok(files.size >= 20);
  for (const file of files) {
    assert.ok(existsSync(new URL(file, ROOT)), `${file} is missing`);
    const text = readFileSync(new URL(file, ROOT), "utf8");
    assert.match(text, /(?:from |import\()\s*"\.\.\/\.\.\/api\/[^"]+\.mjs"/, `${file} imports no api/ handler`);
    assert.match(text, /\btest\(/, `${file} has no test`);
    assert.ok((text.match(/^\s*test\(/gm) || []).length >= 2, `${file} holds fewer than two tests`);
    assert.doesNotMatch(text, /\b(?:test|describe|it)\.(?:skip|todo|only)\b|\bskip:\s*true|\btodo:\s*true/, `${file} skips, parks or narrows a test`);
    assert.doesNotMatch(file, /\.pg\.test\.mjs$/, "a Postgres test is not a stand-in proof");
  }
});

test("a proved row leaves the red route monitor and names its test files", () => {
  const rows = mapRows();
  for (const entry of FIN_B08_DOOR_CONTRACTS) {
    const { sourceFile, row } = rows.find((candidate) => finB08DoorRowId(candidate.sourceFile, candidate.row) === entry.id);
    const proof = finB08DoorProof(sourceFile, row);
    assert.equal(proof.depth, "deep");
    assert.equal(proof.asserts, row.control);
    assert.ok(proof.evidence.startsWith(FIN_B08_DOOR_EVIDENCE));
    for (const file of entry.tests) assert.ok(proof.evidence.includes(file), `${entry.id} evidence names ${file}`);
    const recipe = makeRecipe(sourceFile, row);
    assert.doesNotMatch(recipe.proof.evidence, /gap-door-batch-routes\.mjs/, entry.id);
    assert.equal(recipe.proof.verdict, undefined, entry.id);
  }
});

test("the same route with different words, or another file, stays unproved", () => {
  const { sourceFile, row } = mapRows().find((candidate) =>
    finB08DoorRowId(candidate.sourceFile, candidate.row) === FIN_B08_DOOR_CONTRACTS[0].id);
  assert.equal(finB08DoorProof(sourceFile, { ...row, control: `${row.control} and also more` }), null);
  assert.equal(finB08DoorProof("routes-3.json", row), null);
  assert.equal(finB08DoorProof(sourceFile, { surface: row.surface, control: "" }), null);
});

test("the three rows this batch could not attach stay red, each with its exact reason", () => {
  const rows = mapRows();
  const attached = new Set(FIN_B08_DOOR_CONTRACTS.map((entry) => entry.id));
  const ids = Object.keys(FIN_B08_NOT_ATTACHED);
  assert.equal(ids.length, 3);
  for (const id of ids) {
    assert.equal(attached.has(id), false, `${id} must not be attached`);
    const hits = rows.filter(({ sourceFile, row }) => finB08DoorRowId(sourceFile, row) === id);
    assert.equal(hits.length, 1, `${id} must still be one map row`);
    const { sourceFile, row } = hits[0];
    assert.equal(finB08DoorProof(sourceFile, row), null);
    assert.match(makeRecipe(sourceFile, row).proof.evidence, /gap-door-batch-routes\.mjs/, `${id} stays on the red monitor`);
    assert.ok(FIN_B08_NOT_ATTACHED[id].length > 60, "the reason is spelled out");
  }
});
