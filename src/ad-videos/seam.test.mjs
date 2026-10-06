// The seam between the table, the store, the pipeline and the sweeper.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS — READ THIS BEFORE DELETING ANY OF IT
//
// The ad video pipeline was built by three agents at the same time, in three
// worktrees, and every one of them reported green. Every one of them WAS green.
// The pipeline still could not have moved a single video, for two reasons that
// no test in any of the three could see, because each defect lived in the gap
// BETWEEN two files that were never imported into the same process:
//
//   1. The workers wrote fourteen columns the table did not have. `exported_at`
//      was one of them — the guard that stops a take being re-exported every
//      five minutes at Submagic's per-minute rate.
//
//   2. The sweeper probed the store for six functions by name
//      (lastRawSeenAt, recordRawTake, listPending, patch, candidateScripts)
//      and the store, built to a different vocabulary, offered none of them.
//      The sweeper handled that politely — `{ ok: false, error: "the store does
//      not offer listPending/patch" }` — so it did not crash. It did nothing at
//      all, on every pass, silently.
//
// Both were fixed on 2026-09-22. These tests are what stops them coming back.
// They need NO DATABASE: they read the migrations as text and the modules as
// modules, which is the same trick src/lib/no-unfenced-transmit.test.mjs uses,
// and is the only kind of proof available on a machine with no Postgres.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PENDING_STATES } from "./store.mjs";
import * as store from "./store.mjs";
import { NEXT_STEP, STATES as PIPELINE_STATES } from "./pipeline.mjs";
import { STATES as STORE_STATES } from "./states.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const MIGRATIONS = path.join(REPO, "db", "migrations");

/* Every column ad_videos actually has, read off the real SQL rather than off a
   list somebody keeps up to date by hand. 389 creates the table; 390 adds the
   marks each worker step leaves behind. */
