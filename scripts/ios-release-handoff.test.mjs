import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { REQUIRED_CI_JOBS } from "./release-control.mjs";
import { applySubmission, assertMainCi, assertProjectVersion, checkReceipt, parseArgs, readReceipt } from "./ios-release-handoff.mjs";
import { appleTool, assertIpaFields, findIpaInfoPath, parseArgs as parseUploadArgs,
  runUploadAndSubmit } from "./ios-upload-and-submit.mjs";

const SHA = "a".repeat(40);
const args = { version: "1.0.4", build: "10", sha: SHA, releaseType: "AFTER_APPROVAL", apply: true };

function appleFixture({ state = "PREPARE_FOR_SUBMISSION", processingState = "VALID", attached = null,
  releaseType = "MANUAL", submitted = false, uploaded = true, versionPresent = true } = {}) {
  const writes = [];
  const version = { id: "version-id", type: "appStoreVersions", attributes: {
    platform: "IOS", versionString: "1.0.4", appStoreState: state, releaseType } };
  let hasVersion = versionPresent;
  const build = { id: "build-id", type: "builds", attributes: { version: "10", processingState } };
  let visible = uploaded;
  let linked = attached ? { id: attached, type: "builds" } : null;
  let submission = submitted ? { id: "submission-id", type: "reviewSubmissions",
    attributes: { state: "WAITING_FOR_REVIEW", submittedDate: "2026-11-04T21:00:00Z" },
    relationships: { appStoreVersionForReview: { data: { id: version.id } } } } : null;
  let items = submitted ? [{ id: "item-id", relationships: { appStoreVersion: { data: { id: version.id } } } }] : [];
  const client = async (method, endpoint, body) => {
    if (method !== "GET") writes.push({ method, endpoint, body });
    if (method === "GET" && endpoint.includes("/appStoreVersions?")) return { data: hasVersion ? [version] : [] };
    if (method === "GET" && endpoint.includes("/builds?")) return { data: visible ? [build] : [] };
    if (method === "GET" && endpoint === "/v1/builds/build-id/preReleaseVersion") {
      return { data: { attributes: { platform: "IOS", version: "1.0.4" } } };
    }
    if (method === "GET" && endpoint === "/v1/appStoreVersions/version-id/build") return { data: linked };
    if (method === "GET" && endpoint.includes("/reviewSubmissions?")) return { data: submission ? [submission] : [] };
    if (method === "GET" && endpoint === "/v1/reviewSubmissions/submission-id/items?limit=50") return { data: items };
    if (method === "POST" && endpoint === "/v1/appStoreVersions") {
      assert.equal(body.data.attributes.versionString, "1.0.4");
      assert.equal(body.data.attributes.releaseType, "AFTER_APPROVAL");
      hasVersion = true;
      version.attributes.releaseType = "AFTER_APPROVAL";
      return { data: version };
    }
    if (method === "PATCH" && endpoint === "/v1/appStoreVersions/version-id/relationships/build") {
      linked = body.data;
      return { data: linked };
    }
    if (method === "PATCH" && endpoint === "/v1/appStoreVersions/version-id") {
      version.attributes.releaseType = body.data.attributes.releaseType;
      return { data: version };
    }
    if (method === "POST" && endpoint === "/v1/reviewSubmissions") {
      submission = { id: "submission-id", type: "reviewSubmissions",
        attributes: { state: "READY_FOR_REVIEW" },
        relationships: { appStoreVersionForReview: { data: { id: version.id } } } };
      return { data: submission };
    }
    if (method === "POST" && endpoint === "/v1/reviewSubmissionItems") {
      items = [{ id: "item-id", relationships: { appStoreVersion: { data: { id: version.id } } } }];
      return { data: items[0] };
    }
    if (method === "PATCH" && endpoint === "/v1/reviewSubmissions/submission-id") {
      submission.attributes.state = "WAITING_FOR_REVIEW";
      submission.attributes.submittedDate = "2026-11-04T21:00:00Z";
      version.attributes.appStoreState = "WAITING_FOR_REVIEW";
      return { data: submission };
    }
    throw new Error(`Unexpected ${method} ${endpoint}`);
  };
  return { client, writes, markUploaded: () => { visible = true; },
    setProcessingState: (value) => { build.attributes.processingState = value; } };
}

test("explicit version, build, SHA and release intent are required for apply", () => {
  assert.equal(parseArgs(["--version", "1.0.4", "--build", "10", "--sha", SHA]).apply, false);
  assert.throws(() => parseArgs(["--version", "1.0.4", "--build", "10", "--sha", SHA, "--apply"]), /release-type/);
  assert.throws(() => parseArgs(["--version", "1.0.4", "--build", "10", "--sha", SHA, "--release-type", "AFTER_APPROVAL"]), /requires --apply/);
});

