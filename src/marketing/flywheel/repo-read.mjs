// @ts-check
// Read a flywheel file the way the dashboard must: GitHub first, pending saves on top,
// the copy bundled with the function last.
//
// Design docs/specs/command-center-design-2026-10-05.md §3.2 Endpoints and §6 "Slice 1
// additions": "a GitHub READ path (Contents and Trees API with an ETag, pinned to a
// commit SHA) with pending outbox rows laid on top ... with the function bundle as the
// fallback only and every response naming its source". The bundle is only a fallback
// because outbox commits carry [skip ci] and never refresh it. Unit X1.
//
//   readRepoFile(db, { orgId, path, env, ref }) →
//     { content: string | null, source: 'outbox-pending' | 'github' | 'bundle-fallback' | 'missing', sha? }
//
//   source 'outbox-pending'  a save from the dashboard is waiting in repo_outbox: its
//                            whole file (a replace) or the newest copy with the waiting
//                            edits applied (an edit), in the order they were queued
//   source 'github'          GITHUB_REPO_TOKEN works: the file at the pinned commit
//   source 'bundle-fallback' the copy netlify.toml shipped with this function
//                            (included_files "marketing/flywheel/**")
//
// Reads only. Nothing here writes to GitHub or the database.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getContents, getRef, repoToken } from "../../repo/github.mjs";
import { applyEdit } from "../../repo/edit-ops.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where a deployed or local copy of the repo might be. First hit wins. */
export function bundleRoots(env = process.env) {
  return [...new Set([path.resolve(HERE, "../../.."), env.LAMBDA_TASK_ROOT, process.cwd()]
    .filter((p) => typeof p === "string" && p.length > 0))];
}

/** A repo path the bundle reader will open: relative, no "..", under marketing/. */
function safeRel(p) {
  const s = String(p || "");
  return /^marketing\/[A-Za-z0-9_./ ()-]+$/.test(s) && !s.split("/").includes("..") ? s : null;
}

/** The bundled copy of a repo file, or null. */
export function readBundleFile(repoPath, { roots = bundleRoots() } = {}) {
  const rel = safeRel(repoPath);
  if (!rel) return null;
  for (const root of roots) {
    const full = path.join(root, rel);
    try {
      if (fs.statSync(full).isFile()) return fs.readFileSync(full, "utf8");
    } catch { /* not here */ }
  }
  return null;
}

/** Is there a bundled folder at this repo path? */
export function bundleDirExists(repoPath, { roots = bundleRoots() } = {}) {
  const rel = safeRel(repoPath);
  if (!rel) return false;
  return roots.some((root) => {
    try { return fs.statSync(path.join(root, rel)).isDirectory(); } catch { return false; }
  });
}

/** Saves waiting in repo_outbox for one path, oldest first. */
export async function pendingSaves(db, { orgId, path: p }) {
  if (!db || !orgId) return [];
  const r = await db.query(
    `SELECT id, mode, content, edit FROM repo_outbox
      WHERE org_id = $1 AND path = $2 AND committed_sha IS NULL
      ORDER BY id`,
    [orgId, p]
  );
  return r.rows;
}

/** Does any waiting save live under this folder? (A new campaign before its commit lands.) */
export async function pendingUnder(db, { orgId, prefix }) {
  if (!db || !orgId) return false;
  const r = await db.query(
    `SELECT 1 FROM repo_outbox WHERE org_id = $1 AND committed_sha IS NULL AND path LIKE $2 LIMIT 1`,
    [orgId, `${String(prefix).replace(/[%_]/g, "\\$&")}%`]
  );
  return r.rows.length > 0;
}

/**
 * The newest commit the reads are pinned to, or null when GitHub cannot be read.
 * @param {{ env?: Record<string, any>, deps?: { getRef?: Function } }} [opts]
 */
export async function pinnedRef({ env = process.env, deps = {} } = {}) {
  if (!repoToken(env)) return null;
  const gr = deps.getRef || getRef;
  try {
    const r = await gr({ env });
    return r && r.ok && r.sha ? r.sha : null;
  } catch {
    return null;
  }
}

/**
 * readRepoFile(db, { orgId, path, env, ref, deps }) → { content, source, sha? }
 * @param {any} db
 * @param {{ orgId?: string, path: string, env?: Record<string, any>, ref?: string | null,
 *           deps?: { getContents?: Function, getRef?: Function, roots?: string[] } }} opts
 */
export async function readRepoFile(db, { orgId, path: p, env = process.env, ref = undefined, deps = {} }) {
  /** @type {{ content: string | null, source: string, sha?: string | null }} */
  let base = { content: null, source: "missing" };

  if (repoToken(env)) {
    const pin = ref === undefined ? await pinnedRef({ env, deps }) : ref;
    if (pin) {
      const gc = deps.getContents || getContents;
      try {
        const r = await gc(p, { ref: pin, env });
        if (r && r.ok && !r.missing && typeof r.content === "string") base = { content: r.content, source: "github", sha: pin };
        else if (r && r.ok && r.missing) base = { content: null, source: "github", sha: pin };
      } catch { /* fall back to the bundle */ }
    }
  }
  if (base.source === "missing") {
    const b = readBundleFile(p, { roots: deps.roots || bundleRoots(env) });
    if (b != null) base = { content: b, source: "bundle-fallback" };
  }

  const waiting = await pendingSaves(db, { orgId, path: p }).catch(() => []);
  if (!waiting.length) return base;
  let content = base.content;
  for (const row of waiting) {
    if (row.mode === "replace" && typeof row.content === "string") content = row.content;
    else if (row.mode === "edit" && row.edit) {
      try { content = applyEdit(content, row.edit); } catch { /* the drain records why; keep the copy */ }
    }
  }
  return { content, source: "outbox-pending", sha: base.sha ?? null };
}