function adVideoColumns() {
  const cols = new Set();

  const create = fs.readFileSync(path.join(MIGRATIONS, "389_ad_videos.sql"), "utf8");
  const body = create.slice(
    create.indexOf("CREATE TABLE IF NOT EXISTS ad_videos"),
    create.indexOf("\n);", create.indexOf("CREATE TABLE IF NOT EXISTS ad_videos"))
  );
  for (const line of body.split("\n")) {
    const m = /^ {2}([a-z_][a-z0-9_]*) +[a-z]/.exec(line);
    if (m) cols.add(m[1]);
  }

  for (const file of fs.readdirSync(MIGRATIONS)) {
    if (!/^39[0-9]_.*\.sql$/.test(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    if (!/ALTER TABLE ad_videos/.test(sql)) continue;
    for (const m of sql.matchAll(/ADD COLUMN IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/g)) {
      cols.add(m[1]);
    }
  }
  return cols;
}

/* Every column name the pipeline reads off a row or writes into a patch.
   Source-scanned on purpose: a hand-kept list is exactly the thing that was
   wrong in the first place. */
function pipelineColumns() {
  const src = fs.readFileSync(path.join(HERE, "pipeline.mjs"), "utf8");
  const names = new Set();

  // row.<column>
  for (const m of src.matchAll(/\brow\.([a-z_][a-z0-9_]*)/g)) names.add(m[1]);

  // Keys of the objects handed to ok(...) and to patch: { ... }
  for (const m of src.matchAll(/(?:return ok\(\{|patch: \{|const patch = \{)([\s\S]*?)\n\s*\}/g)) {
    for (const k of m[1].matchAll(/^\s*([a-z_][a-z0-9_]*):/gm)) names.add(k[1]);
  }
  return names;
}

/* Columns the pipeline legitimately reads that are NOT on ad_videos. Each one
   is named here with its source, so that "not a column" stays a deliberate
   decision instead of a thing nobody noticed. */
const NOT_TABLE_COLUMNS = new Set([
  // Joined from ad_scripts by store.listPending — the words for Paul's brief.
  "title", "hook_text", "script_body",
  // Read by buildBrief but NOT held anywhere yet. See the note in the test.
  "headline", "primary_text", "language",
  // Report fields on a step's verdict, never written to the row.
  "retryable", "skipped", "note", "error", "ok", "step"
]);

describe("the workers and the table agree on what a column is", () => {
  test("every column the pipeline writes exists on ad_videos", () => {
    const table = adVideoColumns();
    const used = pipelineColumns();

    // Sanity: the scan found a real table, not an empty set that passes anything.
    assert.ok(table.size > 30, `only found ${table.size} columns — the migration scan is broken`);
    assert.ok(used.size > 15, `only found ${used.size} pipeline fields — the source scan is broken`);
    assert.ok(table.has("exported_at"), "exported_at is the guard that stops a second billed render");

    const missing = [...used].filter((c) => !table.has(c) && !NOT_TABLE_COLUMNS.has(c));
    assert.deepEqual(missing, [],
      `the pipeline reads or writes ${missing.join(", ")}, which ad_videos does not have. ` +
      `Either add the column in a NEW migration, or use the name the table already uses. ` +
      `This is the defect that made three green builders produce a pipeline that could not run.`);
  });

  test("every column the pipeline writes, the store will actually write", () => {
    const used = pipelineColumns();
    const table = adVideoColumns();

    /* status and failure_reason are routed, not patched: store.patch() sends a
       status through advance() so the state machine sees it, and a `failed`
       through markFailed() so the reason lands. Everything else has to be on
       the allow-list or buildPatch() throws by name. */
    const routed = new Set(["status", "failure_reason", "rejected_reason"]);
    const generated = new Set(["resolution_ok"]); // GENERATED ALWAYS — read-only
    const readOnly = new Set([
      "id", "org_id", "partner_id", "created_at", "updated_at",
      "approval_token", "approval_expires_at", "approved_at", "approved_by"
    ]);

    const refused = [...used].filter((c) =>
      table.has(c) && !routed.has(c) && !generated.has(c) && !readOnly.has(c) &&
      !store.PATCHABLE_FOR_TEST.has(c));

    assert.deepEqual(refused, [],
      `store.patch() would throw "unpatchable_column" on ${refused.join(", ")}. ` +
      `A worker's mark that cannot be written is an idempotency guard that never bites.`);
  });

  test("resolution_ok is never written, because the database computes it", () => {
    assert.ok(!store.PATCHABLE_FOR_TEST.has("resolution_ok"),
      "resolution_ok is GENERATED ALWAYS in 389 — writing it is an error, not an override");
  });
});

describe("the sweeper and the store speak the same language", () => {
  /* The exact names src/workflows/ad-video-sweeper.mjs probes with
     `typeof store?.X !== "function"`. When one of these is missing the sweeper
     reports and returns, so the pipeline stops dead WITHOUT failing anything —
     which is how it went unnoticed across three builders. */
  const REQUIRED = [
    "lastRawSeenAt", "recordRawTake", "listPending", "patch",
    "candidateScripts", "mintApprovalLink"
  ];

  for (const name of REQUIRED) {
    test(`the store offers ${name}()`, () => {
      assert.equal(typeof store[name], "function",
        `src/workflows/ad-video-sweeper.mjs calls store.${name}(). Without it the ` +
        `sweeper reports "the store does not offer …" on every pass and no video moves.`);
    });
  }

  /* Both files that reach the store across a module boundary. router.mjs is in
     this list because it is where the SECOND instance of this bug lived: the
     Submagic webhook called findBySubmagicProjectId(db, projectId) — a pool
     where a staff transaction belongs and a string where an options object
     belongs — and row-level security turned that into a silent "no take is
     waiting on this project" for every render that ever finished. */
  const CALLERS = [
    ["src", "workflows", "ad-video-sweeper.mjs"],
    ["src", "http", "router.mjs"]
  ];

  for (const parts of CALLERS) {
  test(`${path.join(...parts)} only calls store functions that exist`, () => {
    const src = fs.readFileSync(path.join(REPO, ...parts), "utf8");
    const probed = new Set();
    /* Two shapes and only two: the `typeof store?.X !== "function"` guard and
       an actual `store.X(` call. Anything looser matches the string
       "../ad-videos/store.mjs" in the import line and asks whether the store
       offers a function called `mjs`. */
    for (const m of src.matchAll(/\bstore\?\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) probed.add(m[1]);
    for (const m of src.matchAll(/\bstore\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) probed.add(m[1]);
    const unanswered = [...probed].filter((n) => typeof store[n] !== "function");
    assert.deepEqual(unanswered, [],
      `it calls store.${unanswered.join(", store.")} and the store does not offer it`);
  });
  }
});

describe("the state lists have not drifted apart", () => {
  test("the store, the state machine and the pipeline name the same states", () => {
    assert.deepEqual([...STORE_STATES].sort(), [...PIPELINE_STATES].sort(),
      "the pipeline's STATES and states.mjs's STATES must be the same thirteen words — " +
      "the database's CHECK constraint pins them and a state in one list only is a row " +
      "that cannot be written");
  });

  test("every state the store queues has a step, and every step has a state", () => {
    assert.deepEqual([...PENDING_STATES].sort(), Object.keys(NEXT_STEP).sort(),
      "store.listPending() reads PENDING_STATES and the pipeline decides what to do from " +
      "NEXT_STEP. A state in the queue with no step spins forever; a step whose state is " +
      "never queued never runs.");
  });

  test("no state the store queues is one only a person may leave", () => {
    /* awaiting_approval MUST NOT be in the queue. If a worker had a step for
       it, the pipeline would move a video past Chris. */
    assert.ok(!PENDING_STATES.includes("awaiting_approval"),
      "awaiting_approval is Chris's. A worker step for it would approve videos nobody watched.");
    for (const dead of ["delivered", "rejected", "failed"]) {
      assert.ok(!PENDING_STATES.includes(dead), `${dead} is an ending, not a queue`);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   3. THE PIPELINE AND THE NAMING MODULE — the third gap of the same kind.

   pipeline.mjs called naming.rawName, naming.adFolderName, naming.briefName
   and naming.finalName. naming.mjs exports rawFileName, paulFolderName,
   briefFileName and finalFileName — different names, different argument
   shapes. pipeline.test.mjs passed because its stub invented the first set.
   Measured 2026-09-24 on the first real take: the rename guard was false so
   the Drive file kept its phone name, and delivery would have answered "the
   naming module was not supplied" on every pass for ever.
   ───────────────────────────────────────────────────────────────────────── */
describe("the pipeline only calls naming functions that exist", () => {
  test("every naming.<fn> in pipeline.mjs is an export of naming.mjs", async () => {
    const naming = await import("./naming.mjs");
    /* Code only. The comments in pipeline.mjs name the OLD phantom functions on
       purpose, as the record of what went wrong; a scan that read them would
       fail on the very explanation of the fix. */
    const src = fs.readFileSync(new URL("./pipeline.mjs", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/^\s*import\b.*$/gm, "");        // `from "./naming.mjs"` is a path, not a call
    const called = new Set();
    for (const m of src.matchAll(/\bnaming\??\.(\w+)/g)) called.add(m[1]);
    /* Three, not four, since spec §9.1 step 5 took the raw-file rename out of
       matchAndRename (owner law: never move or rename raw files). The three
       left are delivery's: Paul's folder, the brief, the finished file. */
    assert.ok(called.size >= 3, `expected the pipeline to call naming functions, found ${[...called].join(", ")}`);
    const missing = [...called].filter((fn) => typeof naming[fn] !== "function");
    assert.deepStrictEqual(missing, [],
      `pipeline.mjs calls naming.${missing.join(", naming.")} but naming.mjs exports no such function — ` +
      "this is the gap that skipped the rename on the first real take");
  });

  test("the pipeline never renames a raw take (spec §9.1 step 5)", () => {
    const src = fs.readFileSync(new URL("./pipeline.mjs", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(src, /\brenameFile\b/, "raw files keep the camera's name");
    assert.doesNotMatch(src, /\brawFileName\b/, "the 084_t01_raw_… name is the one NAMING.md marks wrong");
  });

  test("the real module still names files in its own shapes", async () => {
    const { rawFileName, finalFileName, briefFileName, paulFolderName } = await import("./naming.mjs");
    assert.strictEqual(rawFileName("84", 1, new Date("2026-09-24T01:45:25Z")), "084_t01_raw_2026-09-24.mp4");
    assert.strictEqual(finalFileName("84", 1, 1), "084_t01_final_v1.mp4");
    assert.strictEqual(briefFileName("84", "txt"), "084_brief.txt");
    assert.strictEqual(paulFolderName("84"), "084");
  });
});
