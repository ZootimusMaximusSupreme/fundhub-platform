// src/ad-videos/store.mjs — reading and writing one filmed take.
//
// THE ONE MODULE THE WORKERS IMPORT. Every step of the pipeline — the Drive
// poll, the stager, the transcriber, the matcher, the Submagic caller, the
// webhook, the notifier, the deliverer — moves its row through this file and
// nowhere else. That is deliberate: the state machine is only a guard if every
// write goes past it.
//
// ═══════════════════════════════════════════════════════════════════════════
// EVERY WRITE RUNS AS STAFF, AND EVERY WRITE NAMES ITS ORG
//
// ad_videos carries FORCEd row-level security (389, Part 5). A bare db.query()
// against it is anonymous to those policies and matches ZERO rows — it does not
// error, it just silently does nothing, which is the failure mode that makes a
// test look green while proving nothing. So the reads and writes here take a
// `tx` that a caller opened with asStaff() from src/partners/rls.mjs.
//
// The one exception is the phone tap, which must NOT become staff. It lives in
// src/ad-videos/token.mjs and opens its own one-row transaction.
//
// org_id is in every WHERE clause anyway, the same call src/partners/rls.mjs's
// header makes: inside a scoped transaction the predicate is redundant, outside
// it the query is still correct, and a reviewer can see the intent without
// reading the policies.
//
// ═══════════════════════════════════════════════════════════════════════════
// EVERY STEP IS SAFE TO RUN TWICE
//
// Inngest retries, and the Drive poll runs every 2-5 minutes over a folder that
// still holds the file it saw last time. So:
//   * claimTake() upserts on (org_id, drive_raw_file_id) and returns the row
//     that already existed rather than making a second one.
//   * advance() names the state it expects to be leaving. A retry whose first
//     run actually succeeded matches no row and gets null — which the caller
//     reads as "somebody already did this", not as an error.
// Nothing here counts, appends or increments.

import { asStaff } from "../partners/rls.mjs";
import {
  STATES, TRANSITIONS, TERMINAL_STATES, WORKING_STATES, HUMAN_ONLY, STATE_MEANING,
  isState, isTerminal, isHumanOnly, canTransition, nextStates,
  transition, AdVideoStateError
} from "./states.mjs";
import { normalizeAdId, normalizeTakeNo, parseVideoName } from "./naming.mjs";
import { mintApprovalToken } from "./token.mjs";

/* Re-exported so a worker needs ONE import to move a row and to reason about
   where it may go. Builder B codes against this list. */
export {
  STATES, TRANSITIONS, TERMINAL_STATES, WORKING_STATES, HUMAN_ONLY, STATE_MEANING,
  isState, isTerminal, isHumanOnly, canTransition, nextStates,
  transition, AdVideoStateError, asStaff
};

/* The columns a worker and the queue screen read. NOT `SELECT *`: transcript is
   a wall of text nothing on a screen wants, and source_url is a link that
   should not travel further than the worker handing it to Submagic. Ask for
   them by name with the `withTranscript` flag when a step actually needs them. */
const ROW_COLUMNS =
  `id, org_id, partner_id, ad_id, take_no, script_id, script_path, recorder,
   video_kind, status, drive_raw_file_id, drive_raw_name, width, height,
   duration_seconds, resolution_ok, storage_raw_key, match_confidence,
   submagic_project_id, finished_url, storage_final_key, finished_version,
   paul_folder_id, drive_final_file_id, approval_expires_at, approved_at,
   approved_by, rejected_reason, failure_reason, created_at, updated_at,
   last_step, last_step_note, last_step_at`;

const FULL_COLUMNS = `${ROW_COLUMNS}, transcript, source_url`;

const cols = (withTranscript) => (withTranscript ? FULL_COLUMNS : ROW_COLUMNS);

export class AdVideoStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AdVideoStoreError";
    this.code = code;
  }
}

/* The columns a worker may set on its way through. Anything not on this list
   cannot be written by advance() at all — status, the approval fields and the
   timestamps are moved by their own named functions, so a worker cannot set
   `approved_at` by passing a patch. */
const PATCHABLE = new Set([
  "script_id", "script_path", "recorder", "video_kind",
  "drive_raw_file_id", "drive_raw_name", "width", "height", "duration_seconds",
  "storage_raw_key", "source_url", "transcript", "match_confidence",
  "submagic_project_id", "finished_url", "storage_final_key", "finished_version",
  "paul_folder_id", "drive_final_file_id", "failure_reason", "rejected_reason"

  /* THE MARKS A WORKER LEAVES are NOT repeated here. They are added to this
     same Set by the `WORKER_MARKS` loop further down this file, next to the
     sweeper seam that writes them. One home, so the two lists cannot drift.

     Checked 2026-09-22: a duplicate copy of those fourteen names was added
     here carrying a note that said they had been missing and that a step
     writing one threw `unpatchable_column`. That was wrong — WORKER_MARKS
     already held all fourteen, plus ad_id and take_no. The duplicate changed
     no behaviour and the note described a bug that never existed, so both are
     gone. src/ad-videos/seam.test.mjs is what actually proves the pipeline
     can write every column it emits; trust that test, not a second list. */
]);

