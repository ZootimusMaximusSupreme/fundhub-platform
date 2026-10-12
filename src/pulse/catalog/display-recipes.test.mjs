import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeRecipe, supports } from "./display-recipes.mjs";
import { DISPLAY_PROOF_CASES } from "./proofs/display-proof-cases.mjs";

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
        assert.deepEqual(Object.keys(proof).sort(), ["depth", "evidence"]);
        assert.ok(["deep", "e2e"].includes(proof.depth));
        assert.match(proof.evidence, /\.test\.mjs\b/);
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

  assert.equal(count, 1_635);
});

test("proved controls use tests without claiming they are safe on live data", () => {
  const row = findRow("desks-a.json", (item) => item.kind === "button" && item.coverage === "deep");
  const recipe = makeRecipe("desks-a.json", row);

  assert.equal(recipe.family, "button");
  assert.equal(recipe.mode, "test");
  assert.equal(recipe.schedule, "on-demand");
  assert.equal(recipe.safe, false);
  assert.equal(recipe.expected, row.control);
});

test("deep reads and pinged pages stay read-only", () => {
  const read = findRow("desks-a.json", (item) => item.kind === "read" && item.coverage === "deep");
  const page = findRow("public-pages.json", (item) => item.kind === "page" && item.coverage === "ping");

  assert.equal(makeRecipe("desks-a.json", read).mode, "read-only");
  assert.equal(makeRecipe("public-pages.json", page).mode, "read-only");
});

test("a job heartbeat is a receipt, not proof of its business result", () => {
  const row = findRow("desks-c.json", (item) => item.kind === "job" && item.coverage === "ping");
  const recipe = makeRecipe("desks-c.json", row);

  assert.equal(recipe.family, "read");
  assert.equal(recipe.mode, "receipt");
  assert.equal(recipe.safe, true);
});

test("unproved controls stay visibly red", () => {
  const pingOnlyLink = findRow("public-pages.json", (item) => item.kind === "link" && item.coverage === "ping");
  const uncoveredPage = findRow("public-pages.json", (item) => item.kind === "page" && item.coverage === "none");

  assert.equal(makeRecipe("public-pages.json", pingOnlyLink).mode, "manual-red");
  assert.equal(makeRecipe("public-pages.json", uncoveredPage).mode, "manual-red");
  assert.equal(makeRecipe("public-pages.json", pingOnlyLink).proof, undefined);
  assert.equal(makeRecipe("public-pages.json", uncoveredPage).proof, undefined);
});

test("only exact display proof cases receive deep executable proof", () => {
  for (const proofCase of DISPLAY_PROOF_CASES) {
    const row = findRow(
      proofCase.sourceFile,
      (item) => item.surface === proofCase.surface && item.control === proofCase.control,
    );
    const recipe = makeRecipe(proofCase.sourceFile, row);

    assert.notEqual(recipe.mode, "manual-red", `${proofCase.surface}: ${proofCase.control}`);
    assert.deepEqual(recipe.proof, {
      depth: "deep",
      evidence: proofCase.evidence,
    });
  }
});

test("only the approved display map files are supported", () => {
  const row = rowsFor("desks-a.json")[0];
  assert.equal(supports("/tmp/desks-a.json", row), true);
  assert.equal(supports("routes.json", row), false);
  assert.throws(() => makeRecipe("routes.json", row), /Unsupported display row/);
});