test("pinned source must name the same app and widget version and build", () => {
  const source = `${"MARKETING_VERSION = 1.0.4; CURRENT_PROJECT_VERSION = 10; ".repeat(4)}PRODUCT_BUNDLE_IDENTIFIER = ai.fundhub.app;`;
  assert.doesNotThrow(() => assertProjectVersion(source, args));
  assert.throws(() => assertProjectVersion(source.replace("CURRENT_PROJECT_VERSION = 10", "CURRENT_PROJECT_VERSION = 11"), args), /app and widget/);
});

test("status reads exact iOS version and build without writes", async () => {
  const { client, writes } = appleFixture();
  const receipt = await readReceipt(client, args);
  assert.equal(receipt.uploaded.id, "build-id");
  assert.equal(receipt.attached, null);
  assert.equal(checkReceipt(receipt).ready, true);
  assert.deepEqual(writes, []);
});

test("apply attaches the exact VALID build, sets release intent, submits and reads back", async () => {
  const { client, writes } = appleFixture();
  const receipt = await applySubmission(client, args, await readReceipt(client, args));
  assert.equal(receipt.attached.id, "build-id");
  assert.equal(receipt.appVersion.attributes.releaseType, "AFTER_APPROVAL");
  assert.equal(receipt.appVersion.attributes.appStoreState, "WAITING_FOR_REVIEW");
  assert.equal(receipt.submission.id, "submission-id");
  assert.deepEqual(writes.map((w) => `${w.method} ${w.endpoint}`), [
    "PATCH /v1/appStoreVersions/version-id/relationships/build",
    "PATCH /v1/appStoreVersions/version-id",
    "POST /v1/reviewSubmissions",
    "POST /v1/reviewSubmissionItems",
    "PATCH /v1/reviewSubmissions/submission-id",
  ]);
});

test("already submitted exact build and intent causes zero Apple writes", async () => {
  const { client, writes } = appleFixture({ state: "WAITING_FOR_REVIEW", attached: "build-id",
    releaseType: "AFTER_APPROVAL", submitted: true });
  const receipt = await applySubmission(client, args, await readReceipt(client, args));
  assert.equal(receipt.submission.id, "submission-id");
  assert.deepEqual(writes, []);
});

test("unassigned review draft stops apply before any Apple write", async () => {
  const { client, writes } = appleFixture();
  const guarded = async (method, endpoint, body) => endpoint.includes("/reviewSubmissions?")
    ? { data: [{ id: "other-draft", attributes: { state: "READY_FOR_REVIEW" }, relationships: {} }] }
    : client(method, endpoint, body);
  await assert.rejects(async () => applySubmission(guarded, args, await readReceipt(guarded, args)), /unassigned/);
  assert.deepEqual(writes, []);
});

test("invalid or conflicting builds and submitted release intent fail closed", async () => {
  const invalid = appleFixture({ processingState: "PROCESSING" });
  await assert.rejects(async () => applySubmission(invalid.client, args, await readReceipt(invalid.client, args)), /VALID/);
  const conflict = appleFixture({ attached: "other-build" });
  assert.throws(() => checkReceipt({ appVersion: { attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } },
    uploaded: { id: "build-id", attributes: { processingState: "VALID" } },
    attached: { id: "other-build" } }), /different build/);
  assert.deepEqual(conflict.writes, []);
  const submitted = appleFixture({ state: "WAITING_FOR_REVIEW", attached: "build-id", submitted: true });
  await assert.rejects(async () => applySubmission(submitted.client, args, await readReceipt(submitted.client, args)), /different releaseType/);
  assert.deepEqual(submitted.writes, []);
});

test("latest exact-main run must have all 14 successful named jobs", async () => {
  const successfulJobs = REQUIRED_CI_JOBS.map((name) => ({ name, status: "completed", conclusion: "success" }));
  const github = async ([endpoint]) => {
    if (endpoint.endsWith("/commits/main")) return { sha: SHA };
    if (endpoint.includes("/runs?")) return { workflow_runs: [
      { id: 1, head_sha: SHA, name: "tests", event: "push", head_branch: "main",
        head_repository: { full_name: "ZootimusMaximusSupreme/fundhub-platform" }, status: "completed", conclusion: "success" },
      { id: 2, head_sha: SHA, name: "tests", event: "push", head_branch: "main",
        head_repository: { full_name: "ZootimusMaximusSupreme/fundhub-platform" }, status: "completed", conclusion: "failure" },
    ] };
    if (endpoint.includes("/jobs?")) return { jobs: successfulJobs };
    throw new Error(endpoint);
  };
  await assert.rejects(() => assertMainCi(SHA, github), /Latest exact-main tests run/);
  assert.equal(await assertMainCi(SHA, async ([endpoint]) => {
    const response = await github([endpoint]);
    if (endpoint.includes("/runs?")) response.workflow_runs = [{ ...response.workflow_runs[1], conclusion: "success" }];
    return response;
  }), 2);
});

