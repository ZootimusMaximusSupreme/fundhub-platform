import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { REQUIRED_CI_JOBS } from "./release-control.mjs";
import { applySubmission, assertMainCi, assertProjectVersion, checkReceipt, parseArgs, readReceipt } from "./ios-release-handoff.mjs";
import { appleTool, assertIpaFields, buildIpa, findIpaInfoPath, parseArgs as parseUploadArgs,
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
    setProcessingState: (value) => { build.attributes.processingState = value; },
    setSubmitted: () => {
      visible = true;
      linked = { id: build.id, type: "builds" };
      version.attributes.appStoreState = "WAITING_FOR_REVIEW";
      version.attributes.releaseType = "AFTER_APPROVAL";
      submission = { id: "submission-id", type: "reviewSubmissions",
        attributes: { state: "WAITING_FOR_REVIEW", submittedDate: "2026-11-04T21:00:00Z" },
        relationships: { appStoreVersionForReview: { data: { id: version.id } } } };
      items = [{ id: "item-id", relationships: { appStoreVersion: { data: { id: version.id } } } }];
    } };
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
  await assert.rejects(() => assertMainCi(SHA, github), /Latest main tests run/);
  assert.equal(await assertMainCi(SHA, async ([endpoint]) => {
    const response = await github([endpoint]);
    if (endpoint.includes("/runs?")) response.workflow_runs = [{ ...response.workflow_runs[1], conclusion: "success" }];
    return response;
  }), 2);
});

test("final CI permits only an unchanged native tree on a newer all-green main", async () => {
  const newer = "b".repeat(40);
  const jobs = REQUIRED_CI_JOBS.map((name) => ({ name, status: "completed", conclusion: "success" }));
  let changedFiles = [{ filename: "src/other.mjs" }];
  const github = async ([endpoint]) => {
    if (endpoint.endsWith("/commits/main")) return { sha: newer };
    if (endpoint.includes("/compare/")) return { status: "ahead", merge_base_commit: { sha: SHA }, files: changedFiles };
    if (endpoint.includes("/runs?")) {
      const pinned = endpoint.includes(`head_sha=${SHA}`);
      return { workflow_runs: [{ id: pinned ? 1 : 2, head_sha: pinned ? SHA : newer,
        name: "tests", event: "push", head_branch: "main", status: "completed", conclusion: "success",
        head_repository: { full_name: "ZootimusMaximusSupreme/fundhub-platform" } }] };
    }
    if (endpoint.includes("/jobs?")) return { jobs };
    throw new Error(endpoint);
  };
  await assert.rejects(() => assertMainCi(SHA, github), /not current GitHub main/);
  assert.equal(await assertMainCi(SHA, github, { allowMainAdvance: true }), 2);
  changedFiles = [{ filename: "tools/fundhub-ios/Fundhub.swift" }];
  await assert.rejects(() => assertMainCi(SHA, github, { allowMainAdvance: true }), /native-unchanged/);
  changedFiles = Array.from({ length: 300 }, (_, i) => ({ filename: `src/other-${i}.mjs` }));
  await assert.rejects(() => assertMainCi(SHA, github, { allowMainAdvance: true }), /native-unchanged/);
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

test("archive and export run from the pinned checkout and produce the one IPA output", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-archive-test-"));
  const ipa = path.join(dir, "Fundhub.ipa");
  const calls = [];
  try {
    await buildIpa({ ...args, ipa }, { keyPath: "/tmp/AuthKey_TEST.p8", keyId: "TEST", issuerId: "ISSUER" },
      async (program, commandArgs, options) => {
        assert.equal(program, "xcodebuild");
        calls.push({ commandArgs, options });
        if (commandArgs[0] === "-exportArchive") {
          const exportPath = commandArgs[commandArgs.indexOf("-exportPath") + 1];
          fs.mkdirSync(exportPath);
          fs.writeFileSync(path.join(exportPath, "Fundhub.ipa"), "signed-test-artifact");
        }
        return { stdout: "" };
      });
    assert.equal(fs.readFileSync(ipa, "utf8"), "signed-test-artifact");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].commandArgs.at(-1), "archive");
    assert.equal(calls[1].commandArgs[0], "-exportArchive");
    assert.equal(calls[0].options.cwd, process.cwd());
    assert.equal(calls[1].options.cwd, process.cwd());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function uploadFixture(options = {}) {
  const source = `${"MARKETING_VERSION = 1.0.4; CURRENT_PROJECT_VERSION = 10; ".repeat(4)}PRODUCT_BUNDLE_IDENTIFIER = ai.fundhub.app;`;
  const apple = appleFixture({ uploaded: false, ...options });
  const calls = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-upload-test-"));
  const keyPath = path.join(dir, "AuthKey_TEST.p8");
  const ipa = path.join(dir, "Fundhub.ipa");
  fs.writeFileSync(keyPath, "test-only");
  const deps = { env: { ASC_KEY_ID: "TEST", ASC_ISSUER_ID: "ISSUER", ASC_KEY_PATH: keyPath },
    client: apple.client,
    command: async (program, commandArgs) => {
      assert.equal(program, "git");
      if (commandArgs[0] === "rev-parse") return { stdout: `${SHA}\n` };
      if (commandArgs[0] === "status") return { stdout: "" };
      if (commandArgs[0] === "show") return { stdout: source };
      throw new Error(`Unexpected git ${commandArgs[0]}`);
    },
    inspect: async () => ({ bundle: "ai.fundhub.app", version: "1.0.4", build: "10" }),
    ci: async () => { calls.push("ci"); return 123; },
    build: async () => { calls.push("build"); fs.writeFileSync(ipa, "test-only-ipa"); },
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

test("IPA output inside checkout is refused before archive", async () => {
  const fixture = uploadFixture();
  try {
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: path.join(process.cwd(), "Fundhub.ipa") }, fixture.deps), /outside the source checkout/);
    assert.deepEqual(fixture.calls, []);
  } finally { fixture.cleanup(); }
});

test("dirty or different source SHA and an unproven IPA stop before Apple writes", async () => {
  const fixture = uploadFixture();
  try {
    const dirty = { ...fixture.deps, command: async (program, commandArgs, options) =>
      commandArgs[0] === "status" ? { stdout: " M tools/fundhub-ios/Fundhub.swift" }
        : fixture.deps.command(program, commandArgs, options) };
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa }, dirty), /clean checkout/);
    const wrong = { ...fixture.deps, command: async (program, commandArgs, options) =>
      commandArgs[0] === "rev-parse" ? { stdout: `${"b".repeat(40)}\n` }
        : fixture.deps.command(program, commandArgs, options) };
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa }, wrong), /clean checkout/);
    fs.writeFileSync(fixture.ipa, "unproven");
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa }, fixture.deps), /IPA and pinned archive receipt/);
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
    assert.deepEqual(fixture.calls, ["ci", "build", "--validate-app", "--upload-app", "sleep", "ci"]);
    assert.equal(fixture.apple.writes.at(-1).endpoint, "/v1/reviewSubmissions/submission-id");
  } finally { fixture.cleanup(); }
});

