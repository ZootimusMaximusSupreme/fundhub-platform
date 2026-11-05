#!/usr/bin/env node
// Resume exact intents and start a newly shipped, versioned native release.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { intentKey, listPending, lockActive, readIntent, releaseHome } from "./ios-release-intent.mjs";
import { startShippedRelease } from "./ios-release-auto.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function git(command, root, args) {
  return String((await command("git", ["-C", root, ...args], { maxBuffer: 1_000_000 })).stdout).trim();
}

export async function pinnedCheckout(intent, home, root = ROOT, command = execFileAsync) {
  const checkout = path.join(home, "checkouts", intent.sha);
  await command("git", ["-C", root, "fetch", "--no-tags", "origin", "main"],
    { timeout: 60_000, maxBuffer: 1_000_000 });
  await command("git", ["-C", root, "cat-file", "-e", `${intent.sha}^{commit}`]);
  if (!fs.existsSync(checkout)) {
    fs.mkdirSync(path.dirname(checkout), { recursive: true, mode: 0o700 });
    await command("git", ["-C", root, "worktree", "add", "--detach", checkout, intent.sha],
      { maxBuffer: 1_000_000 });
  }
  const head = await git(command, checkout, ["rev-parse", "HEAD"]);
  const dirty = await git(command, checkout, ["status", "--porcelain", "--untracked-files=all"]);
  if (head !== intent.sha || dirty) throw new Error("Pinned release checkout changed; recovery stopped");
  return checkout;
}

function logLine(home, key, line) {
  const directory = path.join(home, "logs");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.appendFileSync(path.join(directory, `${key}.log`), `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
}

export function writeWatchdogStatus(home, result, reason = "") {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = path.join(home, "watchdog-status.json");
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const blocked = result.auto === "blocked-by-pending" || result.auto === "blocked-by-error" ||
    result.auto === "failed";
  const status = { schema: 1, checkedAt: new Date().toISOString(), ...result,
    blockedReason: blocked ? reason || "An earlier exact release is still pending" : null,
    next: blocked ? "Inspect the private iOS release log and resolve the exact pending release" : null };
  fs.writeFileSync(temp, JSON.stringify(status) + "\n", { flag: "wx", mode: 0o600 });
  try { fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
  return file;
}

async function alertOnce(home, key, reason, command = execFileAsync) {
  const hash = crypto.createHash("sha256").update(reason).digest("hex");
  const file = path.join(home, "logs", `${key}.last-error`);
  let old = null;
  try { old = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first failure */ }
  const now = Date.now();
  if (old?.hash === hash && now - old.at < 60 * 60_000) return;
  fs.writeFileSync(file, JSON.stringify({ hash, at: now }) + "\n", { mode: 0o600 });
  await command("osascript", ["-e",
    'display notification "Check the local release log" with title "Fundhub iOS release needs attention"'],
  { timeout: 5_000 }).catch(() => {});
}

export async function runWatchdog({ home = releaseHome(), root = ROOT,
  command = execFileAsync, notify = alertOnce, autoStart = startShippedRelease } = {}) {
  const result = { pending: 0, resumed: 0, busy: 0, failed: 0, auto: "idle" };
  let blockingReason = "";
  for (const file of listPending(home)) {
    let intent;
    try { intent = readIntent(file); }
    catch (error) {
      const key = path.basename(file, ".json").replace(/[^a-zA-Z0-9._-]/g, "_");
      const reason = `Invalid release intent: ${error.message}`;
      blockingReason = reason;
      logLine(home, key, `FAILED ${reason}`);
      await notify(home, key, reason, command);
      result.failed++;
      continue;
    }
    if (intent.status !== "pending") continue;
    const key = intentKey(intent);
    result.pending++;
    if (lockActive(intent, home)) { result.busy++; continue; }
    try {
      const checkout = await pinnedCheckout(intent, home, root, command);
      const argv = [`--env-file=${path.join(root, ".env")}`,
        path.join(checkout, "scripts", "ios-upload-and-submit.mjs"),
        "--version", intent.version, "--build", intent.build, "--sha", intent.sha,
        "--ipa", intent.ipa, "--apply"];
      const output = await command(process.execPath, argv, { cwd: checkout,
        env: { ...process.env, FUNDHUB_IOS_RELEASE_HOME: home, FUNDHUB_IOS_WATCHDOG: "1" },
        timeout: 4 * 60 * 60_000, maxBuffer: 2_000_000 });
      logLine(home, key, `RESUMED ${String(output.stdout || "").trim().slice(0, 1200)}`);
      fs.rmSync(path.join(home, "logs", `${key}.last-error`), { force: true });
      result.resumed++;
    } catch (error) {
      const reason = String(error.stderr || error.message || "unknown release error").trim().slice(0, 1200)
        .replace(/[\r\n]+/g, " ");
      blockingReason = reason;
      logLine(home, key, `FAILED ${reason}`);
      await notify(home, key, reason, command);
      result.failed++;
    }
  }
  if (result.pending) {
    result.auto = "blocked-by-pending";
  } else if (result.failed) {
    result.auto = "blocked-by-error";
  } else {
    try {
      const started = await autoStart({ home, root, command, checkout: pinnedCheckout });
      result.auto = started.status;
      if (!["idle", "native-unchanged"].includes(started.status)) {
        logLine(home, "auto-start", JSON.stringify(started));
      }
    } catch (error) {
      const reason = String(error.stderr || error.message || "unknown auto-start error").trim().slice(0, 1200)
        .replace(/[\r\n]+/g, " ");
      blockingReason = reason;
      logLine(home, "auto-start", `FAILED ${reason}`);
      await notify(home, "auto-start", reason, command);
      result.failed++;
      result.auto = "failed";
    }
  }
  writeWatchdogStatus(home, result, blockingReason);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runWatchdog({ root: process.env.FUNDHUB_IOS_MAIN_REPO || ROOT })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(`ios-release-watchdog: ${error.message}`); process.exitCode = 1; });
}
