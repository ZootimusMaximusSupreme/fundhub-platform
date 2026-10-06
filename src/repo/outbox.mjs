// @ts-check
// The repo outbox: every app save lands in the database AND in git.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 2 and §2 item 8.
// Table: db/migrations/412_repo_outbox.sql. Diagram: the U05 section of
// docs/journeys/marketing-dashboard-flow.md.
//
//   enqueueRepoWrite(tx, {...})  — inside the CALLER's transaction, next to the
//                                  database change it mirrors. A rolled-back
//                                  save leaves no row. Refuses a path outside
//                                  src/repo/allow-list.mjs. Then the caller
//                                  wakes the worker (src/marketing/wake.mjs)
//                                  AFTER its transaction commits.
//   claimOutbox(db, {claimId})   — one short transaction that stamps a 10-minute
//                                  lease on every waiting row.
//   drainOutbox(db, env, deps)   — the worker's pass (at most once a minute):
//                                  claim, then one commit on GitHub with no lock
//                                  and no transaction held across any call.
//
// ═══════════════════════════════════════════════════════════════════════════
// POOLER-SAFE: A LEASE, NOT A SESSION LOCK.
//
// The app reaches Postgres through the Supabase TRANSACTION pooler (port 6543).
// There a session-level advisory lock (pg_try_advisory_lock / pg_advisory_unlock)
// or a bare SET sticks to whichever shared backend ran it and leaks to the next
// client — a bare SET once left the live pool read-only. So this file uses only
// pg_try_advisory_xact_lock, which ends with its own transaction, and the real
// "only one drain at a time" guard is the lease: claimOutbox refuses while any
// uncommitted row holds a claim younger than LEASE_MINUTES. One global key and
// one batch in flight, because there is one repo and one branch, and an older
// replace must never land after a newer one.
//
// src/http/repo-outbox.pg.test.mjs greps the tree for a session lock or a bare
// SET and fails if one appears.
// ═══════════════════════════════════════════════════════════════════════════
//
// WHAT A DRAIN DOES WITH EACH OUTCOME
//   committed            committed_sha + committed_at on every row in the commit.
//   already committed    an id found in an "Outbox: <ids>" trailer in the last 20
//                        commits is marked done with that commit; it is never
//                        committed twice (a crash after the push).
//   branch moved         (422 "not a fast forward", or 409) re-read the branch,
//                        re-apply every edit onto the new head, retry — up to 3
//                        tries. Still moving: claim cleared, next pass retries.
//   retryable            (no answer, 5xx, 429, rate limit) claim cleared, error
//                        kept, next pass retries.
//   any other refusal    (another 422 such as branch protection, 401, 403, 404)
//                        error recorded on the rows for the health card; the
//                        claim stays and expires after 10 minutes — no hammering.
//   a save that does not fit its file (Part 0 has no rule 7, a lane with no rule,
//                        JSON that would not load) — that row only: error
//                        recorded, claim cleared, retried next pass against the
//                        newest file. The other rows in the batch still commit.
//   held by the dry-run fence (transmit blocked:true) — claim cleared, the
//                        attempt is NOT counted, {skipped:'dry_run'}.
//   no token             {skipped:'no_token'} before anything is claimed.

import { randomUUID } from "node:crypto";
import { withTransaction } from "../db/with-transaction.mjs";
import { redact } from "../lib/outbound-fetch.mjs";
import { assertAllowedRepoPath, isAllowedRepoPath } from "./allow-list.mjs";
import { applyEdit, validateEdit, validateRepoFile } from "./edit-ops.mjs";
import {
  repoToken, getRef, getContents, listCommits, createTree, createCommit, updateRef,
  commitMessage, outboxTrailerIds, isBranchMoved, COMMITS_TO_CHECK
} from "../messaging/providers/github-repo.mjs";

/**
 * @typedef {{committed_sha?: string, ids?: number[], deduped?: number[], rejected?: object[],
 *            unchanged?: boolean, skipped?: string, reason?: string|null, error?: string,
 *            retry?: boolean}} DrainResult
 */

/** A claim is a lease this long. */
export const LEASE_MINUTES = 10;

/** Tries per drain when the branch keeps moving under us. */
export const MAX_TRIES = 3;

