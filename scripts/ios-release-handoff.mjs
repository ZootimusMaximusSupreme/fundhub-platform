#!/usr/bin/env node
// Fundhub iOS App Store handoff. Read-only by default; --apply submits one exact build.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkRequiredJobs } from "./release-control.mjs";

const execFileAsync = promisify(execFile);
const REPO = "ZootimusMaximusSupreme/fundhub-platform";
const APP_ID = "6823985032";
const PROJECT = "tools/fundhub-ios/Fundhub.xcodeproj/project.pbxproj";
const API = "https://api.appstoreconnect.apple.com";
const REVIEWED = new Set(["WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_DEVELOPER_RELEASE", "READY_FOR_SALE"]);

export function parseArgs(argv) {
  const out = { apply: false, version: "", build: "", sha: "", releaseType: "" };
  const args = [...argv];
  while (args.length) {
    const arg = args.shift();
    if (arg === "--apply") out.apply = true;
    else if (arg === "--version") out.version = args.shift() || "";
    else if (arg === "--build") out.build = args.shift() || "";
    else if (arg === "--sha") out.sha = args.shift() || "";
    else if (arg === "--release-type") out.releaseType = args.shift() || "";
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(out.version)) throw new Error("Pass an exact --version such as 1.0.4");
  if (!/^[1-9]\d*$/.test(out.build)) throw new Error("Pass an exact positive --build");
  if (!/^[a-f0-9]{40}$/.test(out.sha)) throw new Error("Pass the exact 40-character main --sha");
  if (out.apply && !["AFTER_APPROVAL", "MANUAL"].includes(out.releaseType)) {
    throw new Error("--apply requires --release-type AFTER_APPROVAL or MANUAL");
  }
  if (!out.apply && out.releaseType) throw new Error("--release-type requires --apply");
  return out;
}

