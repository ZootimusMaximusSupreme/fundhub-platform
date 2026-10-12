import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

import { proofForFlowRow, proofTestFiles } from "./flow-result-proofs.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const MAP_ROOT = new URL("ops/workflows/coverage-every-surface-2026-10-10/", ROOT);
const SOURCE_FILES = ["messages.json", "journeys.json", "agents.json"];
const EXPECTED_PROOF_COUNTS = Object.freeze({
  "messages.json": 265,
  "journeys.json": 21,
  "agents.json": 11,
});

const MESSAGE_DELIVERY_BATCH = "src/pulse/catalog/proofs/flow-batch-message-delivery.test.mjs";

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
    ["agents.json", "agent:VF-LIVE"],
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

test("every test named by a flow proof passes with fake data or local reads", { timeout: 240_000 }, () => {
  const files = [...new Set(allProofs().flatMap(({ proof }) => proofTestFiles(proof)))].sort();
  const childEnv = { ...process.env, DATABASE_URL: "", NODE_ENV: "test" };
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
  const run = spawnSync(process.execPath, ["--test", "--test-concurrency=4", ...files], {
    cwd: new URL(".", ROOT),
    encoding: "utf8",
    env: childEnv,
    timeout: 230_000,
  });

  assert.equal(
    run.status,
    0,
    [run.error?.message, run.stdout, run.stderr].filter(Boolean).join("\n").slice(-20_000),
  );

  const testCount = Number(run.stdout.match(/# tests (\d+)/)?.[1] || 0);
  const skipped = Number(run.stdout.match(/# skipped (\d+)/)?.[1] || 0);
  assert.ok(testCount >= files.length, `Expected at least ${files.length} tests, ran ${testCount}.`);
  assert.equal(skipped, 0, run.stdout.slice(-20_000));
});

