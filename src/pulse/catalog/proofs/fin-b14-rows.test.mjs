// Guards for the batch 14 row table: every listed row is one exact map row, every named test file is a
// plain runnable test that opens no live site, every attached row has exactly one proof case (a live check
// or a practice test), and each row left out stays out only while the reason in fin-b14-not-attachable.mjs
// is still true (each reason is held to the source line it rests on).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B14_DISPLAY_PROOF_CASES, FIN_B14_PRACTICE_CASES } from "./fin-b14-display-proofs.mjs";
import { FIN_B14_LIVE_CASES, FIN_B14_LIVE_ROWS, FIN_B14_RESULT_CONTRACTS } from "./fin-b14-display-contracts.mjs";
import { FIN_B14_NOT_ATTACHABLE } from "./fin-b14-not-attachable.mjs";
import { DISPLAY_RESULT_CONTRACTS } from "./display-saved-result.mjs";
import { ROLE_SETS } from "../../../http/read-api.mjs";
import ROWS from "./fin-b14-rows.json" with { type: "json" };

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
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost|api\.anthropic\.com\/v1\/messages)[a-z0-9.-]+\.(?:ai|net|com)\b[^\s"'`]*\/api\//i.test(text), `${name} must not call a live API`);
    for (const group of groups) {
      for (const also of group.also || []) assert.ok(fs.existsSync(path.join(ROOT, also)), `${also} does not exist`);
      for (const control of [...group.controls, ...(group.notAttached || [])]) {
        listed += 1;
        assert.equal(oneRow(group.sourceFile, group.surface, control).length, 1, `${group.surface} / ${control}`);
      }
    }
  }
  assert.equal(listed, 38, "31 attached rows (27 practice tests and 4 live checks that also name a practice test) and 7 left out");
});

test("live rows are real map rows, each with one registry contract; practice rows have one proof case each", () => {
  assert.equal(FIN_B14_LIVE_ROWS.length, 6);
  for (const [sourceFile, surface, control] of FIN_B14_LIVE_ROWS) {
    assert.equal(oneRow(sourceFile, surface, control).length, 1, `${surface} / ${control}`);
    assert.equal(DISPLAY_RESULT_CONTRACTS.filter((c) => c.control === control).length, 1, "one registry contract");
  }
  assert.equal(FIN_B14_RESULT_CONTRACTS.length, 6);

  const liveKeys = new Set(FIN_B14_LIVE_ROWS.map(([sourceFile, surface, control]) => `${sourceFile}\0${surface}\0${control}`));
  const attached = Object.values(ROWS).flatMap((groups) => groups.flatMap((g) => g.controls.map((control) => ({ sourceFile: g.sourceFile, surface: g.surface, control }))));
  assert.equal(attached.length, 31);
  const practice = attached.filter((row) => !liveKeys.has(keyOf(row)));
  assert.equal(practice.length, 27, "four of the attached rows are live checks that also name a practice test");
  assert.equal(FIN_B14_LIVE_CASES.length, 6);
  assert.equal(FIN_B14_PRACTICE_CASES.length, 27);
  assert.equal(FIN_B14_DISPLAY_PROOF_CASES.length, 33);
  const caseKeys = FIN_B14_DISPLAY_PROOF_CASES.map(keyOf);
  assert.equal(new Set(caseKeys).size, 33, "no row has two proof cases");
  assert.deepEqual([...FIN_B14_PRACTICE_CASES.map(keyOf)].sort(), practice.map(keyOf).sort());
  for (const row of FIN_B14_NOT_ATTACHABLE) assert.equal(caseKeys.includes(keyOf(row)), false, row.control);
  // A live row names the lane (so it stays in the lane); a practice row never does.
  for (const c of FIN_B14_LIVE_CASES) assert.match(c.evidence, /gap-catalog-display\.mjs/);
  for (const c of FIN_B14_PRACTICE_CASES) assert.doesNotMatch(c.evidence, /gap-catalog-display\.mjs/);
  // A live row that also names practice tests: the button's own request is judged by them (Apply, Import now,
  // Confirm, Corrected); a live row with no button request of its own (Page load, Add blank row) names the SQL test only.
  const alsoNamed = FIN_B14_LIVE_CASES.filter((c) => c.tests.length > 1).map((c) => c.control).sort();
  assert.deepEqual(alsoNamed, [
    "Header: Apply to code and bottom-bar Apply (saves every edited journey)",
    "Import now button (paste CSV, creates and updates lender rows)",
    "Mismatch queue row: Confirm button",
    "Mismatch queue row: Corrected button",
  ]);
  // Every test any case names exists, and a practice row's tests are the file beside it in the table.
  for (const c of FIN_B14_DISPLAY_PROOF_CASES) for (const t of c.tests) assert.ok(fs.existsSync(path.join(ROOT, t)), `${t} exists`);
});

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("the left-out rows are real map rows, each with a written reason", () => {
  assert.equal(FIN_B14_NOT_ATTACHABLE.length, 7);
  const listedNotAttached = Object.values(ROWS).flatMap((groups) => groups.flatMap((g) => (g.notAttached || []).map((control) => `${g.sourceFile}\0${g.surface}\0${control}`)));
  assert.deepEqual(listedNotAttached.sort(), FIN_B14_NOT_ATTACHABLE.map(keyOf).sort(), "the table and the reasons list the same rows");
  for (const row of FIN_B14_NOT_ATTACHABLE) {
    assert.equal(oneRow(row.sourceFile, row.surface, row.control).length, 1, row.control);
    assert.ok(row.why.length > 400, "the reason is written out");
    assert.match(row.why, /[Ff]ix|Only the owner can pick/, "and it says what would let the row attach");
  }
});