test("upload command is explicit and IPA metadata must match exactly", () => {
  const parsed = parseUploadArgs(["--version", "1.0.4", "--build", "10", "--sha", SHA,
    "--ipa", "/tmp/Fundhub.ipa", "--apply"]);
  assert.equal(parsed.releaseType, "AFTER_APPROVAL");
  assert.equal(parsed.apply, true);
  assert.throws(() => parseUploadArgs(["--version", "1.0.4", "--build", "10", "--sha", SHA]), /--ipa/);
  assert.equal(findIpaInfoPath("Payload/Fundhub.app/Info.plist\nPayload/Widget.appex/Info.plist\n"),
    "Payload/Fundhub.app/Info.plist");
  assert.doesNotThrow(() => assertIpaFields({ bundle: "ai.fundhub.app", version: "1.0.4", build: "10" }, args));
  assert.throws(() => assertIpaFields({ bundle: "ai.fundhub.app", version: "1.0.4", build: "9" }, args), /IPA bundle/);
});

test("altool receives Apple's validate and upload syntax with a private key directory", async () => {
  const seen = [];
  const env = { version: "1.0.4", build: "10", keyId: "TEST", issuerId: "ISSUER",
    keyPath: "/private/tmp/keys/AuthKey_TEST.p8" };
  const command = async (program, commandArgs, options) => {
    seen.push({ program, commandArgs, options });
    return { stdout: "{}" };
  };
  await appleTool(["--validate-app", "/tmp/Fundhub.ipa"], env, command);
  await appleTool(["--upload-app", "-f", "/tmp/Fundhub.ipa", "--wait"], env, command);
  assert.deepEqual(seen.map(({ commandArgs }) => commandArgs.slice(0, 5)), [
    ["altool", "--validate-app", "/tmp/Fundhub.ipa", "--platform", "ios"],
    ["altool", "--upload-app", "-f", "/tmp/Fundhub.ipa", "--wait"],
  ]);
  assert.equal(seen[0].options.env.API_PRIVATE_KEYS_DIR, "/private/tmp/keys");
  assert.equal(seen[0].commandArgs.includes("--api-key"), true);
});

function uploadFixture(options = {}) {
  const source = `${"MARKETING_VERSION = 1.0.4; CURRENT_PROJECT_VERSION = 10; ".repeat(4)}PRODUCT_BUNDLE_IDENTIFIER = ai.fundhub.app;`;
  const apple = appleFixture({ uploaded: false, ...options });
  const calls = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-upload-test-"));
  const keyPath = path.join(dir, "AuthKey_TEST.p8");
  const ipa = path.join(dir, "Fundhub.ipa");
  fs.writeFileSync(keyPath, "test-only");
  fs.writeFileSync(ipa, "test-only-ipa");
  const deps = { env: { ASC_KEY_ID: "TEST", ASC_ISSUER_ID: "ISSUER", ASC_KEY_PATH: keyPath },
    client: apple.client,
    command: async (program) => {
      assert.equal(program, "git");
      return { stdout: source };
    },
    inspect: async () => ({ bundle: "ai.fundhub.app", version: "1.0.4", build: "10" }),
    ci: async () => { calls.push("ci"); return 123; },
    apple: async (toolArgs) => { calls.push(toolArgs[0]); if (toolArgs[0] === "--upload-app") apple.markUploaded(); },
    sleep: async () => { calls.push("sleep"); apple.setProcessingState("VALID"); } };
  return { apple, calls, deps, ipa, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("upload dry run does no Apple writes or upload", async () => {
  const fixture = uploadFixture();
  try {
    const result = await runUploadAndSubmit({ ...args, apply: false, ipa: fixture.ipa }, fixture.deps);
    assert.equal(result.mode, "upload-dry-run");
    assert.deepEqual(fixture.calls, ["ci"]);
    assert.deepEqual(fixture.apple.writes, []);
  } finally { fixture.cleanup(); }
});

test("one apply validates, uploads, waits VALID, rechecks CI and submits AFTER_APPROVAL", async () => {
  const fixture = uploadFixture();
  fixture.apple.setProcessingState("PROCESSING");
  try {
    const result = await runUploadAndSubmit({ ...args, ipa: fixture.ipa }, fixture.deps);
    assert.equal(result.mode, "upload-and-submit");
    assert.equal(result.appStoreState, "WAITING_FOR_REVIEW");
    assert.equal(result.releaseType, "AFTER_APPROVAL");
    assert.deepEqual(fixture.calls, ["ci", "--validate-app", "--upload-app", "sleep", "ci"]);
    assert.equal(fixture.apple.writes.at(-1).endpoint, "/v1/reviewSubmissions/submission-id");
  } finally { fixture.cleanup(); }
});

test("a bad IPA or existing upload stops before upload and submission", async () => {
  const fixture = uploadFixture();
  try {
    const bad = { ...fixture.deps, inspect: async () => ({ bundle: "ai.fundhub.app", version: "1.0.4", build: "9" }) };
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa }, bad), /IPA bundle/);
    assert.deepEqual(fixture.calls, []);
    fixture.apple.markUploaded();
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa }, fixture.deps), /already uploaded/);
    assert.deepEqual(fixture.calls, []);
  } finally { fixture.cleanup(); }
});

