import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import {
  CHECKS,
  SLICE_ID,
  buildChecks,
  gaps,
  isRoutedDesk,
  scopedRoutedDesks
} from "./slice-23-pages.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../../../public/app");

test("slice 23-pages: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.equal(SLICE_ID, "23-pages");
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x \S+$/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(row.alreadyInRegistry, false);
    assert.equal(typeof row.proof, "string");
    assert.ok(row.proof.length > 0);
    assert.doesNotMatch(row.proof, /^PASS/);
  }
});

test("slice 23-pages: scoped desks are routed, on disk, and in the pulse registry", () => {
  const scoped = scopedRoutedDesks();
  assert.ok(scoped.includes("pipeline.html"));
  assert.ok(scoped.includes("client-portal.html"));
  assert.ok(scoped.includes("contracts.html"));
  assert.ok(scoped.includes("hiring.html"));
  assert.ok(scoped.includes("financeos.html"));
  assert.ok(scoped.includes("lenders.html"));

  for (const file of scoped) {
    assert.ok(fs.existsSync(path.join(APP_DIR, file)), `${file} missing on disk`);
    assert.ok(isRoutedDesk(file), `${file} is not shell-routed`);
  }

  const listed = new Set(PULSE_REGISTRY.filter((row) => row.kind === "desk").map(coverageKey));
  for (const file of scoped) {
    assert.ok(listed.has(file), `${file} should be in PULSE_REGISTRY or CHECKS`);
  }

  assert.deepEqual(CHECKS, []);
  assert.deepEqual(gaps(), []);
});

test("slice 23-pages: buildChecks surfaces a desk dropped from the registry", () => {
  const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
  listed.delete("pipeline.html");
  const missing = buildChecks(listed);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].id, "pipeline");
  assert.equal(missing[0].file, "pipeline.html");
  assert.equal(missing[0].alreadyInRegistry, false);
  assert.match(missing[0].proof, /DESK_FILES/);
  assert.match(missing[0].proof, /Do not auto-fix/);
});
