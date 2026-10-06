// src/ad-videos/merge-takes-step.mjs — the one call the sweeper makes before
// a take is uploaded to Submagic.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT IT DOES, FOR ONE ROW AT `staged` (and nothing at any other state):
//
//   no file name           → the old way: this take alone, with a note.
//   the only take of its   → the old way: this take alone, with a note
//   angle (and settled)      ("one take — sent as it is").
//   another take carries   → this row is closed (failed, reason starts with
//   the angle's master       JOINED_PREFIX) and NOTHING is sent for it.
//   more takes may land    → hold, nothing sent, the row says how long.
//   a name with no angle,  → hold, nothing sent, the row says to rename it
//   or not NAMING.md         (the angle words decide what joins).
//   2+ takes, this row     → build ONE master from all of them, close the
//   carries them             other waiting takes, then hand the master's
//                            bytes to the unchanged Submagic step.
//   2+ takes, no ffmpeg    → hold, nothing sent, the row says where to run
//   or whisper.cpp here      the join (the Netlify worker has neither).
//
// NEVER A LONE TAKE WHEN OTHER TAKES OF ITS ANGLE EXIST
// (.claude/rules/ad-video-best-of-clips.md). A bug in here holds the take; it
// never falls through to sending one take alone.
// ═══════════════════════════════════════════════════════════════════════════
//
// The Submagic step itself (src/ad-videos/pipeline.mjs submagicCreate) is not
// touched. It downloads `row.drive_raw_file_id` through the `drive` port and
// uploads what comes back; for a joined angle this hands it a `drive` whose
// downloadFile answers that one id with the master's bytes. Its claim, its
// resume rule and its money guard all work exactly as before.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  decideJoin, parseAdPrefix, parseScriptMarkdown, findScript, groupLabel,
  SCRIPT_SOURCES, JOINED_PREFIX, PRE_SUBMAGIC
} from "./merge-takes.mjs";
import { resolveLocalJoiner } from "./merge-takes-media.mjs";
import { BIG_FILE_TIMEOUT_MS } from "./pipeline.mjs";

const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/* The verdicts, in the exact shape src/ad-videos/pipeline.mjs advance()
   returns, so the sweeper writes them down with its own unchanged code. */
const STEP = "joinTakes";
const hold = (why) => ({ ok: false, retryable: true, patch: {}, error: String(why).slice(0, 1000), note: null, step: STEP });
const closeInto = (reason) => ({
  ok: true, retryable: false, step: STEP, error: null, note: reason,
  patch: { status: "failed", failure_reason: String(reason).slice(0, 300) }
});
const dead = (why) => ({
  ok: false, retryable: false, step: STEP, note: null, error: String(why),
  patch: { status: "failed", failure_reason: String(why).slice(0, 300) }
});
const skipped = (note) => ({ ok: true, retryable: false, patch: {}, note, skipped: true, error: null, step: STEP });

/**
 * listAngleTakes(db, { store, row }) → every take whose name starts with this
 * row's "{Offer} Ad {n}", whatever its state, as long as it has a Drive file.
 *
 * SELECT only. One staff transaction through the store's own asStaff(), the
 * same way every store read crosses ad_videos' FORCEd row-level security.
 * The prefix also catches "SLO Ad 70 …"; decideJoin() reads the names back
 * and keeps only the exact angle.
 */
export async function listAngleTakes(db, { store, row } = {}) {
  const ad = parseAdPrefix(row?.drive_raw_name);
  if (!ad) return [];
  if (typeof store?.asStaff !== "function") throw new Error("the store offers no asStaff() to read the other takes with");
  const offerWords = String(row.drive_raw_name).trim().slice(0, String(row.drive_raw_name).trim().search(/\s+Ad\s+\d/i));
  const esc = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `${esc(offerWords)} Ad ${ad.adNumber}%`;
  return store.asStaff(async (tx) => {
    const r = await tx.query(
      `SELECT id, status, take_no, drive_raw_file_id, drive_raw_name, created_at,
              width, height, duration_seconds, video_kind,
              submagic_project_id, submagic_claimed_at, failure_reason
         FROM ad_videos
        WHERE drive_raw_file_id IS NOT NULL
          AND drive_raw_name ILIKE $1 ESCAPE '\\'
        ORDER BY created_at ASC
        LIMIT 500`,
      [pattern]
    );
    return r.rows;
  }, { db });
}

/** Every script in SCRIPT_SOURCES, in that order. A missing file is skipped. */
export function loadScripts({ readFile = (p) => fs.readFileSync(p, "utf8"), root = REPO, sources = SCRIPT_SOURCES } = {}) {
  const out = [];
  for (const rel of sources) {
    let text;
    try { text = readFile(path.join(root, rel)); } catch { continue; }
    out.push(...parseScriptMarkdown(text, rel));
  }
  return out;
}

/** The Drive port with ONE id answered by the master instead of the take. */
export function withMasterBytes(drive, fileId, bytes) {
  return {
    ...drive,
    downloadFile: async (id, opts) => (id === fileId
      ? { ok: true, bytes, byteLength: bytes.length, contentType: "video/mp4", master: true }
      : drive.downloadFile(id, opts))
  };
}