test("Page gate: the reason is still true while the run door is wider than the row says", () => {
  // Still true: the editor and ask doors gate on owner and admin only; the run door gates on the finance set,
  // which holds the sales manager as well.
  assert.match(read("api/journeys.mjs"), /requireRole\("owner", "admin"\)/);
  assert.match(read("api/journeys/ask.mjs"), /requireRole\("owner", "admin"\)/);
  assert.match(read("api/journeys/run.mjs"), /requireRole\(res, staff, ROLE_SETS\.FINANCE\)/);
  assert.deepEqual([...ROLE_SETS.FINANCE].sort(), ["admin", "owner", "sales_manager"],
    "the run door's set is owner and admin only now: attach the Page gate row with fin-b14-journeys-handlers.test.mjs");
});

// Each wrong result below is also pinned by a KNOWN BREAK test that runs the page in a browser. These checks
// read the one source line each reason rests on, so a fix turns this file red at once and names the row to attach.
test("Discard: the reason is still true while the handler zeroes the page-wide unsaved count", () => {
  const page = read("public/app/journeys.html");
  assert.match(page, /d\.onclick=\(\)=>\{pushUndo\(\);J\[active\]=JSON\.parse\(JSON\.stringify\(SAVED\[active\]\)\);dirty=0;delete touched\[active\];/,
    "Discard no longer sets the whole page's count to zero: attach the Discard row (fin-b14-journeys.test.mjs already exercises it)");
  assert.match(page, /let active='client', selId=null, dirty=0, touched=\{\}/, "the count is still one number for the whole page");
});

test("Make the change: the reason is still true while an answer that only removes steps is dropped as empty", () => {
  const page = read("public/app/journeys.html");
  assert.match(page, /if\(op\.op==='delete'\)\{const f=findNode\(op\.id\);if\(f\)f\.list\.splice\(f\.idx,1\);return\}/);
  assert.match(page, /if\(!added\.length&&!changed\.length\)\{undoStack\.pop\(\);askErr='That came back empty\./,
    "a removal is counted now: attach the Make the change row");
  assert.match(page, /\{"op":"delete","id":"<id>"\}/, "the page's own prompt still offers delete");
});

test("Run from here: the reason is still true while the plan is cut with findIndex on the path taken only", () => {
  const page = read("public/app/journeys.html");
  assert.match(page, /let steps=plan\(J\[active\]\.nodes\);\s*if\(fromId\)\{ const at=steps\.findIndex\(s=>s\.node&&s\.node\.id===fromId\); if\(at>0\) steps=steps\.slice\(at\); \}/,
    "Run from here cuts the plan differently now: attach the Run from here row");
});

test("Add bureau row: the reason is still true while the table is drawn again from the stored list only", () => {
  const page = read("public/app/lenders.html");
  assert.match(page, /getElementById\("btnAddBureau"\)\.addEventListener\("click", function \(\) \{\s*bureauRows\.push\(\{[\s\S]*?\}\);\s*renderBureau\(\);\s*\}\);/,
    "Add bureau row keeps typed text now: attach the Add bureau row row");
  assert.doesNotMatch(page.slice(page.indexOf('getElementById("btnAddBureau")')), /querySelectorAll\("#bureauBody \[data-f\]"|collectBureau/);
});

test("Export CSV: the reason is still true while the page saves whatever the server answers", () => {
  const page = read("public/app/lenders.html");
  assert.match(page, /p\.set\("format", "csv"\);\s*fetch\("\/api\/read\/lenders\?" \+ p\.toString\(\), \{ headers: headers\(\) \}\)\s*\.then\(function \(r\) \{ return r\.text\(\); \}\)\s*\.then\(function \(csv\) \{/,
    "Export CSV looks at the answer now: attach the Export CSV row");
});

test("Row Save: the reason is still true while an emptied Name is sent as null and null is not read as blank", () => {
  assert.match(read("public/app/lenders.html"), /patch\[k\] = v === "" \? null : v;/);
  assert.match(read("api/lenders.mjs"), /patch\.name !== undefined && String\(patch\.name\)\.trim\(\) === ""/,
    "the handler reads null as blank now: attach the Lender row Save row");
});
