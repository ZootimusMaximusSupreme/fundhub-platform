// Regression for nested browser proof launchers running concurrently in npm test.
// A shared Playwright outputDir causes one CLI to delete another's artifact
// directory while that process is starting a worker (ENOENT on mkdir).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const inspect = "import config from './playwright.config.mjs'; console.log(JSON.stringify({ pid: process.pid, outputDir: config.outputDir }));";

async function launch() {
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", inspect], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    timeout: 15_000,
  });
  return JSON.parse(stdout.trim());
}

test("simultaneous Playwright CLIs isolate their worker artifact directories", async () => {
  const [first, second] = await Promise.all([launch(), launch()]);
  assert.notEqual(first.pid, second.pid, "two independent CLI processes must be distinct");
  assert.notEqual(first.outputDir, second.outputDir, "Playwright cleanup must not remove another CLI's directory");
  for (const { pid, outputDir } of [first, second]) {
    assert.equal(
      path.resolve(ROOT, outputDir),
      path.join(ROOT, "test-results", `run-${pid}`),
      "all isolated artifacts must remain available under the existing CI upload path",
    );
  }
});
