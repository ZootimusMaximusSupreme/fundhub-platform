import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { S2_FLOW_SPECS } from "./s2-display-contracts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PLAYWRIGHT_CLI = path.join(ROOT, "node_modules/@playwright/test/cli.js");

test("the Flow page specs exist and make no live writes", () => {
  for (const spec of S2_FLOW_SPECS) {
    assert.ok(spec.endsWith(".spec.mjs") && fs.existsSync(path.join(ROOT, spec)), spec);
    assert.ok(!path.basename(spec).startsWith("live-"), `${spec} must not make live writes`);
  }
});

test("the ops-admin outbound panel and the consulting pages are driven in a real browser", () => {
  assert.ok(fs.existsSync(PLAYWRIGHT_CLI), "Playwright CLI is not installed");
  const result = spawnSync(process.execPath, [PLAYWRIGHT_CLI, "test", ...S2_FLOW_SPECS, "--workers=1"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CI: "1", E2E_PORT: String(46_000 + (process.pid % 10_000)) },
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `slice-2 flow page proofs failed\n${result.stdout || ""}\n${result.stderr || ""}`);
});
