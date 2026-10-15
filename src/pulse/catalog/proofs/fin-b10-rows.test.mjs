// Guards for the batch 10 row table: every listed row is one exact map row, every named test file is a
// plain runnable test that opens no live site, and every row has exactly one proof case: a live check
// (seven: five saved results, two link gates) or a practice test (thirty-three).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B10_DISPLAY_PROOF_CASES, FIN_B10_PRACTICE_CASES } from "./fin-b10-display-proofs.mjs";
import { FIN_B10_LIVE_CASES, FIN_B10_LIVE_ROWS, FIN_B10_RESULT_CONTRACTS } from "./fin-b10-display-contracts.mjs";
import { displaySavedResultContract } from "./display-saved-result.mjs";
import ROWS from "./fin-b10-rows.json" with { type: "json" };

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
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+\.(?:ai|net)\b[^\s"'`]*\/api\//i.test(text), `${name} must not call a live API`);
    for (const group of groups) {
      for (const control of [...group.controls, ...(group.notAttached || [])]) {
        listed += 1;
        assert.equal(oneRow(group.sourceFile, group.surface, control).length, 1, `${group.surface} / ${control}`);
      }
    }
  }
  assert.equal(listed, 40, "all 40 batch rows are exercised and attached");
});

test("every row has one proof case each (7 live, 33 practice); none is left out", () => {
  const attached = Object.values(ROWS).flatMap((groups) => groups.flatMap((g) => g.controls.map((control) => ({ sourceFile: g.sourceFile, surface: g.surface, control }))));
  assert.equal(attached.length, 40);
  assert.equal(Object.values(ROWS).flatMap((groups) => groups.flatMap((g) => g.notAttached || [])).length, 0, "no row is left out any more");
  assert.equal(FIN_B10_LIVE_CASES.length, 7);
  assert.equal(FIN_B10_PRACTICE_CASES.length, 33);
  assert.equal(FIN_B10_DISPLAY_PROOF_CASES.length, 40);
  const caseKeys = FIN_B10_DISPLAY_PROOF_CASES.map(keyOf);
  assert.equal(new Set(caseKeys).size, 40);
  assert.deepEqual([...caseKeys].sort(), attached.map(keyOf).sort());
  // A live row names the lane (so it stays in the lane); a practice row never does.
  for (const c of FIN_B10_LIVE_CASES) assert.match(c.evidence, /gap-catalog-display\.mjs/);
  for (const c of FIN_B10_PRACTICE_CASES) assert.doesNotMatch(c.evidence, /gap-catalog-display\.mjs/);
  assert.equal(FIN_B10_LIVE_ROWS.length, 7);
  assert.equal(FIN_B10_RESULT_CONTRACTS.length, 7);
});

test("the two link-gate rows are real map rows served by the lane, and the page still carries every link they judge", () => {
  const gated = FIN_B10_RESULT_CONTRACTS.filter((c) => c.mode === "link-gate");
  assert.equal(gated.length, 2);
  const panel = fs.readFileSync(path.join(ROOT, "public/app/client-control-panel.html"), "utf8");
  const wanted = new Map([
    ["present.html", ["ccp-link-present", "ccp-link-present2"]],
    ["pipeline.html", ["ccp-link-pipeline"]],
    ["messaging.html", ["ccp-link-messaging"]],
    ["inquiry-remover.html", ["ccp-link-ir"]],
  ]);
  for (const contract of gated) {
    const row = FIN_B10_LIVE_ROWS.find(([, , control]) => control === contract.control);
    assert.ok(row, `${contract.control} is not a live row`);
    assert.equal(oneRow(row[0], row[1], row[2]).length, 1, contract.control);
    assert.equal(displaySavedResultContract({ control: contract.control }), contract, "the lane serves this batch's own contract");
    assert.ok(contract.links.length >= 1);
    for (const { file, roles } of contract.links) {
      assert.ok(wanted.has(file), `${file} is not a link the control panel carries`);
      assert.ok(roles.length >= 1);
      // Each judged screen is a real page, and the control panel really links to it by the id the row names.
      assert.ok(fs.existsSync(path.join(ROOT, "public/app", file)), `${file} does not exist`);
      assert.ok(wanted.get(file).some((id) => new RegExp(`id="${id}" href="${file.replace(".", "\\.")}"`).test(panel)),
        `client-control-panel.html no longer links ${file} by ${wanted.get(file).join(" or ")}`);
    }
  }
  // The gate that hides or shows those links is the one this page loads.
  assert.match(panel, /<script[^>]+src="shell\.js[^"]*"/);
});