/* COLUMNS THAT ARE JSON, and must be sent as JSON text.

   node-postgres serialises a JavaScript ARRAY parameter as a Postgres array
   literal — `{"a","b"}` — not as JSON. Handed to a jsonb column that is
   `invalid input syntax for type json`, and the whole UPDATE is refused.

   Measured on production 2026-09-24 at 03:45:23: readTranscript got the words
   back from Submagic fine, then died writing them, and because the step's
   note rides on the same UPDATE, the row said nothing at all. `transcript_words`
   was the first jsonb column this store ever wrote, so nothing had covered it.
   JSON.stringify first and Postgres casts the text to jsonb itself. */
const JSON_COLUMNS = new Set(["transcript_words"]);

/* ═══════════════════════════════════════════════════════════════════════════
   NEXT_FREE_TAKE_NO — "give this take the next free number for its ad".

   A step writes this in take_no when it knows the ad but not the take: a phone
   upload is called IMG_4471.mov and says nothing about which attempt it was.
   Spec §9.1 step 5: "Take N" from the file name when it is there, otherwise the
   next free number for that ad.

   THE NUMBER IS PICKED INSIDE THE UPDATE, not read first and written second —
   the same call nextTake() makes for its INSERT. Before this the matcher wrote
   take 1 for every take with no "Take N" in its name, so the second take of an
   ad hit ad_videos_take_uq and stopped there.

   COALESCE(take_no, …): a row that already holds a number keeps it. A take
   number is never re-numbered (390's comment on ad_videos.take_no).

   Only UPDATEs may ask for it (advance() and patch()), and only with the ad id
   in the same write — "the next free number of which ad?" has to be answered
   by the write itself. src/ad-videos/pipeline.mjs holds the same word under
   the same name; pipeline.test.mjs fails if the two drift apart.
   ═══════════════════════════════════════════════════════════════════════════ */
export const NEXT_FREE_TAKE_NO = "next_free";

function buildPatch(patch, startIndex, { nextFreeTake = false } = {}) {
  const sets = [];
  const params = [];
  let i = startIndex;
  let wantsNextTake = false;
  let adParam = null;
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined) continue;
    if (!PATCHABLE.has(key)) {
      throw new AdVideoStoreError("unpatchable_column",
        `"${key}" cannot be set this way — status and the approval fields move ` +
        `through their own functions, so a worker cannot write them by accident`);
    }
    if (key === "take_no" && value === NEXT_FREE_TAKE_NO) { wantsNextTake = true; continue; }
    if (key === "ad_id" && value !== null) adParam = `$${i}`;
    /* THE PADDED-NUMBER GUARD, at the last place it is cheap. 389's
       ad_videos_ad_id_ck already refuses "043" — but it refuses it as a
       Postgres constraint violation from inside a worker, which is a long way
       from the line that made the mistake. normalizeAdId() throws by name, so
       whoever wrote the padded value reads why instead of reading SQLSTATE
       23514. A padded number is never trimmed into a good one: "043" arriving
       here means a caller mixed up the folder name with the link, and quietly
       fixing it would hide the bug that splits an ad's results in half. */
    sets.push(`${key} = $${i}`);
    let v = value;
    if (key === "ad_id" && value !== null) v = normalizeAdId(value);
    else if (JSON_COLUMNS.has(key) && value !== null) v = JSON.stringify(value);
    params.push(v);
    i += 1;
  }
  if (wantsNextTake) {
    if (!nextFreeTake) {
      throw new AdVideoStoreError("next_free_take_update_only",
        "the next free take number is picked inside an UPDATE of the row; a new row " +
        "gets one from nextTake()");
    }
    if (!adParam) {
      throw new AdVideoStoreError("next_free_take_needs_ad",
        "the next free take number needs the ad number in the same write — " +
        "otherwise it is the next number of nothing");
    }
    sets.push(
      `take_no = COALESCE(ad_videos.take_no, (SELECT COALESCE(MAX(t.take_no), 0) + 1 ` +
      `FROM ad_videos t WHERE t.org_id = ad_videos.org_id AND t.ad_id = ${adParam}::text))`
    );
  }
  return { sets, params };
}

// ───────────────────────────────────────────────────────────────────────────
// Reads
// ───────────────────────────────────────────────────────────────────────────

export async function findById(tx, { orgId, id, withTranscript = false }) {
  const r = await tx.query(
    `SELECT ${cols(withTranscript)} FROM ad_videos WHERE id = $1 AND org_id = $2`,
    [id, orgId]
  );
  return r.rows[0] || null;
}

/** The Drive poll's dedupe read: have we already got a row for this file? */
export async function findByDriveFileId(tx, { orgId, driveFileId, withTranscript = false }) {
  const r = await tx.query(
    `SELECT ${cols(withTranscript)} FROM ad_videos
      WHERE org_id = $1 AND drive_raw_file_id = $2`,
    [orgId, driveFileId]
  );
  return r.rows[0] || null;
}

/** The Submagic webhook arrives with a projectId and nothing else. */
export async function findBySubmagicProjectId(tx, { projectId, withTranscript = false }) {
  const r = await tx.query(
    `SELECT ${cols(withTranscript)} FROM ad_videos WHERE submagic_project_id = $1`,
    [projectId]
  );
  return r.rows[0] || null;
}

/** Every take of one ad number, oldest first. */
export async function listByAdId(tx, { orgId, adId, withTranscript = false }) {
  const r = await tx.query(
    `SELECT ${cols(withTranscript)} FROM ad_videos
      WHERE org_id = $1 AND ad_id = $2 ORDER BY take_no`,
    [orgId, normalizeAdId(adId)]
  );
  return r.rows;
}

