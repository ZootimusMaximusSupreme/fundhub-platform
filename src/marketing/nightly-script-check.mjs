// @ts-check
// src/marketing/nightly-script-check.mjs — every night, does each script's repo file
// still hold the words the database holds? Where it does not, the database wins.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §7.9: "The nightly check reads the
// folder's file list once and compares body hashes. The database wins, and any fixes show
// on the health card." §7.4: imported rows stay out of the nightly check. Plan unit U35.
//
// THE JOB: nightly_script_check {day} (src/marketing/job-kinds.mjs, group 'system'). The
// clock queues one per night (src/marketing/schedule.mjs nightlyDay).
//
// WHAT IT CHECKS. Every live script the screens can see (scripts-store.mjs VISIBLE_SQL:
// never an import, never a draft of a batch that is not released yet — the repo is
// public), that the app has put in the repo (repo_path set) or that is a machine script
// in a released batch (it should have a file).
//
// HOW, WITH AS FEW GITHUB CALLS AS IT CAN:
//   1. One staff read: those scripts, plus, for their paths, which have a save still
//      waiting in repo_outbox (skipped: a newer file is already on its way) and the last
//      file the app committed there (repo_outbox.content of the newest committed
//      'replace' row).
//   2. The file list, once: one Contents API listing of each folder those paths are in
//      (marketing/ads/scripts/machine/<week>/). Each entry carries git's blob hash.
//   3. Per script:
//        no file at its path                      → missing
//        the blob hash equals the hash of the last file the app committed there
//                                                 → the body is that file's body
//        else                                     → read that one file (someone changed
//                                                   it by hand, or the app's copy is gone)
//      then sha256 of the body (script-file.mjs bodyHash) against the database's body.
//      Equal → fine. Different, missing or unreadable as a script file → mismatch.
//   4. One staff transaction queues a 'replace' row (the database's file, serializeScript
//      through scripts-store.mjs queueScriptFile) for each mismatch, and nothing else.
//      A file that matches never gets a row.
//
// THE COUNTS ({checked, ok, missing, mismatched, waiting, unreadable, extra, queued}) are
// the job's result (marketing_jobs.result) and its log line. GET marketing/health does
// not show them yet (gap in the U35 section of docs/journeys/ad-script-flow.md).
//
// NEVER DELETES. A file in the folder that no script owns is only counted ('extra').
// No transaction is open during a GitHub call.

import { createHash } from "node:crypto";
import { listFolder as defaultListFolder, getContents as defaultGetContents, repoToken } from "../repo/github.mjs";
import { parseScript, bodyHash, SCRIPTS_DIR } from "./script-file.mjs";
import { queueScriptFile, VISIBLE_SQL } from "./scripts-store.mjs";
import { inStaff, MACHINE } from "./batch-run.mjs";

