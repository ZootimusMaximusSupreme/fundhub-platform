// Guards for the batch 09 row table: every listed row is one exact map row, every named test file is a
// plain runnable test that opens no live site, every attached row has a proof case, and the two
// row left out stays out only while the reason in fin-b09-not-attachable.mjs is still true.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B09_DISPLAY_PROOF_CASES } from "./fin-b09-display-proofs.mjs";
import { FIN_B09_NOT_ATTACHABLE } from "./fin-b09-not-attachable.mjs";
import ROWS from "./fin-b09-rows.json" with { type: "json" };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const maps = new Map();
const rowsOf = (file) => {
  if (!maps.has(file)) maps.set(file, JSON.parse(fs.readFileSync(path.join(MAP_DIR, file), "utf8")));
  return maps.get(file);
};
const oneRow = (file, surface, control) => rowsOf(file).filter((r) => r.surface === surface && r.control === control);

test("every listed row is one exact map row, and its test file is a plain test that never opens the live site", () => {
  let listed = 0;
  for (const [name, groups] of Object.entries(ROWS)) {
    const file = path.join(ROOT, "src/pulse/catalog/proofs", name);
    assert.ok(fs.existsSync(file), `${name} does not exist`);
    assert.ok(name.endsWith(".test.mjs") && !name.includes(".pg."), `${name} is not a plain runnable test`);
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+\.(?:ai|com|net)\b[^\s"'`]*\/api\//i.test(text), `${name} must not call a live API`);
    for (const group of groups) {
      for (const control of [...group.controls, ...(group.notAttached || [])]) {
        listed += 1;
        assert.equal(oneRow(group.sourceFile, group.surface, control).length, 1, `${group.surface} / ${control}`);
      }
    }
  }
  assert.equal(listed, 38, "all 38 listed rows");
});

test("all 38 attached rows have one proof case each", () => {
  const attached = Object.values(ROWS).flatMap((groups) => groups.flatMap((g) => g.controls));
  assert.equal(attached.length, 38);
  assert.equal(FIN_B09_DISPLAY_PROOF_CASES.length, 38);
  assert.equal(new Set(FIN_B09_DISPLAY_PROOF_CASES.map((c) => `${c.sourceFile}\0${c.surface}\0${c.control}`)).size, 38);
  const left = new Set(FIN_B09_DISPLAY_PROOF_CASES.map((c) => c.control));
  for (const row of FIN_B09_NOT_ATTACHABLE) assert.equal(left.has(row.control), false, row.control);
});

test("the one left-out row is a real map row with a reason that is still true", () => {
  assert.equal(FIN_B09_NOT_ATTACHABLE.length, 1);
  for (const row of FIN_B09_NOT_ATTACHABLE) {
    assert.equal(oneRow(row.sourceFile, row.surface, row.control).length, 1, row.control);
    assert.ok(row.why.length > 80, "the reason is written out");
  }

  // Climate: the shipped bundle still has no plain sentence under a clicked state.
  const climate = path.join(ROOT, "public/climate");
  const files = [path.join(climate, "index.html")];
  const chunks = path.join(climate, "_next/static/chunks");
  for (const f of fs.readdirSync(chunks)) if (f.endsWith(".js")) files.push(path.join(chunks, f));
  const app = path.join(chunks, "app");
  for (const f of fs.readdirSync(app)) if (f.endsWith(".js")) files.push(path.join(app, f));
  const text = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  assert.ok(!/wider picture|not a decision about/i.test(text),
    "the climate page now carries the plain sentence: attach the Click a state row with a practice test");
  assert.match(text, /Today's Score/, "the state panel still shows the score");
});

test("the agent list row restores its saved copy before switching", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/app/agent-editor.html"), "utf8");
  const listClick = html.split("function renderList")[1].split("function renderEvents")[0];
  assert.match(listClick, /if\(!confirm\('You have unsaved changes on '\+cur\.name\+'\. Discard them\?'\)\) return;/);
  assert.match(listClick, /restoreSavedAgent\(\);\s*}\s*select\(el\.dataset\.a\);/,
    "the confirmed discard restores the saved object before another agent opens");
});
