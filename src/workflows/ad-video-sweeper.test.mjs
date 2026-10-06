// The ad video sweeper.
//
// `db`, the store and the ports are all arguments, so every case here runs with
// no Inngest, no scheduler, no database and no network.
//
// Two properties carry the most weight:
//   * a pass never throws, whatever the store or the network does — the next
//     pass is the recovery, and a thrown pass takes the scheduled function down
//   * a pass is BOUNDED, because every step past `staged` costs money.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  sweep, detect, walk, portsFor, adVideoSweeper,
  SWEEP_CRON, DEFAULT_BATCH, DEFAULT_DETECT_LIMIT, loadBrollLibrary,
  saveFinishedToDrive, FINISHED_FOLDER_ENV
} from "./ad-video-sweeper.mjs";
import { saveFinishedAndNotify } from "../ad-videos/pipeline.mjs";
import { saveFinished as workerSaveFinished } from "../../netlify/functions/ad-video-worker-background.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const noDb = { query: async () => ({ rows: [] }) };

/** A store stub with the exact surface this file asks Builder A for. */
function fakeStore({ pending = [], scripts = [], onPatch = () => {}, lastSeen = null, onRecord = () => ({ created: true }) } = {}) {
  return {
    lastRawSeenAt: async () => lastSeen,
    recordRawTake: async (_db, take) => onRecord(take),
    listPending: async () => pending,
    /* The real store answers with the row it wrote, and the sweeper's claim port
       reads that answer: no row back means the claim did not land, and a step
       whose claim did not land refuses to spend. So the stand-in answers with a
       row too, unless a test's own onPatch wants to say otherwise. */
    patch: async (_db, id, fields) => onPatch(id, fields) ?? { id, ...fields },
    candidateScripts: async () => scripts,
    findBySubmagicProjectId: async () => null
  };
}

const naming = {
  rawName: () => "043_t02_raw.mp4",
  finalName: () => "043_t02_final_v1.mp4",
  adFolderName: () => "043",
  briefName: () => "043_brief.txt"
};

describe("a pass that cannot run", () => {
  test("a pass with nothing behind it is reported, not thrown", async () => {
    /* "Nothing behind it" means no database too. The real store reaches the
       pool through process.env.DATABASE_URL, so in CI's Postgres job (which
       sets it) this pass found a real, empty database and came back ok — the
       test then failed for having something behind it (measured 2026-10-05).
       The URL is taken away for this one call only; src/db.mjs creates its
       pool on first use and does not cache a failed attempt. */
    const savedUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    let res;
    try {
      res = await sweep(noDb, { env: {} });
    } finally {
      if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl;
    }
    /* WHAT THIS ASSERTED BEFORE THE MERGE, and why it changed. The store was
       Builder A's file and might not exist, so this checked that a MISSING
       MODULE was reported rather than taking the deploy down. It now exists, so
       the pass gets one step further and stops on the database instead.

       The rule under test is the one that has not changed: whatever is missing
       — the module, the database, the folder id — the sweeper SAYS SO and does
       not throw. A registered workflow that throws on import takes every other
       workflow in src/workflows/index.mjs down with it. */
    assert.equal(res.ok, false);
    assert.match(res.error, /store|DATABASE_URL/);
    assert.equal(typeof res.ok, "boolean");
  });

  test("a store that throws is reported, not thrown", async () => {
    const store = fakeStore();
    store.listPending = async () => { throw new Error("connection refused"); };
    const res = await sweep(noDb, { env: {}, store, naming });
    assert.equal(res.ok, false);
    assert.match(res.error, /connection refused/);
  });
});

describe("detect", () => {
  test("with DRIVE_RAW_FOLDER_ID unset nothing is watched and nothing breaks", async () => {
    const res = await detect(noDb, { store: fakeStore(), env: {} });
    assert.equal(res.ok, true);
    assert.equal(res.detected, 0);
    assert.match(res.note, /DRIVE_RAW_FOLDER_ID/);
  });

  test("a store missing the two functions it needs is named, not crashed into", async () => {
    const res = await detect(noDb, { store: {}, env: { DRIVE_RAW_FOLDER_ID: "raw" } });
    assert.equal(res.ok, false);
    assert.match(res.error, /lastRawSeenAt/);
  });
});

