#!/usr/bin/env node
// One guarded command from pinned source through App Store review submission.
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { applySubmission, assertMainCi, assertPinnedShip, assertProjectVersion, checkReceipt, findVersion, makeAppleClient,
  parseArgs as parseHandoffArgs, publicReceipt, readReceipt, readUploadedBuild } from "./ios-release-handoff.mjs";
import { completeIntent, intentPath, readIntent, releaseHome, withIntentLock, writeIntent } from "./ios-release-intent.mjs";

const execFileAsync = promisify(execFile);
const APP_ID = "6823985032";
const BUNDLE_ID = "ai.fundhub.app";
const PROJECT = "tools/fundhub-ios/Fundhub.xcodeproj/project.pbxproj";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLL_ATTEMPTS = 60;
const POLL_MS = 30_000;
const MARKER_SUFFIX = ".fundhub-release.json";

export function parseArgs(argv) {
  const args = [...argv];
  const index = args.indexOf("--ipa");
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith("--")) {
    throw new Error("Pass an unused --ipa output path, or the exact path from a prior run");
  }
  if (args.includes("--release-type")) throw new Error("This release path always uses AFTER_APPROVAL");
  const ipa = path.resolve(args[index + 1]);
  args.splice(index, 2);
  const parsed = parseHandoffArgs(args.includes("--apply")
    ? [...args, "--release-type", "AFTER_APPROVAL"] : args);
  return { ...parsed, ipa, releaseType: "AFTER_APPROVAL" };
}

export function findIpaInfoPath(entries) {
  const matches = entries.split(/\r?\n/).filter((entry) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(entry));
  if (matches.length !== 1) throw new Error(`Expected one iOS app Info.plist in IPA; found ${matches.length}`);
  return matches[0];
}

export function assertIpaFields(fields, args) {
  if (fields.bundle !== BUNDLE_ID || fields.version !== args.version || fields.build !== args.build) {
    throw new Error(`IPA bundle/version/build must be ${BUNDLE_ID} ${args.version} (${args.build})`);
  }
}

