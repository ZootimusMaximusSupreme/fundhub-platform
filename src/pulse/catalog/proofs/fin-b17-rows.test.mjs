// Guards for the batch 17 row table: every listed row is one exact map row, every named test file is a plain
// runnable test that opens no live site, every attached row has exactly one proof case (a live check or a
// practice test), and the thirty-nine attached rows are all accounted for. (Forty rows were attached at
// first. "Commission rule 'See these payouts ->'" was taken back off in repair cycle 1: no live ledger row
// names its rule, so the button cannot narrow the ledger on live data and no test can prove it does.)

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
  const unique = new Set();
  for (const [name, groups] of Object.entries(ROWS)) {
    const file = path.join(ROOT, "src/pulse/catalog/proofs", name);
    assert.ok(fs.existsSync(file), `${name} does not exist`);
    assert.ok(name.endsWith(".test.mjs") && !name.includes(".pg."), `${name} is not a plain runnable test`);
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost|app\.example\.test|fundhub\.ai"|sign\.example\.test)[a-z0-9.-]+\.(?:ai|net|com)\b[^\s"'`]*\/api\//i.test(text), `${name} must not call a live API`);
    for (const group of groups) {
      for (const control of group.controls) {
        unique.add(`${group.sourceFile}\0${group.surface}\0${control}`);
        assert.equal(oneRow(group.sourceFile, group.surface, control).length, 1, `${group.surface} / ${control}`);
      }
    }
  }
  // a row two files press (the Present deck's, by a vm and by the real page) is listed under both and counted once
  assert.equal(unique.size, 39);
});

test("the row taken back off is on no list and has no proof case", () => {
  const taken = "Commission rule 'See these payouts ->' (opens the ledger filtered to the people the rule pays)";
  for (const groups of Object.values(ROWS)) for (const g of groups) assert.ok(!g.controls.includes(taken));
  assert.ok(!FIN_B17_DISPLAY_PROOF_CASES.some((c) => c.control === taken));
  // it is still a real map row: it goes back to the not proved list, with the reason in the manifest
  assert.equal(oneRow("desks-f.json", "products-commissions.html", taken).length, 1);
});

test("39 attached rows have one proof case each: 4 live checks, 35 practice tests", () => {
  assert.equal(FIN_B17_LIVE_PROOF_CASES.length, 4);
  assert.equal(FIN_B17_PRACTICE_CASES.length, 35);
  assert.equal(FIN_B17_DISPLAY_PROOF_CASES.length, 39);
  const caseKeys = FIN_B17_DISPLAY_PROOF_CASES.map(keyOf);
  assert.equal(new Set(caseKeys).size, 39, "no row has two outcomes");
  // a live row names the lane (so it stays in the lane) and also runs the practice test that presses the same control
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

test("the twelve Present rows the real page judges name both the vm test and the real-page test", () => {
  const page = FIN_B17_PRACTICE_CASES.filter((c) => c.tests.some((t) => t.endsWith("fin-b17-present-page.test.mjs")));
  assert.equal(page.length, 12);
  for (const c of page) {
    assert.ok(c.tests.some((t) => t.endsWith("fin-b17-present.test.mjs")), `${c.control} also names the vm test`);
    assert.equal(c.tests.filter((t) => t.endsWith(".test.mjs")).length, 2);
  }
  const names = page.map((c) => c.control);
  for (const needle of [/^Back and Next/, /^Client screen only/, /^Discovery: 7 belief/, /^Objections: 6 buttons/, /^Two walls/]) {
    assert.equal(names.filter((n) => needle.test(n)).length, 1, String(needle));
  }
  assert.equal(names.filter((n) => /^Phase strip button 0[1-7]:/.test(n)).length, 7);
});

test("the two script rows also name the closer desk lane's own test, which reads both scripts live over HTTP", () => {
  const rows = FIN_B17_PRACTICE_CASES.filter((c) => /^(contract-send\.js and data\.js are served|present\.js is served and wired)/.test(c.control));
  assert.equal(rows.length, 2);
  for (const c of rows) assert.ok(c.tests.includes("src/pulse/coverage/gap-closer.test.mjs"), c.control);
  const lane = fs.readFileSync(path.join(ROOT, "src/pulse/coverage/gap-closer.mjs"), "utf8");
  for (const needle of ['path: "/app/present.js"', 'path: "/app/contract-send.js"', 'path: "/app/data.js"']) assert.ok(lane.includes(needle), needle);
});

test("the table counts by page: 24 Present (12 of them also judged on the real page), 10 Products & Commissions, 4 chat widget, 1 money connections", () => {
  const by = (name) => ROWS[name].flatMap((g) => g.controls).length;
  assert.equal(by("fin-b17-present.test.mjs"), 24);
  assert.equal(by("fin-b17-present-page.test.mjs"), 12);
  assert.equal(by("fin-b17-products.test.mjs"), 10);
  assert.equal(by("fin-b17-chat.test.mjs"), 4);
  assert.equal(by("fin-b17-money-connections.test.mjs"), 1);
});