export function assertProjectVersion(source, { version, build }) {
  const versions = [...source.matchAll(/\bMARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
  const builds = [...source.matchAll(/\bCURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1]);
  if (versions.length < 4 || builds.length < 4 ||
      versions.some((v) => v !== version) || builds.some((v) => v !== build) ||
      !source.includes("PRODUCT_BUNDLE_IDENTIFIER = ai.fundhub.app;")) {
    throw new Error(`Pinned source must set Fundhub app and widget to ${version} build ${build}`);
  }
}

export function makeAppleClient(env, fetchImpl = fetch) {
  const keyId = String(env.ASC_KEY_ID || "").trim();
  const issuerId = String(env.ASC_ISSUER_ID || "").trim();
  const keyPath = String(env.ASC_KEY_PATH || "").trim();
  if (!keyId || !issuerId || !keyPath) throw new Error("ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH are required");
  const privateKey = fs.readFileSync(keyPath, "utf8");
  const token = () => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: issuerId, iat: now, exp: now + 600,
      aud: "appstoreconnect-v1" })).toString("base64url");
    const data = `${header}.${payload}`;
    const sig = crypto.sign("sha256", Buffer.from(data), { key: privateKey, dsaEncoding: "ieee-p1363" });
    return `${data}.${sig.toString("base64url")}`;
  };
  return async (method, endpoint, body) => {
    const url = new URL(endpoint, API);
    if (url.origin !== API) throw new Error("App Store Connect pagination left the Apple API");
    const response = await fetchImpl(url, { method, headers: { authorization: `Bearer ${token()}`,
      accept: "application/json", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
    const json = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const codes = (json?.errors || []).map((e) => e.code || e.title).filter(Boolean).slice(0, 3);
      throw new Error(`App Store Connect ${method} ${url.pathname} returned ${response.status}${codes.length ? `: ${codes.join(", ")}` : ""}`);
    }
    return json;
  };
}

async function list(client, endpoint) {
  const rows = [];
  let next = endpoint;
  for (let page = 0; next && page < 10; page++) {
    const result = await client("GET", next);
    rows.push(...(result?.data || []));
    next = result?.links?.next || null;
  }
  if (next) throw new Error("App Store Connect list exceeded ten pages");
  return rows;
}

export async function findVersion(client, version) {
  const versions = await list(client, `/v1/apps/${APP_ID}/appStoreVersions?limit=50`);
  const matches = versions.filter((v) => v.attributes?.platform === "IOS" && v.attributes?.versionString === version);
  if (matches.length > 1) throw new Error(`Expected at most one iOS ${version} App Store version; found ${matches.length}`);
  return matches[0] || null;
}

export async function readVersion(client, version) {
  const found = await findVersion(client, version);
  if (!found) throw new Error(`Expected one existing iOS ${version} App Store version; found 0`);
  return found;
}

export async function readUploadedBuild(client, { version, build }) {
  const builds = await list(client, `/v1/apps/${APP_ID}/builds?limit=200`);
  const candidates = builds.filter((b) => b.attributes?.version === build);
  const matching = [];
  for (const candidate of candidates) {
    const pre = await client("GET", `/v1/builds/${candidate.id}/preReleaseVersion`);
    if (pre?.data?.attributes?.platform === "IOS" && pre.data.attributes.version === version) matching.push(candidate);
  }
  if (matching.length > 1) throw new Error(`Expected at most one iOS ${version} build ${build} upload; found ${matching.length}`);
  return matching[0] || null;
}

export async function readReceipt(client, args) {
  const appVersion = await readVersion(client, args.version);
  const uploaded = await readUploadedBuild(client, args);
  if (!uploaded) throw new Error(`Exact iOS ${args.version} build ${args.build} upload is not visible yet`);
  const attached = await client("GET", `/v1/appStoreVersions/${appVersion.id}/build`);
  const submissions = await list(client, `/v1/apps/${APP_ID}/reviewSubmissions?limit=50&include=appStoreVersionForReview`);
  const submission = submissions.filter((s) => s.relationships?.appStoreVersionForReview?.data?.id === appVersion.id)
    .sort((a, b) => String(a.attributes?.submittedDate || "").localeCompare(String(b.attributes?.submittedDate || ""))).at(-1) || null;
  const unassignedDrafts = submissions.filter((s) => !s.attributes?.submittedDate &&
    !s.relationships?.appStoreVersionForReview?.data?.id);
  return { appVersion, uploaded, attached: attached?.data || null, submission, unassignedDrafts };
}

export function checkReceipt(receipt, releaseType) {
  const { appVersion, uploaded, attached } = receipt;
  if (uploaded.attributes?.processingState !== "VALID") throw new Error("Exact uploaded build is not VALID yet");
  if (attached && attached.id !== uploaded.id) throw new Error("App Store version has a different build attached");
  const state = appVersion.attributes?.appStoreState;
  if (!new Set(["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW", ...REVIEWED]).has(state)) {
    throw new Error(`App Store version state ${state || "unknown"} is not a safe submission state`);
  }
  if (REVIEWED.has(state) && (attached?.id !== uploaded.id || !receipt.submission)) {
    throw new Error("Submitted version lacks the exact build or review submission receipt");
  }
  if (releaseType && REVIEWED.has(state) && appVersion.attributes?.releaseType !== releaseType) {
    throw new Error("Already submitted version has a different releaseType; no automatic change");
  }
  return { state, ready: !REVIEWED.has(state), submitted: REVIEWED.has(state) };
}

async function gh(args) {
  const result = await execFileAsync("gh", ["api", ...args], { maxBuffer: 4_000_000 });
  return JSON.parse(result.stdout);
}

export async function assertMainCi(sha, github = gh, { allowMainAdvance = false } = {}) {
  const main = await github([`repos/${REPO}/commits/main`]);
  if (main.sha !== sha) {
    if (!allowMainAdvance) throw new Error("Pinned SHA is not current GitHub main");
    const compared = await github([`repos/${REPO}/compare/${sha}...${main.sha}`]);
    if (compared.status !== "ahead" || compared.merge_base_commit?.sha !== sha ||
        !Array.isArray(compared.files) || compared.files.length >= 300 ||
        compared.files.some((file) => [file.filename, file.previous_filename]
          .some((name) => String(name || "").startsWith("tools/fundhub-ios/")))) {
      throw new Error("Current main is not a proven native-unchanged descendant of pinned SHA");
    }
  }
  const verifiedRun = async (head) => {
    const runs = await github([`repos/${REPO}/actions/workflows/tests.yml/runs?head_sha=${head}&branch=main&event=push&per_page=30`]);
    const run = (runs.workflow_runs || []).filter((r) => r.head_sha === head && r.name === "tests" &&
      r.event === "push" && r.head_branch === "main" && r.head_repository?.full_name === REPO)
      .sort((a, b) => Number(b.id) - Number(a.id))[0];
    if (!run || run.status !== "completed" || run.conclusion !== "success") {
      throw new Error(`Latest main tests run for ${head} did not pass`);
    }
    const jobs = await github([`repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100`]);
    const verdict = checkRequiredJobs(jobs.jobs || []);
    if (!verdict.ok) throw new Error(verdict.reason);
    return run.id;
  };
  const pinnedRun = await verifiedRun(sha);
  return main.sha === sha ? pinnedRun : (await verifiedRun(main.sha));
}

const link = (type, id) => ({ data: { type, id } });

export async function applySubmission(client, args, receipt) {
  const checked = checkReceipt(receipt, args.releaseType);
  const versionId = receipt.appVersion.id;
  if (checked.submitted) {
    return receipt;
  }
  if (!receipt.submission && receipt.unassignedDrafts?.length) {
    throw new Error("An unassigned App Store review draft exists; inspect it before applying");
  }
  if (!receipt.attached) {
    await client("PATCH", `/v1/appStoreVersions/${versionId}/relationships/build`,
      { data: { type: "builds", id: receipt.uploaded.id } });
  }
  if (receipt.appVersion.attributes?.releaseType !== args.releaseType) {
    await client("PATCH", `/v1/appStoreVersions/${versionId}`,
      { data: { type: "appStoreVersions", id: versionId, attributes: { releaseType: args.releaseType } } });
  }
  let submission = receipt.submission;
  if (!submission) {
    const created = await client("POST", "/v1/reviewSubmissions", { data: { type: "reviewSubmissions",
      relationships: { app: link("apps", APP_ID) } } });
    submission = created?.data;
  }
  if (!submission?.id) throw new Error("App Store Connect did not return a review submission ID");
  const items = await list(client, `/v1/reviewSubmissions/${submission.id}/items?limit=50`);
  const ours = items.filter((item) => item.relationships?.appStoreVersion?.data?.id === versionId);
  if (items.length !== ours.length) throw new Error("Review submission contains other items; inspect it before applying");
  if (ours.length > 1) throw new Error("Review submission contains duplicate version items");
  if (!ours.length) await client("POST", "/v1/reviewSubmissionItems", { data: { type: "reviewSubmissionItems",
    relationships: { reviewSubmission: link("reviewSubmissions", submission.id),
      appStoreVersion: link("appStoreVersions", versionId) } } });
  await client("PATCH", `/v1/reviewSubmissions/${submission.id}`, { data: { type: "reviewSubmissions",
    id: submission.id, attributes: { submitted: true } } });
  const after = await readReceipt(client, args);
  const state = after.appVersion.attributes?.appStoreState;
  if (!REVIEWED.has(state) || after.attached?.id !== after.uploaded.id ||
      after.appVersion.attributes?.releaseType !== args.releaseType || !after.submission) {
    throw new Error("Apple write finished, but exact build/submission readback is incomplete");
  }
  return after;
}

export function publicReceipt(receipt, args, ciRun = null) {
  return { appId: APP_ID, sha: args.sha, version: args.version, build: args.build,
    buildId: receipt.uploaded.id, processingState: receipt.uploaded.attributes?.processingState,
    attachedBuildId: receipt.attached?.id || null,
    appStoreState: receipt.appVersion.attributes?.appStoreState,
    releaseType: receipt.appVersion.attributes?.releaseType,
    reviewSubmissionId: receipt.submission?.id || null,
    reviewState: receipt.submission?.attributes?.state || null,
    submittedDate: receipt.submission?.attributes?.submittedDate || null,
    ciRun };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = (await execFileAsync("git", ["show", `${args.sha}:${PROJECT}`], { maxBuffer: 1_000_000 })).stdout;
  assertProjectVersion(project, args);
  const client = makeAppleClient(process.env);
  const before = await readReceipt(client, args);
  const checked = checkReceipt(before, args.apply ? args.releaseType : "");
  if (!args.apply) {
    console.log(JSON.stringify({ mode: "status", ...publicReceipt(before, args), next: checked.submitted ? "already submitted" : "ready for explicit --apply after exact-main CI" }));
    return;
  }
  const ciRun = await assertMainCi(args.sha);
  const after = await applySubmission(client, args, before);
  console.log(JSON.stringify({ mode: "apply", ...publicReceipt(after, args, ciRun) }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((err) => { console.error(`ios-release-handoff: ${err.message}`); process.exitCode = 1; });
}
