import test from "node:test";
import assert from "node:assert/strict";

import { CHECKS, SLICE_ID } from "./slice-01-auth.mjs";

test("slice 01-auth: every id is set and redAfter is 3x schedule", () => {
  assert.equal(SLICE_ID, "01-auth");
  assert.ok(CHECKS.length > 0);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x \S+$/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
  }
});