test("a bad IPA or existing upload stops before upload and submission", async () => {
  const fixture = uploadFixture();
  try {
    const bad = { ...fixture.deps, inspect: async () => ({ bundle: "ai.fundhub.app", version: "1.0.4", build: "9" }) };
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa }, bad), /IPA bundle/);
    assert.deepEqual(fixture.calls, ["ci", "build"]);
    fs.rmSync(fixture.ipa);
    fixture.calls.length = 0;
    fixture.apple.markUploaded();
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa }, fixture.deps), /already uploaded/);
    assert.deepEqual(fixture.calls, ["ci"]);
  } finally { fixture.cleanup(); }
});

test("a different attached App Store build blocks archive and upload", async () => {
  const fixture = uploadFixture({ attached: "another-build" });
  try {
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa }, fixture.deps), /different build attached/);
    assert.deepEqual(fixture.calls, []);
    assert.deepEqual(fixture.apple.writes, []);
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
    assert.deepEqual(after.calls, ["build", "--validate-app", "--upload-app"]);
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

test("an uncertain upload never sends the same IPA twice", async () => {
  const fixture = uploadFixture();
  const uncertain = { ...fixture.deps, apple: async (toolArgs) => { fixture.calls.push(toolArgs[0]); } };
  try {
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa }, uncertain), /no review submission or duplicate upload/);
    assert.equal(fixture.calls.filter((call) => call === "--upload-app").length, 1);
    fixture.calls.length = 0;
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa }, uncertain), /no review submission or duplicate upload/);
    assert.equal(fixture.calls.includes("--upload-app"), false);
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
    assert.deepEqual(fixture.calls, ["ci"]);
  } finally { fixture.cleanup(); }
});

test("a ready archive marker cannot claim another process's submitted build", async () => {
  const fixture = uploadFixture();
  try {
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa },
      { ...fixture.deps, apple: async () => { throw new Error("validation stopped"); } }), /validation stopped/);
    fixture.apple.setSubmitted();
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa }, fixture.deps), /proven idempotent/);
    assert.deepEqual(fixture.apple.writes, []);
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
    await assert.rejects(() => runUploadAndSubmit({ ...args, ipa: fixture.ipa }, fixture.deps), /IPA bytes changed/);
    assert.deepEqual(fixture.calls, []);
  } finally { fixture.cleanup(); }
});