test("CI failure before upload blocks altool, and CI change after upload blocks submission", async () => {
  const before = uploadFixture();
  try {
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: before.ipa },
      { ...before.deps, ci: async () => { throw new Error("main CI failed"); } }), /main CI failed/);
    assert.deepEqual(before.calls, []);
    assert.deepEqual(before.apple.writes, []);
  } finally { before.cleanup(); }
  const after = uploadFixture();
  try {
    let checks = 0;
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: after.ipa },
      { ...after.deps, ci: async () => { if (++checks === 2) throw new Error("main moved"); return 123; } }), /main moved/);
    assert.deepEqual(after.calls, ["--validate-app", "--upload-app"]);
    assert.deepEqual(after.apple.writes, []);
  } finally { after.cleanup(); }
});

test("an invalid processed build fails without a review submission", async () => {
  const fixture = uploadFixture();
  fixture.apple.setProcessingState("INVALID");
  try {
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa }, fixture.deps), /processing state is INVALID/);
    assert.deepEqual(fixture.apple.writes, []);
  } finally { fixture.cleanup(); }
});

test("the release command creates only the exact missing iOS version before upload", async () => {
  const fixture = uploadFixture({ versionPresent: false });
  try {
    const dry = await runUploadAndSubmit({ ...args, apply: false, ipa: fixture.ipa }, fixture.deps);
    assert.equal(dry.createVersion, true);
    assert.deepEqual(fixture.apple.writes, []);
    const submitted = await runUploadAndSubmit({ ...args, ipa: fixture.ipa }, fixture.deps);
    assert.equal(submitted.appStoreState, "WAITING_FOR_REVIEW");
    assert.equal(fixture.apple.writes[0].endpoint, "/v1/appStoreVersions");
  } finally { fixture.cleanup(); }
});

test("a matching IPA marker resumes an upload without sending the build twice", async () => {
  const fixture = uploadFixture();
  let checks = 0;
  try {
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa },
      { ...fixture.deps, ci: async () => { if (++checks === 2) throw new Error("main moved"); return 123; } }), /main moved/);
    assert.equal(fs.existsSync(`${fixture.ipa}.fundhub-release.json`), true);
    fixture.calls.length = 0;
    const receipt = await runUploadAndSubmit({ ...args, ipa: fixture.ipa }, fixture.deps);
    assert.equal(receipt.appStoreState, "WAITING_FOR_REVIEW");
    assert.deepEqual(fixture.calls, ["ci", "ci"]);
  } finally { fixture.cleanup(); }
});

test("a matching already-submitted release returns the Apple receipt without another write", async () => {
  const fixture = uploadFixture();
  try {
    await runUploadAndSubmit({ ...args, ipa: fixture.ipa }, fixture.deps);
    const writeCount = fixture.apple.writes.length;
    fixture.calls.length = 0;
    const result = await runUploadAndSubmit({ ...args, ipa: fixture.ipa }, fixture.deps);
    assert.equal(result.mode, "already-submitted");
    assert.equal(result.appStoreState, "WAITING_FOR_REVIEW");
    assert.equal(result.releaseType, "AFTER_APPROVAL");
    assert.equal(fixture.apple.writes.length, writeCount);
    assert.deepEqual(fixture.calls, []);
  } finally { fixture.cleanup(); }
});

test("a changed IPA cannot use an earlier upload marker", async () => {
  const fixture = uploadFixture();
  let checks = 0;
  try {
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa },
      { ...fixture.deps, ci: async () => { if (++checks === 2) throw new Error("main moved"); return 123; } }), /main moved/);
    fs.appendFileSync(fixture.ipa, "changed");
    fixture.calls.length = 0;
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa }, fixture.deps), /marker does not match/);
    assert.deepEqual(fixture.calls, []);
  } finally { fixture.cleanup(); }
});
