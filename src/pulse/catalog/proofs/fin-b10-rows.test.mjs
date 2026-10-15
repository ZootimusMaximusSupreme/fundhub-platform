// Guards for the batch 10 row table: every listed row is one exact map row, every named test file is a
// plain runnable test that opens no live site, and every row ends in exactly one place: a live check (seven:
// five saved results, two link gates, each also carrying its browser test), a practice test (thirty-two), or
// held open in the lane with its exact reason (one).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B10_DISPLAY_PROOF_CASES, FIN_B10_PRACTICE_CASES } from "./fin-b10-display-proofs.mjs";
import { FIN_B10_COMPILE_CASES, FIN_B10_LIVE_CASES, FIN_B10_LIVE_ROWS, FIN_B10_OPEN_ROWS, FIN_B10_RESULT_CONTRACTS } from "./fin-b10-display-contracts.mjs";
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
  assert.equal(listed, 40, "all 40 batch rows are exercised (39 attached, 1 held open)");
});

test("every row ends in one place: 7 live, 32 practice, 1 held open; none is left out", () => {
  const attached = Object.values(ROWS).flatMap((groups) => groups.flatMap((g) => g.controls.map((control) => ({ sourceFile: g.sourceFile, surface: g.surface, control }))));
  const open = Object.values(ROWS).flatMap((groups) => groups.flatMap((g) => (g.notAttached || []).map((control) => ({ sourceFile: g.sourceFile, surface: g.surface, control }))));
  assert.equal(attached.length, 39);
  assert.equal(open.length, 1, "exactly one row is held open");
  assert.equal(FIN_B10_LIVE_CASES.length, 7);
  assert.equal(FIN_B10_PRACTICE_CASES.length, 32);
  assert.equal(FIN_B10_DISPLAY_PROOF_CASES.length, 39);
  const caseKeys = FIN_B10_DISPLAY_PROOF_CASES.map(keyOf);
  assert.equal(new Set(caseKeys).size, 39);
  assert.deepEqual([...caseKeys].sort(), attached.map(keyOf).sort());
  // The held-open row is in no proof case: it stays in the lane, and the lane says why.
  assert.ok(!caseKeys.includes(keyOf(open[0])), "the held-open row is not handed to the catalog as proved");
  assert.deepEqual(FIN_B10_OPEN_ROWS.map(([sourceFile, surface, control]) => keyOf({ sourceFile, surface, control })), open.map(keyOf));
  // A live row names the lane (so it stays in the lane) and BOTH its contract test and its browser test; a
  // practice row never names the lane.
  for (const c of FIN_B10_DISPLAY_PROOF_CASES.filter((x) => FIN_B10_LIVE_ROWS.some(([f, s, ctl]) => keyOf({ sourceFile: f, surface: s, control: ctl }) === keyOf(x)))) {
    assert.match(c.evidence, /gap-catalog-display\.mjs/);
    const hits = c.tests.filter((t) => /fin-b10-(?:campaign-manager|client-control-panel|closer|company-brain)\.test\.mjs$/.test(t));
    assert.equal(hits.length, 1, `${c.control}: its browser test is in the catalog's test list`);
    assert.ok(c.tests.some((t) => /fin-b10-(?:live-contracts|link-gate)\.test\.mjs$/.test(t)), `${c.control}: its contract test is too`);
  }
  for (const c of FIN_B10_PRACTICE_CASES) assert.doesNotMatch(c.evidence, /gap-catalog-display\.mjs/);
  assert.equal(FIN_B10_LIVE_ROWS.length, 7);
  assert.equal(FIN_B10_RESULT_CONTRACTS.length, 8, "five saved-result checks, two link gates, one held-open row");
  // The picker's live check re-derives the door's rule, so the door's own test is listed with it.
  const picker = FIN_B10_DISPLAY_PROOF_CASES.find((c) => c.control.startsWith("Client picker select"));
  assert.ok(picker.tests.some((t) => t.endsWith("fin-b10-clients-handler.test.mjs")));
  assert.ok(picker.tests.some((t) => t.endsWith("fin-b10-client-control-panel.test.mjs")));
  assert.ok(picker.tests.some((t) => t.endsWith("fin-b10-live-contracts.test.mjs")));
});

test("the held-open row is served by the lane as NOT_PROVED with its exact reason, and the reason is still true of the page", () => {
  const [sourceFile, surface, control] = FIN_B10_OPEN_ROWS[0];
  assert.equal(oneRow(sourceFile, surface, control).length, 1);
  const contract = displaySavedResultContract({ control });
  assert.equal(contract.mode, "always-red");
  assert.ok(FIN_B10_COMPILE_CASES.some((c) => c.control === control && c.depth === "deep"), "the compiler builds a lane case for it");
  assert.match(contract.requirement, /data-fh-href/);
  assert.match(contract.requirement, /Not attachable today/);
  // The reason names a line of the page. The moment paintCombined() also sets the shell's copy of the
  // address (data-fh-href) on the two partner links, this goes red and says the row can be attached.
  const panel = fs.readFileSync(path.join(ROOT, "public/app/client-control-panel.html"), "utf8");
  const start = panel.indexOf("function paintCombined(");
  const end = panel.indexOf("function loadCombined(", start);
  assert.ok(start > 0 && end > start, "paintCombined() is still in the page");
  const body = panel.slice(start, end);
  assert.match(body, /el\.partnerOpen\.href\s*=/);
  assert.match(body, /el\.partnerConsent\.href\s*=/);
  assert.doesNotMatch(body, /data-fh-href/,
    "paintCombined() now sets data-fh-href: the held-open reason no longer holds. Attach the row (add a late-session case to the browser test) and remove OPEN_GAP.");
  // And the shell's second pass still rebuilds every link from that copy, which is why the late answer wins.
  const shell = fs.readFileSync(path.join(ROOT, "public/app/shell.js"), "utf8");
  assert.match(shell, /var h = a\.getAttribute\("data-fh-href"\)\.replace/);
});

test("the two link-gate rows are real map rows served by the lane, and the page still carries every link they judge", () => {
  const gated = FIN_B10_RESULT_CONTRACTS.filter((c) => c.mode === "link-gate");
  assert.equal(gated.length, 2);
  const panel = fs.readFileSync(path.join(ROOT, "public/app/client-control-panel.html"), "utf8");
  for (const contract of gated) {
    const row = FIN_B10_LIVE_ROWS.find(([, , control]) => control === contract.control);
    assert.ok(row, `${contract.control} is not a live row`);
    assert.equal(oneRow(row[0], row[1], row[2]).length, 1, contract.control);
    assert.equal(displaySavedResultContract({ control: contract.control }), contract, "the lane serves this batch's own contract");
    assert.ok(contract.links.length >= 1);
    for (const { id, file, label, roles } of contract.links) {
      assert.ok(label && roles.length >= 1);
      // Each judged screen is a real page, and the control panel really links to it by the id the row names.
      assert.ok(fs.existsSync(path.join(ROOT, "public/app", file)), `${file} does not exist`);
      assert.ok(new RegExp(`id="${id}" href="${file.replace(".", "\\.")}"`).test(panel),
        `client-control-panel.html no longer links ${file} by ${id}`);
    }
  }
  // The gate that hides or shows those links is the one this page loads.
  assert.match(panel, /<script[^>]+src="shell\.js[^"]*"/);
});
