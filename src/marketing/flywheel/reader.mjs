// @ts-check
// Read the flywheel's stage files the way the dashboard must see them.
//
// Design docs/specs/command-center-design-2026-10-05.md §3.2 (GET
// marketing/flywheel): "The API reads the stamped files from GitHub (Contents API
// with an ETag, pinned to a commit) with pending outbox rows laid on top; the
// function bundle is the fallback only, because outbox commits carry [skip ci]
// and never refresh the bundle." Unit X3.
//
// THREE SOURCES, IN ORDER, AND EVERY ANSWER NAMES ITS OWN:
//   'github'           the file at one commit of the branch (getRef, then every
//                      read pinned to that sha), through src/repo/github.mjs
//                      (the fenced provider; this file makes no call itself).
//   'outbox-pending'   a dashboard save still waiting in repo_outbox, laid on
//                      top: a replace row is the whole new file, an edit row is
//                      re-applied to the copy under it (src/repo/edit-ops.mjs).
//   'bundle-fallback'  the copy shipped with the function (netlify.toml
//                      included_files has marketing/flywheel/**), used only when
//                      GitHub cannot be read (no token, masked token, an error).
//                      On this source every flywheel save the company made is
//                      laid on top, committed or not: the bundle is older than
//                      any of them, and both edit ops are idempotent.
//
// Nothing here writes anything.

import fs from "node:fs";
import path from "node:path";
import { getContents, getRef, listFolder, repoToken } from "../../repo/github.mjs";
import { applyEdit } from "../../repo/edit-ops.mjs";
import { findFlywheelDir, candidateRoots } from "../flywheel-status.mjs";
import { isCampaign } from "./campaigns.mjs";

export const FLYWHEEL_ROOT = "marketing/flywheel";

/** Every file a campaign row or a stage writer reads, relative to the campaign folder. */
export const CAMPAIGN_FILES = Object.freeze([
  "00-OWNER-NOTES.md",
  "01-avatar.md",
  "01-avatar/Market_Language_Bank.md",
  "02-ad-research.md",
  "03-offer.md",
  "04-copy.md",
  "05-ad-strategy.md",
  "06-spend.md"
]);

/** The outbox rows that touch the flywheel, oldest first (the order they were saved). */
export const PENDING_SQL = `
  SELECT id, path, mode, content, edit, committed_sha
    FROM repo_outbox
   WHERE org_id = $1
     AND path LIKE 'marketing/flywheel/%'
   ORDER BY id DESC
   LIMIT 300`;

/**
 * pendingFlywheelRows(db, orgId) → the company's flywheel saves, oldest first.
 * @param {{query: Function}} db
 * @param {string} orgId
 */
export async function pendingFlywheelRows(db, orgId) {
  const r = await db.query(PENDING_SQL, [orgId]);
  return r.rows.slice().reverse().map((row) => ({ ...row, id: Number(row.id) }));
}

/* ETag cache for warm functions: the same file at an unchanged commit answers
   304, which GitHub does not count against the rate limit. */
const ETAGS = new Map();

/** @param {string} p */
function splitCampaignPath(p) {
  const m = /^marketing\/flywheel\/([^/]+)\/(.+)$/.exec(String(p));
  return m ? { campaign: m[1], file: m[2] } : null;
}

/**
 * Lay the outbox rows for one campaign on top of `files` (name -> {text, source}).
 * Returns a new map. A row that cannot apply (a bad edit) leaves the file as it was.
 * @param {Record<string, {text: string|null, source: string}>} files
 * @param {any[]} rows
 * @param {string} campaign
 * @param {{all?: boolean}} [opts]  all: also rows already committed (bundle source)
 */
export function overlayPending(files, rows, campaign, { all = false } = {}) {
  const out = { ...files };
  for (const row of rows || []) {
    if (!all && row.committed_sha) continue;
    const at = splitCampaignPath(row.path);
    if (!at || at.campaign !== campaign) continue;
    const cur = out[at.file]?.text ?? null;
    let next = cur;
    try {
      if (row.mode === "replace") next = String(row.content ?? "");
      else if (row.mode === "edit") next = applyEdit(cur, typeof row.edit === "string" ? JSON.parse(row.edit) : row.edit);
    } catch {
      continue;
    }
    if (next !== cur || row.mode === "replace") {
      // A committed row is only laid on in the fallback (its words are in git,
      // the bundle is just older), so it reads as the fallback copy.
      out[at.file] = { text: next, source: row.committed_sha ? "bundle-fallback" : "outbox-pending" };
    }
  }
  return out;
}

/** Campaign folder names that only exist in the outbox so far. */
export function pendingCampaigns(rows, { all = false } = {}) {
  const out = new Set();
  for (const row of rows || []) {
    if (!all && row.committed_sha) continue;
    const at = splitCampaignPath(row.path);
    if (at && isCampaign(at.campaign)) out.add(at.campaign);
  }
  return [...out];
}

/* ── the bundle ─────────────────────────────────────────────────────────── */

function bundleBase(roots) {
  return findFlywheelDir(roots || candidateRoots());
}

