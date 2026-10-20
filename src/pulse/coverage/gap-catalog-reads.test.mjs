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
import { FIN_B27_H_READ_PROVED } from "../catalog/proofs/fin-b27-h-read-contracts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");

function rowsFor(sourceFile) {
  return JSON.parse(fs.readFileSync(path.join(MAP_DIR, sourceFile), "utf8"));
}

test("every known read gap owns one exact map row", () => {
  assert.equal(READ_GAPS.length, 0);
  assert.equal(CHECK_IDS.length, 1);
  assert.equal(new Set(CHECK_IDS).size, 1);

  for (const item of [...READ_GAPS, ...FIN_B27_H_READ_PROVED]) {
    const sourceFile = item.sourceFile || sourceFileForReadSurface(item.surface);
    const matches = rowsFor(sourceFile).filter((row) => (
      row.surface === item.surface
      && row.control === item.control
      && ["read", "dependency", "effect", "external-dependency", "guard", "job", "poll", "read-panel", "system"].includes(row.kind)
    ));
    assert.equal(matches.length, 1, `${sourceFile}: ${item.surface}: ${item.control}`);
    if (item.finding) assert.ok(item.finding.length > 20, `${item.id} needs an exact finding`);
    else assert.match(item.evidence, /\.test\.mjs/);
  }
});

test("the repaired Present row has no open gap while the climate read can only skip on a failed GET", async () => {
  const rows = await gapChecks({
    db: { query: async () => { throw new Error("the catalog read gap lane must not query"); } },
    fetchImpl: async () => { throw new Error("safe read is offline in this test"); },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows.some((row) => row.id === "catalog-read:present-send-lock"), false);

  const climate = rows.find((row) => row.id === "catalog-read:climate-map");
  assert.equal(climate.status, "skip");
  assert.match(climate.detail, /safe read is offline in this test/);
  assert.notEqual(climate.status, "PASS");
});

test("the lane cannot send, write, or turn a missing result into pass", () => {
  const source = fs.readFileSync(new URL("./gap-catalog-reads.mjs", import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|POST|PUT|PATCH)\b/i);
  assert.doesNotMatch(source, /fetch\s*\(|\.query\s*\(/);
  assert.doesNotMatch(source, /status:\s*["']PASS["']/);
  assert.match(source, /status:\s*["']NOT_PROVED["']/,
    "a future read gap must stay explicitly not proved");
  assert.doesNotMatch(source, /status:\s*["']FAIL["']/);
  assert.doesNotMatch(source, /status:\s*["']na["']/);
});
