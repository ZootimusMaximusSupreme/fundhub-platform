import assert from "node:assert/strict";
import test from "node:test";
import { REQUIRED_CI_JOBS } from "./release-control.mjs";
import { applySubmission, assertMainCi, assertProjectVersion, checkReceipt, parseArgs, readReceipt } from "./ios-release-handoff.mjs";

const SHA = "a".repeat(40);
const args = { version: "1.0.4", build: "10", sha: SHA, releaseType: "AFTER_APPROVAL", apply: true };

function appleFixture({ state = "PREPARE_FOR_SUBMISSION", processingState = "VALID", attached = null,
  releaseType = "MANUAL", submitted = false } = {}) {
  const writes = [];
  const version = { id: "version-id", type: "appStoreVersions", attributes: {
    platform: "IOS", versionString: "1.0.4", appStoreState: state, releaseType } };
  const build = { id: "build-id", type: "builds", attributes: { version: "10", processingState } };
  let linked = attached ? { id: attached, type: "builds" } : null;
  let submission = submitted ? { id: "submission-id", type: "reviewSubmissions",
    attributes: { state: "WAITING_FOR_REVIEW", submittedDate: "2026-11-04T21:00:00Z" },
    relationships: { appStoreVersionForReview: { data: { id: version.id } } } } : null;
  let items = submitted ? [{ id: "item-id", relationships: { appStoreVersion: { data: { id: version.id } } } }] : [];
  const client = async (method, endpoint, body) => {
    if (method !== "GET") writes.push({ method, endpoint, body });
    if (method === "GET" && endpoint.includes("/appStoreVersions?")) return { data: [version] };
    if (method === "GET" && endpoint.includes("/builds?")) return { data: [build] };
    if (method === "GET" && endpoint === "/v1/builds/build-id/preReleaseVersion") {
      return { data: { attributes: { platform: "IOS", version: "1.0.4" } } };
    }
    if (method === "GET" && endpoint === "/v1/appStoreVersions/version-id/build") return { data: linked };
    if (method === "GET" && endpoint.includes("/reviewSubmissions?")) return { data: submission ? [submission] : [] };
    if (method === "GET" && endpoint === "/v1/reviewSubmissions/submission-id/items?limit=50") return { data: items };
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
  return { client, writes };
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
