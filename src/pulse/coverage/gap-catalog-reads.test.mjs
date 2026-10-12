import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  READ_GAPS,
  gapChecks,
  sourceFileForReadSurface,
} from "./gap-catalog-reads.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");

function rowsFor(sourceFile) {
  return JSON.parse(fs.readFileSync(path.join(MAP_DIR, sourceFile), "utf8"));
}

test("every known read gap owns one exact map row", () => {
  assert.equal(READ_GAPS.length, 27);
  assert.equal(CHECK_IDS.length, 27);
  assert.equal(new Set(CHECK_IDS).size, 27);

  for (const item of READ_GAPS) {
    const sourceFile = sourceFileForReadSurface(item.surface);
    const matches = rowsFor(sourceFile).filter((row) => (
      row.surface === item.surface
      && row.control === item.control
      && ["read", "dependency", "effect", "external-dependency", "guard", "job", "poll", "read-panel", "system"].includes(row.kind)
    ));
    assert.equal(matches.length, 1, `${sourceFile}: ${item.surface}: ${item.control}`);
    assert.ok(item.finding.length > 20, `${item.id} needs an exact finding`);
  }
});

test("missing result probes stay red and name their exact control", async () => {
  const rows = await gapChecks({
    db: { query: async () => { throw new Error("the catalog read gap lane must not query"); } },
    fetchImpl: async () => { throw new Error("the catalog read gap lane must not fetch"); },
  });

  assert.equal(rows.length, READ_GAPS.length);
  for (const [index, row] of rows.entries()) {
    const item = READ_GAPS[index];
    assert.equal(row.id, item.id);
    assert.equal(row.status, "FAIL");
    assert.match(row.detail, new RegExp(item.surface.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(row.suggestedFix.includes(item.control));
    assert.match(row.suggestedFix, /Do not auto-fix\. Chris fixes reds\./);
  }
});

test("the lane cannot send, write, or turn a missing result into pass", () => {
  const source = fs.readFileSync(new URL("./gap-catalog-reads.mjs", import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|POST|PUT|PATCH)\b/i);
  assert.doesNotMatch(source, /fetch\s*\(|\.query\s*\(/);
  assert.doesNotMatch(source, /status:\s*["']PASS["']/);
  assert.doesNotMatch(source, /status:\s*["']na["']/);
});
