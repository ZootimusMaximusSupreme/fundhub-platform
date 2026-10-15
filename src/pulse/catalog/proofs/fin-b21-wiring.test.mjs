// Batch 21 wiring: every one of the 32 rows is one exact map row and ends in exactly one outcome
// (live check, practice test, or named as not attachable), and the display lane agrees:
// live rows are judged by their saved result, practice rows leave the lane, and the rest stay NOT_PROVED.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { gapChecks } from "../../coverage/gap-catalog-display.mjs";
import { FIN_B21_CHECKS } from "./fin-b21-display-contracts.mjs";
import { FIN_B21_DISPLAY_PROOF_CASES, FIN_B21_NOT_ATTACHABLE } from "./fin-b21-display-practice.mjs";
import { displaySavedResultContract } from "./display-saved-result.mjs";
import { DISPLAY_PROOF_CASES } from "./display-proof-cases.mjs";
import { REPO_ROOT } from "./fin-b21-sql-kit.mjs";

const MAP = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "ops/workflows/coverage-every-surface-2026-10-10/desks-f.json"), "utf8"));
const rowFor = (surface, control) => MAP.filter((row) => row.surface === surface && row.control === control);
const idFor = (surface, control) => `catalog-display:desks-f.json:${surface}:${control}`;

const LIVE = FIN_B21_CHECKS.map((c) => ({ surface: c.surface, control: c.control }));
const PRACTICE = FIN_B21_DISPLAY_PROOF_CASES.map((c) => ({ surface: c.surface, control: c.control }));
const NOT_ATTACHABLE = FIN_B21_NOT_ATTACHABLE.map((c) => ({ surface: c.surface, control: c.control }));

test("32 rows: 15 live checks, 7 practice tests, 10 named as not attachable, no row twice", () => {
  assert.equal(LIVE.length, 15);
  assert.equal(PRACTICE.length, 7);
  assert.equal(NOT_ATTACHABLE.length, 10);
  const all = [...LIVE, ...PRACTICE, ...NOT_ATTACHABLE].map((r) => idFor(r.surface, r.control));
  assert.equal(all.length, 32);
  assert.equal(new Set(all).size, 32);
  for (const r of [...LIVE, ...PRACTICE, ...NOT_ATTACHABLE]) {
    assert.equal(rowFor(r.surface, r.control).length, 1, `${r.surface} / ${r.control}`);
  }
  // Only these three pages are touched.
  assert.deepEqual([...new Set(all.map((id) => id.split(":")[2]))].sort(),
    ["social-studio.html", "staff-teams.html", "teleprompter.html (+ teleprompter.js, teleprompter-edits.js)"]);
});

test("every not-attachable row carries an exact reason that names where to look", () => {
  for (const entry of FIN_B21_NOT_ATTACHABLE) {
    assert.ok(entry.reason.length > 150, entry.control);
    assert.match(entry.reason, /Needs|needs/, entry.control);
  }
});

test("every practice case names a plain runnable test file that exists and is not a database test", () => {
  for (const entry of FIN_B21_DISPLAY_PROOF_CASES) {
    assert.ok(entry.tests.length >= 1);
    for (const file of entry.tests) {
      assert.ok(fs.existsSync(path.join(REPO_ROOT, file)), file);
      assert.doesNotMatch(file, /\.pg\.test\.mjs$/);
      assert.match(file, /\.test\.mjs$/);
    }
    assert.ok(entry.proof.assertion.length > 80);
  }
});

test("the registry carries a contract only for the live rows", () => {
  for (const r of LIVE) {
    const row = rowFor(r.surface, r.control)[0];
    const contract = displaySavedResultContract(row);
    assert.ok(contract, r.control);
    assert.equal(contract.mode, "query");
    assert.equal(contract.anyImpact, true);
  }
  for (const r of [...PRACTICE, ...NOT_ATTACHABLE]) {
    assert.equal(displaySavedResultContract(rowFor(r.surface, r.control)[0]), null, r.control);
  }
});

test("the plug-in list holds the practice cases and none of the other rows", () => {
  const byKey = new Set(DISPLAY_PROOF_CASES.map((c) => `${c.sourceFile}\0${c.surface}\0${c.control}`));
  for (const entry of FIN_B21_DISPLAY_PROOF_CASES) assert.ok(byKey.has(entry.key), entry.control);
  for (const r of [...LIVE, ...NOT_ATTACHABLE]) {
    assert.equal(byKey.has(`desks-f.json\0${r.surface}\0${r.control}`), false, `${r.control} must not be attached as a practice test`);
  }
});

test("the display lane judges the live rows, drops the practice rows, and keeps the rest NOT_PROVED", async () => {
  const db = { query: async () => ({ rows: [{ sample_count: 3, bad_count: 0 }] }) };
  const rows = await gapChecks({ db, orgId: "00000000-0000-4000-8000-0000000000a1" });
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const r of LIVE) {
    const got = byId.get(idFor(r.surface, r.control));
    assert.ok(got, `lane row: ${r.control}`);
    assert.equal(got.status, "PASS", r.control);
  }
  for (const r of PRACTICE) assert.equal(byId.has(idFor(r.surface, r.control)), false, `${r.control} left the lane`);
  for (const r of NOT_ATTACHABLE) {
    assert.equal(byId.get(idFor(r.surface, r.control))?.status, "NOT_PROVED", r.control);
  }
  // A wrong saved result is red on exactly that row.
  const red = await gapChecks({
    db: { query: async (sql) => ({ rows: [{ sample_count: 4, bad_count: /display-result:staff-revoke /.test(sql) ? 1 : 0 }] }) },
    orgId: "00000000-0000-4000-8000-0000000000a1"
  });
  const revoke = red.find((row) => row.id === idFor("staff-teams.html", "Editor 'Revoke login' (confirm): suspends the person and kills their sessions"));
  assert.equal(revoke.status, "FAIL");
  assert.match(revoke.detail, /1 of 4/);
});

test("with no database a live row is skipped, never green", async () => {
  const rows = await gapChecks({});
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const r of LIVE) assert.equal(byId.get(idFor(r.surface, r.control)).status, "skip", r.control);
});

test("a control nobody has used yet is green with the first-result words, except the rule book", async () => {
  const rows = await gapChecks({ db: { query: async () => ({ rows: [{ sample_count: 0, bad_count: 0 }] }) }, orgId: "x" });
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const r of LIVE) {
    const got = byId.get(idFor(r.surface, r.control));
    if (r.control.startsWith("'Check the wording'")) {
      assert.equal(got.status, "FAIL", "the rule book is never quiet: no saved rules at all is red");
    } else {
      assert.equal(got.status, "PASS", r.control);
      assert.match(got.detail, /no saved results yet/);
    }
  }
});
