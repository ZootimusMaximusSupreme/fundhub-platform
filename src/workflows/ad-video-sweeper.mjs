// The ad video sweeper — the clock the whole pipeline runs on.
//
// Two jobs, in this order, every five minutes:
//
//   1. LOOK IN THE RAW DRIVE FOLDER. A take that appeared since the last pass
//      becomes a row. This is the only trigger: Drive push channels expire in
//      seven days and do not renew themselves, so the API research calls
//      polling the simple, reliable answer and this agrees.
//
//   2. MOVE EVERY ROW ONE STEP. src/ad-videos/pipeline.mjs decides what that
//      step is; this file only supplies the ports and writes the result down.
//
// ═══════════════════════════════════════════════════════════════════════════
// EVERY PASS IS BOUNDED, AND A PASS NEVER THROWS.
//
// Same shape and the same reasoning as src/workflows/message-dispatch-sweeper.mjs:
// one bounded batch, then stop. A backlog that cannot be cleared in one pass is
// cleared in the next one, and nothing is lost by stopping early because a row
// that did not move is still in its state and still due. A pass that failed must
// not take the scheduled function down with it — the next pass is the recovery.
//
// It matters more here than for messages, because the steps cost money. Export
// is capped at 50 an hour and every update costs another, so an unbounded pass
// that retried could spend an hour's budget in a minute.
// ═══════════════════════════════════════════════════════════════════════════
//
// ═══════════════════════════════════════════════════════════════════════════
// IT IS REGISTERED, AND REGISTERING IT SENDS NOTHING.
//
// Three separate things still have to be true before a single byte leaves:
//   * ADAPTERS_DRY_RUN must be an explicit off value, or Submagic and Drive are
//     both held (src/lib/dry-run.mjs defaults to BLOCKED).
//   * MESSAGING_DRY_RUN must be an explicit off value, or the phone stays quiet.
//   * SUBMAGIC_API_KEY, the Drive credentials and DRIVE_RAW_FOLDER_ID must be
//     set, or every step reports "not configured" and the rows sit still.
//
// With none of those set this function walks an empty folder and does nothing,
// which is the correct behaviour for a deploy nobody has switched on.
// ═══════════════════════════════════════════════════════════════════════════

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { advance, renotify } from "../ad-videos/pipeline.mjs";
import * as defaultStaging from "../ad-videos/staging.mjs";
import * as submagic from "../messaging/providers/submagic.mjs";
import * as drive from "../messaging/providers/google-drive-write.mjs";
import * as ntfy from "../messaging/providers/ntfy.mjs";
import * as fanout from "../ad-videos/notify-fanout.mjs";

/** Every five minutes. The research puts the useful window at two to five;
    five is the slower end because each pass can cost a paid API minute. */
export const SWEEP_CRON = "*/5 * * * *";

export const SOURCE_WORKFLOW = "ad-video-sweeper";

/** How many rows one pass will move. Small on purpose: see the header. */
export const DEFAULT_BATCH = 10;

/** How many new Drive files one pass will pick up. */
export const DEFAULT_DETECT_LIMIT = 20;

/* ─────────────────────────────────────────────────────────────────────────
   THE ONE THING THIS FILE DOES NOT OWN.

   The `ad_videos` table, its reader and the naming rules are Builder A's
   (src/ad-videos/store.mjs, src/ad-videos/naming.mjs). They are loaded here at
   RUN TIME rather than imported at the top, for one reason: an import of a file
   that does not exist yet fails the whole module, which would take every other
   registered workflow down with it. A missing store must be a quiet, reported
   "not built yet", not a dead deploy.

   Delete the try/catch and make these plain imports the day both files land.
   ───────────────────────────────────────────────────────────────────────── */
async function loadStore(options) {
  if (options.store && options.naming) return { ok: true, store: options.store, naming: options.naming };
  try {
    const [store, naming] = await Promise.all([
      options.store ? Promise.resolve(options.store) : import("../ad-videos/store.mjs"),
      options.naming ? Promise.resolve(options.naming) : import("../ad-videos/naming.mjs")
    ]);
    return { ok: true, store, naming };
  } catch (err) {
    return { ok: false, error: `the ad_videos store is not built yet: ${String(err?.message || err)}` };
  }
}

/* portsFor — everything a pipeline step is allowed to reach.

   Passed in rather than imported by the pipeline, so every step is testable
   with a stub and nothing in src/ad-videos/ can open a socket of its own. */
