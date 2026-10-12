import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { makeRecipe } from "../door-recipes.mjs";
import { evaluateKeyContract } from "./door-batch-key-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/keys.json");
const CODE_ROOTS = ["src", "api", "netlify", "scripts", "e2e", "vendor", "db", "public"];
const CODE_EXTENSIONS = /\.(?:mjs|js|cjs|ts|tsx|html|sql)$/;

function codeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return codeFiles(full);
    return CODE_EXTENSIONS.test(entry.name) ? [full] : [];
  });
}

function exactName(name) {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
}

test("one key-contract pass proves every non-sensitive key without reading values", () => {
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) => {
    if (row.repeats_row_in || !["none", "staffOnly"].includes(row.impact)) return false;
    return makeRecipe("keys.json", row).proof?.evidence.includes("door-batch-key-contract.test.mjs");
  });
  const sources = CODE_ROOTS.flatMap((root) => codeFiles(path.join(ROOT, root))).map((file) => ({
    file: path.relative(ROOT, file),
    text: fs.readFileSync(file, "utf8"),
  }));

  assert.equal(rows.length, 279);
  for (const row of rows) {
    const pattern = exactName(row.env_name);
    const references = sources.filter(({ text }) => pattern.test(text)).map(({ file }) => file);
    const result = evaluateKeyContract(row, references);
    assert.equal(result.ok, true, `${row.surface}: ${result.problems.join(", ")}`);
    assert.ok(references.length >= 1, row.surface);

    const recipe = makeRecipe("keys.json", row);
    assert.equal(recipe.mode, "read-only", row.surface);
    assert.equal(recipe.proof.depth, "e2e", row.surface);
    assert.equal(recipe.proof.asserts, result.assertion, row.surface);
  }
});

test("the key contract rejects bad names and missing readers while sensitive rows use health proof", () => {
  const bad = evaluateKeyContract(
    {
      env_name: "bad-name",
      surface: "env:OTHER",
      control: "OTHER: wrong key",
      read_by_files: 0,
    },
    []
  );
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.problems, [
    "invalid env name",
    "surface does not match env name",
    "control does not name the key",
    "map names no reader",
    "repo code has no reader",
  ]);

  const sensitive = {
    env_name: "MONEY_KEY",
    surface: "env:MONEY_KEY",
    control: "MONEY_KEY: protects money",
    read_by_files: 1,
    impact: "money",
  };
  assert.equal(makeRecipe("keys.json", sensitive).mode, "read-only");
  assert.equal(makeRecipe("keys.json", sensitive).proof.depth, "deep");
  assert.match(makeRecipe("keys.json", sensitive).proof.evidence, /door-batch-key-health\.test\.mjs/);
});
