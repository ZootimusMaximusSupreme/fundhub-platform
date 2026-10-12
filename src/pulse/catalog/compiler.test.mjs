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
  assert.match(out.items[0].reason, /names no executable proof target/);
});

test("a row must have exactly one recipe owner", () => {
  const source = [{ sourceFile: "x.json", rows: [{ ...base, surface: "button:x" }] }];
  assert.throws(() => compileCatalog(source, []), /found 0/);
  assert.throws(() => compileCatalog(source, [recipe, recipe]), /found 2/);
});
