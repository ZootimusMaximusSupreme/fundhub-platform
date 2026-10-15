// Guards for the batch 19 row table: every listed row is one exact map row, every named test file is a
// plain runnable test that opens no live site, every attached row has a proof case, and the five rows
// left out stay out only while the reason in fin-b19-not-attachable.mjs is still true.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B19_DISPLAY_PROOF_CASES } from "./fin-b19-display-proofs.mjs";
import { FIN_B19_HIDDEN_HEADS, FIN_B19_NOT_ATTACHABLE } from "./fin-b19-not-attachable.mjs";
import ROWS from "./fin-b19-rows.json" with { type: "json" };

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
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost|assets\.example\.test|example\.test)[a-z0-9.-]+\.(?:ai|com|net)\b[^\s"'`]*\/api\//i.test(text), `${name} must not call a live API`);
    for (const group of groups) {
      for (const control of [...group.controls, ...(group.notAttached || [])]) {
        listed += 1;
        assert.equal(oneRow(group.sourceFile, group.surface, control).length, 1, `${group.surface} / ${control}`);
      }
    }
  }
  assert.equal(listed, 40, "35 attached rows and 5 exercised-but-not-attached rows");
});

test("attached rows have one proof case each; the exercised-but-not-attached rows have none", () => {
  const attached = Object.values(ROWS).flatMap((groups) => groups.flatMap((g) => g.controls));
  assert.equal(attached.length, 35);
  assert.equal(FIN_B19_DISPLAY_PROOF_CASES.length, 35);
  assert.equal(new Set(FIN_B19_DISPLAY_PROOF_CASES.map((c) => `${c.sourceFile}\0${c.surface}\0${c.control}`)).size, 35);
  const left = new Set(FIN_B19_DISPLAY_PROOF_CASES.map((c) => c.control));
  for (const row of [...FIN_B19_NOT_ATTACHABLE, ...FIN_B19_HIDDEN_HEADS]) assert.equal(left.has(row.control), false, row.control);
  for (const c of FIN_B19_DISPLAY_PROOF_CASES) {
    for (const t of c.tests) assert.ok(fs.existsSync(path.join(ROOT, t)), `${t} exists`);
  }
});

test("the five left-out rows are real map rows: two named not attachable, three sidebar heads judged by the live shared chrome", () => {
  assert.equal(FIN_B19_NOT_ATTACHABLE.length, 2);
  assert.equal(FIN_B19_HIDDEN_HEADS.length, 3);
  const listedNotAttached = Object.values(ROWS).flatMap((groups) => groups.flatMap((g) => g.notAttached || []));
  assert.deepEqual(
    [...listedNotAttached].sort(),
    [...FIN_B19_NOT_ATTACHABLE, ...FIN_B19_HIDDEN_HEADS].map((r) => r.control).sort(),
  );
  for (const row of FIN_B19_NOT_ATTACHABLE) {
    assert.equal(oneRow(row.sourceFile, row.surface, row.control).length, 1, row.control);
    assert.ok(row.why.length > 120, "the reason is written out");
  }
  for (const row of FIN_B19_HIDDEN_HEADS) assert.equal(oneRow(row.sourceFile, row.surface, row.control).length, 1, row.control);

  // The Sort and chip reason, held to the page: an empty choice still reorders nothing.
  const pipeline = fs.readFileSync(path.join(ROOT, "public/app/pipeline.html"), "utf8");
  assert.match(pipeline, /function applySort\(\)\{\s*var mode=fSort\.value; if\(!mode\) return;/,
    "applySort() now handles an empty choice: Manual and the Sort chip x may work, attach the Sort and chip rows");
  assert.match(pipeline, /c\.el\.value=''; applyFilters\(\); if\(c\.el===fSort\) applySort\(\); syncChips\(\);/,
    "the chip x changed: re-check the chip row");

  // The three heads: every link under each is still on NAV_HIDDEN in shell.js, which is what hides the section.
  // (fin-b19-hidden-head.test.mjs holds the live reader to the same file, and breaks it on purpose.)
  const shell = fs.readFileSync(path.join(ROOT, "public/app/shell.js"), "utf8");
  const hidden = shell.match(/var NAV_HIDDEN = \[([\s\S]*?)\];/)[1];
  const css = fs.readFileSync(path.join(ROOT, "public/app/crm-sidebar.css"), "utf8");
  const cssHidden = css.match(/\.navitem:is\(([\s\S]*?)\) \{\s*display: none !important;/)[1];
  const html = fs.readFileSync(path.join(ROOT, "public/app/sidebar.fragment.html"), "utf8");
  for (const head of FIN_B19_HIDDEN_HEADS) {
    for (const href of head.links) {
      assert.ok(hidden.includes(`"${href}"`), `${href} is no longer on NAV_HIDDEN: the ${head.label} head can show, attach the row`);
      // The same rows are hidden a second time by the sidebar stylesheet, which has to move with NAV_HIDDEN.
      assert.ok(cssHidden.includes(`[href="${href}"]`), `${href} is no longer hidden by crm-sidebar.css: the ${head.label} head can show, attach the row`);
    }
    // And the sidebar still lists each head with exactly those links.
    const block = html.split(`data-fh-section="${head.section}"`)[1].split("</div></div>")[0];
    assert.deepEqual([...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), head.links, head.section);
  }
});
