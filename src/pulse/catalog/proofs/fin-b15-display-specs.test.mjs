// Runs the browser spec tests that the batch 15 practice rows are bound to.
// One Playwright run per spec file, restricted to the bound test titles. The run must pass, and
// every bound title must match at least one test that passed, so a renamed or removed spec test
// cannot leave a row quietly "proved". Nothing here touches a live site: every spec answers /api
// itself and runs against the local static server.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B15_DISPLAY_ENTRIES, FIN_B15_SPEC_TITLES } from "./fin-b15-display-specs.mjs";
import { FIN_B15_DISPLAY_CONTRACTS } from "./fin-b15-display-contracts.mjs";
import { freeBrowserPort } from "./browser-port.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PLAYWRIGHT_CLI = path.join(ROOT, "node_modules/@playwright/test/cli.js");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");

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

test("every bound row is one exact map row, and every named spec and test exists and is not a live-site test", () => {
  assert.equal(FIN_B15_DISPLAY_ENTRIES.length, 20);
  const map = JSON.parse(fs.readFileSync(path.join(MAP_DIR, "desks-c.json"), "utf8"));
  const keys = new Set();
  for (const entry of FIN_B15_DISPLAY_ENTRIES) {
    const key = `${entry.surface}\0${entry.control}`;
    assert.equal(keys.has(key), false, `duplicate row ${key}`);
    keys.add(key);
    assert.equal(map.filter((r) => r.surface === entry.surface && r.control === entry.control).length, 1, key);
    assert.ok(entry.test || (entry.tests && entry.tests.length) || (entry.specs && entry.specs.length), `${entry.control} names no test`);
    for (const file of [entry.test, ...(entry.tests || [])].filter(Boolean)) {
      assert.ok(file.endsWith(".test.mjs"), `${file} is a node test`);
      assert.ok(fs.existsSync(path.join(ROOT, file)), file);
    }
    for (const { spec, titles } of entry.specs || []) {
      assert.ok(fs.existsSync(path.join(ROOT, spec)), `${spec} does not exist`);
      assert.ok(!path.basename(spec).startsWith("live-"), `${spec} must not touch the live site`);
      assert.ok(titles.length > 0, `${entry.control} names no title in ${spec}`);
      const text = fs.readFileSync(path.join(ROOT, spec), "utf8");
      for (const title of titles) {
        const probe = title.replace(/\$\{[^}]*\}/g, "");
        // A title built from a template (full at ${size.width}px ...) is matched on its fixed tail.
        const tail = title.replace(/^full at \d+px/, "");
        assert.ok(text.includes(title) || text.includes(probe) || text.includes(tail.trim()), `"${title}" is not in ${spec}`);
      }
    }
  }
});

test("a row that says alsoLive owns a live check too, and a row that does not says nothing reads its saved data", () => {
  const live = new Set(FIN_B15_DISPLAY_CONTRACTS.map((c) => c.control));
  for (const entry of FIN_B15_DISPLAY_ENTRIES) {
    assert.equal(live.has(entry.control), entry.alsoLive === true, `${entry.control}: alsoLive says ${entry.alsoLive === true}, the contracts say ${live.has(entry.control)}`);
  }
});

for (const [spec, titles] of FIN_B15_SPEC_TITLES) {
  test(`${spec}: the bound tests run in a real browser and pass`, { timeout: 600_000 }, async () => {
    assert.ok(fs.existsSync(PLAYWRIGHT_CLI), "Playwright CLI is not installed");
    const port = await freeBrowserPort();
    const reportFile = path.join(os.tmpdir(), `fin-b15-display-${process.pid}-${path.basename(spec)}.json`);
    const grep = [...titles].map(escapeRegExp).join("|");
    const result = spawnSync(process.execPath, [
      PLAYWRIGHT_CLI, "test", spec, "--grep", grep, "--workers=1", "--reporter=json"
    ], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
        E2E_PORT: String(port)
      },
      maxBuffer: 64 * 1024 * 1024
    });
    let report = null;
    try { report = JSON.parse(fs.readFileSync(reportFile, "utf8")); } catch { /* reported below */ }
    finally { fs.rmSync(reportFile, { force: true }); }
    assert.ok(report, `no report from ${spec}\n${result.stdout || ""}\n${result.stderr || ""}`);
    assert.equal(result.status, 0, `${spec} failed\n${(result.stdout || "").slice(0, 2000)}\n${(result.stderr || "").slice(0, 2000)}`);
    const ran = ranTests(report);
    assert.ok(ran.length > 0, `${spec} ran no test`);
    assert.ok(ran.every((r) => r.ok), `${spec} has a test that did not pass`);
    for (const title of titles) {
      assert.ok(ran.some((r) => r.full.includes(title)), `the bound title "${title}" did not run in ${spec}`);
    }
  });
}
