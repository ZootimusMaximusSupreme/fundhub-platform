import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { autoStatePath, newerRelease, projectRelease, readAutoState, seedAutoState,
  startShippedRelease } from "./ios-release-auto.mjs";

const oldSha = "a".repeat(40);
const newSha = "b".repeat(40);
const project = (version, build) =>
  `${`MARKETING_VERSION = ${version}; CURRENT_PROJECT_VERSION = ${build};\n`.repeat(4)}PRODUCT_BUNDLE_IDENTIFIER = ai.fundhub.app;`;

function fixture(callback) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-ios-auto-test-"));
  const home = path.join(temp, "home");
  const root = path.join(temp, "repo");
  fs.mkdirSync(root);
  return Promise.resolve(callback({ home, root })).finally(() => fs.rmSync(temp, { recursive: true, force: true }));
}

function commandFor({ changed = "tools/fundhub-ios/Fundhub/FundhubApp.swift",
  version = "1.0.4", build = "10", receipt = null } = {}) {
  const calls = [];
  const command = async (name, argv) => {
    calls.push({ name, argv });
    if (name === "git") {
      if (argv.includes("fetch") || argv.includes("merge-base")) return { stdout: "" };
      if (argv.includes("rev-parse")) return { stdout: `${newSha}\n` };
      if (argv.includes("show")) return { stdout: project(version, build) };
      if (argv.includes("diff")) return { stdout: changed };
    }
    if (name === process.execPath) {
      return { stdout: JSON.stringify(receipt || { sha: newSha, version, build,
        reviewSubmissionId: "review-42", appStoreState: "WAITING_FOR_REVIEW",
        submittedDate: "2026-11-05T08:00:00Z" }) };
    }
    throw new Error(`Unexpected command: ${name} ${argv.join(" ")}`);
  };
  return { command, calls };
}

test("project release is exact across app and widget, and requires a higher version plus build", () => {
  assert.deepEqual(projectRelease(project("1.0.4", "10")), { version: "1.0.4", build: "10" });
  assert.throws(() => projectRelease(project("1.0.4", "10").replace("MARKETING_VERSION = 1.0.4",
    "MARKETING_VERSION = 1.0.5")), /Pinned source must set/);
  assert.equal(newerRelease({ version: "1.0.4", build: "10" }, { version: "1.0.3", build: "9" }), true);
  assert.equal(newerRelease({ version: "1.0.3", build: "10" }, { version: "1.0.3", build: "9" }), false);
  assert.equal(newerRelease({ version: "1.0.4", build: "9" }, { version: "1.0.3", build: "9" }), false);
});

test("first run creates a private baseline and sends no Apple command", () => fixture(async ({ home, root }) => {
  const { command, calls } = commandFor({ version: "1.0.3", build: "9" });
  const result = await startShippedRelease({ home, root, command,
    checkout: async () => { throw new Error("must not checkout"); } });
  assert.equal(result.status, "seeded");
  assert.deepEqual(readAutoState(home), { schema: 1, sha: newSha, version: "1.0.3",
    build: "9", seededAt: readAutoState(home).seededAt });
  assert.equal(fs.statSync(autoStatePath(home)).mode & 0o777, 0o600);
  assert.equal(calls.some((call) => call.name === process.execPath), false);
}));

test("non-native main advances the baseline without submitting", () => fixture(async ({ home, root }) => {
  seedAutoState(home, oldSha, project("1.0.3", "9"));
  const { command, calls } = commandFor({ changed: "", version: "1.0.3", build: "9" });
  const result = await startShippedRelease({ home, root, command,
    checkout: async () => { throw new Error("must not checkout"); } });
  assert.equal(result.status, "native-unchanged");
  assert.equal(readAutoState(home).sha, newSha);
  assert.equal(calls.some((call) => call.name === process.execPath), false);
}));

test("native source without both version and build bumps stops before release", () => fixture(async ({ home, root }) => {
  seedAutoState(home, oldSha, project("1.0.3", "9"));
  const { command, calls } = commandFor({ version: "1.0.3", build: "9" });
  await assert.rejects(() => startShippedRelease({ home, root, command,
    checkout: async () => { throw new Error("must not checkout"); } }), /not both increased/);
  assert.equal(readAutoState(home).sha, oldSha);
  assert.equal(calls.some((call) => call.name === process.execPath), false);
}));

test("failed CI or Ship blocks Apple, then a proven submission advances the cursor once", () =>
  fixture(async ({ home, root }) => {
    seedAutoState(home, oldSha, project("1.0.3", "9"));
    const { command, calls } = commandFor();
    const checkout = async (intent) => {
      assert.deepEqual({ sha: intent.sha, version: intent.version, build: intent.build },
        { sha: newSha, version: "1.0.4", build: "10" });
      assert.match(intent.ipa, /Fundhub-1\.0\.4-10-b{40}\.ipa$/);
      return path.join(home, "checkouts", newSha);
    };
    await assert.rejects(() => startShippedRelease({ home, root, command, checkout,
      ci: async () => { throw new Error("CI red"); }, ship: async () => {} }), /CI red/);
    await assert.rejects(() => startShippedRelease({ home, root, command, checkout,
      ci: async () => {}, ship: async () => { throw new Error("Ship missing"); } }), /Ship missing/);
    assert.equal(calls.some((call) => call.name === process.execPath), false);
    const result = await startShippedRelease({ home, root, command, checkout,
      ci: async (sha) => assert.equal(sha, newSha),
      ship: async (sha) => assert.equal(sha, newSha) });
    assert.equal(result.status, "submitted");
    const apply = calls.filter((call) => call.name === process.execPath);
    assert.equal(apply.length, 1);
    assert.ok(apply[0].argv.includes("--apply"));
    assert.equal(readAutoState(home).reviewSubmissionId, "review-42");
    assert.equal((await startShippedRelease({ home, root, command, checkout })).status, "idle");
    assert.equal(calls.filter((call) => call.name === process.execPath).length, 1);
  }));

test("unproven Apple command output never advances the cursor", () => fixture(async ({ home, root }) => {
  seedAutoState(home, oldSha, project("1.0.3", "9"));
  const { command } = commandFor({ receipt: { sha: newSha, version: "1.0.4", build: "10" } });
  await assert.rejects(() => startShippedRelease({ home, root, command,
    ci: async () => {}, ship: async () => {}, checkout: async () => root }), /did not prove/);
  assert.equal(readAutoState(home).sha, oldSha);
}));
