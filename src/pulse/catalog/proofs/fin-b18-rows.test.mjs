// Guards for the batch 18 row table (fin-b18-rows.json) and the proof cases built from it.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ROWS from "./fin-b18-rows.json" with { type: "json" };
import { FIN_B18_DISPLAY_PROOF_CASES, FIN_B18_LIVE_PROOF_CASES, FIN_B18_PRACTICE_CASES } from "./fin-b18-display-proofs.mjs";
import { FIN_B18_LIVE_ROWS } from "./fin-b18-display-contracts.mjs";
import { DISPLAY_PROOF_CASES } from "./display-proof-cases.mjs";
import { displaySavedResultContract } from "./display-saved-result.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const mapRows = (file) => JSON.parse(fs.readFileSync(path.join(MAP_DIR, file), "utf8"));
const keyOf = (sourceFile, surface, control) => `${sourceFile}\0${surface}\0${control}`;

// Rows of this batch that are left red on purpose. Each one has its reason in manifest-b18.md.
const NOT_ATTACHABLE = [
  ["desks-e.json", "public/app/ops-admin.html", "AR column header sort (click or Enter on Client, Invoice, Amount owed, Overdue, Status)"],
  ["desks-e.json", "public/app/ops-admin.html", "AR row expand (terms, payment method, owner, outstanding, collection history)"],
  ["desks-e.json", "public/app/partner-galaxy.html", "Sky canvas: click a worker to open the detail panel (NODES, CLIENTS and ROUTES are empty arrays, so no worker exists to click)"],
];

const listed = Object.entries(ROWS).flatMap(([file, groups]) => groups.flatMap((group) => group.controls.map((control) => ({
  file, sourceFile: group.sourceFile, surface: group.surface, control,
}))));

test("every listed row is one exact map row and its test file exists and is a test", () => {
  const seen = new Set();
  for (const row of listed) {
    const key = keyOf(row.sourceFile, row.surface, row.control);
    assert.equal(seen.has(key), false, `listed twice: ${row.control}`);
    seen.add(key);
    const hits = mapRows(row.sourceFile).filter((m) => m.surface === row.surface && m.control === row.control);
    assert.equal(hits.length, 1, `${row.surface} / ${row.control} is exactly one map row`);
    assert.ok(row.file.endsWith(".test.mjs"));
    assert.ok(fs.existsSync(path.join(HERE, row.file)), `${row.file} exists`);
  }
  assert.equal(listed.length, 36, "36 rows are pressed by a practice test");
});

test("the rows left red are not listed, not live, and have no proof case", () => {
  const exact = new Set(DISPLAY_PROOF_CASES.map((c) => keyOf(c.sourceFile, c.surface, c.control)));
  const live = new Set(FIN_B18_LIVE_ROWS.map((r) => keyOf(...r)));
  const listedKeys = new Set(listed.map((r) => keyOf(r.sourceFile, r.surface, r.control)));
  for (const [sourceFile, surface, control] of NOT_ATTACHABLE) {
    const key = keyOf(sourceFile, surface, control);
    assert.equal(listedKeys.has(key), false, `${control} is not listed`);
    assert.equal(live.has(key), false, `${control} has no live check`);
    assert.equal(exact.has(key), false, `${control} has no proof case`);
  }
});

test("a row is a live check or a practice test, and a live row also names the screen half when one presses it", () => {
  assert.equal(FIN_B18_LIVE_PROOF_CASES.length, 6);
  assert.equal(FIN_B18_PRACTICE_CASES.length, 31);
  assert.equal(FIN_B18_DISPLAY_PROOF_CASES.length, 37, "37 rows attached: 6 live and 31 practice only");
  const practice = new Set(FIN_B18_PRACTICE_CASES.map((c) => keyOf(c.sourceFile, c.surface, c.control)));
  for (const live of FIN_B18_LIVE_PROOF_CASES) {
    assert.equal(practice.has(keyOf(live.sourceFile, live.surface, live.control)), false, "no row is both");
    assert.equal(live.depth, "deep");
    assert.match(live.evidence, /gap-catalog-display\.mjs/, "a live row stays in the display lane");
    assert.ok(displaySavedResultContract({ control: live.control })?.mode === "query", `${live.control} has a query contract`);
  }
  for (const test of FIN_B18_PRACTICE_CASES) {
    assert.equal(test.depth, "e2e");
    assert.doesNotMatch(test.evidence, /gap-catalog-display\.mjs/, "a practice row leaves the lane");
  }
  // the five live rows that a screen test also presses carry that test file, and the sixth carries the writer test
  const screen = (control) => FIN_B18_LIVE_PROOF_CASES.find((c) => c.control.startsWith(control)).tests;
  assert.ok(screen("Your bank applications list").some((t) => t.endsWith("fin-b18-money-declines-helper.test.mjs")));
  assert.ok(screen("Your steps list").some((t) => t.endsWith("fin-b18-money-declines-helper.test.mjs")));
  assert.ok(screen("Banner: helper stopped").some((t) => t.endsWith("fin-b18-money-declines-helper.test.mjs")));
  assert.ok(screen("What happened").some((t) => t.endsWith("fin-b18-money-pages.test.mjs")));
  assert.ok(screen("Write today's C-suite tasks").some((t) => t.endsWith("fin-b18-ops-admin.test.mjs")));
  assert.ok(screen("hire-closer (server)").some((t) => t.endsWith("fin-b18-live-writer.test.mjs")));
});