/** git's blob hash of a text file: sha1("blob <bytes>\0" + content). Pure. @param {string} content */
export function gitBlobSha(content) {
  const text = String(content ?? "");
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(text, "utf8")}\0`, "utf8")
    .update(text, "utf8")
    .digest("hex");
}

/** The folder of a repo path, without a trailing slash. @param {string} p */
export function folderOf(p) {
  const i = String(p).lastIndexOf("/");
  return i > 0 ? String(p).slice(0, i) : "";
}

/** The body of a script file, or null when it is not one this app wrote. @param {unknown} content */
export function bodyOfFile(content) {
  if (typeof content !== "string") return null;
  try { return parseScript(content).body; } catch { return null; }
}

/**
 * compareScripts(scripts, {listing, committed, waiting, fetched}) → the verdict per
 * script. Pure.
 *   scripts    [{id, body, repo_path}]
 *   listing    Map(path → blob sha) of the folders read
 *   committed  Map(path → the last file the app committed there)
 *   waiting    Set(path) with a save still in repo_outbox
 *   fetched    Map(path → file text) of files read one by one
 * → [{id, path, verdict: 'ok'|'missing'|'mismatched'|'waiting'|'needs_read'|'unreadable'}]
 * @param {any[]} scripts
 * @param {{ listing: Map<string,string>, committed: Map<string,string>, waiting: Set<string>, fetched?: Map<string,string|null> }} known
 */
export function compareScripts(scripts, { listing, committed, waiting, fetched = new Map() }) {
  return scripts.map((s) => {
    const path = s.repo_path || null;
    const id = String(s.id);
    if (!path) return { id, path, verdict: "missing" };
    if (waiting.has(path)) return { id, path, verdict: "waiting" };
    const sha = listing.get(path);
    if (!sha) return { id, path, verdict: "missing" };
    let text = null;
    const ours = committed.get(path);
    if (typeof ours === "string" && gitBlobSha(ours) === sha) text = ours;
    else if (fetched.has(path)) text = fetched.get(path) ?? null;
    else return { id, path, verdict: "needs_read" };
    const body = bodyOfFile(text);
    if (body == null) return { id, path, verdict: text == null ? "unreadable" : "mismatched" };
    return { id, path, verdict: bodyHash(body) === bodyHash(s.body) ? "ok" : "mismatched" };
  });
}

/**
 * checkScriptFiles(db, env, {orgId, day}, deps) → the counts (see the header), or
 * {skipped:'no_token'|'dry_run'} when GitHub cannot be read. Throws when a folder listing
 * fails for another reason (the queue tries again).
 * @param {any} db @param {Record<string, any>} env
 * @param {{ orgId: string, day?: string|null }} args @param {any} [deps]
 */
export async function checkScriptFiles(db, env, { orgId, day = null }, deps = {}) {
  if (!orgId) throw new TypeError("checkScriptFiles: orgId is required");
  const listFolder = deps.listFolder || defaultListFolder;
  const getContents = deps.getContents || defaultGetContents;
  if (!deps.listFolder && !repoToken(env)) return { skipped: "no_token", day };

  // 1. What the database says, in one short staff read.
  const read = await inStaff(db, deps, async (tx) => {
    const scripts = (await tx.query(
      `SELECT s.id, s.body, s.repo_path, s.updated_at
         FROM ad_scripts s
         LEFT JOIN marketing_batches b ON b.id = s.batch_id
        WHERE s.org_id = $1
          AND s.archived_at IS NULL
          AND ${VISIBLE_SQL}
          AND (s.repo_path IS NOT NULL OR (s.source = 'machine' AND s.batch_id IS NOT NULL))
        ORDER BY s.created_at, s.id`,
      [orgId]
    )).rows;
    const paths = [...new Set(scripts.map((s) => s.repo_path).filter(Boolean))];
    if (!paths.length) return { scripts, waiting: new Set(), committed: new Map() };
    const waiting = new Set((await tx.query(
      `SELECT DISTINCT path FROM repo_outbox
        WHERE org_id = $1 AND committed_sha IS NULL AND path = ANY($2::text[])`,
      [orgId, paths]
    )).rows.map((r) => r.path));
    const committed = new Map((await tx.query(
      `SELECT DISTINCT ON (path) path, content
         FROM repo_outbox
        WHERE org_id = $1 AND mode = 'replace' AND committed_sha IS NOT NULL AND path = ANY($2::text[])
        ORDER BY path, committed_at DESC, id DESC`,
      [orgId, paths]
    )).rows.map((r) => [r.path, r.content]));
    return { scripts, waiting, committed };
  });

  // 2. The file list, once: one listing per folder (no transaction open).
  /** @type {Map<string, string>} */
  const listing = new Map();
  let extra = 0;
  const wanted = new Set(read.scripts.map((s) => s.repo_path).filter(Boolean));
  const folders = [...new Set([...wanted].map(folderOf).filter((f) => f && f.startsWith(SCRIPTS_DIR.replace(/\/$/, ""))))].sort();
  for (const folder of folders) {
    const r = await listFolder(folder, { env, fetchImpl: deps.fetchImpl });
    if (r && r.blocked) return { skipped: "dry_run", day };
    if (!r || !r.ok) throw new Error(`could not list ${folder}: ${(r && r.error) || "no answer"}`);
    for (const e of r.entries || []) {
      if (e.type !== "file") continue;
      listing.set(e.path, String(e.sha || ""));
      if (!wanted.has(e.path)) extra += 1;
    }
  }

  // 3. Compare; read only the files whose hash the app does not already know.
  let verdicts = compareScripts(read.scripts, { listing, committed: read.committed, waiting: read.waiting });
  /** @type {Map<string, string|null>} */
  const fetched = new Map();
  for (const v of verdicts) {
    if (v.verdict !== "needs_read" || fetched.has(v.path)) continue;
    const r = await getContents(v.path, { env, fetchImpl: deps.fetchImpl });
    fetched.set(v.path, r && r.ok && typeof r.content === "string" ? r.content : null);
  }
  if (fetched.size) verdicts = compareScripts(read.scripts, { listing, committed: read.committed, waiting: read.waiting, fetched });

  // 4. The database wins: one replace row per mismatch.
  const fix = verdicts.filter((v) => v.verdict === "missing" || v.verdict === "mismatched");
  const byId = new Map(read.scripts.map((s) => [String(s.id), s]));
  const queueFile = deps.queueScriptFile || queueScriptFile;
  if (fix.length) {
    await inStaff(db, deps, async (tx) => {
      for (const v of fix) {
        const s = byId.get(v.id);
        const stamp = s && s.updated_at ? new Date(s.updated_at).getTime() : 0;
        await queueFile(tx, { orgId, scriptId: v.id, opId: `u35:nightly:${day || "now"}:${v.id}:${stamp}`, updatedBy: MACHINE });
      }
    });
  }

  const count = (k) => verdicts.filter((v) => v.verdict === k).length;
  return {
    day,
    checked: verdicts.length,
    ok: count("ok"),
    missing: count("missing"),
    mismatched: count("mismatched"),
    waiting: count("waiting"),
    unreadable: count("unreadable"),
    extra,
    queued: fix.length,
    folders: folders.length,
    files_read: fetched.size
  };
}

/** nightly_script_check's handler. @param {any} job @param {{ db?: any, env?: any, deps?: any }} [ctx] */
export async function run(job, ctx = {}) {
  const p = (job && job.payload) || {};
  const out = await checkScriptFiles(ctx.db, ctx.env || process.env, { orgId: job.org_id, day: typeof p.day === "string" ? p.day : null }, ctx.deps || {});
  console.log(`[nightly-script-check] org ${String(job.org_id).slice(0, 8)}: ${JSON.stringify(out)}`);
  return out;
}
