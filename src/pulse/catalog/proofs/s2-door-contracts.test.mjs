import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { S2_DOOR_CONTRACTS, s2DoorProof } from "./s2-door-contracts.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const MAP = new URL("ops/workflows/coverage-every-surface-2026-10-10/", ROOT);

function rows(sourceFile) {
  return JSON.parse(fs.readFileSync(new URL(sourceFile, MAP), "utf8"));
}

test("every slice-2 route proof names one exact catalog row and real handler tests", () => {
  assert.equal(S2_DOOR_CONTRACTS.length, 17);
  assert.equal(new Set(S2_DOOR_CONTRACTS.map((entry) => entry.key)).size, 17);

  for (const entry of S2_DOOR_CONTRACTS) {
    const matches = rows(entry.sourceFile).filter((row) => row.surface === entry.surface && row.control === entry.control);
    assert.equal(matches.length, 1, entry.key);
    assert.equal(matches[0].impact, "customerMessage", entry.key);
    assert.ok(entry.tests.length >= 1, entry.key);
    for (const file of entry.tests) {
      assert.ok(fs.existsSync(new URL(file, ROOT)), `${file} does not exist`);
      assert.match(file, /^src\/http\/.+\.test\.mjs$/);
      assert.doesNotMatch(file, /\.pg\.test\.mjs$/);
      const source = fs.readFileSync(new URL(file, ROOT), "utf8");
      assert.match(source, /runWithSharedDb|handler\(|handler,/, `${file} must run a real handler`);
    }
    assert.equal(s2DoorProof(entry.sourceFile, matches[0]).depth, "deep");
  }
});

test("a different result on the same route stays unproved", () => {
  const entry = S2_DOOR_CONTRACTS[0];
  assert.equal(s2DoorProof(entry.sourceFile, { surface: entry.surface, control: `${entry.control} (another result)` }), null);
  assert.equal(s2DoorProof("routes-3.json", { surface: entry.surface, control: entry.control }), null);
});
