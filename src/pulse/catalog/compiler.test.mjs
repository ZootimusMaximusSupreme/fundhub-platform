import assert from "node:assert/strict";
import test from "node:test";

import { compileCatalog } from "./compiler.mjs";

const base = {
  control: "does one thing", kind: "button", calls: [], tables: [], evidence: "src/x.test.mjs",
  impact: "staffOnly", coverage: "e2e"
};
const recipe = {
  supports: () => true,
  makeRecipe: (sourceFile, row) => ({
    family: "test", mode: "test", target: row.surface, expected: "works", schedule: "on-command",
    safe: true, sourceFile, surface: row.surface
  })
};

test("compiler removes only rows Claude marked as repeats and keeps stable unique ids", () => {
  const sources = [{ sourceFile: "x.json", rows: [
    { ...base, surface: "button:a" },
    { ...base, surface: "button:b", repeats_row_in: "old.json" }
  ] }];
  const one = compileCatalog(sources, [recipe]);
  const two = compileCatalog(sources, [recipe]);
  assert.equal(one.rows, 2);
  assert.equal(one.repeats, 1);
  assert.equal(one.unique, 1);
  assert.equal(one.items[0].id, two.items[0].id);
});

test("money and customer rows stay red below deep", () => {
  for (const impact of ["money", "customerMessage", "customerData"]) {
    const out = compileCatalog([{ sourceFile: "x.json", rows: [{ ...base, surface: `x:${impact}`, impact }] }], [recipe]);
    assert.equal(out.items[0].state, "red");
    assert.match(out.items[0].reason, /below required level L3/);
  }
});

test("a declared level without an executable target stays red", () => {
  const row = { ...base, surface: "button:x", evidence: "someone said this was tested" };
  const out = compileCatalog([{ sourceFile: "x.json", rows: [row] }], [recipe]);
  assert.equal(out.items[0].state, "red");
  assert.match(out.items[0].reason, /names no executable test, gap check, or beat/);
});

test("a status ping alone never counts as e2e or deep proof", () => {
  const row = { ...base, surface: "button:x", evidence: "job:button-x" };
  const out = compileCatalog([{ sourceFile: "x.json", rows: [row] }], [recipe]);
  assert.equal(out.items[0].state, "red");
  assert.match(out.items[0].reason, /status ping alone/);
});

test("a row must have exactly one recipe owner", () => {
  const source = [{ sourceFile: "x.json", rows: [{ ...base, surface: "button:x" }] }];
  assert.throws(() => compileCatalog(source, []), /found 0/);
  assert.throws(() => compileCatalog(source, [recipe, recipe]), /found 2/);
});

test("a safe recipe can raise coverage only with its own executable proof", () => {
  const deepRecipe = {
    supports: () => true,
    makeRecipe: (sourceFile, row) => ({
      family: "test", mode: "test", target: row.surface, expected: "works", schedule: "on-command",
      safe: true, sourceFile, surface: row.surface,
      proof: {
        depth: "deep",
        evidence: "src/catalog-result.test.mjs",
        asserts: "the final customer result is correct"
      }
    })
  };
  const out = compileCatalog(
    [{ sourceFile: "x.json", rows: [{ ...base, surface: "x:money", impact: "money", coverage: "none", evidence: "old.test.mjs" }] }],
    [deepRecipe],
    { resolve: (reference) => reference === "src/catalog-result.test.mjs" ? [reference] : [] }
  );
  assert.equal(out.items[0].state, "wired");
  assert.equal(out.items[0].proofDepth, "deep");
  assert.equal(out.items[0].proofAsserts, "the final customer result is correct");
  assert.deepEqual(out.items[0].proof.tests, ["src/catalog-result.test.mjs"]);
});

test("an exact red gap monitor wires a money row without claiming deep result proof", () => {
  const redRecipe = {
    supports: () => true,
    makeRecipe: (sourceFile, row) => ({
      family: "test", mode: "test", target: row.surface, expected: "stays red", schedule: "daily",
      safe: true, sourceFile, surface: row.surface,
      proof: {
        depth: "e2e",
        verdict: "red",
        evidence: "src/pulse/coverage/gap-route-result.mjs src/pulse/coverage/gap-route-result.test.mjs",
        asserts: "the exact named business result stays red"
      }
    })
  };
  const out = compileCatalog(
    [{ sourceFile: "x.json", rows: [{ ...base, surface: "x:money-gap", impact: "money", coverage: "none" }] }],
    [redRecipe],
    { resolve: (reference) => [reference] }
  );
  assert.equal(out.items[0].state, "wired");
  assert.equal(out.items[0].proofDepth, "e2e");
  assert.equal(out.items[0].proofVerdict, "red");
  assert.match(out.items[0].reason, /business result remains red/);
  assert.deepEqual(out.items[0].proof.lanes, ["src/pulse/coverage/gap-route-result.mjs"]);
});

test("an exact red claim needs a real gap lane", () => {
  const redRecipe = {
    supports: () => true,
    makeRecipe: (sourceFile, row) => ({
      family: "test", mode: "test", target: row.surface, expected: "stays red", schedule: "daily",
      safe: true, sourceFile, surface: row.surface,
      proof: {
        depth: "e2e",
        verdict: "red",
        evidence: "src/only-a-test.test.mjs",
        asserts: "the exact named business result stays red"
      }
    })
  };
  const out = compileCatalog(
    [{ sourceFile: "x.json", rows: [{ ...base, surface: "x:missing-gap", impact: "money", coverage: "none" }] }],
    [redRecipe],
    { resolve: (reference) => [reference] }
  );
  assert.equal(out.items[0].state, "red");
  assert.match(out.items[0].reason, /no executable gap lane/);
});

test("recipe proof stays red when its own target cannot be resolved", () => {
  const deepRecipe = {
    supports: () => true,
    makeRecipe: (sourceFile, row) => ({
      family: "test", mode: "test", target: row.surface, expected: "works", schedule: "on-command",
      safe: true, sourceFile, surface: row.surface,
      proof: { depth: "deep", evidence: "missing.test.mjs", asserts: "the result is correct" }
    })
  };
  const out = compileCatalog([{ sourceFile: "x.json", rows: [{ ...base, surface: "x:money", impact: "money" }] }], [deepRecipe], { resolve: () => [] });
  assert.equal(out.items[0].state, "red");
  assert.match(out.items[0].reason, /recipe claims proof/);
});

test("recipe proof needs a depth, executable evidence, assertion, and safe runner", () => {
  const source = [{ sourceFile: "x.json", rows: [{ ...base, surface: "button:x" }] }];
  for (const proof of [
    { depth: "ping", evidence: "x.test.mjs", asserts: "works" },
    { depth: "deep", evidence: "", asserts: "works" },
    { depth: "deep", evidence: "x.test.mjs", asserts: "" }
  ]) {
    const bad = { ...recipe, makeRecipe: (sourceFile, row) => ({
      family: "test", mode: "test", target: row.surface, expected: "works", schedule: "on-command",
      safe: true, sourceFile, surface: row.surface, proof
    }) };
    assert.throws(() => compileCatalog(source, [bad]), /bad recipe/);
  }
});