/** Biggest file one replace row may carry. */
export const MAX_CONTENT_BYTES = 1_000_000;

/** The one global key: one repo, one branch, one batch in flight. Transaction-scoped. */
export const OUTBOX_LOCK_SQL =
  "SELECT pg_try_advisory_xact_lock(hashtextextended('repo_outbox', 0)) AS got";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ERROR = 300;

export class OutboxError extends Error {
  constructor(message, code = "outbox_refused") {
    super(message);
    this.name = "OutboxError";
    this.code = code;
  }
}

const clip = (err) => redact(String(err?.message || err || "unknown error")).slice(0, MAX_ERROR);

/** JSON with sorted keys, so a jsonb read back compares equal to what was stored. */
function stableJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(",")}}`;
}

/* pg hands back bigint as text; the trailer and the id order need numbers. */
function normalizeRow(r) {
  const out = { ...r, id: Number(r.id) };
  if (r.attempts != null) out.attempts = Number(r.attempts);
  return out;
}

const byId = (a, b) => a.id - b.id;

// ── enqueue ─────────────────────────────────────────────────────────────────

/**
 * Queue one repo write inside the caller's transaction.
 *
 * @param {{query:Function}} tx  The transaction the database change runs in.
 * @param {{orgId?: string, opId?: string, path?: string, mode?: string,
 *          content?: string|null, edit?: object|null}} [args]
 *   orgId — the org's id. opId — the caller's id for this save (one per org; a
 *   request that writes two files uses two ids). path — must be on
 *   src/repo/allow-list.mjs. mode — 'replace' (content = the whole file) or
 *   'edit' (edit = one op from src/repo/edit-ops.mjs).
 * @returns {Promise<{id:number, op_id:string, path:string, mode:string, duplicate:boolean}>}
 *          `duplicate` is true when the same op id already queued the same save.
 * @throws RepoPathError | EditOpError | OutboxError — refuse the request (400).
 */
export async function enqueueRepoWrite(tx, { orgId, opId, path, mode, content, edit } = {}) {
  if (!tx || typeof tx.query !== "function") {
    throw new OutboxError("enqueueRepoWrite needs the caller's transaction");
  }
  const org = String(orgId ?? "").trim();
  if (!UUID.test(org)) throw new OutboxError("orgId must be the org's id");
  const op = String(opId ?? "").trim();
  if (!op || op.length > 200) throw new OutboxError("opId must be 1 to 200 characters");
  const p = assertAllowedRepoPath(path);

  let body = null;
  let editJson = null;
  if (mode === "replace") {
    if (typeof content !== "string") throw new OutboxError("a replace save needs the whole file as text");
    if (edit != null) throw new OutboxError("a replace save carries no edit");
    if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
      throw new OutboxError(`a file over ${MAX_CONTENT_BYTES} bytes cannot be saved this way`);
    }
    validateRepoFile(p, content);
    body = content;
  } else if (mode === "edit") {
    if (content != null) throw new OutboxError("an edit save carries no whole file");
    editJson = validateEdit(edit, p);
  } else {
    throw new OutboxError(`mode must be 'replace' or 'edit', not ${JSON.stringify(mode)}`);
  }

  const ins = await tx.query(
    `INSERT INTO repo_outbox (org_id, op_id, path, mode, content, edit)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (org_id, op_id) DO NOTHING
     RETURNING id, op_id, path, mode`,
    [org, op, p, mode, body, editJson == null ? null : JSON.stringify(editJson)]
  );
  if (ins.rows[0]) return { ...normalizeRow(ins.rows[0]), duplicate: false };

  // The op id was used before. The same save again is a harmless repeat; a
  // different save under the same id is a caller bug and must not be dropped.
  const prev = (await tx.query(
    `SELECT id, op_id, path, mode, content, edit FROM repo_outbox WHERE org_id = $1 AND op_id = $2`,
    [org, op]
  )).rows[0];
  if (!prev) throw new OutboxError(`op id ${op} could not be saved or read back`);
  const same = prev.path === p && prev.mode === mode
    && (prev.content ?? null) === body
    && stableJson(prev.edit ?? null) === stableJson(editJson);
  if (!same) throw new OutboxError(`op id ${op} was already used for a different save`, "op_id_reused");
  return { id: Number(prev.id), op_id: prev.op_id, path: prev.path, mode: prev.mode, duplicate: true };
}

// ── claim ───────────────────────────────────────────────────────────────────

/**
 * Stamp a lease on every waiting row, in one short transaction.
 * @param {any} db  src/db.mjs's db, a pool, or anything withTransaction accepts.
 * @param {{claimId?: string}} [opts]
 * @returns {Promise<{rows: any[], skipped?: undefined}|{skipped: 'busy', rows?: undefined}>}
 */
export async function claimOutbox(db, { claimId } = {}) {
  const id = String(claimId ?? "").trim();
  if (!id || id.length > 100) throw new OutboxError("claimId must be 1 to 100 characters");
  return withTransaction(db, async (tx) => {
    const lock = await tx.query(OUTBOX_LOCK_SQL);
    if (!lock.rows[0]?.got) return { skipped: "busy" };
    const live = await tx.query(
      `SELECT 1 FROM repo_outbox
        WHERE committed_sha IS NULL
          AND claimed_at > now() - make_interval(mins => $1)
        LIMIT 1`,
      [LEASE_MINUTES]
    );
    if (live.rows.length) return { skipped: "busy" };
    const r = await tx.query(
      `UPDATE repo_outbox
          SET claimed_at = now(), claim_id = $1, attempts = attempts + 1
        WHERE committed_sha IS NULL
        RETURNING id, org_id, op_id, path, mode, content, edit, created_at,
                  claimed_at, claim_id, attempts, error`,
      [id]
    );
    return { rows: r.rows.map(normalizeRow).sort(byId) };
  });
}

/**
 * The drain's database side. Every update is limited to rows that still carry
 * THIS claim and are not committed, so a drain whose lease was taken over
 * changes nothing.
 */
export function sqlStore(db) {
  return {
    claim: (claimId) => claimOutbox(db, { claimId }),

    async markCommitted(claimId, ids, sha) {
      if (!ids.length) return;
      await db.query(
        `UPDATE repo_outbox
            SET committed_sha = $3, committed_at = now(), error = NULL
          WHERE id = ANY($1::bigint[]) AND claim_id = $2 AND committed_sha IS NULL`,
        [ids, claimId, sha]
      );
    },

    /** Error on each row; the claim stays and expires after the lease. */
    async recordErrors(claimId, items) {
      if (!items.length) return;
      await db.query(
        `UPDATE repo_outbox o
            SET error = v.error
           FROM unnest($1::bigint[], $3::text[]) AS v(id, error)
          WHERE o.id = v.id AND o.claim_id = $2 AND o.committed_sha IS NULL`,
        [items.map((x) => x.id), claimId, items.map((x) => x.error)]
      );
    },

    /** Clear the claim so the next pass retries. error null keeps the old one. */
    async release(claimId, items, { countAttempt = true } = {}) {
      if (!items.length) return;
      await db.query(
        `UPDATE repo_outbox o
            SET claimed_at = NULL, claim_id = NULL,
                error = COALESCE(v.error, o.error),
                attempts = CASE WHEN $3::boolean THEN o.attempts ELSE GREATEST(o.attempts - 1, 0) END
           FROM unnest($1::bigint[], $4::text[]) AS v(id, error)
          WHERE o.id = v.id AND o.claim_id = $2 AND o.committed_sha IS NULL`,
        [items.map((x) => x.id), claimId, countAttempt, items.map((x) => x.error ?? null)]
      );
    }
  };
}

// ── drain ───────────────────────────────────────────────────────────────────

/** What a GitHub answer means for the drain. */
export function classify(res) {
  if (res?.ok) return "ok";
  if (res?.blocked) return "held";
  if (isBranchMoved(res)) return "moved";
  const s = Number(res?.status) || 0;
  if (s === 0 || s >= 500 || s === 429) return "retry";
  if (s === 403 && String(res?.headers?.["x-ratelimit-remaining"] ?? "") === "0") return "retry";
  return "stop";
}

function plainError(stage, res) {
  const why = res?.error || (res?.status ? `HTTP ${res.status}` : "no answer");
  return redact(`GitHub would not ${stage}: ${why}`).slice(0, MAX_ERROR);
}

function describeRow(r) {
  return r.mode === "edit" ? `${r.edit?.op ?? "edit"} on ${r.path}` : `save of ${r.path}`;
}

/* Build each touched file from the branch head, applying rows in id order.
   A row the file cannot take is set aside with its reason; the rest go on. */
async function buildFiles(rows, head, gh) {
  const byPath = new Map();
  for (const r of rows) {
    if (!byPath.has(r.path)) byPath.set(r.path, []);
    byPath.get(r.path).push(r);
  }
  const files = [];
  const rejected = [];
  for (const [path, list] of byPath) {
    const firstReplace = list.findIndex((r) => r.mode === "replace");
    const needsRead = list.slice(0, firstReplace < 0 ? list.length : firstReplace).some((r) => r.mode === "edit");
    let content = null;
    if (needsRead) {
      const got = await getContents(path, { ref: head, ...gh });
      if (!got.ok) return { stop: { res: got, stage: `read ${path}` } };
      content = got.missing ? null : got.content;
    }
    let applied = 0;
    for (const r of list) {
      try {
        if (!isAllowedRepoPath(path)) throw new Error("the path is no longer on the allow-list");
        const next = r.mode === "replace" ? r.content : applyEdit(content, r.edit);
        validateRepoFile(path, next);
        content = next;
        applied++;
      } catch (err) {
        rejected.push({ id: r.id, error: clip(`could not apply ${describeRow(r)}: ${err?.message || err}`) });
      }
    }
    if (applied) files.push({ path, content });
  }
  return { files, rejected };
}

async function commitRows(rows, { store, claimId, gh, maxTries }) {
  let pending = rows;
  const deduped = [];
  const rejected = [];
  let lastMoved = null;

  const end = async (kind, res, stage) => {
    const items = pending.map((r) => ({ id: r.id, error: kind === "held" ? null : plainError(stage, res) }));
    const ids = items.map((x) => x.id);
    if (kind === "held") {
      await store.release(claimId, items, { countAttempt: false });
      return { skipped: "dry_run", reason: res?.error ?? null };
    }
    const error = plainError(stage, res);
    if (kind === "retry") {
      await store.release(claimId, items, { countAttempt: true });
      return { error, ids, retry: true, deduped, rejected };
    }
    await store.recordErrors(claimId, items);
    return { error, ids, deduped, rejected };
  };

  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const ref = await getRef(gh);
    let k = classify(ref);
    if (k === "moved") { lastMoved = ref; continue; }
    if (k !== "ok") return end(k, ref, "read the branch");
    if (!ref.sha) return end("retry", { status: 0, error: "no commit in the answer" }, "read the branch");
    const head = ref.sha;

    const hist = await listCommits({ ...gh, sha: head, perPage: COMMITS_TO_CHECK });
    k = classify(hist);
    if (k === "moved") { lastMoved = hist; continue; }
    if (k !== "ok") return end(k, hist, "list recent commits");
    const top = hist.commits[0];
    if (!top || top.sha !== head || !top.tree) {
      return end("retry", { status: 0, error: "the branch head was not the first commit listed" }, "list recent commits");
    }

    // A crash after the push: an id already in an "Outbox:" trailer is done.
    const landed = new Map();
    for (const c of hist.commits) {
      for (const id of outboxTrailerIds(c.message)) if (!landed.has(id)) landed.set(id, c.sha);
    }
    const already = pending.filter((r) => landed.has(r.id));
    if (already.length) {
      const bySha = new Map();
      for (const r of already) {
        const sha = landed.get(r.id);
        if (!bySha.has(sha)) bySha.set(sha, []);
        bySha.get(sha).push(r.id);
      }
      for (const [sha, ids] of bySha) await store.markCommitted(claimId, ids, sha);
      deduped.push(...already.map((r) => r.id));
      pending = pending.filter((r) => !landed.has(r.id));
    }
    if (!pending.length) {
      const newest = hist.commits.find((c) => outboxTrailerIds(c.message).some((id) => deduped.includes(id)));
      return { committed_sha: newest?.sha ?? landed.get(deduped[0]), ids: [], deduped, rejected };
    }

    const built = await buildFiles(pending, head, gh);
    if (built.stop) {
      k = classify(built.stop.res);
      if (k === "moved") { lastMoved = built.stop.res; continue; }
      return end(k === "ok" ? "retry" : k, built.stop.res, built.stop.stage);
    }
    if (built.rejected.length) {
      // That row only: reason kept, claim cleared, retried next pass on the newest file.
      await store.release(claimId, built.rejected, { countAttempt: true });
      rejected.push(...built.rejected);
      const out = new Set(built.rejected.map((x) => x.id));
      pending = pending.filter((r) => !out.has(r.id));
    }
    if (!pending.length) {
      return { error: `none of the waiting saves fit the files they edit (${rejected[0]?.error ?? ""})`.slice(0, MAX_ERROR), ids: [], deduped, rejected };
    }

    const ids = pending.map((r) => r.id);
    const tree = await createTree({ ...gh, baseTree: top.tree, files: built.files });
    k = classify(tree);
    if (k === "moved") { lastMoved = tree; continue; }
    if (k !== "ok" || !tree.sha) return end(k === "ok" ? "retry" : k, tree, "build the file tree");
    if (tree.sha === top.tree) {
      // Every file already reads this way at the head: nothing to commit.
      await store.markCommitted(claimId, ids, head);
      return { committed_sha: head, ids, unchanged: true, deduped, rejected };
    }

    const commit = await createCommit({
      ...gh, message: commitMessage(ids, built.files.map((f) => f.path)), tree: tree.sha, parents: [head]
    });
    k = classify(commit);
    if (k === "moved") { lastMoved = commit; continue; }
    if (k !== "ok" || !commit.sha) return end(k === "ok" ? "retry" : k, commit, "make the commit");

    const upd = await updateRef({ ...gh, sha: commit.sha });
    k = classify(upd);
    if (k === "ok") {
      await store.markCommitted(claimId, ids, commit.sha);
      return { committed_sha: commit.sha, ids, deduped, rejected };
    }
    if (k === "moved") { lastMoved = upd; continue; }
    return end(k, upd, "move the branch");
  }

  // Someone else kept moving the branch first. Clear the claim; next pass retries.
  return end("retry", lastMoved, `move the branch (it kept moving; tried ${maxTries} times)`);
}

/**
 * One drain pass. Never throws.
 *
 * @param {any} db    src/db.mjs's db (or a pool). Unused when deps.store is given.
 * @param {Record<string, any>} [env] process.env by default: GITHUB_REPO_TOKEN,
 *                       GITHUB_REPO, GITHUB_BRANCH, ADAPTERS_DRY_RUN.
 * @param {{fetchImpl?: Function, claimId?: string, store?: any, maxTries?: number}} [deps]
 * @returns {Promise<DrainResult>}
 *   {committed_sha, ids, deduped, rejected, unchanged?} when the saves are on the branch;
 *   {skipped: 'no_token'|'dry_run'|'busy'|'empty'};
 *   {error, ids?, retry?} with the reason in plain words.
 */
export async function drainOutbox(db, env = process.env, deps = {}) {
  if (!repoToken(env)) return { skipped: "no_token" };
  const store = deps.store || sqlStore(db);
  const claimId = deps.claimId || randomUUID();
  const gh = { env, fetchImpl: deps.fetchImpl };

  let claimed;
  try {
    claimed = await store.claim(claimId);
  } catch (err) {
    return { error: `could not claim the waiting saves: ${clip(err)}` };
  }
  if (claimed?.skipped) return { skipped: claimed.skipped };
  const rows = (claimed?.rows || []).map(normalizeRow).sort(byId);
  if (!rows.length) return { skipped: "empty" };

  try {
    return await commitRows(rows, { store, claimId, gh, maxTries: deps.maxTries ?? MAX_TRIES });
  } catch (err) {
    // A bug, or the database going away mid-drain. The claim stays and expires
    // after the lease; the trailer check stops a second commit of anything that landed.
    return { error: `the repo save stopped: ${clip(err)}`, ids: rows.map((r) => r.id) };
  }
}
