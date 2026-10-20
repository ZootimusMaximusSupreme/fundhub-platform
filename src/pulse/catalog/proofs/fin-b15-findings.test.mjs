// Holds the batch 15 product finding to the repo. The finding was fixed on 2026-10-20: these tests now
// go red if the repaint restart comes back, or if a mute or an expected-to-fail marker sneaks back in.

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
    assert.ok(f.what.length > 200 && f.fix.length > 40, "the fault and its fix are written out");
    const entry = FIN_B15_DISPLAY_ENTRIES.find((e) => e.control === f.control);
    assert.ok(entry, "the row is attached to its practice test");
    const named = (entry.specs || []).filter((s) => s.spec === f.spec).flatMap((s) => s.titles);
    for (const t of f.retryTests) assert.ok(named.includes(t), `the row names the Try again test "${t}"`);
  }
});

test("the Try again tests and the finding test exist in the spec, with no mute and no expected-to-fail marker", () => {
  for (const f of FIN_B15_FINDINGS) {
    const spec = fs.readFileSync(path.join(ROOT, f.spec), "utf8");
    for (const t of f.retryTests) {
      const at = spec.indexOf(`test("${t}"`);
      assert.ok(at > 0, `"${t}" is in ${f.spec}`);
    }
    const fAt = spec.indexOf(`test("${f.findingTest}"`);
    assert.ok(fAt > 0, "the finding test is in the spec");
    assert.ok(!spec.slice(fAt, fAt + 900).includes("test.fail("), "the finding test must pass, not be expected to fail");
    assert.ok(!spec.includes("muteRepaintRestarts"), "no test mutes the page's repaint restart any more");
  }
});

test("the fix holds: a failed Rules or Every version read is retried only on a real open, never on a repaint", () => {
  const source = fs.readFileSync(path.join(ROOT, "public/app/marketing-cc-scripts.js"), "utf8");
  const body = source.split("function onToggle(ev)")[1].split("function onPointerDown")[0];
  // "opened" is true only when the fold was closed before this toggle. A repaint re-creates an open fold,
  // so its toggle has opened === false and must not restart a failed read.
  assert.match(body, /const opened = d\.open && !st\.open\[key\];\s*st\.open\[key\] = d\.open;/,
    "opened is worked out before st.open is updated");
  assert.match(body, /key === "rules" && !st\.rules\.loaded && st\.rules\.status !== "loading" && \(opened \|\| st\.rules\.status !== "error"\)\) loadRules\(\)/,
    "the Rules fold restarts a failed read only on a real open");
  assert.match(body, /!st\.versions\[id\] \|\| \(opened && st\.versions\[id\]\.status === "error"\)/,
    "the Every version fold restarts a failed read only on a real open");
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