function bundleCampaigns(roots) {
  const base = bundleBase(roots);
  if (!base) return [];
  try {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isCampaign(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function bundleFiles(campaign, roots) {
  const base = bundleBase(roots);
  /** @type {Record<string, {text: string|null, source: string}>} */
  const out = {};
  for (const f of CAMPAIGN_FILES) {
    let text = null;
    if (base) {
      try { text = fs.readFileSync(path.join(base, campaign, f), "utf8"); } catch { text = null; }
    }
    out[f] = { text, source: text == null ? "missing" : "bundle-fallback" };
  }
  return out;
}

/* ── GitHub ─────────────────────────────────────────────────────────────── */

/**
 * @param {string} p
 * @param {{ref: string, env: any, deps: any}} o
 */
async function ghRead(p, { ref, env, deps }) {
  const read = deps.getContents || getContents;
  const key = `${ref}:${p}`;
  const cached = ETAGS.get(p);
  const res = await read(p, { ref, etag: cached && cached.ref === ref ? cached.etag : undefined, env, fetchImpl: deps.fetchImpl });
  if (res.notModified && cached) return { text: cached.text, ok: true };
  if (res.missing) return { text: null, ok: true };
  if (!res.ok) return { text: null, ok: false, error: res.error || `could not read ${p}` };
  if (res.etag) ETAGS.set(p, { ref, etag: res.etag, text: res.content, key });
  return { text: res.content, ok: true };
}

/**
 * readFlywheel({ db, orgId, campaign, env, deps }) → {
 *   source: 'github' | 'bundle-fallback', fallback_reason, commit_sha,
 *   campaigns: [names],            every folder, plus ones only in the outbox
 *   files: { name: {text, source} } | null   the asked campaign's files
 * }
 *
 * `deps` lets a test hand in getRef / listFolder / getContents / pendingRows /
 * bundleRoots. With no campaign, only the list is read.
 * @param {{db?: any, orgId?: string, campaign?: string|null, env?: any, deps?: any}} [args]
 */
export async function readFlywheel({ db, orgId, campaign = null, env = process.env, deps = {} } = {}) {
  const rows = deps.pendingRows
    ? await deps.pendingRows()
    : (db && orgId ? await pendingFlywheelRows(db, orgId) : []);

  let source = "github";
  let fallbackReason = null;
  let sha = null;
  /** @type {string[]} */
  let folders = [];
  /** @type {Record<string, {text: string|null, source: string}>|null} */
  let files = null;

  const hasToken = deps.getRef ? true : Boolean(repoToken(env));
  if (!hasToken) {
    source = "bundle-fallback";
    fallbackReason = "GITHUB_REPO_TOKEN is not set (or is masked), so the files were read from the copy built into the site.";
  } else {
    try {
      const ref = await (deps.getRef || getRef)({ env, fetchImpl: deps.fetchImpl });
      if (!ref.ok || !ref.sha) throw new Error(ref.error || "GitHub did not say which commit the branch is on");
      sha = ref.sha;
      const list = await (deps.listFolder || listFolder)(FLYWHEEL_ROOT, { ref: sha, env, fetchImpl: deps.fetchImpl });
      if (!list.ok) throw new Error(list.error || "GitHub did not list the flywheel folder");
      folders = list.entries.filter((e) => e.type === "dir" && isCampaign(e.name)).map((e) => e.name);
      if (campaign) {
        const reads = await Promise.all(CAMPAIGN_FILES.map((f) =>
          ghRead(`${FLYWHEEL_ROOT}/${campaign}/${f}`, { ref: /** @type {string} */ (sha), env, deps })));
        const bad = reads.find((r) => !r.ok);
        if (bad) throw new Error(bad.error || "GitHub did not answer");
        files = {};
        CAMPAIGN_FILES.forEach((f, i) => {
          /** @type {any} */ (files)[f] = { text: reads[i].text, source: reads[i].text == null ? "missing" : "github" };
        });
      }
    } catch (err) {
      source = "bundle-fallback";
      fallbackReason = `GitHub could not be read (${String((err && /** @type {any} */ (err).message) || err).slice(0, 200)}), so the files were read from the copy built into the site.`;
      sha = null;
      files = null;
    }
  }

  const all = source === "bundle-fallback";
  if (all) {
    folders = bundleCampaigns(deps.bundleRoots);
    if (campaign) files = bundleFiles(campaign, deps.bundleRoots);
  }
  if (campaign && files) files = overlayPending(files, rows, campaign, { all });

  const campaigns = [...new Set([...folders, ...pendingCampaigns(rows, { all })])].sort();
  return { source, fallback_reason: fallbackReason, commit_sha: sha, campaigns, files };
}

/**
 * readRepoFile(path, { env, deps }) → { text, source: 'github'|'bundle'|'missing' }
 * One read of any repo file (a read, never a write): the branch head on GitHub,
 * else the copy beside the code (locally the repo; on Netlify only what
 * included_files ships). A file that is in neither is "missing", which the
 * caller reports as a finding.
 * @param {string} p
 * @param {{env?: any, deps?: any, roots?: string[]}} [opts]
 */
export async function readRepoFile(p, { env = process.env, deps = {}, roots } = {}) {
  if (deps.getContents || repoToken(env)) {
    try {
      const res = await (deps.getContents || getContents)(p, { env, fetchImpl: deps.fetchImpl });
      if (res.ok && !res.missing && typeof res.content === "string") return { text: res.content, source: "github" };
      if (res.ok && res.missing) return { text: null, source: "missing" };
    } catch { /* fall through to the copy beside the code */ }
  }
  for (const root of roots || candidateRoots(env)) {
    try { return { text: fs.readFileSync(path.join(root, p), "utf8"), source: "bundle" }; } catch { /* next */ }
  }
  return { text: null, source: "missing" };
}

/** Test hook: forget the ETag cache. */
export function clearReaderCache() {
  ETAGS.clear();
}
