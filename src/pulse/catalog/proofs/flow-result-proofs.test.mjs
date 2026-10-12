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
  "messages.json": 447,
  "journeys.json": 132,
  "agents.json": 25,
});

const MESSAGE_DELIVERY_BATCH = "src/pulse/catalog/proofs/flow-batch-message-delivery.test.mjs";
const ACTIVE_MESSAGE_BATCH = "src/pulse/catalog/proofs/flow-batch-active-message-results.test.mjs";
const FLOW_GAP_TEST = "src/pulse/coverage/gap-catalog-flow.test.mjs";
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

test("known flow gaps map to the exact executable red monitor", () => {
  const cases = [
    ["messages.json", "dispatch:sms-duplicate-guard-NOT-WIRED"],
    ["journeys.json", "journey:climate-lead-magnet-intended#2-reading-and-map"],
    ["journeys.json", "journey:fh-consulting-intended#3-three-prices"],
    ["agents.json", "ai-caller:api/journeys/ask.mjs"],
  ];

  for (const [sourceFile, surface] of cases) {
    const row = loadRows(sourceFile).find((candidate) => candidate.surface === surface);
    assert.ok(row, `${sourceFile}: ${surface}`);
    const proof = proofForFlowRow(sourceFile, row);
    assert.ok(proof, surface);
    assert.match(proof.evidence, /src\/pulse\/coverage\/gap-catalog-flow\.mjs/, surface);
    assert.equal(proof.verdict, "red", surface);
    assert.equal(proof.asserts, row.control, surface);
  }
});

test("only exact intended role-access rows use the shared live-gate result proof", () => {
  const rows = loadRows("journeys.json").filter((row) => (
    /#(?:reach-.+|stays-blocked)$/.test(String(row.surface || ""))
  ));
  assert.equal(rows.length, 90);
  let proved = 0;
  for (const row of rows) {
    const proof = proofForFlowRow("journeys.json", row);
    assert.ok(proof, row.surface);
    if (proof.verdict === "red") {
      assert.deepEqual(proofTestFiles(proof), [FLOW_GAP_TEST], row.surface);
      continue;
    }
    proved += 1;
    assert.deepEqual(proofTestFiles(proof), [
      "src/pulse/catalog/proofs/flow-batch-role-access-results.test.mjs",
    ], row.surface);
  }
  assert.equal(proved, 40);
});

test("verified inactive templates use the exact monitor without a red verdict", () => {
  const row = loadRows("messages.json").find((candidate) => candidate.surface === "template:AF");
  assert.ok(row);
  const proof = proofForFlowRow("messages.json", row);
  assert.ok(proof);
  assert.match(proof.evidence, /src\/pulse\/coverage\/gap-catalog-flow\.mjs/);
  assert.equal(proof.verdict, undefined);
});

test("every deep message proof runs the gate and final dispatcher outcome", () => {
  for (const { row, proof } of allProofs().filter(({ sourceFile, proof }) => (
    sourceFile === "messages.json" && proof.depth === "deep"
  ))) {
    const files = new Set(proofTestFiles(proof));
    const sharedChain = files.has("src/messaging/gate.test.mjs")
      && files.has("src/messaging/dispatch.test.mjs");
    const batchedChain = files.has(MESSAGE_DELIVERY_BATCH)
      || files.has(ACTIVE_MESSAGE_BATCH)
      || files.has(FLOW_GAP_TEST);
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