describe("walk", () => {
  test("a row moves one step, and the spend claim is written BEFORE the result", async () => {
    /* Two writes now, not one, and the ORDER of them is the point: the claim
       goes down before the take's bytes leave, so a function killed mid-upload
       leaves a mark behind instead of a row that says nothing happened. */
    const patches = [];
    const store = fakeStore({
      pending: [{ id: "r1", status: "staged", staged_at: "2026-09-22T10:00:00Z", drive_raw_file_id: "d1" }],
      onPatch: (id, fields) => patches.push([id, fields])
    });
    const res = await walk(noDb, {
      store,
      ports: {
        ...portsFor({ env: {}, naming }),
        drive: { downloadFile: async () => ({ ok: true, bytes: new Uint8Array([1]), byteLength: 1 }) },
        submagic: { createProjectFromFile: async () => ({ ok: true, projectId: "p9" }) }
      }
    });
    assert.equal(res.ok, true);
    assert.equal(res.advanced, 1);
    assert.equal(patches.length, 2);
    assert.ok(patches[0][1].submagic_claimed_at, "the claim is written first");
    assert.equal(patches[1][1].status, "editing");
    assert.equal(patches[1][1].submagic_claimed_at, null, "and comes off with the result");
    assert.equal(res.per[0].from, "staged");
    assert.equal(res.per[0].to, "editing");
  });

  /* CHANGED 2026-09-23, and the old rule cost a night.

     This used to assert that a waiting row is not written at all. The intent
     was right — a wait must never touch status, a timestamp or a claim — but
     "write nothing" also meant "say nothing", and a take that retries every
     five minutes then looks exactly like a take nobody is touching. The first
     pilot take sat at `staged` for hours that way with the reason living only
     in a return value nobody could read.

     So the rule is now narrower and stronger: a wait writes ONLY the note of
     what it tried and why it stopped. Status and every timestamp stay untouched,
     which is what the old test was really protecting. */
  test("a row that cannot move writes its reason and nothing else", async () => {
    const patches = [];
    const store = fakeStore({
      pending: [{ id: "r1", status: "raw_landed", drive_raw_file_id: "d1" }],
      onPatch: (id, f) => patches.push([id, f])
    });
    /* staging: null on purpose. The real stager is wired in now and would move
       this row, so the "stuck" case has to be a port that is genuinely absent
       rather than a feature that was never built. */
    const res = await walk(noDb, {
      store,
      ports: { ...portsFor({ env: {}, naming }), staging: null }
    });
    assert.equal(patches.length, 1, "a waiting row must say why — silence is how a stall goes unnoticed");
    const [, wrote] = patches[0];
    assert.match(wrote.last_step_note, /staging port was not supplied/,
      "the reason the step gave must be readable in the database, not only in a return value");
    assert.ok(wrote.last_step_at, "and when it last tried");
    assert.deepEqual(
      Object.keys(wrote).sort(),
      ["last_step", "last_step_at", "last_step_note"],
      "a wait writes the note and NOTHING else — no status, no timestamp, no claim"
    );
    assert.match(res.per[0].note, /staging port was not supplied/);
  });

  test("the sweeper hands the pipeline a real stager, so a raw take moves with no network", async () => {
    /* The gap this batch closed. `direct` staging makes no call and publishes
       no link — it only marks the row ready for the upload route. */
    const patches = [];
    const store = fakeStore({
      pending: [{ id: "r1", status: "raw_landed", drive_raw_file_id: "d1" }],
      onPatch: (id, f) => patches.push([id, f])
    });
    const res = await walk(noDb, { store, ports: portsFor({ env: {}, naming }) });
    assert.equal(res.advanced, 1);
    assert.equal(patches[0][1].status, "staged");
    assert.equal(patches[0][1].source_url, undefined, "direct staging must not publish a link");
    assert.equal(patches[0][1].storage_raw_key, "drive:d1");
  });

  test("every row in the batch gets a turn, and one stuck row does not block the rest", async () => {
    const store = fakeStore({
      pending: [
        { id: "r1", status: "raw_landed", drive_raw_file_id: "d1" },
        { id: "r2", status: "staged", staged_at: "2026-09-22T10:00:00Z", drive_raw_file_id: "d2" }
      ]
    });
    const res = await walk(noDb, {
      store,
      ports: {
        ...portsFor({ env: {}, naming }),
        staging: null,
        drive: { downloadFile: async () => ({ ok: true, bytes: new Uint8Array([1]), byteLength: 1 }) },
        submagic: { createProjectFromFile: async () => ({ ok: true, projectId: "p9" }) }
      }
    });
    assert.equal(res.per.length, 2);
    assert.equal(res.advanced, 1);
  });

  test("a store missing listPending/patch is named", async () => {
    const res = await walk(noDb, { store: {}, ports: {} });
    assert.equal(res.ok, false);
    assert.match(res.error, /listPending/);
  });
});

