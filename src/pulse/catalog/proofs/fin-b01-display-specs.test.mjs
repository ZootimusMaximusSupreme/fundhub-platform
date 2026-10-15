// Runs the browser spec tests that the batch 01 display rows are bound to.
// One Playwright run per spec file, restricted to the bound test titles. The run
// must pass, and every bound title must match at least one test that passed, so a
// renamed or removed spec test cannot leave a row quietly "proved".
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B01_DISPLAY_SPEC_PROOFS, FIN_B01_PRACTICE_SPECS } from "./fin-b01-display-specs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PLAYWRIGHT_CLI = path.join(ROOT, "node_modules/@playwright/test/cli.js");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");

const bySpec = new Map();
for (const proof of FIN_B01_DISPLAY_SPEC_PROOFS) {
  for (const part of proof.parts) {
    if (!bySpec.has(part.spec)) bySpec.set(part.spec, new Set());
    for (const title of part.titles) bySpec.get(part.spec).add(title);
  }
}

// A row that stays in the lane (the optimize intake) has its practice test run here too.
for (const practice of FIN_B01_PRACTICE_SPECS) {
  if (!bySpec.has(practice.spec)) bySpec.set(practice.spec, new Set());
  for (const title of practice.titles) bySpec.get(practice.spec).add(title);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ranTests(report) {
  const out = [];
  const walk = (suite, trail) => {
    const here = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs || []) {
      const ok = spec.tests?.length > 0 && spec.tests.every((t) => t.status === "expected");
      out.push({ full: [...here, spec.title].join(" "), ok });
    }
    for (const child of suite.suites || []) walk(child, here);
  };
  for (const suite of report.suites || []) walk(suite, []);
  return out;
}

test("every bound row is one exact map row, every named spec and server test file exists and is safe", () => {
  assert.equal(FIN_B01_DISPLAY_SPEC_PROOFS.length, 36);
  assert.equal(new Set(FIN_B01_DISPLAY_SPEC_PROOFS.map((p) => p.rowKey)).size, 36);
  const maps = new Map();
  for (const proof of FIN_B01_DISPLAY_SPEC_PROOFS) {
    if (!maps.has(proof.sourceFile)) {
      maps.set(proof.sourceFile, JSON.parse(fs.readFileSync(path.join(MAP_DIR, proof.sourceFile), "utf8")));
    }
    const matches = maps.get(proof.sourceFile).filter((r) => r.surface === proof.surface && r.control === proof.control);
    assert.equal(matches.length, 1, proof.rowKey);
    assert.equal(matches[0].impact, "money", proof.rowKey);
    assert.ok(proof.parts.length > 0, `${proof.rowKey} names no spec`);
    for (const part of proof.parts) {
      assert.ok(fs.existsSync(path.join(ROOT, part.spec)), `${part.spec} does not exist`);
      assert.ok(!path.basename(part.spec).startsWith("live-"), `${part.spec} must not touch the live site`);
      assert.ok(part.titles.length > 0, `${proof.rowKey} names no spec test in ${part.spec}`);
    }
    for (const server of proof.servers) {
      assert.ok(fs.existsSync(path.join(ROOT, server)), `${server} does not exist`);
      assert.doesNotMatch(server, /\.pg\.test\.mjs$/, `${server} is a database test`);
    }
  }
});

test("every practice test for a row that stays in the lane is one exact map row and a real spec", () => {
  assert.equal(FIN_B01_PRACTICE_SPECS.length, 1);
  for (const practice of FIN_B01_PRACTICE_SPECS) {
    const rows = JSON.parse(fs.readFileSync(path.join(MAP_DIR, practice.sourceFile), "utf8"))
      .filter((r) => r.surface === practice.surface);
    assert.equal(rows.length, 1, practice.surface);
    assert.equal(rows[0].impact, "money");
    const spec = fs.readFileSync(path.join(ROOT, practice.spec), "utf8");
    for (const title of practice.titles) assert.ok(spec.includes(`test("${title}"`), `${practice.spec} has no test "${title}"`);
  }
});

for (const [spec, titles] of bySpec) {
  test(`${spec}: the bound tests run in a real browser and pass`, () => {
    assert.ok(fs.existsSync(PLAYWRIGHT_CLI), "Playwright CLI is not installed");
    const reportFile = path.join(os.tmpdir(), `fin-b01-display-${process.pid}-${path.basename(spec)}.json`);
    const grep = [...titles].map(escapeRegExp).join("|");
    const result = spawnSync(process.execPath, [
      PLAYWRIGHT_CLI, "test", spec, "--grep", grep, "--workers=1", "--reporter=json",
    ], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
        E2E_PORT: String(45_000 + ((process.pid + spec.length * 97) % 10_000)),
      },
      maxBuffer: 64 * 1024 * 1024,
    });
    let report = null;
    try { report = JSON.parse(fs.readFileSync(reportFile, "utf8")); } catch { /* reported below */ }
    finally { fs.rmSync(reportFile, { force: true }); }
    assert.ok(report, `no report from ${spec}\n${result.stdout || ""}\n${result.stderr || ""}`);
    assert.equal(result.status, 0, `${spec} failed\n${result.stdout?.slice(0, 2000)}\n${result.stderr?.slice(0, 2000)}`);
    const ran = ranTests(report);
    assert.ok(ran.length > 0, `${spec} ran no test`);
    assert.ok(ran.every((r) => r.ok), `${spec} has a test that did not pass`);
    for (const title of titles) {
      assert.ok(ran.some((r) => r.full.includes(title)), `the bound title "${title}" did not run in ${spec}`);
    }
  });
}
