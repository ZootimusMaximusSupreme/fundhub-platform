import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

import { proofForFlowRow, proofTestFiles } from "./flow-result-proofs.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const MAP_ROOT = new URL("ops/workflows/coverage-every-surface-2026-10-10/", ROOT);
const SOURCE_FILES = ["messages.json", "journeys.json", "agents.json"];
const EXPECTED_PROOF_COUNTS = Object.freeze({
  "messages.json": 263,
  "journeys.json": 27,
  "agents.json": 23,
});

const MESSAGE_DELIVERY_BATCH = "src/pulse/catalog/proofs/flow-batch-message-delivery.test.mjs";
const execFileAsync = promisify(execFile);

function loadRows(sourceFile) {
  return JSON.parse(fs.readFileSync(new URL(sourceFile, MAP_ROOT), "utf8"));
}

function allProofs() {
  return SOURCE_FILES.flatMap((sourceFile) => loadRows(sourceFile)
    .map((row) => ({ sourceFile, row, proof: proofForFlowRow(sourceFile, row) }))
    .filter((entry) => entry.proof));
}

test("flow proofs name only real, runnable result tests", () => {
  const counts = Object.fromEntries(SOURCE_FILES.map((sourceFile) => [sourceFile, 0]));

  for (const { sourceFile, row, proof } of allProofs()) {
    counts[sourceFile] += 1;
    assert.equal(["e2e", "deep"].includes(proof.depth), true, row.surface);
    assert.equal(typeof proof.evidence, "string", row.surface);

    const files = proofTestFiles(proof);
    assert.ok(files.length > 0, row.surface);
    for (const file of files) {
      assert.equal(file.endsWith(".pg.test.mjs"), false, `${row.surface}: ${file}`);
      assert.equal(fs.existsSync(new URL(file, ROOT)), true, `${row.surface}: ${file}`);
    }
  }

  assert.deepEqual(counts, EXPECTED_PROOF_COUNTS);
});

test("known unproved flow gaps stay without proof", () => {
  const cases = [
    ["messages.json", "dispatch:sms-duplicate-guard-NOT-WIRED"],
    ["journeys.json", "journey:optimize-intended#2-book-without-form"],
    ["journeys.json", "journey:soft-pull-multi-biz-intended-draft#2-authorize-first"],
    ["agents.json", "ai-caller:vendor/underwriteiq-full/api/lite/ai-gatekeeper.js"],
  ];

  for (const [sourceFile, surface] of cases) {
    const row = loadRows(sourceFile).find((candidate) => candidate.surface === surface);
    assert.ok(row, `${sourceFile}: ${surface}`);
    assert.equal(proofForFlowRow(sourceFile, row), undefined, surface);
  }
});

test("every deep message proof runs the gate and final dispatcher outcome", () => {
  for (const { row, proof } of allProofs().filter(({ sourceFile, proof }) => (
    sourceFile === "messages.json" && proof.depth === "deep"
  ))) {
    const files = new Set(proofTestFiles(proof));
    const sharedChain = files.has("src/messaging/gate.test.mjs")
      && files.has("src/messaging/dispatch.test.mjs");
    const batchedChain = files.has(MESSAGE_DELIVERY_BATCH);
    assert.equal(sharedChain || batchedChain, true, row.surface);
  }
});

test("every test named by a flow proof passes with fake data or local reads", { timeout: 240_000 }, async () => {
  const files = [...new Set(allProofs().flatMap(({ proof }) => proofTestFiles(proof)))].sort();
  const childEnv = {
    ...process.env,
    DATABASE_URL: "",
    NODE_ENV: "test",
    UNSUBSCRIBE_TOKEN_SECRET: "test-only-unsubscribe-secret-that-is-long-enough-0000000000000000",
  };
  delete childEnv.NODE_TEST_CONTEXT;
  for (const key of [
    "ANTHROPIC_API_KEY",
    "BLAND_API_KEY",
    "CLICKFUNNELS_API_KEY",
    "MAILGUN_API_KEY",
    "NTFY_TOKEN",
    "OPENAI_API_KEY",
    "POSTGRID_API_KEY",
    "RESEND_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
  ]) delete childEnv[key];
  let next = 0;
  const runs = [];
  const failures = [];
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      try {
        const result = await execFileAsync(process.execPath, ["--test", "--test-force-exit", file], {
          cwd: ROOT,
          encoding: "utf8",
          env: childEnv,
          maxBuffer: 8 * 1024 * 1024,
          timeout: 30_000,
        });
        runs.push({ file, stdout: result.stdout });
      } catch (error) {
        failures.push({ file, output: [error.stdout, error.stderr, error.message].filter(Boolean).join("\n").slice(-4_000) });
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  assert.deepEqual(failures, []);

  const testCount = runs.reduce((count, run) => count + Number(run.stdout.match(/# tests (\d+)/)?.[1] || 0), 0);
  const skipped = runs.reduce((count, run) => count + Number(run.stdout.match(/# skipped (\d+)/)?.[1] || 0), 0);
  assert.ok(testCount >= files.length, `Expected at least ${files.length} tests, ran ${testCount}.`);
  assert.equal(skipped, 0);
});

