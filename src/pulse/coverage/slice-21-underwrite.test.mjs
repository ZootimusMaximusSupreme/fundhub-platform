import test from "node:test";
import assert from "node:assert/strict";

import { CHECKS, SLICE_ID, gaps } from "./slice-21-underwrite.mjs";

test("slice 21-underwrite: every id is set and redAfter is 3x schedule", () => {
  assert.equal(SLICE_ID, "21-underwrite");
  assert.ok(CHECKS.length > 0);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x \S+/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
  }
});

test("slice 21-underwrite: read/underwrite is in the pulse registry", () => {
  const row = CHECKS.find((c) => c.id === "read/underwrite");
  assert.ok(row, "lists GET /api/read/underwrite");
  assert.equal(row.alreadyInRegistry, true);
  assert.equal(row.proof, "PASS");
});

test("slice 21-underwrite: CRS and analysis workflows are listed", () => {
  const ids = new Set(CHECKS.map((c) => c.id));
  assert.ok(ids.has("dpc-01-analyzer-lock"));
  assert.ok(ids.has("u-03-crs-snapshot-sync"));
  assert.ok(ids.has("u-04-promote-crs-primary"));
});

test("slice 21-underwrite: gaps are only non-registry rows", () => {
  const g = gaps();
  assert.ok(g.every((row) => !row.alreadyInRegistry));
  assert.ok(!g.some((row) => row.id === "read/underwrite"));
  assert.equal(g.length, CHECKS.filter((c) => !c.alreadyInRegistry).length);
});

test("slice 21-underwrite: c-00 listed when slice-15-crs is absent", () => {
  const ids = CHECKS.map((c) => c.id);
  assert.ok(ids.includes("c-00-crs-soft-pull-request"));
});
