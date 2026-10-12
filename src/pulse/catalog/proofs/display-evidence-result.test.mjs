import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DISPLAY_EVIDENCE_TEST,
  displayEvidenceResultProof,
  displayEvidenceTestReferences,
  exactSafeBrowserSpecs,
} from "./display-evidence-result.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const DISPLAY_MAPS = [
  "desks-a.json", "desks-b.json", "desks-c.json", "desks-d.json",
  "desks-e.json", "desks-f.json", "public-pages.json",
];

const rows = DISPLAY_MAPS.flatMap((sourceFile) => JSON.parse(
  fs.readFileSync(path.join(MAP_DIR, sourceFile), "utf8"),
).filter((row) => !row.repeats_row_in));

test("shared display evidence accepts only exact safe local browser proof", () => {
  const selected = rows.filter((row) => displayEvidenceResultProof(row));
  assert.equal(selected.length, 159, "the exact safe display proof set changed; review every added or removed row");

  for (const row of selected) {
    const proof = displayEvidenceResultProof(row);
    assert.equal(proof.depth, "e2e");
    assert.equal(proof.evidence, DISPLAY_EVIDENCE_TEST);
    assert.equal(proof.asserts, row.control);
    assert.ok(["none", "staffOnly"].includes(row.impact), row.control);
    assert.ok(!["page", "page-load"].includes(String(row.kind).toLowerCase()), row.control);

    const specs = exactSafeBrowserSpecs(row);
    assert.ok(specs.length > 0, row.control);
    for (const spec of specs) {
      assert.ok(spec.startsWith("e2e/"), spec);
      assert.ok(fs.existsSync(path.join(ROOT, spec)), `${row.control}: missing ${spec}`);
    }

    for (const reference of displayEvidenceTestReferences(row)) {
      assert.ok(reference.includes("/"), `${row.control}: ambiguous test name ${reference}`);
      assert.ok(fs.existsSync(path.join(ROOT, reference)), `${row.control}: missing ${reference}`);
      assert.doesNotMatch(reference, /(?:^|\/)(?:live-|launch-proof-live)|e2e\/(?:cc-tab-shoot|teleprompter-take-flow)\.spec\.mjs$|\.pg\.test\.mjs$|\.test\.db\.mjs$|hole\d|comprehensive|demo-journey|prove|\.paused\.spec\.mjs$/i);
    }
  }
});

test("weak, live, database, page-load, and deep-result claims stay red", () => {
  const base = {
    control: "Named button",
    kind: "button",
    impact: "none",
    evidence: "e2e/calendar.spec.mjs 'click checks the named result'",
  };
  assert.ok(displayEvidenceResultProof(base));
  assert.equal(displayEvidenceResultProof({ ...base, impact: "money" }), null);
  assert.equal(displayEvidenceResultProof({ ...base, kind: "page-load" }), null);
  assert.equal(displayEvidenceResultProof({ ...base, evidence: "e2e/screens-smoke.spec.mjs page load only" }), null);
  assert.equal(displayEvidenceResultProof({ ...base, evidence: "e2e/live-proof.spec.mjs exact click" }), null);
  assert.equal(displayEvidenceResultProof({ ...base, evidence: "src/example.pg.test.mjs; e2e/calendar.spec.mjs exact click" }), null);
  assert.equal(displayEvidenceResultProof({ ...base, evidence: "calendar.spec.mjs exact click" }), null);
});
