// One way to run the slice-2 browser proofs from a node:test file, so the two
// wrapper tests (s2-display-contracts.test.mjs and s2-flow-pages.test.mjs) do
// not each carry their own copy.
//
// The browser is the repo's own Playwright, run one spec worker at a time (the
// Playwright runs from many tests at once step on each other's test-results
// folder on a busy Mac). NO BACKEND: every spec answers /api/** itself.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { freeBrowserPort } from "./browser-port.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PLAYWRIGHT_CLI = path.join(ROOT, "node_modules/@playwright/test/cli.js");

/** Every spec is a real *.spec.mjs file and none of them makes a live write. */
export function assertSpecsAreSafe(specs) {
  for (const spec of specs) {
    assert.ok(spec.endsWith(".spec.mjs") && fs.existsSync(path.join(ROOT, spec)), spec);
    assert.ok(!path.basename(spec).startsWith("live-"), `${spec} must not make live writes`);
  }
}

/** Run the specs in a real browser; the run must exit clean. */
export async function runSpecs(specs, label) {
  assert.ok(fs.existsSync(PLAYWRIGHT_CLI), "Playwright CLI is not installed");
  const port = await freeBrowserPort();
  const result = spawnSync(process.execPath, [PLAYWRIGHT_CLI, "test", ...specs, "--workers=1"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CI: "1", E2E_PORT: String(port) },
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${label} failed\n${result.stdout || ""}\n${result.stderr || ""}`);
}
