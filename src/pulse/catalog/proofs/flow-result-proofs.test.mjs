import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

import { proofForFlowRow, proofTestFiles } from "./flow-result-proofs.mjs";
import { FIN_B22_LIVE_PROOFS } from "./fin-b22-flow-contracts.mjs";

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
  // Batch 22 moved the duplicate-text guard (judged from saved results), the journeys proxy (a practice
  // test), the web push devices (saved results), two journey steps (a live page read) and, in generation 3,
  // seven steps the live page does not carry (a verified nothing-to-judge) out of this list; the row below is
  // the one nothing can judge yet.
  const cases = [
    ["messages.json", "script:one-off senders in scripts/"],
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

test("the 1 outbound message leftover that nothing can judge stays red", () => {
  const rows = loadRows("messages.json")
    .map((row) => ({ row, proof: proofForFlowRow("messages.json", row) }))
    .filter(({ proof }) => proof?.verdict === "red");

  assert.equal(rows.length, 1);
  assert.deepEqual(rows.map(({ row }) => row.surface).sort(), [
    "script:one-off senders in scripts/",
  ]);
  for (const { row, proof } of rows) {
    assert.deepEqual(proofTestFiles(proof), [FLOW_GAP_TEST], row.surface);
  }
});

test("the 9 message rows judged from saved results carry a live-check proof, not a red verdict", () => {
  const live = loadRows("messages.json").filter((row) => FIN_B22_LIVE_PROOFS[row.surface] && !FIN_B22_LIVE_PROOFS[row.surface].shipped);
  assert.equal(live.length, 9);
  for (const row of live) {
    const proof = proofForFlowRow("messages.json", row);
    assert.equal(proof.verdict, undefined, row.surface);
    assert.equal(proof.depth, "deep", row.surface);
    assert.match(proof.evidence, /Executable live saved-result check: src\/pulse\/coverage\/gap-catalog-flow\.mjs/, row.surface);
    assert.ok(proofTestFiles(proof).includes("src/pulse/catalog/proofs/fin-b22-flow-live.test.mjs"), row.surface);
    assert.equal(proof.asserts, row.control, row.surface);
  }
});

test("the two journey steps judged by a live page read carry a page-read proof, not a red verdict", () => {
  const rows = loadRows("journeys.json").filter((row) => FIN_B22_LIVE_PROOFS[row.surface]?.page);
  assert.deepEqual(rows.map((row) => row.surface).sort(), [
    "journey:climate-lead-magnet-intended#2-reading-and-map",
    "journey:fh-consulting-intended#5-request-enrollment",
  ]);
  for (const row of rows) {
    const proof = proofForFlowRow("journeys.json", row);
    assert.equal(proof.verdict, undefined, row.surface);
    assert.equal(proof.depth, "deep", row.surface);
    assert.match(proof.evidence, /Executable live page read: src\/pulse\/coverage\/gap-catalog-flow\.mjs/, row.surface);
    assert.ok(proofTestFiles(proof).includes("src/pulse/catalog/proofs/fin-b22-page-reads.test.mjs"), row.surface);
    assert.equal(proof.asserts, row.control, row.surface);
  }
});

test("the seven steps the live page does not carry are a verified nothing-to-judge, not a red verdict", () => {
  const rows = [
    ...loadRows("journeys.json").map((row) => ["journeys.json", row]),
    ...loadRows("messages.json").map((row) => ["messages.json", row]),
  ].filter(([, row]) => FIN_B22_LIVE_PROOFS[row.surface]?.shipped);
  assert.deepEqual(rows.map(([, row]) => row.surface).sort(), [
    "journey:climate-lead-magnet-intended#1-headline-button",
    "journey:climate-lead-magnet-intended#3-state-click",
    "journey:climate-lead-magnet-intended#4-form",
    "journey:climate-lead-magnet-intended#6-gate",
    "journey:fh-consulting-intended#2-education-only",
    "journey:fh-consulting-intended#3-three-prices",
    "ui:ops-admin outbound mail panel",
  ]);
  for (const [sourceFile, row] of rows) {
    const proof = proofForFlowRow(sourceFile, row);
    assert.equal(proof.verdict, undefined, row.surface);
    assert.match(proof.evidence, /Executable verified nothing-to-judge: src\/pulse\/coverage\/gap-catalog-flow\.mjs/, row.surface);
    assert.ok(proofTestFiles(proof).includes("src/pulse/catalog/proofs/fin-b22-not-shipped.test.mjs"), row.surface);
    assert.equal(proof.asserts, row.control, row.surface);
  }
});

test("the web push row names the practice test of the sender beside its saved-result check", () => {
  const row = loadRows("messages.json").find((candidate) => candidate.surface === "provider:web-push-and-client-push");
  const files = proofTestFiles(proofForFlowRow("messages.json", row));
  assert.ok(files.includes("src/push/fin-b22-send-to-client.test.mjs"));
  assert.ok(files.includes("src/pulse/catalog/proofs/fin-b22-flow-live.test.mjs"));
});

test("the journeys proxy is judged by a test with fake data: who may ask, what goes upstream, what comes back", () => {
  const rows = loadRows("agents.json");
  const row = rows.find((candidate) => candidate.surface === "ai-caller:api/journeys/ask.mjs");
  const proof = proofForFlowRow("agents.json", row);
  assert.equal(proof.verdict, undefined);
  assert.equal(proof.depth, "deep");
  assert.deepEqual(proofTestFiles(proof), ["src/http/fin-b22-journeys-ask.test.mjs"]);
  assert.equal(rows.filter((candidate) => proofForFlowRow("agents.json", candidate)?.verdict === "red").length, 0);
});

test("route counts never prove signed-in role access: only a test that signs in does", () => {
  const rows = loadRows("journeys.json").filter((row) => (
    /#(?:reach-.+|stays-blocked)$/.test(String(row.surface || ""))
  ));
  assert.equal(rows.length, 90);
  const probe = fs.readFileSync(new URL("src/pulse/catalog/proofs/s2-role-probe.mjs", ROOT), "utf8");
  const reach = fs.readFileSync(new URL("src/pulse/catalog/proofs/s2-role-route-reach.test.mjs", ROOT), "utf8");
  // The proof signs in as each role through the real adapter; a count alone is not it.
  assert.match(probe, /staffSession|accountSession/);
  assert.match(reach, /probeRoute\(api, key, journey\.name\)/);
  for (const row of rows) {
    const proof = proofForFlowRow("journeys.json", row);
    assert.ok(proof, row.surface);
    assert.equal(proof.verdict, undefined, row.surface);
    assert.deepEqual(
      proofTestFiles(proof),
      ["src/pulse/catalog/proofs/s2-role-route-reach.test.mjs"],
      row.surface,
    );
  }
});

test("rendered contracts prove two journey results and the soft-pull steps carry real tests", () => {
  for (const surface of [
    "journey:slo-connections-intended#1-open-tab",
    "journey:optimize-intended#2-book-without-form",
  ]) {
    const row = loadRows("journeys.json").find((candidate) => candidate.surface === surface);
    const proof = proofForFlowRow("journeys.json", row);
    assert.equal(proof.verdict, undefined, surface);
    assert.match(proof.evidence, /flow-read-contracts\.test\.mjs/, surface);
  }

  // Batch 22: the soft-pull steps are no longer text-only. Steps 2 and 5 are judged by the server handler and
  // the real page; step 6 is judged from the saved companies and by the two staff screens.
  const server = "src/http/fin-b22-soft-pull-flow.test.mjs";
  const page = "src/pulse/catalog/proofs/fin-b22-soft-pull-page.test.mjs";
  const staff = "src/pulse/catalog/proofs/fin-b22-soft-pull-staff.test.mjs";
  const expected = new Map([
    ["journey:soft-pull-multi-biz-intended-draft#2-authorize-first", [page, server]],
    ["journey:soft-pull-multi-biz-intended-draft#5-pay-same-page", [page, server]],
    ["journey:soft-pull-multi-biz-intended-draft#6-staff-sees-files", [
      FLOW_GAP_TEST, "src/pulse/catalog/proofs/fin-b22-flow-live.test.mjs", staff,
    ]],
  ]);
  for (const [surface, files] of expected) {
    const row = loadRows("journeys.json").find((candidate) => candidate.surface === surface);
    assert.ok(row, surface);
    const proof = proofForFlowRow("journeys.json", row);
    assert.equal(proof.verdict, undefined, surface);
    assert.equal(proof.depth, "deep", surface);
    assert.deepEqual(proofTestFiles(proof), [...files].sort(), surface);
  }
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
          timeout: 120_000,
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

