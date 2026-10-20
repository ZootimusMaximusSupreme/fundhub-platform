import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { makeRecipe } from "../door-recipes.mjs";
import { proofReferences } from "./door-proof.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const MAP_ROOT = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const SOURCE_FILES = [
  "routes-0.json",
  "routes-1.json",
  "routes-2.json",
  "routes-3.json",
  "jobs.json",
  "webhooks.json",
  "keys.json",
];
const FAILED_FOCUSED_TESTS = new Set([
  "content-tiles.test.mjs",
  "creative-run.test.mjs",
  "marketing-offer-generate.test.mjs",
  "payment-links-endpoints.test.mjs",
]);

function codeFiles(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? codeFiles(path.join(dir, entry.name), relative) : [relative];
  });
}

const indexed = ["src", "api", "netlify", "scripts", "e2e"]
  .flatMap((dir) => codeFiles(path.join(ROOT, dir), dir))
  .filter((name) => name.endsWith(".mjs"));
const byBase = new Map();
for (const relative of indexed) {
  const base = path.basename(relative);
  if (!byBase.has(base)) byBase.set(base, []);
  byBase.get(base).push(relative);
}

function resolve(reference) {
  if (reference.includes("/")) return fs.existsSync(path.join(ROOT, reference)) ? [reference] : [];
  return byBase.get(reference) || [];
}

function rowsFor(sourceFile) {
  return JSON.parse(fs.readFileSync(path.join(MAP_ROOT, sourceFile), "utf8"));
}

const cases = SOURCE_FILES.flatMap((sourceFile) =>
  rowsFor(sourceFile)
    .filter((row) => !row.repeats_row_in)
    .map((row, index) => ({ sourceFile, row, index, recipe: makeRecipe(sourceFile, row) }))
);
const proved = cases.filter(({ recipe }) => recipe.proof);

test("every door proof case names executable code and a focused test", async (t) => {
  for (const { sourceFile, row, index, recipe } of proved) {
    await t.test(`${sourceFile}:${index}:${row.surface}`, () => {
      assert.notEqual(recipe.mode, "manual-red");
      assert.equal(recipe.safe, true);
      if (recipe.proof.evidence.includes("door-batch-key-contract.test.mjs")) {
        assert.match(recipe.proof.asserts, /valid env name and is referenced by repo code; no value is read$/);
      } else if (recipe.proof.evidence.includes("door-batch-route-result.test.mjs")) {
        assert.equal(recipe.proof.depth, "e2e");
        assert.equal(recipe.proof.verdict, "red");
        assert.match(recipe.proof.asserts, new RegExp(`^${row.control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — `));
        assert.match(recipe.proof.evidence, /gap-door-batch-routes\.mjs/);
        assert.match(recipe.proof.asserts, /monitor stays red until an intended-method fake-data test judges this named result$/);
      } else if (recipe.proof.evidence.includes("door-batch-webhook-final.test.mjs")) {
        assert.equal(recipe.proof.asserts, row.control);
        assert.equal(recipe.proof.verdict, undefined);
      } else if (recipe.proof.evidence.includes("door-batch-job-final.test.mjs")) {
        if (recipe.proof.verdict === "red") {
          assert.equal(recipe.proof.depth, "e2e");
          assert.match(recipe.proof.asserts, new RegExp(`^${row.control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — `));
          assert.match(recipe.proof.evidence, /gap-door-batch-jobs\.mjs/);
          assert.match(recipe.proof.asserts, /monitor stays red until a non-empty fake-data run judges this named final result$/);
        } else {
          assert.equal(recipe.proof.asserts, row.control);
        }
      } else if (!["route:climate/config", "route:public/rb2b-webhook"].includes(row.surface)) {
        assert.equal(recipe.proof.asserts, row.control);
      }
      assert.equal(["e2e", "deep"].includes(recipe.proof.depth), true);

      const references = proofReferences(recipe.proof.evidence);
      const resolved = references.flatMap(resolve);
      assert.ok(resolved.length > 0, "proof must resolve to executable code");
      assert.equal(references.every((reference) => resolve(reference).length > 0), true, recipe.proof.evidence);
      assert.equal(references.some((reference) => reference.endsWith(".pg.test.mjs")), false);
      assert.equal(
        references.some((reference) => FAILED_FOCUSED_TESTS.has(path.basename(reference))),
        false
      );
      assert.equal(
        resolved.some((reference) => reference.endsWith(".test.mjs")),
        true,
        "every proof case must have a focused test"
      );
      assert.equal(
        resolved.some((reference) =>
          reference.endsWith(".test.mjs") ||
          /src\/pulse\/(?:coverage\/gap-|beats\/beat-)/.test(reference)
        ),
        true,
        "a ping alone is never proof"
      );

      const needDeep = ["money", "customerMessage", "customerData"].includes(row.impact);
      const exactRed = recipe.proof.verdict === "red";
      assert.equal(needDeep ? (recipe.proof.depth === "deep" || exactRed) : ["e2e", "deep"].includes(recipe.proof.depth), true);
      if (exactRed) {
        assert.equal(recipe.proof.depth, "e2e");
        assert.match(recipe.proof.evidence, /src\/pulse\/coverage\/gap-door-batch-(?:routes|webhooks|jobs)\.mjs/);
      } else if (needDeep) {
        const exactSafeHandler = /(?:door-batch-(?:job-final|webhook-final|route-exact)|door-contracts-(?:money-customer|routes-(?:01(?:-2)?|23))|s2-door-contracts|s3-door-contracts|s1-door-contracts|fin-b05-door-contracts|door-flow-read-contracts-2|fin-b08-door-contracts)\.test\.mjs/.test(recipe.proof.evidence);
        assert.equal(exactSafeHandler || resolved.some((reference) =>
          /src\/pulse\/(?:coverage\/gap-|beats\/beat-)/.test(reference) && !reference.endsWith(".test.mjs")
        ), true, "deep proof must name the result lane, beat, or exact safe handler result");
      }
    });
  }
});