/**
 * The queue read. `status` may be one state, several, or null for all.
 * Asks for limit + 1 so a caller can tell there is a next page, matching
 * src/http/read-api.mjs's page().
 */
export async function listByStatus(tx, { orgId, status = null, limit = 50, offset = 0 }) {
  const wanted = status == null
    ? null
    : (Array.isArray(status) ? status : [status]).map(String);

  if (wanted) {
    const bad = wanted.filter((s) => !isState(s));
    if (bad.length) {
      throw new AdVideoStoreError("unknown_state",
        `unknown state ${bad.join(", ")} — expected one of ${STATES.join(", ")}`);
    }
  }

  const r = await tx.query(
    `SELECT ${ROW_COLUMNS} FROM ad_videos
      WHERE org_id = $1
        AND ($2::text[] IS NULL OR status = ANY($2))
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [orgId, wanted, limit + 1, offset]
  );
  return r.rows;
}

/** The highest take number filmed for this ad, or 0 when none has been. */
export async function lastTakeNo(tx, { orgId, adId }) {
  const r = await tx.query(
    `SELECT COALESCE(MAX(take_no), 0)::int AS n FROM ad_videos
      WHERE org_id = $1 AND ad_id = $2`,
    [orgId, normalizeAdId(adId)]
  );
  return r.rows[0].n;
}

/**
 * Has this ad already finished? 389's partial unique index is what actually
 * refuses a second one; this is the read that lets a caller say so in words
 * instead of handing back a constraint violation.
 */
export async function finishedTake(tx, { orgId, adId }) {
  const r = await tx.query(
    `SELECT ${ROW_COLUMNS} FROM ad_videos
      WHERE org_id = $1 AND ad_id = $2 AND status IN ('approved', 'delivered')`,
    [orgId, normalizeAdId(adId)]
  );
  return r.rows[0] || null;
}

// ───────────────────────────────────────────────────────────────────────────
// Writes
// ───────────────────────────────────────────────────────────────────────────

/**
 * Start a take. `takeNo` is required and is never guessed inside a transaction
 * that could race another one — use nextTake() when you want the next free
 * number, which does the read and the write in one statement.
 */
export async function createTake(tx, {
  orgId, partnerId, adId, takeNo,
  status = "scripted", videoKind = "ad", ...rest
}) {
  if (!isState(status)) {
    throw new AdVideoStoreError("unknown_state", `"${status}" is not a state`);
  }
  const { sets, params } = buildPatch(rest, 7);
  const extraCols = sets.map((s) => s.split(" = ")[0]);
  const extraPlaceholders = sets.map((s) => s.split(" = ")[1]);

  const r = await tx.query(
    `INSERT INTO ad_videos
       (org_id, partner_id, ad_id, take_no, status, video_kind${extraCols.length ? ", " + extraCols.join(", ") : ""})
     VALUES ($1, $2, $3, $4, $5, $6${extraPlaceholders.length ? ", " + extraPlaceholders.join(", ") : ""})
     RETURNING ${FULL_COLUMNS}`,
    [orgId, partnerId, normalizeAdId(adId), normalizeTakeNo(takeNo), status, videoKind, ...params]
  );
  return r.rows[0];
}

/**
 * The next take of an ad — the diagram's rejected → filming arrow, which is a
 * NEW ROW and not this row moving backwards (389's header, states.mjs note 2).
 *
 * The take number is chosen INSIDE the INSERT, so two workers racing cannot
 * both read "2" and both try to write take 2. The loser hits
 * ad_videos_take_uq and can retry.
 */
export async function nextTake(tx, {
  orgId, partnerId, adId, status = "filming", videoKind = "ad", ...rest
}) {
  if (!isState(status)) {
    throw new AdVideoStoreError("unknown_state", `"${status}" is not a state`);
  }
  const clean = normalizeAdId(adId);
  const { sets, params } = buildPatch(rest, 6);
  const extraCols = sets.map((s) => s.split(" = ")[0]);
  const extraPlaceholders = sets.map((s) => s.split(" = ")[1]);

  const r = await tx.query(
    `INSERT INTO ad_videos
       (org_id, partner_id, ad_id, take_no, status, video_kind${extraCols.length ? ", " + extraCols.join(", ") : ""})
     SELECT $1, $2, $3,
            COALESCE((SELECT MAX(v.take_no) FROM ad_videos v
                       WHERE v.org_id = $1 AND v.ad_id = $3), 0) + 1,
            $4, $5${extraPlaceholders.length ? ", " + extraPlaceholders.join(", ") : ""}
     RETURNING ${FULL_COLUMNS}`,
    [orgId, partnerId, clean, status, videoKind, ...params]
  );
  return r.rows[0];
}

/**
 * The Drive poll's write: a row for this raw file, or the one that already
 * exists for it.
 *
 * ON CONFLICT DO NOTHING plus a follow-up SELECT, not DO UPDATE: seeing the
 * same file a second time must change NOTHING about a row that has already
 * moved on to staged or editing. Returns { row, created } so the caller knows
 * whether there is work to do.
 */
export async function claimTake(tx, {
  orgId, partnerId, adId, takeNo, driveFileId, driveName = null,
  videoKind = "ad", status = "raw_landed", ...rest
}) {
  if (!driveFileId) {
    throw new AdVideoStoreError("drive_file_required",
      "claimTake needs the Drive file id — it is what makes the claim repeatable");
  }
  const clean = normalizeAdId(adId);
  const take = normalizeTakeNo(takeNo);
  const { sets, params } = buildPatch(rest, 9);
  const extraCols = sets.map((s) => s.split(" = ")[0]);
  const extraPlaceholders = sets.map((s) => s.split(" = ")[1]);

  const ins = await tx.query(
    `INSERT INTO ad_videos
       (org_id, partner_id, ad_id, take_no, status, video_kind,
        drive_raw_file_id, drive_raw_name${extraCols.length ? ", " + extraCols.join(", ") : ""})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8${extraPlaceholders.length ? ", " + extraPlaceholders.join(", ") : ""})
     ON CONFLICT (org_id, drive_raw_file_id) WHERE drive_raw_file_id IS NOT NULL
     DO NOTHING
     RETURNING ${FULL_COLUMNS}`,
    [orgId, partnerId, clean, take, status, videoKind, driveFileId, driveName, ...params]
  );
  if (ins.rows[0]) return { row: ins.rows[0], created: true };

  const existing = await findByDriveFileId(tx, { orgId, driveFileId, withTranscript: true });
  return { row: existing, created: false };
}

/**
 * Move a take one state forward, and set whatever that step learned.
 *
 * TWO GUARDS, AND THEY CATCH DIFFERENT THINGS:
 *
 *   transition() refuses a move the machine does not allow — a step asking for
 *   something that could never be right, caught before any SQL runs, with the
 *   legal moves in the message.
 *
 *   `AND status = $from` in the WHERE clause refuses a move that WAS right when
 *   the worker read the row and is not right now — a retry whose first run
 *   succeeded, or two workers on one row. That one returns null rather than
 *   throwing, because it is the ordinary case on a queue that retries.
 *
 * A caller that gets null should read the row and stop, not retry.
 */
export async function advance(tx, { orgId, id, from, to, by = "worker", patch = {} }) {
  transition(from, to, { by });

  const { sets, params } = buildPatch(patch, 5, { nextFreeTake: true });
  const assignments = ["status = $4", ...sets];

  const r = await tx.query(
    `UPDATE ad_videos
        SET ${assignments.join(", ")}
      WHERE id = $1 AND org_id = $2 AND status = $3
      RETURNING ${FULL_COLUMNS}`,
    [id, orgId, from, to, ...params]
  );
  return r.rows[0] || null;
}

/**
 * A step broke. `reason` is required — 389's ad_videos_failure_ck refuses a
 * failure with no words, and a pipeline that fails silently is the thing this
 * whole table was built to stop.
 *
 * Callable from any working state, so a worker's catch block never has to know
 * which state it was in to record what went wrong.
 */
export async function markFailed(tx, { orgId, id, from, reason }) {
  const words = String(reason == null ? "" : reason).trim().slice(0, 2000);
  if (!words) {
    throw new AdVideoStoreError("reason_required",
      "a failure must say why — a status of failed with no reason is the silence this table exists to prevent");
  }
  transition(from, "failed");
  const r = await tx.query(
    `UPDATE ad_videos
        SET status = 'failed', failure_reason = $4
      WHERE id = $1 AND org_id = $2 AND status = $3
      RETURNING ${FULL_COLUMNS}`,
    [id, orgId, from, words]
  );
  return r.rows[0] || null;
}

/* The marks a retry has to wipe, and the reason wiping them is the whole fix.
   Ordered the way the pipeline runs, so a reader can follow it.

   ═══════════════════════════════════════════════════════════════════════════
   WITHOUT THIS LIST A RETRIED TAKE NEVER MOVES AGAIN.

   retryFailed() puts the row back at `staged`, and the step that runs at
   `staged` is submagicCreate(). That step's first line is "have I already got a
   project id? then skip" — and a take that failed at, say, the export still has
   its project id. So it skips, returns an EMPTY patch, and because the patch is
   empty the sweeper writes nothing and the status never moves. The row sits at
   `staged` forever, on every pass, silently. The same trap waits at every later
   step: a stale transcript stalls the transcriber, a stale exported_at sends the
   exporter to poll a render that was never asked for. (renamed_at used to
   stall the matcher. The matcher no longer renames raw files — spec §9.1 step
   5 — and no longer reads it; it is cleared here for rows from before.)

   So a retry clears everything downstream of staging. The raw file in Drive and
   the row's identity (ad_id, take_no, script_id) survive, because those are the
   inputs, not the work. script_id in particular is kept on purpose: the match
   is the expensive, model-driven step and the transcript it was made from is
   about to be read again from a project that says the same words. A row with
   script_id set is matched; matchAndRename moves it on without asking again.

   THE TWO SPEND CLAIMS ARE HERE FOR A SECOND REASON. A claim standing with no
   result is how the pipeline refuses to pay twice after a crash, and it is
   DELIBERATELY unclearable by any worker. A person retrying the take is the
   one act that says "I have looked, go again" — so this is the only place they
   come off. See migration 391 and the header of src/ad-videos/pipeline.mjs. */
const RETRY_CLEARS = Object.freeze([
  "submagic_claimed_at", "submagic_project_id",
  "transcript", "transcript_words",
  "renamed_at",
  "broll_placed_at", "broll_count", "broll_notes",
  "export_claimed_at", "exported_at",
  "rendered_at", "finished_url", "storage_final_key", "save_note",
  "notified_at", "notify_error",
  "delivery_note"
]);

/**
 * Put the take back in the queue after a failure — the diagram's "retry the
 * broken step" arrow. Back to `staged`, because the raw file in Drive is the
 * one input that still exists after any later step died, and everything after
 * staging is derived from it.
 *
 * Which is exactly why everything after staging is cleared here. See
 * RETRY_CLEARS above: a retry that leaves last run's marks standing is not a
 * retry, it is a take that stalls at `staged` and never says so.
 *
 * Costs a second Submagic project, and that is the right trade: a person asked
 * for this, the old project's render is the one that failed, and 30 creates an
 * hour is not the constraint a hand-driven retry runs into.
 */
export async function retryFailed(tx, { orgId, id }) {
  transition("failed", "staged");
  const cleared = RETRY_CLEARS.map((c) => `${c} = NULL`).join(", ");
  const r = await tx.query(
    `UPDATE ad_videos
        SET status = 'staged', failure_reason = NULL, ${cleared}
      WHERE id = $1 AND org_id = $2 AND status = 'failed'
      RETURNING ${FULL_COLUMNS}`,
    [id, orgId]
  );
  return r.rows[0] || null;
}

/* Exported for src/ad-videos/store-retry.test.mjs, which proves this list
   covers every mark the pipeline reads as "already done". Read it; never
   mutate it from outside. */
export { RETRY_CLEARS as RETRY_CLEARS_FOR_TEST };

/**
 * The finished file is saved; hand the take a token and wait for Chris.
 *
 * The token is minted HERE rather than by the notifier, so the row is armed
 * before any notification goes out. A notification carrying a token the row
 * does not yet hold is a link that 404s on the one tap that matters.
 */
export async function armForApproval(tx, { orgId, id, from = "rendered", token, expiresAt, patch = {} }) {
  transition(from, "awaiting_approval");
  const { sets, params } = buildPatch(patch, 6);
  const assignments = [
    "status = 'awaiting_approval'",
    "approval_token = $4",
    "approval_expires_at = $5",
    ...sets
  ];
  const r = await tx.query(
    `UPDATE ad_videos
        SET ${assignments.join(", ")}
      WHERE id = $1 AND org_id = $2 AND status = $3
      RETURNING ${FULL_COLUMNS}`,
    [id, orgId, from, token, expiresAt, ...params]
  );
  return r.rows[0] || null;
}

/**
 * Chris said yes on a screen rather than on his phone.
 *
 * `by: "human"` is not decoration — states.mjs refuses a worker-caused move
 * into `approved`, and this function is only ever reached from a request a
 * person made. The phone tap is the other door and lives in token.mjs.
 */
export async function approve(tx, { orgId, id, approvedBy }) {
  const who = String(approvedBy == null ? "" : approvedBy).trim().slice(0, 120);
  if (!who) {
    throw new AdVideoStoreError("approver_required",
      "an approval must name who gave it — 389 refuses an approved_at with no approved_by");
  }
  transition("awaiting_approval", "approved", { by: "human" });
  const r = await tx.query(
    `UPDATE ad_videos
        SET status = 'approved', approved_at = now(), approved_by = $3,
            approval_token = NULL, approval_expires_at = NULL
      WHERE id = $1 AND org_id = $2 AND status = 'awaiting_approval'
      RETURNING ${FULL_COLUMNS}`,
    [id, orgId, who]
  );
  return r.rows[0] || null;
}

/** Chris said no on a screen. A reason is required, same as the phone tap. */
export async function reject(tx, { orgId, id, reason }) {
  const words = String(reason == null ? "" : reason).trim().slice(0, 500);
  if (!words) {
    throw new AdVideoStoreError("reason_required",
      "a rejection must say why, or the next take repeats the same mistake");
  }
  transition("awaiting_approval", "rejected", { by: "human" });
  const r = await tx.query(
    `UPDATE ad_videos
        SET status = 'rejected', rejected_reason = $3,
            approval_token = NULL, approval_expires_at = NULL
      WHERE id = $1 AND org_id = $2 AND status = 'awaiting_approval'
      RETURNING ${FULL_COLUMNS}`,
    [id, orgId, words]
  );
  return r.rows[0] || null;
}

/** The video and the brief are in Paul's folder. The end of the line. */
export async function markDelivered(tx, { orgId, id, paulFolderId, driveFinalFileId }) {
  transition("approved", "delivered");
  const r = await tx.query(
    `UPDATE ad_videos
        SET status = 'delivered', paul_folder_id = $3, drive_final_file_id = $4
      WHERE id = $1 AND org_id = $2 AND status = 'approved'
      RETURNING ${FULL_COLUMNS}`,
    [id, orgId, paulFolderId, driveFinalFileId]
  );
  return r.rows[0] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE SWEEPER'S SIX FUNCTIONS
//
// Added 2026-09-22 at merge. src/workflows/ad-video-sweeper.mjs was written
// against a store that named its functions differently from the one that was
// built, so it checked for them, found nothing, and reported "the store does
// not offer listPending/patch" on every pass. It did not crash — it did
// nothing at all, quietly, forever, which is worse.
//
// These six are that seam, written on the store's side because this file is
// where the state machine and the row-level security already live. Everything
// above stays as it was.
//
// EACH ONE OPENS ITS OWN STAFF TRANSACTION and takes a `db` rather than a `tx`,
// because the sweeper is a workflow and has no transaction to hand in. That is
// the only difference in shape from the functions above.
// ═══════════════════════════════════════════════════════════════════════════

/* The states a worker has a next step for. Anything else is a resting place:
   a person moves it (awaiting_approval), or nothing does (delivered, rejected,
   failed, scripted, filming). Must stay equal to the keys of NEXT_STEP in
   src/ad-videos/pipeline.mjs — src/ad-videos/store-sweeper.test.mjs fails if
   the two lists drift apart. */
export const PENDING_STATES = Object.freeze([
  "raw_landed", "staged", "editing", "transcribed", "matched", "rendered", "approved"
]);

/* The marks a step leaves, added by 390. Patchable, unlike status and the
   approval fields, because a step writes its own mark as part of doing its
   job — but still an ALLOW-LIST, so a typo is an error rather than a column
   that silently never gets written. */
const WORKER_MARKS = Object.freeze([
  "staged_at", "renamed_at", "broll_placed_at", "exported_at", "rendered_at",
  "notified_at", "delivered_at", "broll_count", "broll_notes", "save_note",
  "notify_error", "delivery_note", "drive_brief_file_id", "transcript_words",
  "ad_id", "take_no",
  /* The two spend claims (391). A step writes its claim BEFORE it calls the
     vendor and clears it when the vendor answers, so these are written and
     cleared by the same patch path as every other mark. */
  "submagic_claimed_at", "export_claimed_at",
  /* What the last pass tried and why it stopped (392). Written on EVERY pass,
     including one that waited and moved nothing — a take that retries in
     silence looks identical to a take nobody is touching, and that is how the
     first pilot take sat at `staged` with no explanation. */
  "last_step", "last_step_note", "last_step_at"
]);
for (const c of WORKER_MARKS) PATCHABLE.add(c);

/* The brief Paul gets carries the script's own words, so listPending reads them
   alongside the take. LEFT JOIN, not JOIN: a take whose match has not run yet
   has no script_id, and dropping it from the queue would strand it at
   raw_landed forever. */
const PENDING_COLUMNS = `
  v.id, v.org_id, v.partner_id, v.ad_id, v.take_no, v.script_id, v.script_path,
  v.recorder, v.video_kind, v.status, v.drive_raw_file_id, v.drive_raw_name,
  v.width, v.height, v.duration_seconds, v.resolution_ok, v.storage_raw_key,
  v.source_url, v.transcript, v.transcript_words, v.match_confidence,
  v.submagic_project_id, v.finished_url, v.storage_final_key,
  v.finished_version, v.paul_folder_id, v.drive_final_file_id,
  v.drive_brief_file_id, v.staged_at, v.renamed_at, v.broll_placed_at,
  v.exported_at, v.rendered_at, v.notified_at, v.delivered_at,
  v.submagic_claimed_at, v.export_claimed_at,
  v.broll_count, v.failure_reason, v.created_at, v.updated_at,
  /* What the last pass tried and why it stopped (392). Carried here so the
     state of a stalled take is readable from the same query that lists it,
     rather than needing a second look at a column nothing returns. */
  v.last_step, v.last_step_note, v.last_step_at,
  /* The token, so a buzz can be tried again with the links already sent. */
  v.approval_token,
  s.title, s.hook_text, s.body AS script_body`;

/**
 * lastRawSeenAt(db) → an ISO time, or null when no take has ever landed.
 *
 * What the Drive poll passes as `since`, so it asks for new files instead of
 * the whole folder every five minutes.
 *
 * DELIBERATELY EARLIER THAN THE TRUE ANSWER. This is OUR insert time, not
 * Drive's createdTime, and the two differ by however long the poll took to
 * notice. Asking from a moment that is too LATE loses a take silently and
 * forever; asking from one that is too EARLY costs one listing of files we
 * already hold, and claimTake's ON CONFLICT throws every one of them away. So
 * it deliberately reaches back OVERLAP_MINUTES and the duplicate is absorbed
 * downstream, which is the trade this whole file is built to make.
 */
export const OVERLAP_MINUTES = 30;

export async function lastRawSeenAt(db) {
  return asStaff(async (tx) => {
    const r = await tx.query(
      `SELECT MAX(created_at) - make_interval(mins => $1) AS since
         FROM ad_videos WHERE drive_raw_file_id IS NOT NULL`,
      [OVERLAP_MINUTES]
    );
    const at = r.rows[0]?.since;
    return at ? new Date(at).toISOString() : null;
  }, { db });
}

/**
 * recordRawTake(db, file) → { created, row }
 *
 * A new file in the Raw folder becomes a row at `raw_landed`.
 *
 * *** NO AD NUMBER IS INVENTED HERE. *** Chris's phone calls the file
 * IMG_4471.mov and nothing about it says which ad it is — the transcript match
 * is what gives a take its number (plan §1 step 8). So ad_id and take_no go in
 * NULL and 390's ad_videos_identified_ck refuses to let the row past `matched`
 * without them. A guessed number is worse than no number: it is indistinguish-
 * able from a real one to everybody downstream, including Paul.
 *
 * The ONE exception is a file we named ourselves — a re-run over a folder the
 * renamer already touched. parseVideoName() reads those back, and only those:
 * it returns null for anything that is not one of our four shapes rather than
 * guessing at a number it half-recognises.
 *
 * SAFE TO RUN TWICE. The insert is ON CONFLICT DO NOTHING against
 * ad_videos_drive_raw_uq, so the poll seeing the same file on the next pass
 * changes nothing about a row that has already moved on to staged or editing.
 */
export async function recordRawTake(db, {
  driveFileId, name = null, width = null, height = null,
  durationSeconds = null, videoKind = "ad", orgId = null, partnerId = null
} = {}) {
  if (!driveFileId) {
    throw new AdVideoStoreError("drive_file_required",
      "recordRawTake needs the Drive file id — it is what makes the poll repeatable");
  }

  /* duration_seconds is an INTEGER column and Drive reports the length in
     milliseconds, so a 67.248-second take arrives as a fraction and Postgres
     refuses the whole INSERT. Measured 2026-09-23 against production: the very
     first take ever polled died here with
     `invalid input syntax for type integer: "67.248"`, which meant nothing
     could ever reach Submagic. Round it — a take's length to the nearest second
     is all anything downstream needs, and NULL still means unknown. */
  const seconds = durationSeconds === null || durationSeconds === undefined || durationSeconds === ""
    ? null
    : Number.isFinite(Number(durationSeconds)) ? Math.round(Number(durationSeconds)) : null;

  /* Only our own names are read. Anything else stays unidentified on purpose. */
  let adId = null;
  let takeNo = null;
  const parsed = parseVideoName(name);
  if (parsed) { adId = parsed.adId; takeNo = parsed.takeNo; }

  return asStaff(async (tx) => {
    const who = await houseOwner(tx, { orgId, partnerId });
    if (!who) {
      return { created: false, row: null,
        error: "no house partner found — 377 creates it with slug 'fundhub-house'" };
    }

    const ins = await tx.query(
      `INSERT INTO ad_videos
         (org_id, partner_id, ad_id, take_no, status, video_kind,
          drive_raw_file_id, drive_raw_name, width, height, duration_seconds)
       VALUES ($1, $2, $3, $4, 'raw_landed', $5, $6, $7, $8, $9, $10)
       ON CONFLICT (org_id, drive_raw_file_id) WHERE drive_raw_file_id IS NOT NULL
       DO NOTHING
       RETURNING ${FULL_COLUMNS}`,
      [who.orgId, who.partnerId, adId, takeNo, videoKind,
       driveFileId, name, width, height, seconds]
    );
    if (ins.rows[0]) return { created: true, row: ins.rows[0] };

    const existing = await findByDriveFileId(tx, {
      orgId: who.orgId, driveFileId, withTranscript: true
    });
    return { created: false, row: existing };
  }, { db });
}

/* The org and partner a take of Chris's own belongs to. 377 creates exactly one
   house partner per org with slug 'fundhub-house'; 389 makes partner_id NOT
   NULL for the reason 377:163-165 gives — a row no partner owns is a row no
   policy matches and nobody sees. Passed-in values win, so a test or a second
   org does not have to go through this lookup. */
async function houseOwner(tx, { orgId = null, partnerId = null } = {}) {
  if (orgId && partnerId) return { orgId, partnerId };
  const r = await tx.query(
    `SELECT id, org_id FROM partners
      WHERE slug = 'fundhub-house' AND ($1::uuid IS NULL OR org_id = $1)
      ORDER BY created_at ASC LIMIT 1`,
    [orgId]
  );
  const row = r.rows[0];
  return row ? { orgId: orgId || row.org_id, partnerId: partnerId || row.id } : null;
}

/**
 * findByProject(db, projectId) → the take Submagic's webhook is talking about.
 *
 * THE `db`-TAKING TWIN of findBySubmagicProjectId() above, and it exists
 * because the webhook router had neither of the two things that function needs.
 * It called `findBySubmagicProjectId(db, projectId)` — a pool where a staff
 * transaction belongs, and a bare string where `{ projectId }` belongs — and
 * that fails in the worst available way:
 *
 *   * the string does not destructure, so the query asked for `undefined`; and
 *   * ad_videos carries FORCEd row-level security, so a pool that has not
 *     declared a principal matches ZERO rows. It does not error. It returns
 *     nothing, the webhook answers "no take is waiting on this project", and
 *     every render notification is dropped in silence.
 *
 * The webhook is on an open door with no signature, so it runs as staff for one
 * read and one patch and nothing else. The payload was already verified against
 * Submagic with our own key before this is reached.
 */
export async function findByProject(db, projectId) {
  const id = String(projectId || "").trim();
  if (!id) return null;
  return asStaff(
    (tx) => findBySubmagicProjectId(tx, { projectId: id, withTranscript: true }),
    { db }
  );
}

/**
 * listPending(db, { limit }) → the rows that have a next step, oldest first.
 *
 * OLDEST FIRST, not newest. A take that has been stuck since this morning is
 * the one worth moving; newest-first would let a busy day starve it forever.
 */
export async function listPending(db, { limit = 25, states = PENDING_STATES } = {}) {
  const wanted = (Array.isArray(states) ? states : [states]).map(String);
  const bad = wanted.filter((s) => !isState(s));
  if (bad.length) {
    throw new AdVideoStoreError("unknown_state",
      `unknown state ${bad.join(", ")} — expected one of ${STATES.join(", ")}`);
  }
  return asStaff(async (tx) => {
    const r = await tx.query(
      `SELECT ${PENDING_COLUMNS}
         FROM ad_videos v
         LEFT JOIN ad_scripts s ON s.id = v.script_id
        WHERE v.status = ANY($1)
        ORDER BY v.created_at ASC
        LIMIT $2`,
      [wanted, Math.max(1, Math.min(Number(limit) || 25, 200))]
    );
    return r.rows;
  }, { db });
}

/**
 * patch(db, id, changes) → the row as it now stands, or null.
 *
 * THE ONE WRITE THE SWEEPER MAKES, and the reason it cannot skip approval.
 *
 * A status in `changes` is NOT written as a column. It is routed to advance(),
 * which calls transition(), which refuses a move into `approved` or `rejected`
 * unless the caller is a person (states.mjs HUMAN_ONLY, `by: "worker"` is the
 * default here and is never overridden). So a worker that returned
 * `{ status: "approved" }` — through a bug, a bad vendor payload, or a webhook
 * somebody forged — is refused before any SQL runs. There is no path from this
 * function to an approved video.
 *
 * `status: "failed"` is the one status that is not a transition: it is reachable
 * from every working state and carries its reason, so it goes to markFailed().
 *
 * Everything else is checked against PATCHABLE, which throws by name on a
 * column that does not exist. A patch key that is merely misspelled must not
 * be a write that quietly goes nowhere — that is how an idempotency mark stops
 * being written and a billed export runs every five minutes.
 */
export async function patch(db, id, changes = {}) {
  const { status, failure_reason: reason, ...rest } = changes || {};
  return asStaff(async (tx) => {
    const current = await tx.query(
      `SELECT org_id, status FROM ad_videos WHERE id = $1`, [id]
    );
    const row = current.rows[0];
    if (!row) return null;
    const orgId = row.org_id;

    if (status === "failed") {
      return markFailed(tx, { orgId, id, from: row.status, reason: reason || "a step broke and said nothing" });
    }
    if (status && status !== row.status) {
      return advance(tx, { orgId, id, from: row.status, to: status, patch: rest });
    }
    // No status move — just the marks this step left behind.
    const { sets, params } = buildPatch(rest, 3, { nextFreeTake: true });
    if (!sets.length) return findById(tx, { orgId, id, withTranscript: true });
    const r = await tx.query(
      `UPDATE ad_videos SET ${sets.join(", ")}
        WHERE id = $1 AND org_id = $2
        RETURNING ${FULL_COLUMNS}`,
      [id, orgId, ...params]
    );
    return r.rows[0] || null;
  }, { db });
}

/**
 * candidateScripts(db, { limit }) → the scripts a take could be.
 *
 * What src/ad-videos/match.mjs scores to decide which ad a filmed take is —
 * word overlap over all of them, then Claude on the top 3 only when the
 * overlap is unclear. Archived scripts are
 * left out: a take cannot be a script that was withdrawn, and offering one as a
 * candidate is how a take gets the wrong number.
 */
export async function candidateScripts(db, { limit = 400 } = {}) {
  return asStaff(async (tx) => {
    const r = await tx.query(
      /* Only scripts that carry an ad number, and the number rides along as
         adId — the exact shape src/ad-videos/match.mjs asks for. A script with
         no number cannot be a take's script: the pipeline stops dead on it
         ("the matched script carries no ad number"), so offering it to the
         matcher was only ever a way to lose. Measured 2026-09-24: the one
         script on offer was an unrelated walkthrough with no number. */
      `SELECT id, ad_id AS "adId", title, hook_text, body, version
         FROM ad_scripts
        WHERE archived_at IS NULL AND ad_id IS NOT NULL
        ORDER BY updated_at DESC
        LIMIT $1`,
      [Math.max(1, Math.min(Number(limit) || 400, 1000))]
    );
    return r.rows;
  }, { db });
}

/**
 * mintApprovalLink(db, { orgId, id }) → { token, expiresAt } or null.
 *
 * The credential that goes in the phone notification, written on the row
 * BEFORE the buzz goes out. A notification carrying a token the row does not
 * yet hold is a link that 404s on the one tap that matters.
 *
 * WHY THIS AND NOT armForApproval(). armForApproval moves the row to
 * awaiting_approval in the same statement, and the buzz has to be sent while
 * it is still `rendered` — the notification is what carries the link. So this
 * writes the token only, and the pipeline's own patch makes the state move a
 * moment later through patch() above, past the state machine, as usual.
 *
 * `AND status = 'rendered'` is what keeps this from re-arming a take that is
 * already waiting on Chris: a second mint would kill the link in the
 * notification he is looking at right now.
 */
export async function mintApprovalLink(db, { orgId = null, id, ttlHours } = {}) {
  const { token, expiresAt } = mintApprovalToken(
    ttlHours ? { ttlHours } : {}
  );
  return asStaff(async (tx) => {
    const r = await tx.query(
      `UPDATE ad_videos
          SET approval_token = $2, approval_expires_at = $3
        WHERE id = $1
          AND status = 'rendered'
          AND ($4::uuid IS NULL OR org_id = $4)
        RETURNING id`,
      [id, token, expiresAt, orgId]
    );
    return r.rows[0] ? { token, expiresAt } : null;
  }, { db });
}

/* The write allow-list, under a loud name, so src/ad-videos/seam.test.mjs can
   prove that every column the pipeline writes is one the store will actually
   write. Not part of the API — read it, never mutate it from outside. */
export { PATCHABLE as PATCHABLE_FOR_TEST };
