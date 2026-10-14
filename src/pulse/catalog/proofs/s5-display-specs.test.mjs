// Runs the browser specs that the S5 screen registry leans on, in one local
// Playwright pass (fake API, local static server, no outside network), and
// checks that every case a registry row names actually ran and passed.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { S5_DISPLAY_ROWS } from "./s5-display-contracts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const CLI = path.join(ROOT, "node_modules/@playwright/test/cli.js");
const rows = S5_DISPLAY_ROWS.filter((row) => row.spec);
const specs = [...new Set(rows.map((row) => row.spec))].sort();

test("the browser specs behind the registry exist and make no live writes", () => {
  assert.ok(rows.length > 0);
  for (const spec of specs) {
    assert.ok(fs.existsSync(path.join(ROOT, spec)), `${spec} does not exist`);
    assert.ok(!path.basename(spec).startsWith("live-"), `${spec} must not make live writes`);
  }
});

test("every case a registry row names ran in a real browser and passed", { timeout: 600_000 }, () => {
  assert.ok(fs.existsSync(CLI), "Playwright CLI is not installed");
  const result = spawnSync(process.execPath, [CLI, "test", ...specs, "--workers=1", "--reporter=list"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CI: "1", E2E_PORT: String(46_000 + (process.pid % 10_000)) },
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.equal(result.status, 0, `browser specs failed\n${output.slice(-4000)}`);
  const passed = output.split("\n").filter((line) => /^\s+(?:✓|ok)\s/.test(line));
  for (const row of rows) {
    for (const title of row.titles) {
      assert.ok(
        passed.some((line) => line.includes(path.basename(row.spec)) && line.includes(title)),
        `${row.name}: no passing case in ${row.spec} with "${title}" in its name`,
      );
    }
  }
});
