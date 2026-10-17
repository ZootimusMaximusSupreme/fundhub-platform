import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { freeBrowserPort } from "./browser-port.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const CLI = path.join(ROOT, "node_modules/@playwright/test/cli.js");

test("reviewed read proofs pass through the real rendered pages", async () => {
  const port = await freeBrowserPort();
  const result = spawnSync(process.execPath, [
    CLI,
    "test",
    "e2e/agent-editor-promote-demote.spec.mjs",
    "e2e/ccp-headline.spec.mjs",
    "e2e/portal-refer-a-friend.spec.mjs",
    "--workers=1",
    "--reporter=line",
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
    `reviewed browser proofs failed\n${result.stdout || ""}\n${result.stderr || ""}`,
  );
  assert.match(result.stdout || "", /passed/);
});