describe("a whole pass", () => {
  test("an empty folder and an empty queue is a clean, quiet pass", async () => {
    const res = await sweep(noDb, { env: {}, store: fakeStore(), naming });
    assert.equal(res.ok, true);
    assert.equal(res.detected, 0);
    assert.equal(res.advanced, 0);
  });

  test("the batch limit reaches the store", async () => {
    let asked = null;
    const store = fakeStore();
    // The walk asks with only a limit. The rebuzz loop asks again, with states
    // and its own cap of 25. Record the walk, or the last call hides the batch.
    store.listPending = async (_db, opts) => {
      if (!opts?.states) asked = opts.limit;
      return [];
    };
    await sweep(noDb, { env: {}, store, naming, limit: 3 });
    assert.equal(asked, 3);
  });

  test("the default batch is bounded and small — every step past staged costs money", () => {
    assert.ok(DEFAULT_BATCH > 0 && DEFAULT_BATCH <= 25);
    assert.ok(DEFAULT_DETECT_LIMIT > 0 && DEFAULT_DETECT_LIMIT <= 50);
  });
});

describe("what actually gates this", () => {
  test("it IS registered — a take nobody looks for is a take nobody edits", () => {
    const index = fs.readFileSync(path.join(HERE, "index.mjs"), "utf8");
    assert.ok(/adVideoSweeper/.test(index));
  });

  test("it is defined and it is one reviewable file", () => {
    assert.ok(adVideoSweeper);
  });

  test("it runs often enough that a take is picked up within minutes", () => {
    const [minute] = SWEEP_CRON.split(" ");
    assert.match(minute, /^\*\/(\d+)$/);
    assert.ok(Number(minute.slice(2)) <= 5,
      "the research puts the useful polling window at two to five minutes");
  });

  test("REGISTERING IT SENDS NOTHING — the ports read the fences, not a flag of their own", () => {
    const src = fs.readFileSync(path.join(HERE, "ad-video-sweeper.mjs"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const flag of ["force", "skipCompliance", "override", "bypass", "test_bypass"]) {
      assert.ok(!new RegExp(`\\b${flag}\\b`, "i").test(code), `the sweeper must not contain a ${flag} identifier`);
    }
    assert.ok(!/DRY_RUN/.test(code),
      "the sweeper must not read a dry-run flag itself — the chokepoint owns that decision");
  });

  test("it reaches the network only through the fenced providers", () => {
    const src = fs.readFileSync(path.join(HERE, "ad-video-sweeper.mjs"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/\bfetch\s*\(/.test(code));
    assert.ok(/messaging\/providers\/submagic\.mjs/.test(src));
    assert.ok(/messaging\/providers\/google-drive-write\.mjs/.test(src));
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   THE BUG THIS GUARDS, measured 2026-09-23.

   Nothing in the repo loaded the B-roll library. `brollLibrary` was always the
   empty default, placeBrollAndExport skips b-roll when that list is empty, and
   so no ad had ever had a single clip placed on it — while the planner, the
   uploader and 78 renamed clips in Drive all sat there working perfectly.

   An empty list is silent. These tests are what makes it loud.
   ───────────────────────────────────────────────────────────────────────── */
describe("the b-roll library actually gets loaded", () => {
  test("clips come back when the folder is set", async () => {
    const port = {
      listBrollClips: async ({ brollFolderId }) => ({
        ok: true,
        clips: [{ driveFileId: "a", name: "roadmap-document.png", folder: "deliverables" }],
        asked: brollFolderId
      })
    };
    const clips = await loadBrollLibrary({ DRIVE_BROLL_FOLDER_ID: "folder_1" }, port);
    assert.equal(clips.length, 1, "a set folder must produce clips — an empty list means no ad ever gets b-roll");
    assert.equal(clips[0].name, "roadmap-document.png");
  });

  test("no folder set is b-roll off, not a crash", async () => {
    const clips = await loadBrollLibrary({}, { listBrollClips: async () => ({ ok: true, clips: [] }) });
    assert.deepEqual(clips, []);
  });

  test("a Drive failure is b-roll off, not a thrown sweep", async () => {
    const port = { listBrollClips: async () => ({ ok: false, error: "drive said no", clips: [] }) };
    const clips = await loadBrollLibrary({ DRIVE_BROLL_FOLDER_ID: "folder_1" }, port);
    assert.deepEqual(clips, [], "one bad Drive read must not stop captions and export");
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   OUR OWN COPY OF THE FINISHED CUT, measured missing 2026-09-24.

   The background worker never supplied `saveFinished`, so storage_final_key
   stayed NULL on every finished ad and the only copy was Submagic's link.
   These tests hold the port to three promises: it is wired, it never puts a
   cut where the sweeper would pay for it again, and it never throws (a throw
   would hold the buzz).
   ───────────────────────────────────────────────────────────────────────── */
describe("the finished cut is copied to our own Drive folder", () => {
  const row = { id: "r1", ad_id: "84", take_no: 1, finished_version: 2, finished_url: "https://render.example/out.mp4" };
  const names = { finalFileName: (a, t, v) => `${a}_t${t}_final_v${v}.mp4` };

  test("the background worker hands this port to the sweep", () => {
    assert.equal(workerSaveFinished, saveFinishedToDrive,
      "an unwired port is how storage_final_key stayed NULL on every finished ad");
  });

  test("the copy goes to the finished folder, named for the cut, from the render link", async () => {
    let asked = null;
    const port = { uploadVideo: async (args) => { asked = args; return { ok: true, fileId: "drv_final_1" }; } };
    const out = await saveFinishedToDrive(row, {
      env: { [FINISHED_FOLDER_ENV]: "fin_1", DRIVE_RAW_FOLDER_ID: "raw_1" }, port, naming: names
    });
    assert.deepEqual(out, { ok: true, key: "drive:drv_final_1" });
    assert.equal(asked.parentId, "fin_1");
    assert.equal(asked.name, "84_t1_final_v2.mp4");
    assert.equal(asked.sourceUrl, "https://render.example/out.mp4");
  });

  test("the real naming module names the copy the way Paul's folder does", async () => {
    let asked = null;
    const port = { uploadVideo: async (args) => { asked = args; return { ok: true, fileId: "f" }; } };
    await saveFinishedToDrive(row, { env: { [FINISHED_FOLDER_ENV]: "fin_1" }, port });
    assert.equal(asked.name, "084_t01_final_v2.mp4");
  });

  test("no folder set: nothing moves, and the reason names the variable", async () => {
    const port = { uploadVideo: async () => assert.fail("must not upload with no folder") };
    const out = await saveFinishedToDrive(row, { env: {}, port, naming: names });
    assert.equal(out.ok, false);
    assert.match(out.error, /DRIVE_FINISHED_FOLDER_ID is not set/);
  });

  test("the Raw folder is refused — the sweeper would read the cut as a new take and pay again", async () => {
    const port = { uploadVideo: async () => assert.fail("a cut in Raw is a second paid Submagic project") };
    const out = await saveFinishedToDrive(row, {
      env: { [FINISHED_FOLDER_ENV]: "same", DRIVE_RAW_FOLDER_ID: "same" }, port, naming: names
    });
    assert.equal(out.ok, false);
    assert.match(out.error, /same folder as DRIVE_RAW_FOLDER_ID/);
  });

  test("the B-roll folder is refused — the cut would be placed as a clip", async () => {
    const port = { uploadVideo: async () => assert.fail("must not upload into B-roll") };
    const out = await saveFinishedToDrive(row, {
      env: { [FINISHED_FOLDER_ENV]: "b", DRIVE_BROLL_FOLDER_ID: "b" }, port, naming: names
    });
    assert.equal(out.ok, false);
    assert.match(out.error, /same folder as DRIVE_BROLL_FOLDER_ID/);
  });

  test("a Drive refusal and a throw both come back as a note, never a throw", async () => {
    const env = { [FINISHED_FOLDER_ENV]: "fin_1" };
    const refused = await saveFinishedToDrive(row, {
      env, port: { uploadVideo: async () => ({ ok: false, error: "drive said no" }) }, naming: names
    });
    assert.deepEqual(refused, { ok: false, error: "drive said no" });
    const threw = await saveFinishedToDrive(row, {
      env, port: { uploadVideo: async () => { throw new Error("socket hang up"); } }, naming: names
    });
    assert.equal(threw.ok, false);
    assert.match(threw.error, /socket hang up/);
  });

  test("through the real step: the key lands on the row, and a miss still buzzes", async () => {
    const notify = { send: async () => ({ status: "sent" }) };
    const rendered = { ...row, status: "rendered" };

    const saved = await saveFinishedAndNotify(rendered, {
      notify, env: { [FINISHED_FOLDER_ENV]: "fin_1" },
      saveFinished: (r, o) => saveFinishedToDrive(r, {
        ...o, port: { uploadVideo: async () => ({ ok: true, fileId: "f9" }) }, naming: names
      })
    });
    assert.equal(saved.patch.storage_final_key, "drive:f9");
    assert.equal(saved.patch.status, "awaiting_approval");
    assert.ok(saved.patch.notified_at, "the buzz still went");

    const missed = await saveFinishedAndNotify(rendered, {
      notify, env: {},
      saveFinished: (r, o) => saveFinishedToDrive(r, {
        ...o, port: { uploadVideo: async () => assert.fail("no folder") }, naming: names
      })
    });
    assert.equal(missed.patch.storage_final_key, undefined);
    assert.match(missed.patch.save_note, /DRIVE_FINISHED_FOLDER_ID is not set/);
    assert.ok(missed.patch.notified_at, "a copy we could not take never holds the buzz");
  });
});
