import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HOME_NAME = path.join("Library", "Application Support", "Fundhub", "iOS Releases");

export function releaseHome(env = process.env) {
  return path.resolve(env.FUNDHUB_IOS_RELEASE_HOME || path.join(os.homedir(), HOME_NAME));
}

export function intentKey({ sha, version, build }) {
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^\d+\.\d+\.\d+$/.test(version) || !/^[1-9]\d*$/.test(build)) {
    throw new Error("Release intent needs exact source SHA, version and build");
  }
  return `${version}-${build}-${sha}`;
}

export function intentPath(args, home = releaseHome()) {
  return path.join(home, "intents", `${intentKey(args)}.json`);
}

function atomicWrite(file, value, create = false) {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
  try {
    if (create && fs.existsSync(file)) throw new Error("Release intent appeared during creation");
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}

export function readIntent(file) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value?.schema !== 1 || value?.appId !== "6823985032" || value?.releaseType !== "AFTER_APPROVAL" ||
      !path.isAbsolute(value?.ipa || "") || !["pending", "done"].includes(value?.status) ||
      path.basename(file) !== `${intentKey(value)}.json`) {
    throw new Error(`Invalid iOS release intent: ${path.basename(file)}`);
  }
  return value;
}

export function writeIntent(args, home = releaseHome()) {
  const file = intentPath(args, home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    const existing = readIntent(file);
    if (existing.ipa !== args.ipa || existing.status !== "pending") {
      throw new Error("Release intent already exists with a different IPA or is complete");
    }
    return file;
  }
  atomicWrite(file, { schema: 1, appId: "6823985032", sha: args.sha, version: args.version,
    build: args.build, ipa: args.ipa, releaseType: "AFTER_APPROVAL", status: "pending",
    createdAt: new Date().toISOString() }, true);
  return file;
}

export function completeIntent(file, receipt) {
  const value = readIntent(file);
  if (value.status === "done") return value;
  if (!receipt?.reviewSubmissionId || !["WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_DEVELOPER_RELEASE",
    "READY_FOR_SALE"].includes(receipt?.appStoreState)) {
    throw new Error("Apple review receipt is required before closing the release intent");
  }
  const next = { ...value, status: "done", completedAt: new Date().toISOString(),
    reviewSubmissionId: receipt.reviewSubmissionId, submittedDate: receipt.submittedDate };
  atomicWrite(file, next);
  return next;
}

export function listPending(home = releaseHome()) {
  const directory = path.join(home, "intents");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => name.endsWith(".json"))
    .map((name) => path.join(directory, name));
}

export function lockPath(args, home = releaseHome()) {
  return path.join(home, "locks", `${intentKey(args)}.lock`);
}

export function lockActive(args, home = releaseHome()) {
  const file = lockPath(args, home);
  if (!fs.existsSync(file)) return false;
  const ownerFile = path.join(file, "owner.json");
  let owner;
  try { owner = JSON.parse(fs.readFileSync(ownerFile, "utf8")); }
  catch {
    if (Date.now() - fs.statSync(file).mtimeMs < 30_000) return true;
    fs.rmSync(file, { recursive: true, force: true });
    return false;
  }
  if (!Number.isInteger(owner.pid) || owner.pid <= 0 || owner.host !== os.hostname()) return true;
  try {
    process.kill(owner.pid, 0);
    if (Number.isFinite(owner.startedAt)) {
      const started = Date.parse(String(execFileSync("ps", ["-p", String(owner.pid), "-o", "lstart="],
        { encoding: "utf8", timeout: 5_000 })).trim());
      if (Number.isFinite(started) && Math.abs(started - owner.startedAt) > 5 * 60_000) {
        fs.rmSync(file, { recursive: true, force: true });
        return false;
      }
    }
    return true;
  }
  catch (error) { if (error.code !== "ESRCH") return true; }
  fs.rmSync(file, { recursive: true, force: true });
  return false;
}

export async function withIntentLock(args, home, callback) {
  const file = lockPath(args, home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (lockActive(args, home)) throw new Error("Exact iOS release is already running");
  try { fs.mkdirSync(file, { mode: 0o700 }); }
  catch (error) { if (error.code === "EEXIST") throw new Error("Exact iOS release is already running"); throw error; }
  fs.writeFileSync(path.join(file, "owner.json"), JSON.stringify({ pid: process.pid, host: os.hostname(),
    startedAt: Date.now() - process.uptime() * 1000 }) + "\n",
    { mode: 0o600 });
  try { return await callback(); }
  finally { fs.rmSync(file, { recursive: true, force: true }); }
}
