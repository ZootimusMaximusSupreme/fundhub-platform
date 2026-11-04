import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { completeIntent, intentKey, intentPath, listPending, lockActive, lockPath,
  readIntent, withIntentLock, writeIntent } from "./ios-release-intent.mjs";
import { pinnedCheckout, runWatchdog } from "./ios-release-watchdog.mjs";
import { installWatchdog, makePlist } from "./ios-release-watchdog-install.mjs";
import { executeReleaseIntent } from "./ios-upload-and-submit.mjs";

const sha = "a".repeat(40);
const args = { sha, version: "1.0.4", build: "10" };

function fixture(callback) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-ios-watchdog-test-"));
  const home = path.join(temp, "release-home");
  const root = path.join(temp, "repo");
  fs.mkdirSync(root);
  try { return callback({ temp, home, root }); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

test("explicit intent is private, immutable for its IPA, and marked complete only after a receipt", () => fixture(({ home, temp }) => {
  const release = { ...args, ipa: path.join(temp, "Fundhub.ipa") };
  const file = writeIntent(release, home);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(listPending(home), [file]);
  assert.throws(() => writeIntent({ ...release, ipa: path.join(temp, "other.ipa") }, home), /different IPA/);
  assert.throws(() => completeIntent(file, { reviewSubmissionId: "review-1" }), /Apple review receipt/);
  completeIntent(file, { reviewSubmissionId: "review-1", appStoreState: "WAITING_FOR_REVIEW",
    submittedDate: "2026-11-04T20:59:28Z" });
  assert.equal(readIntent(file).status, "done");
  assert.equal(readIntent(file).reviewSubmissionId, "review-1");
  assert.throws(() => writeIntent(release, home), /is complete/);
}));

test("per-release lock blocks a concurrent command and recovers a dead owner", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-ios-lock-test-"));
  try {
    await withIntentLock(args, temp, async () => {
      assert.equal(lockActive(args, temp), true);
      await assert.rejects(() => withIntentLock(args, temp, async () => {}), /already running/);
    });
    assert.equal(lockActive(args, temp), false);
    const stale = lockPath(args, temp);
    fs.mkdirSync(stale);
    fs.writeFileSync(path.join(stale, "owner.json"), JSON.stringify({ pid: 999999, host: os.hostname() }));
    assert.equal(lockActive(args, temp), false);
    assert.equal(fs.existsSync(stale), false);
    fs.mkdirSync(stale);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(stale, old, old);
    assert.equal(lockActive(args, temp), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("watchdog starts only a stored exact release from a clean pinned checkout", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-ios-resume-test-"));
  try {
    const home = path.join(temp, "home");
    const root = path.join(temp, "repo");
    fs.mkdirSync(root);
    const release = { ...args, ipa: path.join(temp, "Fundhub.ipa") };
    const file = writeIntent(release, home);
    fs.mkdirSync(path.join(home, "checkouts", sha), { recursive: true });
    const calls = [];
    const command = async (name, argv, options) => {
      calls.push({ name, argv, options });
      if (name === "git" && argv.includes("fetch")) return { stdout: "" };
      if (name === "git" && argv.includes("cat-file")) return { stdout: "" };
      if (name === "git" && argv.includes("rev-parse")) return { stdout: `${sha}\n` };
      if (name === "git" && argv.includes("status")) return { stdout: "" };
      if (name === process.execPath) {
        assert.equal(argv.includes("--apply"), true);
        assert.equal(argv.includes(release.ipa), true);
        assert.equal(options.env.FUNDHUB_IOS_RELEASE_HOME, home);
        completeIntent(file, { reviewSubmissionId: "review-1", appStoreState: "WAITING_FOR_REVIEW" });
        return { stdout: '{"mode":"upload-and-submit"}' };
      }
      throw new Error(`Unexpected command ${name}`);
    };
    const result = await runWatchdog({ home, root, command, notify: async () => {} });
    assert.deepEqual(result, { pending: 1, resumed: 1, busy: 0, failed: 0 });
    assert.equal(calls.filter((call) => call.name === process.execPath).length, 1);
    assert.equal(readIntent(file).status, "done");
    assert.deepEqual(await runWatchdog({ home, root, command, notify: async () => {} }),
      { pending: 0, resumed: 0, busy: 0, failed: 0 });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("one malformed intent alerts and does not stall a valid release", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-ios-malformed-test-"));
  try {
    const home = path.join(temp, "home");
    const root = path.join(temp, "repo");
    fs.mkdirSync(root);
    const release = { ...args, ipa: path.join(temp, "Fundhub.ipa") };
    writeIntent(release, home);
    fs.writeFileSync(path.join(home, "intents", "000-bad.json"), "not json");
    fs.mkdirSync(path.join(home, "checkouts", sha), { recursive: true });
    const alerted = [];
    const command = async (name, argv) => {
      if (name === "git" && argv.includes("fetch")) return { stdout: "" };
      if (name === "git" && argv.includes("cat-file")) return { stdout: "" };
      if (name === "git" && argv.includes("rev-parse")) return { stdout: `${sha}\n` };
      if (name === "git" && argv.includes("status")) return { stdout: "" };
      if (name === process.execPath) {
        completeIntent(intentPath(release, home), { reviewSubmissionId: "r", appStoreState: "WAITING_FOR_REVIEW" });
        return { stdout: "done" };
      }
      throw new Error(name);
    };
    const result = await runWatchdog({ home, root, command,
      notify: async (_home, key) => alerted.push(key) });
    assert.deepEqual(result, { pending: 1, resumed: 1, busy: 0, failed: 1 });
    assert.deepEqual(alerted, ["000-bad"]);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("missing pinned object is fetched before a recovery checkout is created", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-ios-fetch-test-"));
  try {
    const home = path.join(temp, "home");
    const root = path.join(temp, "repo");
    fs.mkdirSync(root);
    const order = [];
    const command = async (name, argv) => {
      assert.equal(name, "git");
      if (argv.includes("fetch")) { order.push("fetch"); return { stdout: "" }; }
      if (argv.includes("cat-file")) { order.push("object"); return { stdout: "" }; }
      if (argv.includes("worktree")) {
        order.push("worktree");
        fs.mkdirSync(path.join(home, "checkouts", sha), { recursive: true });
        return { stdout: "" };
      }
      if (argv.includes("rev-parse")) return { stdout: `${sha}\n` };
      if (argv.includes("status")) return { stdout: "" };
      throw new Error(argv.join(" "));
    };
    const checkout = await pinnedCheckout(args, home, root, command);
    assert.equal(checkout, path.join(home, "checkouts", sha));
    assert.deepEqual(order, ["fetch", "object", "worktree"]);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("installer uses a two-minute launchd job and refuses unpublished code", async () => {
  assert.match(makePlist("/repo & one", "/home/release"), /<key>StartInterval<\/key><integer>120<\/integer>/);
  assert.match(makePlist("/repo & one", "/home/release"), /repo &amp; one/);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-ios-installer-test-"));
  try {
    const home = path.join(temp, "home");
    const root = path.join(temp, "repo");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, ".env"), "");
    const calls = [];
    const command = async (name, argv) => {
      calls.push([name, argv]);
      if (name === "git" && argv.includes("fetch")) return { stdout: "" };
      if (name === "git" && argv.includes("rev-parse")) return { stdout: `${sha}\n` };
      if (name === "git" && argv.includes("cat-file")) throw new Error("not on published main");
      throw new Error(`Unexpected ${name}`);
    };
    await assert.rejects(() => installWatchdog({ sourceRoot: root, mainRepo: root, home, command,
      launchAgents: path.join(temp, "agents") }), /not on published main/);
    assert.equal(calls.length, 3);
    assert.equal(fs.existsSync(path.join(temp, "agents")), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("installer points launchd at a stable published runner and local credentials", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-ios-installer-main-test-"));
  try {
    const home = path.join(temp, "home");
    const root = path.join(temp, "repo");
    const agents = path.join(temp, "agents");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, ".env"), "");
    const calls = [];
    const command = async (name, argv) => {
      calls.push([name, argv]);
      if (name === "git" && argv.includes("rev-parse")) return { stdout: `${sha}\n` };
      if (name === "git" && argv.includes("worktree")) {
        fs.mkdirSync(path.join(home, "runner"), { recursive: true });
      }
      return { stdout: "" };
    };
    const result = await installWatchdog({ sourceRoot: root, mainRepo: root, home,
      command, launchAgents: agents });
    const plist = fs.readFileSync(result.plist, "utf8");
    assert.match(plist, /StartInterval<\/key><integer>120/);
    assert.ok(plist.includes(path.join(home, "runner", "scripts", "ios-release-watchdog.mjs")));
    assert.ok(plist.includes(root));
    assert.equal(calls.filter(([name]) => name === "launchctl").length, 3);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("bad apply preflight leaves no pending release intent", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-ios-intent-gate-test-"));
  try {
    const key = path.join(temp, "AuthKey_DUMMY.p8");
    fs.writeFileSync(key, "unused test key");
    const home = path.join(temp, "release-home");
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "ios-upload-and-submit.mjs");
    const result = spawnSync(process.execPath, [script, "--version", "1.0.4", "--build", "10",
      "--sha", "0".repeat(40), "--ipa", path.join(home, "artifacts", "Fundhub.ipa"), "--apply"],
    { encoding: "utf8", env: { ...process.env, FUNDHUB_IOS_RELEASE_HOME: home,
      ASC_KEY_ID: "DUMMY", ASC_ISSUER_ID: "DUMMY", ASC_KEY_PATH: key } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /clean checkout at the exact pinned source SHA/);
    assert.equal(fs.existsSync(path.join(home, "intents")), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("completed intent returns a matching Apple receipt without another apply", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-ios-done-test-"));
  try {
    const home = path.join(temp, "home");
    const release = { ...args, ipa: path.join(home, "artifacts", "Fundhub.ipa"), apply: true };
    const file = writeIntent(release, home);
    completeIntent(file, { reviewSubmissionId: "review-1", appStoreState: "WAITING_FOR_REVIEW" });
    const calls = [];
    const receipt = { mode: "already-submitted", reviewSubmissionId: "review-1",
      appStoreState: "WAITING_FOR_REVIEW" };
    const result = await executeReleaseIntent(release, { home, run: async (input) => {
      calls.push(input.apply);
      assert.equal(input.apply, false);
      return receipt;
    } });
    assert.deepEqual(calls, [false]);
    assert.equal(result, receipt);
    await assert.rejects(() => executeReleaseIntent(release, { home,
      run: async () => ({ ...receipt, reviewSubmissionId: "wrong" }) }), /does not match/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("apply refuses an ephemeral IPA path before a release intent is created", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-ios-artifact-path-test-"));
  try {
    const home = path.join(temp, "persistent-home");
    const release = { ...args, ipa: path.join(temp, "Fundhub.ipa"), apply: true };
    let called = false;
    await assert.rejects(() => executeReleaseIntent(release, { home, run: async () => {
      called = true;
    } }), /durable iOS release artifacts/);
    assert.equal(called, false);
    assert.equal(fs.existsSync(path.join(home, "intents")), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
