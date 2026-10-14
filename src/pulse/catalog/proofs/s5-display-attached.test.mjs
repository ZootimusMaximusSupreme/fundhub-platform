// Guards the S5 screen registry (s5-display-contracts.mjs).
//
// A row with "titles" is proved by an older render test that already judged
// this control by running the screen's own script on a fixture. That older test
// must still exist, still read the screen's script, and still carry every case
// the row names. Rename or delete a case and this file goes red, and the row
// must go back to not proved. The older test runs on its own in the suite.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { S5_DISPLAY_PROOF_CASES, S5_DISPLAY_ROWS } from "./s5-display-contracts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAPS = new Map();
const mapRows = (file) => {
  if (!MAPS.has(file)) MAPS.set(file, JSON.parse(fs.readFileSync(path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10", file), "utf8")));
  return MAPS.get(file);
};

test("every registry row is one real map line, staff-only or no-impact, with a proving file that exists", () => {
  assert.ok(S5_DISPLAY_ROWS.length > 0);
  const keys = new Set();
  for (const row of S5_DISPLAY_ROWS) {
    const matches = mapRows(row.sourceFile).filter((item) => item.surface === row.surface && item.control === row.control);
    assert.equal(matches.length, 1, `${row.name}: not exactly one map row`);
    assert.equal(matches[0].impact, row.impact);
    assert.ok(["staffOnly", "none"].includes(row.impact), `${row.name}: ${row.impact} rows need a saved-result proof`);
    assert.ok(fs.existsSync(path.join(ROOT, row.test)), `${row.name}: ${row.test} is missing`);
    const key = `${row.sourceFile}\0${row.surface}\0${row.control}`;
    assert.equal(keys.has(key), false, `${row.name}: listed twice`);
    keys.add(key);
  }
  assert.equal(S5_DISPLAY_PROOF_CASES.length, S5_DISPLAY_ROWS.length);
});

test("rows proved by an older render test still name real cases in a test that runs the screen's own script", () => {
  const attached = S5_DISPLAY_ROWS.filter((row) => row.titles);
  assert.ok(attached.length > 0);
  for (const row of attached) {
    const proving = row.spec || row.test;
    assert.ok(fs.existsSync(path.join(ROOT, proving)), `${row.name}: ${proving} is missing`);
    const source = fs.readFileSync(path.join(ROOT, proving), "utf8");
    if (row.spec) {
      // A browser spec: s5-display-specs.test.mjs runs it and checks each case passed.
      assert.ok(source.includes("@playwright/test"), `${row.name}: ${row.spec} is not a Playwright spec`);
    } else {
      const page = row.surface.match(/([a-z-]+)\.html$/)[1];
      assert.ok(source.includes(`${page}.js`), `${row.name}: ${proving} no longer reads ${page}.js`);
    }
    assert.ok(row.titles.length >= 1);
    for (const title of row.titles) {
      assert.ok(source.includes(title), `${row.name}: ${proving} lost the case "${title}"`);
    }
  }
});
