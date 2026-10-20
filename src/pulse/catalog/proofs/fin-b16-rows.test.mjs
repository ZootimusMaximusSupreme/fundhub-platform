// Guards for the batch 16 row table: every listed row is one exact map row, every named test file is a plain
// runnable test that opens no live site, every attached row has exactly one proof case (a live check or a
// practice test, with every test file that presses it), and the forty rows are all accounted for: 39 attached
// and 1 retired page row.

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
  // 50 listings: a row can be pressed by more than one file (Today steps 2 to 6, Needs reply, Send this one to),
  // and the 6 live rows each list their screen half.
  assert.equal(listed, 50);
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
  // Every live row also runs the practice test that presses the same control.
  const withScreenHalf = FIN_B16_LIVE_PROOF_CASES.filter((c) => c.tests.some((t) => !FIN_B16_LIVE_TESTS.includes(t))).map((c) => c.control);
  assert.equal(withScreenHalf.length, 6, "every live row has its screen half attached");
  for (const c of FIN_B16_DISPLAY_PROOF_CASES) {
    for (const t of c.tests) assert.ok(c.evidence.split("; ").includes(t), `${t} is missing from the evidence of ${c.control}`);
    assert.ok(c.evidence.split("; ").every((p) => fs.existsSync(path.join(ROOT, p))), c.control);
    assert.ok(c.tests.every((t) => t.endsWith(".test.mjs") && !t.includes(".pg.")), c.control);
  }
});

test("a row pressed by several files lists them all, and the server-side tests are attached where the page test cannot see them", () => {
  const find = (re) => FIN_B16_DISPLAY_PROOF_CASES.find((c) => re.test(c.control));
  const needsReply = find(/^Tab: Needs reply/);
  assert.ok(needsReply.tests.some((t) => t.endsWith("fin-b16-inbox-read.test.mjs")), "the server half of the Needs reply tab");
  assert.ok(needsReply.tests.some((t) => t.endsWith("fin-b16-messaging.test.mjs")));
  const sendTo = find(/^'Send this one to'/);
  for (const t of ["fin-b16-compose-writes.test.mjs", "fin-b16-messaging.test.mjs", "compose.test.mjs"]) {
    assert.ok(sendTo.tests.some((x) => x.endsWith(t)), `${t} is attached to Send this one to`);
  }
  for (const re of [/^Settings: quiet hours/, /^Settings: schedule fields/]) {
    assert.ok(find(re).tests.some((t) => t.endsWith("fin-b16-cc-settings.test.mjs")), "the Settings page is pressed for this row");
  }
  assert.ok(find(/^Today: 'Build the avatar'/).tests.some((t) => t.endsWith("fin-b16-cc-avatar.test.mjs")));
  for (const n of [2, 3, 4, 5, 6]) {
    const c = find(new RegExp(`^Today flywheel step ${n} `));
    assert.ok(c.tests.some((t) => t.endsWith("fin-b16-cc-today-words.test.mjs")), `step ${n} runs every state`);
  }
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