export function portsFor({ env = process.env, naming, staging, saveFinished, candidateScripts = [], brollLibrary = [] } = {}) {
  return {
    env,
    naming,
    /* The real stager, unless a test hands in its own. It publishes nothing by
       default: `direct` mode makes no call and no link, and the take's bytes
       move once, inside the fence, when submagicCreate() runs. */
    staging: staging || defaultStaging,
    saveFinished,
    candidateScripts,
    brollLibrary,
    submagic,
    drive,
    /* Chris's phone by TEXT (AD_VIDEO_SMS_TO, else the pulse number, via the
       Twilio provider) and the ntfy topic. He asked to be texted the finished
       video. ntfy stays as the second channel. See src/ad-videos/notify-fanout.mjs. */
    notify: fanout,
    webhookUrl: env.SUBMAGIC_WEBHOOK_URL || null,
    paulFolderId: env.DRIVE_PAUL_FOLDER_ID || null,
    landingBase: env.PUBLIC_SITE_URL || "https://fundhub.ai",
    /* Both null here ON PURPOSE. A decision link is minted PER ROW, a moment
       before that row's buzz goes out (see approvalLinks() below), because the
       token in it is a credential for exactly one take. A link built once at
       port-construction time would either be the same for every video or be
       minted for takes that are nowhere near needing one. */
    approveUrl: null,
    rejectUrl: null
  };
}

/* approvalLinks — the two buttons in the notification, and the only place a
   token is put in a URL.

   Called for one row, only when that row is at `rendered` and is therefore
   about to be shown to Chris. store.mintApprovalLink() writes the token on the
   row first and hands it back; if it returns null the row was not at `rendered`
   any more — somebody else got there — and no link is built.

   THE TOKEN IS IN THE QUERY STRING, and that is what it is for: a phone
   notification has no session, so the link IS the credential (owner decision 5,
   2026-09-22). What keeps that from mattering is in the database, not here —
   389's policies are written on approval_token, so the link reaches one row and
   nothing else. It is never logged: the sweeper's per-row report carries the id
   and the state, never the URL. */
export async function approvalLinks(database, row, { store, env = process.env } = {}) {
  if (row?.status !== "rendered") return { approveUrl: null, rejectUrl: null };
  if (typeof store?.mintApprovalLink !== "function") return { approveUrl: null, rejectUrl: null };

  const minted = await store.mintApprovalLink(database, { orgId: row.org_id, id: row.id });
  if (!minted?.token) return { approveUrl: null, rejectUrl: null };

  const base = String(env.PUBLIC_SITE_URL || "https://fundhub.ai").replace(/\/+$/, "");
  const url = (decision) =>
    `${base}/api/public/ad-video-approve?token=${encodeURIComponent(minted.token)}` +
    `&decision=${decision}`;
  /* Both links open the SAME page — api/public/ad-video-approve.mjs answers a
     GET with the screen and its two buttons, and only a POST decides. The
     `decision` hint tells the page which button he meant to press; it cannot
     decide anything by itself, which is what stops a link preview or a URL
     scanner from approving a video nobody watched. */
  return { approveUrl: url("approve"), rejectUrl: url("reject") };
}

/* detect — new takes in the Raw folder become rows.

   Two filters happen inside drive.listNewVideos and are worth repeating here
   because they are the difference between a working trigger and a broken one:
   a file still uploading has a real id and ZERO bytes, and a stray note in the
   folder is not a take. Both are skipped. */
export async function detect(database, { store, env = process.env, limit = DEFAULT_DETECT_LIMIT } = {}) {
  const folderId = env.DRIVE_RAW_FOLDER_ID;
  if (!folderId) return { ok: true, detected: 0, note: "DRIVE_RAW_FOLDER_ID is not set — nothing is being watched" };
  if (typeof store?.lastRawSeenAt !== "function" || typeof store?.recordRawTake !== "function") {
    return { ok: false, detected: 0, error: "the store does not offer lastRawSeenAt/recordRawTake" };
  }

  const since = await store.lastRawSeenAt(database);
  const listed = await drive.listNewVideos({ folderId, since, pageSize: limit, env });
  if (!listed.ok) return { ok: false, detected: 0, error: listed.error };

  let detected = 0;
  for (const file of listed.files) {
    const meta = await drive.getFileMeta(file.id, { env });
    const written = await store.recordRawTake(database, {
      driveFileId: file.id,
      name: file.name,
      createdTime: file.createdTime,
      sizeBytes: Number(file.size) || null,
      width: meta.ok ? meta.width : null,
      height: meta.ok ? meta.height : null,
      durationSeconds: meta.ok ? meta.durationSeconds : null
    });
    if (written?.created) detected += 1;
  }
  return { ok: true, detected, skipped: listed.skipped || 0 };
}

