// Guards for the batch 16 row table: every listed row is one exact map row, every named test file is a plain
// runnable test that opens no live site, every attached row has exactly one proof case (a live check or a
// practice test), and the forty rows are all accounted for (39 attached, 1 retired page row).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B16_DISPLAY_PROOF_CASES, FIN_B16_LIVE_PROOF_CASES, FIN_B16_PRACTICE_CASES } from "./fin-b16-display-proofs.mjs";
import { FIN_B16_LIVE_ROWS, FIN_B16_LIVE_TESTS } from "./fin-b16-display-contracts.mjs";
import ROWS from "./fin-b16-rows.json" with { type: "json" };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const maps = new Map();
const rowsOf = (file) => {
  if (!maps.has(file)) maps.set(file, JSON.parse(fs.readFileSync(path.join(MAP_DIR, file), "utf8")));
  return maps.get(file);
};
const oneRow = (file, surface, control) => rowsOf(file).filter((r) => r.surface === surface && r.control === control);
const keyOf = (c) => `${c.sourceFile}\0${c.surface}\0${c.control}`;

const RETIRED = {
  sourceFile: "public-pages.json",
  surface: "page:partner/autopsy/index.html",
  control: "Decline Autopsy sales page (SHELVED 2026-08-31): netlify.toml sends /partner/autopsy/* to the menu, so the file is not reachable; its routes are commented out in netlify/functions/api.mjs.",
};

test("every listed row is one exact map row, and its test file is a plain test that never opens a live site", () => {
  let listed = 0;
  for (const [name, groups] of Object.entries(ROWS)) {
    const file = path.join(ROOT, "src/pulse/catalog/proofs", name);
    assert.ok(fs.existsSync(file), `${name} does not exist`);
    assert.ok(name.endsWith(".test.mjs") && !name.includes(".pg."), `${name} is not a plain runnable test`);
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+\.(?:ai|net)\b[^\s"'`]*\/api\//i.test(text), `${name} must not call a live API`);
    for (const group of groups) {
      for (const control of group.controls) {
        listed += 1;
        assert.equal(oneRow(group.sourceFile, group.surface, control).length, 1, `${group.surface} / ${control}`);
      }
    }
  }
  // 33 practice rows, plus the 3 live rows whose screen half is also pressed (4 and 6 of the Shoot tab, 'Send this one to').
  assert.equal(listed, 36);
});

test("39 attached rows have one proof case each (6 live, 33 practice); the retired row has none", () => {
  assert.equal(FIN_B16_LIVE_PROOF_CASES.length, 6);
  assert.equal(FIN_B16_PRACTICE_CASES.length, 33);
  assert.equal(FIN_B16_DISPLAY_PROOF_CASES.length, 39);
  const caseKeys = FIN_B16_DISPLAY_PROOF_CASES.map(keyOf);
  assert.equal(new Set(caseKeys).size, 39);
  assert.equal(caseKeys.includes(keyOf(RETIRED)), false, "the retired page row is the lane's own live redirect check");
  // A live row names the lane (so it stays in the lane); a practice row never does.
  for (const c of FIN_B16_LIVE_PROOF_CASES) assert.match(c.evidence, /gap-catalog-display\.mjs/);
  for (const c of FIN_B16_PRACTICE_CASES) assert.doesNotMatch(c.evidence, /gap-catalog-display\.mjs/);
  assert.equal(FIN_B16_LIVE_ROWS.length, 6);
  // Every live row also runs the practice test that presses the same control, when there is one.
  const withScreenHalf = FIN_B16_LIVE_PROOF_CASES.filter((c) => c.tests.some((t) => !FIN_B16_LIVE_TESTS.includes(t))).map((c) => c.control);
  assert.equal(withScreenHalf.length, 3);
  for (const c of FIN_B16_LIVE_PROOF_CASES) assert.ok(c.evidence.split("; ").every((p) => fs.existsSync(path.join(ROOT, p))), c.control);
});

test("all 40 rows of the batch are accounted for: 39 attached and 1 retired page", () => {
  const all = [...FIN_B16_DISPLAY_PROOF_CASES, RETIRED];
  assert.equal(all.length, 40);
  assert.equal(new Set(all.map(keyOf)).size, 40, "no row has two outcomes");
  for (const row of all) assert.equal(oneRow(row.sourceFile, row.surface, row.control).length, 1, row.control);
  // The 40 are the not-proved rows of desks-c.json (36), public-pages.json (1) and desks-f.json (3).
  const count = (file) => all.filter((r) => r.sourceFile === file).length;
  assert.deepEqual([count("desks-c.json"), count("public-pages.json"), count("desks-f.json")], [36, 1, 3]);
});

test("the Reference disclosure row (who-sent-it colour key) is a practice test of the messaging page, not a live check", () => {
  const control = "Reference disclosure (who-sent-it colour key)";
  assert.equal(oneRow("desks-c.json", "messaging.html", control).length, 1, "a real map row");
  const hits = FIN_B16_DISPLAY_PROOF_CASES.filter((c) => c.sourceFile === "desks-c.json" && c.surface === "messaging.html" && c.control === control);
  assert.equal(hits.length, 1, "exactly one proof case");
  assert.ok(FIN_B16_PRACTICE_CASES.includes(hits[0]), "a practice case");
  assert.equal(hits[0].evidence, "src/pulse/catalog/proofs/fin-b16-messaging.test.mjs");
  assert.doesNotMatch(hits[0].evidence, /gap-catalog-display\.mjs/, "it reads no saved data, so it does not stay in the lane");
});
