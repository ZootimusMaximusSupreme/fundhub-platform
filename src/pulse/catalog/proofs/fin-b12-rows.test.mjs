// Accounts for every batch 12 display row, and holds the three "cannot be attached" reasons to the repo.
//
// Every one of the 40 rows is a live check (fin-b12-display-contracts.mjs), a practice test (fin-b12-rows.json
// and the test file named beside it), both (nine rows, see BOTH below), or not attachable
// (fin-b12-not-attachable.mjs). The lane then reports it as not proved only when it is not attachable.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B12_CONTROLS } from "./fin-b12-display-contracts.mjs";
import { DISPLAY_PROOF_CASES } from "./display-proof-cases.mjs";
import { displaySavedResultContract, isTrackedDisplayControl } from "./display-saved-result.mjs";
import { FIN_B12_NOT_ATTACHABLE } from "./fin-b12-not-attachable.mjs";
import ROWS from "./fin-b12-rows.json" with { type: "json" };
import { compileDisplayRuntimeData } from "../compiler.mjs";
import { gapChecks } from "../../coverage/gap-catalog-display.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const here = (file) => path.join(path.dirname(fileURLToPath(import.meta.url)), file);

const live = new Set(Object.values(FIN_B12_CONTROLS));
const practice = new Set(Object.values(ROWS).flatMap((groups) => groups.flatMap((group) => group.controls)));
const blocked = new Set(FIN_B12_NOT_ATTACHABLE.map((row) => row.control));

// Repair cycle 1: a live check reads SAVED rows and cannot see what a page paints. For nine rows a practice
// test of the real page was added beside the live check, so each of those nine is BOTH, on purpose. They
// are listed here by name so the overlap cannot grow by accident. (The finance-os.html header row lost its
// live check: a client with no name is the page's own designed fallback, not a wrong result. It is a practice
// test only.)
const HEADER_ROW = "Header text 'no client open' / client name";
const BOTH = new Set([
  FIN_B12_CONTROLS.cfTiles, FIN_B12_CONTROLS.cfVideo, FIN_B12_CONTROLS.docsPage,
  FIN_B12_CONTROLS.fosPicker, FIN_B12_CONTROLS.fosPage,
  FIN_B12_CONTROLS.galaxyPage, FIN_B12_CONTROLS.bench, FIN_B12_CONTROLS.card, FIN_B12_CONTROLS.applied,
]);

test("the 40 batch 12 rows are 17 live checks and 32 practice tests (9 of them also live checks)", () => {
  assert.equal(live.size, 17);
  assert.ok(practice.has(HEADER_ROW) && !live.has(HEADER_ROW), "the header row is a practice test only");
  assert.equal(practice.size, 32);
  assert.equal(blocked.size, 0);
  for (const control of blocked) assert.ok(!live.has(control) && !practice.has(control), control);
  const both = new Set([...live].filter((control) => practice.has(control)));
  assert.deepEqual([...both].sort(), [...BOTH].sort(), "the rows that are both are exactly the nine named above");
  assert.equal(new Set([...live, ...practice, ...blocked]).size, 40);
});

test("every practice-test file named in fin-b12-rows.json exists and claims its rows", () => {
  for (const file of Object.keys(ROWS)) {
    assert.ok(fs.existsSync(here(file)), `${file} exists`);
    const source = fs.readFileSync(here(file), "utf8");
    assert.match(source, /proof\.assertAllClaimed\(\)/, `${file} fails if a listed row is never exercised`);
  }
});

test("the lane leaves no batch 12 row not proved", async () => {
  const mapDir = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
  const sources = ["desks-a.json", "desks-b.json", "desks-c.json", "desks-d.json", "desks-e.json", "desks-f.json", "public-pages.json"]
    .map((sourceFile) => ({ sourceFile, rows: JSON.parse(fs.readFileSync(path.join(mapDir, sourceFile), "utf8")) }));
  const runtime = compileDisplayRuntimeData(sources, {
    proofCases: DISPLAY_PROOF_CASES,
    staffProofCases: [],
    contractFor: displaySavedResultContract,
    isTracked: isTrackedDisplayControl,
  });
  const rows = await gapChecks({ env: {}, fetchImpl: async () => new Response("", { status: 200 }) }, runtime);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const all = [...live, ...practice, ...blocked];
  const pick = (control) => rows.filter((row) => row.id.endsWith(`:${control}`));
  for (const control of all) {
    const matches = pick(control);
    if (blocked.has(control)) {
      assert.equal(matches.length, 1, `${control}: one lane row`);
      assert.equal(matches[0].status, "NOT_PROVED", `${control}: stays not proved, and says what is missing`);
    } else if (live.has(control)) {
      assert.equal(matches.length, 1, `${control}: one saved-result lane row`);
      assert.notEqual(matches[0].status, "NOT_PROVED", `${control}: saved-result lane is attached`);
    } else {
      assert.equal(matches.length, 0, `${control}: direct browser proof removes it from the not-proved lane`);
    }
  }
  assert.ok(byId.size > 0);
});

test("documents status filter offers only statuses the saved row can hold", () => {
  const html = read("public/app/documents.html");
  assert.doesNotMatch(html, /<option value="gen-(?:pending|failed)">/);
  assert.doesNotMatch(html, /if\(sf==='gen-(?:pending|failed)'/);
  for (const value of ["del-pending", "del-bounced", "sig-pending", "sig-expired"]) {
    assert.match(html, new RegExp(`<option value="${value}">`), value);
    assert.match(html, new RegExp(`if\\(sf==='${value}'`), value);
  }
});

test("galaxy legend never changes saved output or presence on dice", () => {
  const html = read("public/app/galaxy.html");
  assert.match(html, /<i>size = output today<\/i>/);
  assert.match(html, /<i>brightness = working right now<\/i>/);
  const activity = html.slice(html.indexOf("function evActivity("), html.indexOf("/* -- one worker hands something to another -- */"));
  assert.doesNotMatch(activity, /n\.out\s*[+\-]?=/, "animation never changes output");
  assert.doesNotMatch(activity, /n\.state\s*=/, "animation never changes presence");
});

test("galaxy rails draw only routes and labels supplied by the feed", () => {
  const html = read("public/app/galaxy.html");
  assert.match(html, /function fillC\(s\)\{[\s\S]*?pick\(CLIENTS\)[\s\S]*?\.replace\('\{C\}', c\)/, "fillC picks any client from the feed");
  assert.match(html, /threads\.push\(\{a:a,b:b, label:String\(r\[2\] \|\| 'handoff'\)/, "the feed's label is used directly");
  assert.doesNotMatch(html, /label:fillC\(r\[2\]\)/, "a hand-off label is never randomized");
  assert.doesNotMatch(html, /ROUTES\.push\(\[ids\[ri\]/, "the page never invents routes between neighbours");
});