test("every unproved door stays manual-red and omits proof", () => {
  for (const { sourceFile, row, recipe } of cases.filter(({ recipe }) => !recipe.proof)) {
    assert.equal(recipe.mode, "manual-red", `${sourceFile}: ${row.surface}`);
    assert.equal("proof" in recipe, false, `${sourceFile}: ${row.surface}`);
  }
});

test("an exact route gap monitor wires a row red when its old name-only evidence cannot prove the result", () => {
  const row = rowsFor("routes-0.json").find((item) => item.surface === "route:ad-videos");
  // The control is changed so no attached test is bound to this row: only the name is left.
  const sameNameWithoutEvidence = { ...row, control: `${row.control} (name only)`, coverage: "none", evidence: "route:ad-videos" };
  const recipe = makeRecipe("routes-0.json", sameNameWithoutEvidence);
  assert.equal(recipe.mode, "read-only");
  assert.match(recipe.proof.evidence, /gap-door-batch-routes\.mjs/);
  assert.match(recipe.proof.asserts, /monitor stays red until an intended-method fake-data test judges this named result$/);
});

test("known partial rows use exact executable checkers without claiming the business result is green", () => {
  const samples = [
    ["routes-1.json", "route:closer-deck", /action=send_ebook/],
    ["jobs.json", "function:ad-video-worker-background", /background function/],
    ["webhooks.json", "webhook:POST /api/webhooks/lendflow", /Lendflow/],
    ["webhooks.json", "webhook:POST netlify\/functions\/ad-video-worker-background", /whole ad-video pass/],
  ];
  for (const [sourceFile, surface, control] of samples) {
    const row = rowsFor(sourceFile).find((item) => item.surface === surface && control.test(item.control));
    const recipe = makeRecipe(sourceFile, row);
    assert.notEqual(recipe.mode, "manual-red", `${sourceFile}: ${surface}`);
    assert.ok(recipe.proof, `${sourceFile}: ${surface}`);
    assert.equal(
      /(?:gap-door-batch-routes|door-batch-(?:job-final|webhook-red))\.test\.mjs/.test(recipe.proof.evidence),
      true,
      `${sourceFile}: ${surface}`
    );
  }
});

test("door proof totals are deliberate", () => {
  const bySource = Object.fromEntries(SOURCE_FILES.map((sourceFile) => [
    sourceFile,
    proved.filter((item) => item.sourceFile === sourceFile).length,
  ]));
  assert.deepEqual(bySource, {
    "routes-0.json": 137,
    "routes-1.json": 159,
    "routes-2.json": 96,
    "routes-3.json": 52,
    "jobs.json": 83,
    "webhooks.json": 29,
    "keys.json": 428,
  });
});