export async function inspectIpa(ipa, command = execFileAsync) {
  if (!ipa.endsWith(".ipa") || !fs.statSync(ipa, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("--ipa must name an existing .ipa file");
  }
  const entries = (await command("unzip", ["-Z1", ipa], { maxBuffer: 5_000_000 })).stdout;
  const infoPath = findIpaInfoPath(entries);
  const bytes = (await command("unzip", ["-p", ipa, infoPath],
    { encoding: "buffer", maxBuffer: 5_000_000 })).stdout;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-ipa-info-"));
  const info = path.join(temp, "Info.plist");
  try {
    fs.writeFileSync(info, bytes);
    const read = async (key) => String((await command("plutil", ["-extract", key, "raw", "-o", "-", info],
      { maxBuffer: 10_000 })).stdout).trim();
    return { bundle: await read("CFBundleIdentifier"), version: await read("CFBundleShortVersionString"),
      build: await read("CFBundleVersion") };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function ipaHash(ipa) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(ipa);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

function uploadMarker(ipa, args) {
  const markerPath = `${ipa}${MARKER_SUFFIX}`;
  const fields = { schema: 2, sha: args.sha, version: args.version, build: args.build };
  const read = () => {
    if (!fs.existsSync(markerPath)) return null;
    let actual;
    try { actual = JSON.parse(fs.readFileSync(markerPath, "utf8")); } catch { throw new Error("IPA upload marker is unreadable"); }
    if (Object.keys(fields).some((key) => actual?.[key] !== fields[key]) ||
        !/^[a-f0-9]{64}$/.test(actual?.ipaSha256 || "") ||
        !["ready", "upload_attempted"].includes(actual?.phase)) {
      throw new Error("IPA upload marker does not match this source, version and build");
    }
    return actual;
  };
  const write = (value, create = false) => {
    const temp = `${markerPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
    try {
      if (create && fs.existsSync(markerPath)) throw new Error("IPA upload marker appeared during archive/export");
      fs.renameSync(temp, markerPath);
    } finally { fs.rmSync(temp, { force: true }); }
  };
  return { path: markerPath, read, ready: (digest) => write({ ...fields, ipaSha256: digest, phase: "ready" }, true),
    attempted: (record) => write({ ...record, phase: "upload_attempted" }) };
}

async function assertCleanPinnedSource(args, command = execFileAsync) {
  const head = String((await command("git", ["rev-parse", "HEAD"], { cwd: ROOT })).stdout).trim();
  const dirty = String((await command("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT })).stdout).trim();
  if (head !== args.sha || dirty) throw new Error("Archive requires a clean checkout at the exact pinned source SHA");
}

function assertOutputOutsideCheckout(ipa) {
  const parent = fs.realpathSync(path.dirname(ipa));
  if (parent === ROOT || parent.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error("--ipa output must be outside the source checkout");
  }
}

export async function buildIpa(args, toolEnv, command = execFileAsync) {
  if (fs.existsSync(args.ipa)) throw new Error("Unproven IPA exists at the requested output path");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-ios-archive-"));
  const archive = path.join(temp, "Fundhub.xcarchive");
  const exported = path.join(temp, "export");
  const auth = ["-allowProvisioningUpdates", "-authenticationKeyPath", toolEnv.keyPath,
    "-authenticationKeyID", toolEnv.keyId, "-authenticationKeyIssuerID", toolEnv.issuerId];
  try {
    await command("xcodebuild", ["-project", "tools/fundhub-ios/Fundhub.xcodeproj", "-scheme", "Fundhub",
      "-configuration", "Release", "-destination", "generic/platform=iOS", "-archivePath", archive,
      ...auth, "archive"], { cwd: ROOT, timeout: 60 * 60_000, maxBuffer: 20_000_000 });
    await command("xcodebuild", ["-exportArchive", "-archivePath", archive,
      "-exportOptionsPlist", "tools/fundhub-ios/ExportOptions.plist", "-exportPath", exported,
      ...auth], { cwd: ROOT, timeout: 30 * 60_000, maxBuffer: 20_000_000 });
    const produced = path.join(exported, "Fundhub.ipa");
    if (!fs.statSync(produced, { throwIfNoEntry: false })?.isFile()) {
      throw new Error("Xcode export did not produce Fundhub.ipa");
    }
    fs.copyFileSync(produced, args.ipa, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    throw new Error(`Pinned iOS archive/export failed: ${error.message?.startsWith("Xcode export") ? error.message : "inspect the Xcode signing result"}`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

export async function appleTool(args, env, command = execFileAsync) {
  try {
    await command("xcrun", ["altool", ...args, "--platform", "ios", "--apple-id", APP_ID,
      "--bundle-id", BUNDLE_ID, "--bundle-version", env.build,
      "--bundle-short-version-string", env.version, "--api-key", env.keyId,
      "--api-issuer", env.issuerId, "--output-format", "json"],
    { env: { ...process.env, API_PRIVATE_KEYS_DIR: path.dirname(env.keyPath) },
      timeout: 30 * 60_000, maxBuffer: 2_000_000 });
  } catch {
    throw new Error(`Apple ${args[0]} failed; exact ${env.version} build ${env.build} was not submitted`);
  }
}

export async function runUploadAndSubmit(args, { env = process.env, client = makeAppleClient(env),
  command = execFileAsync, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  inspect = inspectIpa, ci = assertMainCi, ship = assertPinnedShip,
  apple = appleTool, build = buildIpa } = {}) {
  assertOutputOutsideCheckout(args.ipa);
  await assertCleanPinnedSource(args, command);
  const project = (await command("git", ["show", `${args.sha}:${PROJECT}`], { cwd: ROOT, maxBuffer: 1_000_000 })).stdout;
  assertProjectVersion(project, args);
  const marker = uploadMarker(args.ipa, args);
  let marked = marker.read();
  const hasIpa = fs.statSync(args.ipa, { throwIfNoEntry: false })?.isFile() || false;
  if (hasIpa !== Boolean(marked)) throw new Error("IPA and pinned archive receipt must both exist for a retry");
  if (marked) {
    assertIpaFields(await inspect(args.ipa, command), args);
    if (marked.ipaSha256 !== await ipaHash(args.ipa)) {
      throw new Error("IPA bytes changed since the pinned archive receipt");
    }
  }
  let appVersion = await findVersion(client, args.version);
  let existing = await readUploadedBuild(client, args);
  const attached = appVersion ? (await client("GET", `/v1/appStoreVersions/${appVersion.id}/build`))?.data : null;
  if (attached && (!existing || attached.id !== existing.id)) {
    throw new Error("Exact App Store version already has a different build attached");
  }
  const firstCiRun = await ci(args.sha, undefined, { allowMainAdvance: true });
  const firstShipRun = await ship(args.sha);
  if (appVersion && !["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW"].includes(appVersion.attributes?.appStoreState)) {
    if (marked?.phase !== "upload_attempted" || !existing) {
      throw new Error("Exact App Store version is not open for a proven idempotent review receipt");
    }
    const completed = await readReceipt(client, args);
    if (!checkReceipt(completed, "AFTER_APPROVAL").submitted) {
      throw new Error("Exact App Store version is not an already-submitted release");
    }
    return { mode: "already-submitted", ...publicReceipt(completed, args, firstCiRun), shipRun: firstShipRun };
  }
  if (existing && (!marked || marked.phase !== "upload_attempted")) {
    throw new Error("Exact build is already uploaded without a matching upload attempt receipt; no automatic resume");
  }
  if (!args.apply) return { mode: "upload-dry-run", version: args.version, build: args.build,
    sha: args.sha, ipa: path.basename(args.ipa), releaseType: "AFTER_APPROVAL", ciRun: firstCiRun,
    shipRun: firstShipRun, createVersion: !appVersion, resumeUpload: Boolean(existing && marked),
    next: "Run the same command with --apply to archive, export, upload, wait VALID and submit" };

  const keyId = String(env.ASC_KEY_ID || "").trim();
  const issuerId = String(env.ASC_ISSUER_ID || "").trim();
  const keyPath = String(env.ASC_KEY_PATH || "").trim();
  if (!keyId || !issuerId || !keyPath || path.basename(keyPath) !== `AuthKey_${keyId}.p8` ||
      !fs.statSync(keyPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("A matching ASC API key file is required for IPA upload");
  }
  const toolEnv = { version: args.version, build: args.build, keyId, issuerId, keyPath };
  if (!marked) {
    await build(args, toolEnv, command);
    await assertCleanPinnedSource(args, command);
    assertIpaFields(await inspect(args.ipa, command), args);
    marker.ready(await ipaHash(args.ipa));
    marked = marker.read();
  }
  if (!appVersion) {
    await client("POST", "/v1/appStoreVersions", { data: { type: "appStoreVersions",
      attributes: { platform: "IOS", versionString: args.version, releaseType: "AFTER_APPROVAL" },
      relationships: { app: { data: { type: "apps", id: APP_ID } } } } });
    appVersion = await findVersion(client, args.version);
    if (!appVersion) throw new Error("Apple did not return the newly created exact iOS version");
  }
  if (marked.phase === "ready") {
    await apple(["--validate-app", args.ipa], toolEnv, command);
    marker.attempted(marked);
    await apple(["--upload-app", "-f", args.ipa, "--wait"], toolEnv, command);
  }
  let receipt = null;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    try {
      receipt = await readReceipt(client, args);
      const state = receipt.uploaded.attributes?.processingState;
      if (state === "VALID") break;
      if (state && state !== "PROCESSING") throw new Error(`Exact uploaded build processing state is ${state}`);
    } catch (error) {
      if (!error.message.includes("upload is not visible yet")) throw error;
    }
    if (attempt < POLL_ATTEMPTS - 1) await sleep(POLL_MS);
  }
  if (receipt?.uploaded.attributes?.processingState !== "VALID") {
    throw new Error("Exact upload attempt did not become VALID within 30 minutes; no review submission or duplicate upload was sent");
  }
  const finalCiRun = await ci(args.sha, undefined, { allowMainAdvance: true });
  const finalShipRun = await ship(args.sha);
  const submitted = await applySubmission(client, args, receipt);
  return { mode: "upload-and-submit", ...publicReceipt(submitted, args, finalCiRun), shipRun: finalShipRun };
}

export async function executeReleaseIntent(args, { home = releaseHome(), run = runUploadAndSubmit } = {}) {
  if (!args.apply) {
    return run(args);
  }
  const artifactRoot = path.join(home, "artifacts");
  if (!args.ipa.startsWith(`${artifactRoot}${path.sep}`)) {
    throw new Error("--ipa output must be inside the durable iOS release artifacts folder");
  }
  fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(args.ipa), { recursive: true, mode: 0o700 });
  if (!fs.realpathSync(path.dirname(args.ipa)).startsWith(`${fs.realpathSync(artifactRoot)}${path.sep}`) &&
      fs.realpathSync(path.dirname(args.ipa)) !== fs.realpathSync(artifactRoot)) {
    throw new Error("--ipa artifact folder must stay inside durable release storage");
  }
  const file = intentPath(args, home);
  args.resumeIntent = fs.existsSync(file);
  const preflight = await run({ ...args, apply: false });
  if (args.resumeIntent && readIntent(file).status === "done") {
    if (preflight.mode !== "already-submitted" ||
        preflight.reviewSubmissionId !== readIntent(file).reviewSubmissionId) {
      throw new Error("Completed release intent does not match Apple's read-only receipt");
    }
    return preflight;
  }
  const result = await withIntentLock(args, home, async () => {
    const intent = writeIntent(args, home);
    const receipt = await run(args);
    completeIntent(intent, receipt);
    return receipt;
  });
  return result;
}

async function main() {
  const result = await executeReleaseIntent(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(async (error) => {
    console.error(`ios-upload-and-submit: ${error.message}`);
    process.exitCode = 1;
    if (process.argv.includes("--apply")) {
      await execFileAsync("osascript", ["-e",
        'display notification "Check the release command result" with title "Fundhub iOS release stopped"'],
      { timeout: 5_000 }).catch(() => {});
    }
  });
}
