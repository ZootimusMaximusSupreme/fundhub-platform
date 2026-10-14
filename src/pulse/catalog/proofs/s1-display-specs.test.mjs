// Runs the browser spec tests that the slice 1 display rows are bound to.
// One Playwright run per spec file, restricted to the bound test titles. The run
// must pass, and every bound title must match at least one test that passed, so
// a renamed or removed spec test cannot leave a row quietly "proved".
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { S1_DISPLAY_SPEC_PROOFS } from "./s1-display-specs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PLAYWRIGHT_CLI = path.join(ROOT, "node_modules/@playwright/test/cli.js");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");

const bySpec = new Map();
for (const proof of S1_DISPLAY_SPEC_PROOFS) {
  if (!bySpec.has(proof.spec)) bySpec.set(proof.spec, new Set());
  for (const title of proof.titles) bySpec.get(proof.spec).add(title);
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

test("every bound row is one exact map row and its spec file exists and is not a live-site spec", () => {
  assert.equal(S1_DISPLAY_SPEC_PROOFS.length, 58);
  assert.equal(new Set(S1_DISPLAY_SPEC_PROOFS.map((p) => p.rowKey)).size, 58);
  const maps = new Map();
  for (const proof of S1_DISPLAY_SPEC_PROOFS) {
    if (!maps.has(proof.sourceFile)) {
      maps.set(proof.sourceFile, JSON.parse(fs.readFileSync(path.join(MAP_DIR, proof.sourceFile), "utf8")));
    }
    const matches = maps.get(proof.sourceFile).filter((r) => r.surface === proof.surface && r.control === proof.control);
    assert.equal(matches.length, 1, proof.rowKey);
    assert.equal(matches[0].impact, "money", proof.rowKey);
    assert.ok(fs.existsSync(path.join(ROOT, proof.spec)), `${proof.spec} does not exist`);
    assert.ok(!path.basename(proof.spec).startsWith("live-"), `${proof.spec} must not touch the live site`);
    assert.ok(proof.titles.length > 0, `${proof.rowKey} names no spec test`);
  }
});

for (const [spec, titles] of bySpec) {
  test(`${spec}: the bound tests run in a real browser and pass`, () => {
    assert.ok(fs.existsSync(PLAYWRIGHT_CLI), "Playwright CLI is not installed");
    const reportFile = path.join(os.tmpdir(), `s1-display-${process.pid}-${path.basename(spec)}.json`);
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
      maxBuffer: 32 * 1024 * 1024,
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
