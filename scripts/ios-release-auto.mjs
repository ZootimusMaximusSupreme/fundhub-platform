// Auto-start only a newly shipped Fundhub iOS source with a newer project version and build.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertMainCi, assertPinnedShip, assertProjectVersion } from "./ios-release-handoff.mjs";
import { releaseHome } from "./ios-release-intent.mjs";

const execFileAsync = promisify(execFile);
const PROJECT = "tools/fundhub-ios/Fundhub.xcodeproj/project.pbxproj";
const REVIEWED = new Set(["WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_DEVELOPER_RELEASE", "READY_FOR_SALE"]);

export function projectRelease(source) {
  const version = [...source.matchAll(/\bMARKETING_VERSION = ([^;]+);/g)][0]?.[1] || "";
  const build = [...source.matchAll(/\bCURRENT_PROJECT_VERSION = ([^;]+);/g)][0]?.[1] || "";
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[1-9]\d*$/.test(build)) {
    throw new Error("Fundhub iOS project needs a numeric version and build");
  }
  assertProjectVersion(source, { version, build });
  return { version, build };
}

export function newerRelease(next, prior) {
  const left = next.version.split(".").map(Number);
  const right = prior.version.split(".").map(Number);
  const versionHigher = left.findIndex((part, index) => part !== right[index]);
  return versionHigher >= 0 && left[versionHigher] > right[versionHigher] &&
    Number(next.build) > Number(prior.build);
}

export function autoStatePath(home = releaseHome()) {
  return path.join(home, "auto-start.json");
}

export function readAutoState(home = releaseHome()) {
  const file = autoStatePath(home);
  if (!fs.existsSync(file)) return null;
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  if (state?.schema !== 1 || !/^[a-f0-9]{40}$/.test(state?.sha || "") ||
      !/^\d+\.\d+\.\d+$/.test(state?.version || "") || !/^[1-9]\d*$/.test(state?.build || "")) {
    throw new Error("Invalid iOS auto-start state; no release was started");
  }
  return state;
}

function writeAutoState(home, state) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = autoStatePath(home);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ schema: 1, ...state }) + "\n", { flag: "wx", mode: 0o600 });
  try { fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}

export function seedAutoState(home, sha, project) {
  const existing = readAutoState(home);
  if (existing) return existing;
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Auto-start baseline needs an exact main SHA");
  const release = projectRelease(project);
  writeAutoState(home, { sha, ...release, seededAt: new Date().toISOString() });
  return readAutoState(home);
}

async function git(command, root, args) {
  return String((await command("git", ["-C", root, ...args],
    { timeout: 60_000, maxBuffer: 1_000_000 })).stdout).trim();
}

export async function startShippedRelease({ home = releaseHome(), root, command = execFileAsync,
  ci = assertMainCi, ship = assertPinnedShip, checkout } = {}) {
  if (!root || typeof checkout !== "function") throw new Error("Auto-start needs the main repo and pinned checkout");
  await git(command, root, ["fetch", "--no-tags", "origin", "main"]);
  const sha = await git(command, root, ["rev-parse", "origin/main"]);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Remote main did not return an exact source SHA");
  const project = await git(command, root, ["show", `${sha}:${PROJECT}`]);
  const release = projectRelease(project);
  const prior = readAutoState(home);
  if (!prior) {
    seedAutoState(home, sha, project);
    return { status: "seeded", sha };
  }
  if (prior.sha === sha) return { status: "idle", sha };
  await git(command, root, ["merge-base", "--is-ancestor", prior.sha, sha]);
  const changed = await git(command, root, ["diff", "--name-only", `${prior.sha}..${sha}`, "--",
    "tools/fundhub-ios/"]);
  if (!changed) {
    writeAutoState(home, { ...prior, sha });
    return { status: "native-unchanged", sha };
  }
  if (!newerRelease(release, prior)) {
    throw new Error(`Native source changed at ${sha}, but the iOS version and build were not both increased`);
  }
  await ci(sha);
  await ship(sha);
  const ipa = path.join(home, "artifacts", `Fundhub-${release.version}-${release.build}-${sha}.ipa`);
  const intent = { sha, ...release, ipa };
  const pinned = await checkout(intent, home, root, command);
  const argv = [`--env-file=${path.join(root, ".env")}`,
    path.join(pinned, "scripts", "ios-upload-and-submit.mjs"),
    "--version", release.version, "--build", release.build, "--sha", sha,
    "--ipa", ipa, "--apply"];
  const output = await command(process.execPath, argv, { cwd: pinned,
    env: { ...process.env, FUNDHUB_IOS_RELEASE_HOME: home, FUNDHUB_IOS_WATCHDOG: "1" },
    timeout: 4 * 60 * 60_000, maxBuffer: 2_000_000 });
  let receipt;
  try { receipt = JSON.parse(String(output.stdout || "").trim().split("\n").at(-1)); }
  catch { throw new Error("Auto-start release command returned no readable Apple receipt"); }
  if (receipt.sha !== sha || receipt.version !== release.version || receipt.build !== release.build ||
      !receipt.reviewSubmissionId || !REVIEWED.has(receipt.appStoreState)) {
    throw new Error("Auto-start release command did not prove the exact Apple submission");
  }
  writeAutoState(home, { sha, ...release, submittedAt: receipt.submittedDate || new Date().toISOString(),
    reviewSubmissionId: receipt.reviewSubmissionId });
  return { status: "submitted", sha, version: release.version, build: release.build,
    reviewSubmissionId: receipt.reviewSubmissionId };
}