/* walk — move each row one step, and write down what happened. */
export async function walk(database, { store, ports, limit = DEFAULT_BATCH } = {}) {
  if (typeof store?.listPending !== "function" || typeof store?.patch !== "function") {
    return { ok: false, advanced: 0, error: "the store does not offer listPending/patch" };
  }
  const rows = (await store.listPending(database, { limit })) || [];
  const per = [];
  let advanced = 0;

  for (const row of rows) {
    /* The one step that needs something minted before it runs. Every other
       step's ports are the same for every row. */
    const links = await approvalLinks(database, row, { store, env: ports.env });

    /* THE CLAIM PORT — the only write a step makes for itself, and the only one
       that happens BEFORE the work rather than after it.

       The two steps that cost money (the Submagic create and the Submagic
       export) call this the instant before they call the vendor, so a function
       that is killed mid-upload leaves a mark behind saying "something was
       started here". Without it the next pass reads a row that says nothing
       happened and spends again — see the header of src/ad-videos/pipeline.mjs
       and migration 391.

       It returns FALSE when the write did not land, and a step that gets false
       does not call the vendor at all. */
    const claim = async (patch) => {
      const written = await store.patch(database, row.id, patch);
      return written !== null && written !== undefined;
    };

    const out = await advance(row, {
      ...ports,
      ...links,
      claim,
      candidateScripts: ports.candidateScripts,
      brollLibrary: ports.brollLibrary
    });
    /* WRITE DOWN WHAT JUST HAPPENED, EVEN WHEN NOTHING MOVED.

       A step that waits returns no patch, so before migration 392 a take could
       retry every five minutes for hours and look untouched from the outside —
       which is exactly how the first pilot take went dark at `staged`. The note
       goes on the same write as the patch when there is one, and on its own
       when there is not. */
    const mark = {
      last_step: out.step || null,
      last_step_note: out.ok ? null : (out.note || out.error || null),
      last_step_at: new Date().toISOString()
    };
    if (out.patch && Object.keys(out.patch).length) {
      try {
        await store.patch(database, row.id, { ...out.patch, ...mark });
        advanced += 1;
      } catch (err) {
        /* THE WRITE ITSELF FAILED. The step did its job and the database
           refused the result — measured 2026-09-24, a jsonb column handed a raw
           array. The note used to ride on that same UPDATE, so when it was
           refused the row said nothing and the reason only existed in a
           function log. Write the note on its own so the row says why. */
        const why = String((err && err.message) || err).slice(0, 300);
        await store.patch(database, row.id, {
          ...mark, last_step_note: `could not save the result of ${out.step}: ${why}`
        });
        per.push({ id: row.id, from: row.status, step: out.step, to: row.status, ok: false, note: why });
        continue;
      }
    } else {
      await store.patch(database, row.id, mark);
    }
    per.push({
      id: row.id,
      from: row.status,
      step: out.step,
      to: out.patch?.status || row.status,
      ok: out.ok,
      note: out.note || out.error || null
    });
  }
  return { ok: true, advanced, per };
}

/* rebuzz — a finished ad whose buzz did not land gets buzzed again.

   `awaiting_approval` is a resting place for the walk (the next move is a
   person's), so this is a separate, small loop: rows waiting on Chris with no
   notified_at. It writes marks only, never a status. See renotify(). */
export async function rebuzz(database, { store, ports } = {}) {
  const per = [];
  if (typeof store?.listPending !== "function") return { tried: 0, per };
  let rows = [];
  try { rows = (await store.listPending(database, { states: ["awaiting_approval"], limit: 25 })) || []; }
  catch (err) { return { tried: 0, per, error: String((err && err.message) || err) }; }
  let tried = 0;
  for (const row of rows) {
    if (row.notified_at) continue;
    tried += 1;
    const out = await renotify(row, { notify: ports.notify, env: ports.env });
    const mark = { last_step: "renotify", last_step_note: out.ok ? null : (out.error || null), last_step_at: new Date().toISOString() };
    try { await store.patch(database, row.id, { ...(out.patch || {}), ...mark }); }
    catch (err) { per.push({ id: row.id, step: "renotify", ok: false, note: String((err && err.message) || err) }); continue; }
    per.push({ id: row.id, from: row.status, step: "renotify", to: row.status, ok: out.ok, note: out.note || out.error || null });
  }
  return { tried, per };
}

/* sweep — one pass.

   `db` and the limits are arguments, so the tests drive this with no Inngest
   and no scheduler. Never throws; the error is returned so a caller can log it. */
/* loadBrollLibrary — the clips, read once per pass.

   MEASURED 2026-09-23: this did not exist and `brollLibrary` was always empty,
   so placeBrollAndExport skipped b-roll on every take and no ad has ever had a
   clip on it. Reading the folder is one Drive call per subfolder and no bytes
   move here — the winners are fetched later, in the pipeline.

   A missing DRIVE_BROLL_FOLDER_ID is not an error. It means b-roll is off, the
   ads still caption and export, and the note says why. */
