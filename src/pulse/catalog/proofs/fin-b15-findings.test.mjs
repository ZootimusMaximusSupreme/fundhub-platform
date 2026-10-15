// Holds the batch 15 product finding to the repo. If the "still true" test goes red, the page was
// fixed: take the mute out of the two Try again tests and the expected-to-fail marker off the
// FINDING test (the text in FIN_B15_FINDINGS.whenFixed says exactly what).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B15_FINDINGS } from "./fin-b15-findings.mjs";
import { FIN_B15_DISPLAY_ENTRIES } from "./fin-b15-display-specs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");

test("the finding is one exact map row, and that row IS attached to a practice test, never left out", () => {
  assert.equal(FIN_B15_FINDINGS.length, 1);
  const map = JSON.parse(fs.readFileSync(path.join(MAP_DIR, "desks-c.json"), "utf8"));
  for (const f of FIN_B15_FINDINGS) {
    assert.equal(map.filter((r) => r.surface === f.surface && r.control === f.control).length, 1, f.control);
    assert.ok(f.what.length > 200 && f.whenFixed.length > 40, "the fault and what to do when it is fixed are written out");
    const entry = FIN_B15_DISPLAY_ENTRIES.find((e) => e.control === f.control);
    assert.ok(entry, "the row is attached to its practice test");
    const named = (entry.specs || []).filter((s) => s.spec === f.spec).flatMap((s) => s.titles);
    for (const t of f.mutedTests) assert.ok(named.includes(t), `the row names the muted test "${t}"`);
  }
});

test("the muted tests and the FINDING test exist in the spec, and the mute is narrow: it drops a toggle on a fold that already shows its failure box and nothing else", () => {
  for (const f of FIN_B15_FINDINGS) {
    const spec = fs.readFileSync(path.join(ROOT, f.spec), "utf8");
    for (const t of f.mutedTests) {
      const at = spec.indexOf(t);
      assert.ok(at > 0, `"${t}" is in ${f.spec}`);
      const body = spec.slice(at, at + 400);
      assert.ok(body.includes("muteRepaintRestarts(page)"), `"${t}" mutes the repaint restart and nothing else`);
    }
    const fAt = spec.indexOf(f.findingTest);
    assert.ok(fAt > 0, "the FINDING test is in the spec");
    assert.ok(spec.slice(fAt, fAt + 900).includes("test.fail();"), "the FINDING test is marked expected-to-fail");
    // The mute drops only a toggle whose fold already has the failure box. If it were widened (say, every
    // toggle), the two button tests would stop meaning anything.
    const mute = spec.split("async function muteRepaintRestarts(page)")[1].split("\n}\n")[0];
    assert.match(mute, /d\.tagName === "DETAILS" && d\.querySelector\("\.ccs-err"\)/);
    assert.match(mute, /stopImmediatePropagation/);
  }
});

test("the finding is still true: a failed Rules or Every version read is started again on every repaint", () => {
  const source = fs.readFileSync(path.join(ROOT, "public/app/marketing-cc-scripts.js"), "utf8");
  const body = source.split("function onToggle(ev)")[1].split("function onPointerDown")[0];
  // The Rules fold starts its read whenever it is open, not loaded, and not already loading. A status of
  // "error" is none of those, so a failed read is started again by the next repaint.
  assert.match(body, /key === "rules" && !st\.rules\.loaded && st\.rules\.status !== "loading"\) loadRules\(\)/,
    "the Rules fold no longer restarts a failed read on every repaint: take the mute out of the Try again tests");
  // The Every version fold does the same on purpose for status === "error".
  assert.match(body, /!st\.versions\[id\] \|\| st\.versions\[id\]\.status === "error"\)/,
    "the Every version fold no longer restarts a failed read on every repaint: take the mute out of the Try again tests");
  assert.ok(!/status !== "error"/.test(body), "a failed read is now left alone until Try again: take the mute out of the Try again tests");
});

test("the Try again buttons are still wired in the page: each one calls the read of its own part", () => {
  const source = fs.readFileSync(path.join(ROOT, "public/app/marketing-cc-scripts.js"), "utf8");
  for (const [act, call] of [
    ["scripts-retry", "loadScripts()"], ["ideas-retry", "loadIdeas()"], ["rules-retry", "loadRules()"],
    ["batches-retry", "loadBatches()"]
  ]) {
    assert.ok(source.includes(`case "${act}": ${call}; break;`), `${act} calls ${call}`);
  }
  assert.match(source, /case "versions-retry": \{\s*const d = b\.closest\("\[data-load='versions'\]"\);\s*if \(d\) loadVersions\(d\.getAttribute\("data-id"\)\);/);
});