/**
 * joinBeforeSubmagic(db, row, { store, ports }) → { out?, ports?, note? }
 *
 *   out    a finished verdict — the sweeper writes it INSTEAD of running the
 *          Submagic step (hold, close, skip or fail)
 *   ports  port overrides for the Submagic step (the master's bytes)
 *   note   a plain line for the pass report
 *   {}     not this step's business — the Submagic step runs as before
 *
 * `ports.join` (tests only) may carry { listTakes, joiner, scripts, now,
 * settleMinutes, keepWorkDir }. Production passes nothing and gets the real
 * database read, the scripts in the repo, the real clock and whatever ffmpeg
 * and whisper.cpp this machine has.
 */
export async function joinBeforeSubmagic(db, row, { store, ports = {} } = {}) {
  if (String(row?.status || "") !== "staged") return {};
  /* Already at Submagic, or a create was started: the Submagic step's own
     resume and claim rules decide. This step never second-guesses money. */
  if (has(row.submagic_project_id) || has(row.submagic_claimed_at)) return {};

  const opts = ports.join || {};
  const env = ports.env || process.env;
  try {
    const now = typeof opts.now === "function" ? opts.now() : (opts.now ?? Date.now());
    const takes = has(row.drive_raw_name)
      ? await (opts.listTakes || listAngleTakes)(db, { store, row })
      : [];
    const d = decideJoin(row, takes, { now, settleMinutes: opts.settleMinutes });

    if (d.action === "proceed") return { note: d.note };
    if (d.action === "hold") return { out: hold(d.note) };
    if (d.action === "skip") return { out: skipped(d.note) };
    if (d.action === "close") return { out: closeInto(d.reason) };

    /* d.action === "join" */
    const label = groupLabel(d.parsed);
    const joiner = opts.joiner || await resolveLocalJoiner({ env });
    if (!joiner?.ok) {
      return { out: hold(
        `${d.note} must become ONE master before Submagic sees them, and ${joiner?.why || "no joiner is available here"}. ` +
        "Nothing was sent; every take is safe in Drive. Run the join pass where ffmpeg and whisper.cpp exist: " +
        "node scripts/ad-video-join-takes.mjs --live"
      ) };
    }

    const scripts = opts.scripts || loadScripts();
    const script = findScript(scripts, d.parsed);
    if (!script) {
      return { out: hold(
        `${d.note}: no script titled "Ad ${d.parsed.adNumber} — ${d.parsed.angle}" was found in ${SCRIPT_SOURCES.join(", ")}. ` +
        "The join puts lines in script order and cannot without the script. Nothing was sent."
      ) };
    }
    if (typeof ports.drive?.downloadFile !== "function") return { out: hold(`${d.note}: the Drive port cannot download the takes`) };

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-join-"));
    try {
      const built = await joiner.buildMaster({
        members: d.members,
        script,
        workDir,
        fetchTake: async (m) => {
          const got = await ports.drive.downloadFile(m.drive_raw_file_id, { env, timeoutMs: BIG_FILE_TIMEOUT_MS });
          if (!got?.ok) return { ok: false, error: got?.error || "Drive returned nothing" };
          const ext = (/\.([A-Za-z0-9]{2,5})$/.exec(String(m.drive_raw_name || "")) || [])[1] || "mp4";
          const file = path.join(workDir, `take-${m.takeNo}.${ext.toLowerCase()}`);
          fs.writeFileSync(file, Buffer.from(got.bytes));
          return { ok: true, path: file };
        }
      });
      if (!built?.ok) {
        const why = `${d.note} could not be joined: ${built?.error || "the join returned nothing"}`;
        return { out: built?.retryable === false ? dead(why) : hold(`${why}. Nothing was sent.`) };
      }

      /* CLOSE THE OTHER WAITING TAKES BEFORE A BYTE GOES OUT. If one of them
         were still `staged` when this master reached Submagic, its own pass
         would find no other waiting take, carry the angle itself, and pay for
         a second master. A close that does not land stops the upload. */
      for (const m of d.members) {
        if (m.id === row.id || !PRE_SUBMAGIC.includes(m.status) || has(m.submagic_project_id)) continue;
        const leadTake = d.members.find((x) => x.id === row.id)?.takeNo;
        const reason = `${JOINED_PREFIX} ${label} Take ${m.takeNo} went into the master carried by Take ${leadTake} (row ${row.id})`;
        let written = null;
        try { written = await store.patch(db, m.id, { status: "failed", failure_reason: reason.slice(0, 300) }); }
        catch { written = null; }
        if (!written) {
          return { out: hold(`${d.note}: Take ${m.takeNo} could not be marked as joined, so the master was NOT sent (it would be paid for twice)`) };
        }
      }

      const bytes = fs.readFileSync(built.path);
      return {
        ports: { drive: withMasterBytes(ports.drive, row.drive_raw_file_id, bytes) },
        note: `${d.note} joined into one master — ${built.summary}`
      };
    } finally {
      if (!opts.keepWorkDir) {
        try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* our own temp folder; the OS clears it too */ }
      }
    }
  } catch (err) {
    /* A bug here must never become a lone take at Submagic. */
    return { out: hold(`the join step broke, so nothing was sent: ${String(err?.message || err).slice(0, 300)}`) };
  }
}