export async function loadBrollLibrary(env = process.env, port = drive) {
  const folderId = env.DRIVE_BROLL_FOLDER_ID;
  if (!folderId) return [];
  if (typeof port?.listBrollClips !== "function") return [];
  const got = await port.listBrollClips({ brollFolderId: folderId, env });
  return got.ok ? (got.clips || []) : [];
}

/** The Drive folder that holds our own copy of each finished cut. */
export const FINISHED_FOLDER_ENV = "DRIVE_FINISHED_FOLDER_ID";

/* saveFinishedToDrive — the `saveFinished` port: our own copy of the finished cut.

   MEASURED 2026-09-24: nothing supplied this port, so storage_final_key stayed
   NULL and the only copy of a finished ad was Submagic's download link, whose
   life nobody could measure. This pulls the render down and puts it in
   DRIVE_FINISHED_FOLDER_ID with the same uploadVideo() deliverToPaul uses.

   NEVER THE RAW FOLDER. detect() reads every video in DRIVE_RAW_FOLDER_ID as a
   new take, so a finished cut put there would be sent back to Submagic and
   paid for again. Same for the B-roll folder, where it would be placed as a
   clip. Either one is refused and nothing moves.

   NEVER THROWS. saveFinishedAndNotify() calls this before the buzz; a throw
   there would hold the buzz for ever. Every miss comes back as { ok: false }
   and the pipeline writes it on the row as save_note — the approval and the
   text still go out. */
export async function saveFinishedToDrive(row, { env = process.env, port = drive, naming } = {}) {
  try {
    const folderId = String(env[FINISHED_FOLDER_ENV] || "").trim();
    if (!folderId) return { ok: false, error: `${FINISHED_FOLDER_ENV} is not set — our own copy of the finished cut was not taken` };
    for (const other of ["DRIVE_RAW_FOLDER_ID", "DRIVE_BROLL_FOLDER_ID"]) {
      if (String(env[other] || "").trim() === folderId) {
        return { ok: false, error: `${FINISHED_FOLDER_ENV} is the same folder as ${other} — nothing was saved there` };
      }
    }
    if (typeof port?.uploadVideo !== "function") return { ok: false, error: "the Drive provider offers no uploadVideo" };
    if (row?.ad_id === null || row?.ad_id === undefined || row?.ad_id === "") {
      return { ok: false, error: "no ad number on the row — the copy has no name" };
    }
    const names = naming || await import("../ad-videos/naming.mjs");
    const up = await port.uploadVideo({
      parentId: folderId,
      name: names.finalFileName(row.ad_id, row.take_no, row.finished_version || 1),
      sourceUrl: row.finished_url,
      env
    });
    if (!up?.ok || !up.fileId) return { ok: false, error: String(up?.error || "Drive returned no file id") };
    return { ok: true, key: `drive:${up.fileId}` };
  } catch (err) {
    return { ok: false, error: `saving our copy threw: ${String((err && err.message) || err)}` };
  }
}

export async function sweep(database, options = {}) {
  const env = options.env || process.env;
  try {
    const loaded = await loadStore(options);
    if (!loaded.ok) return { ok: false, detected: 0, advanced: 0, per: [], error: loaded.error };

    const { store, naming } = loaded;
    const ports = options.ports || portsFor({
      env,
      naming,
      staging: options.staging,
      saveFinished: options.saveFinished,
      candidateScripts: typeof store.candidateScripts === "function"
        ? await store.candidateScripts(database)
        : [],
      brollLibrary: options.brollLibrary || await loadBrollLibrary(env)
    });

    const found = await detect(database, { store, env, limit: options.detectLimit });
    const moved = await walk(database, { store, ports, limit: options.limit });
    const buzzed = await rebuzz(database, { store, ports });
    if (buzzed.tried) moved.per = [...(moved.per || []), ...buzzed.per];

    return {
      ok: found.ok && moved.ok,
      detected: found.detected || 0,
      advanced: moved.advanced || 0,
      per: moved.per || [],
      error: found.error || moved.error || null,
      note: found.note || null
    };
  } catch (err) {
    return {
      ok: false, detected: 0, advanced: 0, per: [],
      error: String((err && err.message) || err).slice(0, 300)
    };
  }
}

/* handle — the shape src/journeys/runner/registry.mjs expects of a registered
   workflow. It has no event trigger (it is a cron), so no journey reaches it
   and it always appears in the runner's neverFired list. That is correct for a
   scheduled job, not a coverage hole. */
export async function handle({ db: handleDb, step, env = process.env } = {}) {
  const run = () => sweep(handleDb || db, { env });
  return step && typeof step.run === "function" ? step.run("sweep-ad-videos", run) : run();
}

export const adVideoSweeper = inngest.createFunction(
  { id: "ad-video-sweeper", name: "Ad video sweeper (Drive takes → Submagic → approval)" },
  { cron: SWEEP_CRON },
  () => sweep(db)
);

export default sweep;
