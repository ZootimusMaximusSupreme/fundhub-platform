#!/usr/bin/env node
// One guarded command from an exported IPA through App Store review submission.
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { applySubmission, assertMainCi, assertProjectVersion, checkReceipt, findVersion, makeAppleClient,
  parseArgs as parseHandoffArgs, publicReceipt, readReceipt, readUploadedBuild } from "./ios-release-handoff.mjs";

const execFileAsync = promisify(execFile);
const APP_ID = "6823985032";
const BUNDLE_ID = "ai.fundhub.app";
const PROJECT = "tools/fundhub-ios/Fundhub.xcodeproj/project.pbxproj";
const POLL_ATTEMPTS = 60;
const POLL_MS = 30_000;
const MARKER_SUFFIX = ".fundhub-release.json";

export function parseArgs(argv) {
  const args = [...argv];
  const index = args.indexOf("--ipa");
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith("--")) {
    throw new Error("Pass the exact exported --ipa path");
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

function uploadMarker(ipa, args, digest) {
  const markerPath = `${ipa}${MARKER_SUFFIX}`;
  const expected = { schema: 1, sha: args.sha, version: args.version, build: args.build, ipaSha256: digest };
  const check = () => {
    if (!fs.existsSync(markerPath)) return false;
    let actual;
    try { actual = JSON.parse(fs.readFileSync(markerPath, "utf8")); } catch { throw new Error("IPA upload marker is unreadable"); }
    if (Object.keys(expected).some((key) => actual?.[key] !== expected[key])) {
      throw new Error("IPA upload marker does not match this source, version, build and IPA bytes");
    }
    return true;
  };
  return { path: markerPath, check, write: () => {
    if (!check()) {
      try { fs.writeFileSync(markerPath, JSON.stringify(expected) + "\n", { flag: "wx", mode: 0o600 }); }
      catch (error) { if (error.code !== "EEXIST") throw error; check(); }
    }
  } };
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
  inspect = inspectIpa, ci = assertMainCi, apple = appleTool } = {}) {
  const project = (await command("git", ["show", `${args.sha}:${PROJECT}`], { maxBuffer: 1_000_000 })).stdout;
  assertProjectVersion(project, args);
  assertIpaFields(await inspect(args.ipa, command), args);
  const marker = uploadMarker(args.ipa, args, await ipaHash(args.ipa));
  const marked = marker.check();
  let appVersion = await findVersion(client, args.version);
  let existing = await readUploadedBuild(client, args);
  if (appVersion && !["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW"].includes(appVersion.attributes?.appStoreState)) {
    if (!marked || !existing) throw new Error("Exact App Store version is not open for a new review submission");
    const completed = await readReceipt(client, args);
    if (!checkReceipt(completed, "AFTER_APPROVAL").submitted) {
      throw new Error("Exact App Store version is not an already-submitted release");
    }
    return { mode: "already-submitted", ...publicReceipt(completed, args) };
  }
  if (existing && !marked) throw new Error("Exact build is already uploaded without this IPA release marker; no automatic resume");
  const firstCiRun = await ci(args.sha);
  if (!args.apply) return { mode: "upload-dry-run", version: args.version, build: args.build,
    sha: args.sha, ipa: path.basename(args.ipa), releaseType: "AFTER_APPROVAL", ciRun: firstCiRun,
    createVersion: !appVersion, resumeUpload: Boolean(existing && marked),
    next: "Run the same command with --apply to create the version if needed, validate, upload, wait VALID and submit" };

  const keyId = String(env.ASC_KEY_ID || "").trim();
  const issuerId = String(env.ASC_ISSUER_ID || "").trim();
  const keyPath = String(env.ASC_KEY_PATH || "").trim();
  if (!keyId || !issuerId || !keyPath || path.basename(keyPath) !== `AuthKey_${keyId}.p8` ||
      !fs.statSync(keyPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("A matching ASC API key file is required for IPA upload");
  }
  const toolEnv = { version: args.version, build: args.build, keyId, issuerId, keyPath };
  if (!appVersion) {
    await client("POST", "/v1/appStoreVersions", { data: { type: "appStoreVersions",
      attributes: { platform: "IOS", versionString: args.version, releaseType: "AFTER_APPROVAL" },
      relationships: { app: { data: { type: "apps", id: APP_ID } } } } });
    appVersion = await findVersion(client, args.version);
    if (!appVersion) throw new Error("Apple did not return the newly created exact iOS version");
  }
  if (marked && !existing) {
    for (let attempt = 0; attempt < 10 && !existing; attempt++) {
      existing = await readUploadedBuild(client, args);
      if (!existing && attempt < 9) await sleep(POLL_MS);
    }
  }
  if (!existing) {
    await apple(["--validate-app", args.ipa], toolEnv, command);
    marker.write();
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
    throw new Error("Exact uploaded build did not become VALID within 30 minutes; no review submission was sent");
  }
  const finalCiRun = await ci(args.sha);
  const submitted = await applySubmission(client, args, receipt);
  return { mode: "upload-and-submit", ...publicReceipt(submitted, args, finalCiRun) };
}

async function main() {
  const result = await runUploadAndSubmit(parseArgs(process.argv.slice(2)));
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
