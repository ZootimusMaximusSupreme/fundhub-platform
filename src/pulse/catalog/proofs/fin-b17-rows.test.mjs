// Guards for the batch 17 row table: every listed row is one exact map row, every named test file is a plain
// runnable test that opens no live site, every attached row has exactly one proof case (a live check or a
// practice test), and the forty rows are all accounted for.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B17_DISPLAY_PROOF_CASES, FIN_B17_LIVE_PROOF_CASES, FIN_B17_PRACTICE_CASES } from "./fin-b17-display-proofs.mjs";
import { FIN_B17_LIVE_ROWS } from "./fin-b17-display-contracts.mjs";
import ROWS from "./fin-b17-rows.json" with { type: "json" };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const maps = new Map();
const rowsOf = (file) => {
  if (!maps.has(file)) maps.set(file, JSON.parse(fs.readFileSync(path.join(MAP_DIR, file), "utf8")));
  return maps.get(file);
};
const oneRow = (file, surface, control) => rowsOf(file).filter((r) => r.surface === surface && r.control === control);
const keyOf = (c) => `${c.sourceFile}\0${c.surface}\0${c.control}`;

test("every listed row is one exact map row, and its test file is a plain test that never opens a live site", () => {
  let listed = 0;
  for (const [name, groups] of Object.entries(ROWS)) {
    const file = path.join(ROOT, "src/pulse/catalog/proofs", name);
    assert.ok(fs.existsSync(file), `${name} does not exist`);
    assert.ok(name.endsWith(".test.mjs") && !name.includes(".pg."), `${name} is not a plain runnable test`);
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost|app\.example\.test|fundhub\.ai"|sign\.example\.test)[a-z0-9.-]+\.(?:ai|net|com)\b[^\s"'`]*\/api\//i.test(text), `${name} must not call a live API`);
    for (const group of groups) {
      for (const control of group.controls) {
        listed += 1;
        assert.equal(oneRow(group.sourceFile, group.surface, control).length, 1, `${group.surface} / ${control}`);
      }
    }
  }
  assert.equal(listed, 40);
});

test("40 attached rows have one proof case each: 4 live checks, 36 practice tests", () => {
  assert.equal(FIN_B17_LIVE_PROOF_CASES.length, 4);
  assert.equal(FIN_B17_PRACTICE_CASES.length, 36);
  assert.equal(FIN_B17_DISPLAY_PROOF_CASES.length, 40);
  const caseKeys = FIN_B17_DISPLAY_PROOF_CASES.map(keyOf);
  assert.equal(new Set(caseKeys).size, 40, "no row has two outcomes");
  // a live row names the lane (so it stays in the lane) and also runs the practice test that presses the control
  for (const c of FIN_B17_LIVE_PROOF_CASES) {
    assert.match(c.evidence, /gap-catalog-display\.mjs/);
    assert.ok(c.tests.some((t) => /fin-b17-(present|chat|money-connections)\.test\.mjs$/.test(t)), c.control);
  }
  for (const c of FIN_B17_PRACTICE_CASES) assert.doesNotMatch(c.evidence, /gap-catalog-display\.mjs/);
  assert.equal(FIN_B17_LIVE_ROWS.length, 4);
  for (const c of FIN_B17_DISPLAY_PROOF_CASES) {
    assert.ok(c.evidence.split("; ").every((p) => p === "src/pulse/coverage/gap-catalog-display.mjs" || fs.existsSync(path.join(ROOT, p))), c.control);
    assert.equal(oneRow(c.sourceFile, c.surface, c.control).length, 1, c.control);
  }
});

test("the two script rows also name the closer desk lane's own test, which reads both scripts live over HTTP", () => {
  const rows = FIN_B17_PRACTICE_CASES.filter((c) => /^(contract-send\.js and data\.js are served|present\.js is served and wired)/.test(c.control));
  assert.equal(rows.length, 2);
  for (const c of rows) assert.ok(c.tests.includes("src/pulse/coverage/gap-closer.test.mjs"), c.control);
  const lane = fs.readFileSync(path.join(ROOT, "src/pulse/coverage/gap-closer.mjs"), "utf8");
  for (const needle of ['path: "/app/present.js"', 'path: "/app/contract-send.js"', 'path: "/app/data.js"']) assert.ok(lane.includes(needle), needle);
});

test("the table counts by page: 24 Present, 11 Products & Commissions, 4 chat widget, 1 money connections", () => {
  const by = (name) => ROWS[name].flatMap((g) => g.controls).length;
  assert.equal(by("fin-b17-present.test.mjs"), 24);
  assert.equal(by("fin-b17-products.test.mjs"), 11);
  assert.equal(by("fin-b17-chat.test.mjs"), 4);
  assert.equal(by("fin-b17-money-connections.test.mjs"), 1);
});
