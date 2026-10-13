import assert from "node:assert/strict";
import test from "node:test";

import { compileCatalog, compileDisplayRuntimeData, compileHourlyUncoveredSurfaces } from "./compiler.mjs";

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

test("hourly backlog follows current tripwires and real beat covers, including new gaps", () => {
  const tripwires = { "route:z": ["deep:z"], "route:a": ["deep:a"], "route:new": ["deep:new"] };
  assert.deepEqual(compileHourlyUncoveredSurfaces(tripwires, [{ covers: ["route:z", "route:other"] }]), ["route:a", "route:new"]);
  assert.deepEqual(compileHourlyUncoveredSurfaces(tripwires, [{ covers: Object.keys(tripwires) }]), []);
  assert.deepEqual(compileHourlyUncoveredSurfaces(tripwires, []), ["route:a", "route:new", "route:z"]);
});

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

test("display runtime compilation preserves exact cases, saved contracts, and retired pages", () => {
  const rows = [
    { ...base, surface: "a", control: "saved", page: "public/a.html" },
    { ...base, surface: "b", control: "unproved" },
    { ...base, surface: "c", control: "direct" },
    { ...base, surface: "d", control: "repeat", repeats_row_in: "old.json" },
    { ...base, surface: "e", control: "retired", page: "public/partner/autopsy/index.html" }
  ];
  const proof = (row, evidence) => ({ ...row, sourceFile: "public-pages.json", depth: "deep", evidence });
  const contract = { mode: "query", requirement: "exact result", sql: "SELECT 1" };
  const options = {
    staffProofCases: [proof(rows[0])],
    proofCases: [proof(rows[0], "src/pulse/coverage/gap-catalog-display.mjs"), proof(rows[2], "src/direct.test.mjs")],
    contractFor: (row) => row.control === "saved" ? contract : null,
    isTracked: () => true
  };
  const out = compileDisplayRuntimeData([{ sourceFile: "public-pages.json", rows }], options);
  assert.deepEqual(out.displayResultCases.map((entry) => entry.control), ["saved"]);
  assert.deepEqual(out.displayTrackingCases.map((entry) => entry.control), ["saved", "unproved", "retired"]);
  assert.deepEqual(out.displayTrackingCases[0].contract, contract);
  assert.equal(out.displayTrackingCases[1].contract, null);
  assert.equal(out.displayTrackingCases[2].retired, true);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
  assert.throws(() => compileDisplayRuntimeData([{ sourceFile: "public-pages.json", rows: [...rows, rows[0]] }], options), /found 2/);
});

test("an exact saved result still runs when its map kind is outside the generic control list", () => {
  const row = { ...base, kind: "contract-cell", surface: "documents.html", control: "Void contract" };
  const proof = { ...row, sourceFile: "desks-b.json", depth: "deep", evidence: "src/browser.test.mjs" };
  const contract = { mode: "always-red", requirement: "Missing exact void receipt", sql: null };
  const out = compileDisplayRuntimeData([{ sourceFile: "desks-b.json", rows: [row] }], {
    proofCases: [proof], staffProofCases: [proof], contractFor: () => contract, isTracked: () => false
  });
  assert.equal(out.displayResultCases.length, 1);
  assert.equal(out.displayTrackingCases.length, 1);
  assert.deepEqual(out.displayTrackingCases[0].contract, contract);
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
  assert.deepEqual(out.items[0].proof.tests, ["src/pulse/coverage/gap-route-result.test.mjs"]);
  assert.equal(out.items[0].proof.tests.includes("src/x.test.mjs"), false);
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
