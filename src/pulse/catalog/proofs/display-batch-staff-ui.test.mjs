import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STAFF_UI_GROUPS,
  STAFF_UI_PROOF_CASES,
  STAFF_UI_SPECS,
} from "./display-batch-staff-ui.mjs";
import { freeBrowserPort } from "./browser-port.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PLAYWRIGHT_CLI = path.join(ROOT, "node_modules/@playwright/test/cli.js");

test("staff display batch maps exact rows to one safe local browser run", () => {
  assert.ok(STAFF_UI_GROUPS.length >= 20, "the shared staff harness lost page groups");
  assert.ok(STAFF_UI_PROOF_CASES.length >= 100, "the staff display proof batch unexpectedly shrank");
  assert.ok(STAFF_UI_SPECS.length >= 20, "the staff display browser suite unexpectedly shrank");

  const keys = new Set();
  for (const proofCase of STAFF_UI_PROOF_CASES) {
    const key = `${proofCase.sourceFile}\0${proofCase.surface}\0${proofCase.control}`;
    assert.equal(keys.has(key), false, `duplicate staff display proof: ${key}`);
    keys.add(key);
    assert.ok(["e2e", "deep"].includes(proofCase.depth));
    assert.deepEqual(proofCase.tests, ["src/pulse/catalog/proofs/display-batch-staff-ui.test.mjs"]);
    if (proofCase.depth === "deep") {
      assert.match(proofCase.evidence, /src\/pulse\/coverage\/gap-catalog-display\.mjs/);
    }
  }

  for (const spec of STAFF_UI_SPECS) {
    assert.ok(spec.endsWith(".spec.mjs"), `${spec} is not a browser spec`);
    assert.ok(fs.existsSync(path.join(ROOT, spec)), `${spec} does not exist`);
    assert.ok(!path.basename(spec).startsWith("live-"), `${spec} must not make live writes`);
  }
});

test("staff display batch presses every mapped control and checks its result", async () => {
  assert.ok(fs.existsSync(PLAYWRIGHT_CLI), "Playwright CLI is not installed");
  const port = await freeBrowserPort();
  const result = spawnSync(process.execPath, [
    PLAYWRIGHT_CLI,
    "test",
    ...STAFF_UI_SPECS,
    "--workers=1",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1",
      E2E_PORT: String(port),
    },
    maxBuffer: 16 * 1024 * 1024,
  });

  assert.equal(
    result.status,
    0,
    `staff display browser proofs failed\n${result.stdout || ""}\n${result.stderr || ""}`,
  );
});
