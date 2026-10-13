import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeRecipe, supports } from "./display-recipes.mjs";
import { DISPLAY_PROOF_CASES } from "./proofs/display-proof-cases.mjs";
import { DISPLAY_RESULT_LANE } from "./proofs/display-saved-result.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP_DIR = path.resolve(HERE, "../../../ops/workflows/coverage-every-surface-2026-10-10");
const SOURCE_FILES = [
  "desks-a.json",
  "desks-b.json",
  "desks-c.json",
  "desks-d.json",
  "desks-e.json",
  "desks-f.json",
  "public-pages.json",
];
const MODES = new Set(["read-only", "test", "receipt", "manual-red"]);
const FAMILIES = new Set(["button", "form", "link", "read", "screen"]);
const BASE_RECIPE_KEYS = [
  "expected",
  "family",
  "mode",
  "safe",
  "schedule",
  "sourceFile",
  "surface",
  "target",
];

function rowsFor(sourceFile) {
  return JSON.parse(fs.readFileSync(path.join(MAP_DIR, sourceFile), "utf8"));
}

function findRow(sourceFile, predicate) {
  const row = rowsFor(sourceFile).find(predicate);
  assert.ok(row, `${sourceFile} is missing the representative row`);
  return row;
}

test("all seven display maps produce one valid recipe per row", () => {
  let count = 0;

  for (const sourceFile of SOURCE_FILES) {
    const rows = rowsFor(sourceFile);
    assert.ok(rows.length > 0, `${sourceFile} is empty`);

    for (const row of rows) {
      assert.equal(supports(sourceFile, row), true, `${sourceFile}: ${row.surface} / ${row.kind}`);
      const recipe = makeRecipe(sourceFile, row);
      const { proof, ...baseRecipe } = recipe;
      assert.deepEqual(Object.keys(baseRecipe).sort(), BASE_RECIPE_KEYS);
      if (proof) {
        assert.deepEqual(
          Object.keys(proof).filter((key) => key !== "verdict").sort(),
          ["asserts", "depth", "evidence"],
        );
        if (proof.verdict !== undefined) assert.equal(proof.verdict, "red");
        assert.ok(["deep", "e2e"].includes(proof.depth));
        assert.match(proof.evidence, /(?:\.test\.mjs\b|src\/pulse\/coverage\/gap-[^/]+\.mjs\b)/);
        assert.equal(proof.asserts, row.control);
      }
      assert.ok(FAMILIES.has(recipe.family), `${row.surface} has invalid family ${recipe.family}`);
      assert.ok(MODES.has(recipe.mode), `${row.surface} has invalid mode ${recipe.mode}`);
      assert.equal(typeof recipe.safe, "boolean");
      assert.ok(recipe.target.length > 0, `${row.surface} has no target`);
      assert.ok(recipe.expected.length > 0, `${row.surface} has no expected result`);
      assert.equal(recipe.sourceFile, sourceFile);
      assert.equal(recipe.surface, row.surface);
      count += 1;
    }
  }

  assert.ok(count >= 1_635, `display map shrank to ${count} rows`);
});

test("tracked controls use safe executable proof without making a live write", () => {
  const row = findRow("desks-a.json", (item) => item.kind === "button" && item.coverage === "deep");
  const recipe = makeRecipe("desks-a.json", row);

  assert.equal(recipe.family, "button");
  assert.equal(recipe.mode, "test");
  assert.equal(recipe.schedule, "on-demand");
  assert.equal(recipe.safe, true);
  assert.equal(recipe.expected, row.control);
  assert.equal(recipe.proof.depth, "deep");
  assert.match(recipe.proof.evidence, /src\/pulse\/catalog\/proofs\/display-contracts-ab\.test\.mjs$/);
  assert.ok(fs.existsSync(path.resolve(HERE, "../../..", recipe.proof.evidence)));
});

test("deep reads and pinged pages stay read-only", () => {
  const read = findRow("desks-a.json", (item) => item.kind === "read" && item.coverage === "deep");
  const page = findRow("public-pages.json", (item) => item.kind === "page" && item.coverage === "ping");

  assert.equal(makeRecipe("desks-a.json", read).mode, "read-only");
  assert.equal(makeRecipe("public-pages.json", page).mode, "read-only");
});

test("an exact job checker outranks its heartbeat receipt", () => {
  const row = findRow("desks-c.json", (item) => item.kind === "job" && item.coverage === "ping");
  const recipe = makeRecipe("desks-c.json", row);

  assert.equal(recipe.family, "read");
  assert.equal(recipe.safe, true);
  if (recipe.proof) {
    assert.equal(recipe.mode, "test");
    assert.equal(recipe.proof.asserts, row.control);
  } else {
    assert.equal(recipe.mode, "receipt");
  }
});

test("every named display control gets an exact executable tracking lane", () => {
  const pingOnlyLink = findRow(
    "public-pages.json",
    (item) => item.surface === "link:404.html -> /app/",
  );
  const uncoveredPage = findRow("public-pages.json", (item) => item.kind === "page" && item.coverage === "none");

  for (const row of [pingOnlyLink, uncoveredPage]) {
    const recipe = makeRecipe("public-pages.json", row);
    assert.equal(recipe.mode, row.kind === "page" ? "read-only" : "test");
    assert.equal(recipe.safe, true);
    assert.equal(recipe.proof.depth, "e2e");
    assert.equal(recipe.proof.asserts, row.control);
    assert.equal(recipe.proof.evidence, "src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs");
    assert.ok(fs.existsSync(path.resolve(HERE, "../../..", recipe.proof.evidence)));
  }
});

test("only exact display proof cases receive deep executable proof", () => {
  for (const proofCase of DISPLAY_PROOF_CASES) {
    const row = findRow(
      proofCase.sourceFile,
      (item) => item.surface === proofCase.surface && item.control === proofCase.control,
    );
    const recipe = makeRecipe(proofCase.sourceFile, row);

    assert.notEqual(recipe.mode, "manual-red", `${proofCase.surface}: ${proofCase.control}`);
    assert.equal(recipe.proof.depth, proofCase.depth);
    const expectedEvidence = recipe.proof.verdict === "red" && proofCase.evidence.includes(DISPLAY_RESULT_LANE)
      ? DISPLAY_RESULT_LANE
      : proofCase.evidence;
    assert.equal(recipe.proof.evidence, expectedEvidence);
    assert.equal(recipe.proof.asserts, row.control);
    if (recipe.proof.verdict !== undefined) assert.equal(recipe.proof.verdict, "red");
  }
});

test("only the approved display map files are supported", () => {
  const row = rowsFor("desks-a.json")[0];
  assert.equal(supports("/tmp/desks-a.json", row), true);
  assert.equal(supports("routes.json", row), false);
  assert.throws(() => makeRecipe("routes.json", row), /Unsupported display row/);
});
