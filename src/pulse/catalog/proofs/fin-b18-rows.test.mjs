// Guards for the batch 18 row table (fin-b18-rows.json) and the proof cases built from it.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ROWS from "./fin-b18-rows.json" with { type: "json" };
import SERVER_ROWS from "./fin-b18-server-rows.json" with { type: "json" };
import { FIN_B18_DISPLAY_PROOF_CASES, FIN_B18_LIVE_PROOF_CASES, FIN_B18_PRACTICE_CASES } from "./fin-b18-display-proofs.mjs";
import { FIN_B18_LIVE_ROWS } from "./fin-b18-display-contracts.mjs";
import { DISPLAY_PROOF_CASES } from "./display-proof-cases.mjs";
import { displaySavedResultContract } from "./display-saved-result.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const mapRows = (file) => JSON.parse(fs.readFileSync(path.join(MAP_DIR, file), "utf8"));
const keyOf = (sourceFile, surface, control) => `${sourceFile}\0${surface}\0${control}`;

const NOT_ATTACHABLE = [];

const rowsOf = (table) => Object.entries(table).flatMap(([file, groups]) => groups.flatMap((group) => group.controls.map((control) => ({
  file, sourceFile: group.sourceFile, surface: group.surface, control,
}))));
const pageListed = rowsOf(ROWS);
const serverListed = rowsOf(SERVER_ROWS);
// every row any test file presses or reads (a row may have a page test and a server test)
const listed = [...pageListed, ...serverListed];

test("every listed row is one exact map row and its test file exists and is a test", () => {
  const seen = new Set();
  for (const row of listed) {
    const key = keyOf(row.sourceFile, row.surface, row.control);
    assert.equal(seen.has(`${row.file}\0${key}`), false, `listed twice in ${row.file}: ${row.control}`);
    seen.add(`${row.file}\0${key}`);
    const hits = mapRows(row.sourceFile).filter((m) => m.surface === row.surface && m.control === row.control);
    assert.equal(hits.length, 1, `${row.surface} / ${row.control} is exactly one map row`);
    assert.ok(row.file.endsWith(".test.mjs"));
    assert.ok(fs.existsSync(path.join(HERE, row.file)), `${row.file} exists`);
  }
  // a row is pressed by a page test once; a server test may read the same control's server half
  const pageKeys = pageListed.map((r) => keyOf(r.sourceFile, r.surface, r.control));
  assert.equal(new Set(pageKeys).size, pageKeys.length, "no row is pressed by two page tests");
  assert.equal(pageListed.length, 39, "39 rows are pressed by a practice test in a browser");
  assert.equal(serverListed.length, 5, "5 rows also have their server half read in Node");
  for (const row of serverListed) {
    assert.ok(pageKeys.includes(keyOf(row.sourceFile, row.surface, row.control)) || FIN_B18_LIVE_ROWS.some((r) => keyOf(...r) === keyOf(row.sourceFile, row.surface, row.control)),
      `${row.control}: a server test reads the half of a row that a page test or a live check also judges`);
  }
});

test("the rows left red are not listed, not live, and have no proof case", () => {
  const exact = new Set(DISPLAY_PROOF_CASES.map((c) => keyOf(c.sourceFile, c.surface, c.control)));
  const live = new Set(FIN_B18_LIVE_ROWS.map((r) => keyOf(...r)));
  const listedKeys = new Set(listed.map((r) => keyOf(r.sourceFile, r.surface, r.control)));
  assert.equal(NOT_ATTACHABLE.length, 0, "the five repaired rows are attached now");
  for (const [sourceFile, surface, control] of NOT_ATTACHABLE) {
    assert.equal(mapRows(sourceFile).filter((m) => m.surface === surface && m.control === control).length, 1, `${control} is exactly one map row`);
    const key = keyOf(sourceFile, surface, control);
    assert.equal(listedKeys.has(key), false, `${control} is not listed`);
    assert.equal(live.has(key), false, `${control} has no live check`);
    assert.equal(exact.has(key), false, `${control} has no proof case`);
  }
});

test("a row is a live check or a practice test, and a live row also names the screen half when one presses it", () => {
  assert.equal(FIN_B18_LIVE_PROOF_CASES.length, 6);
  assert.equal(FIN_B18_PRACTICE_CASES.length, 34);
  assert.equal(FIN_B18_DISPLAY_PROOF_CASES.length, 40, "40 rows attached: 6 live and 34 practice only");
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
  // and the server half: the read the page depends on is run in Node beside the live check
  for (const control of ["Your bank applications list", "Your steps list", "Banner: helper stopped", "What happened"]) {
    assert.ok(screen(control).some((t) => t.endsWith("fin-b18-server-reads.test.mjs")), `${control} also runs the server read`);
  }
  assert.ok(FIN_B18_PRACTICE_CASES.find((c) => c.control.startsWith("Empty state ('You do not owe"))
    .tests.some((t) => t.endsWith("fin-b18-server-reads.test.mjs")), "the payments empty state also runs the server read");
  assert.ok(screen("Write today's C-suite tasks").some((t) => t.endsWith("fin-b18-ops-admin.test.mjs")));
  assert.ok(FIN_B18_PRACTICE_CASES.find((c) => c.control.startsWith("AR row expand"))
    .tests.some((t) => t === "src/http/read-invoices-handler.test.mjs"), "AR detail also runs its real read handler");
  assert.ok(screen("hire-closer (server)").some((t) => t.endsWith("fin-b18-live-writer.test.mjs")));
});
