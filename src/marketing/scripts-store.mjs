// @ts-check
// The script actions' database side: read scripts, approve, edit, reject and
// set the film order. Every function takes the transaction it runs in.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §7.8 (Script actions), §7.9
// (Repo files), §7.2 (voice pairs on edit), §7.4 (How status moves,
// Visibility via §7.7), §4 traps 9, 17 and 21. Plan unit U25. Shapes:
// docs/specs/marketing-machine-api.md §4 (the Script object S) and §6.2.
//
// WHO CALLS IT
//   The routes in api/marketing/scripts.mjs, script.mjs and scripts/*.mjs. A
//   GET passes the transaction from staffRead(); a write passes the one from
//   withRequest() (src/marketing/http.mjs), which is ONE asStaff() transaction.
//   ad_scripts forces partner row security (377 Part 4e): outside a staff
//   transaction a query sees nothing and an UPDATE "succeeds" changing nothing.
//   So nothing here opens its own transaction or its own connection.
//
// WHAT EVERY SAVE DOES, IN ONE TRANSACTION
//   1. lock the version it edits (FOR UPDATE) and check it is still the live
//      one with the version the screen sent; otherwise 409 stale with what is
//      saved now ({version, body, parts} of the live version)
//   2. the database change
//   3. the repo file through the outbox (mode 'replace'), plus the registry
//      entry on approve (mode 'edit', op registry_add_ad)
//   then withRequest saves the answer and commits. The route wakes the worker
//   AFTER the commit (no network call inside a transaction, §4 trap 3).
//
// WHAT A SCREEN MAY SEE (§7.4, §7.7)
//   * source 'import' rows (the scripts that were here before the machine,
//     413's backfill) stay out: not listed, not readable, not actionable here.
//   * a script from a batch is seen only once that batch is released and its
//     release_at has passed. A script with no batch is always seen.
//   A script the screen may not see answers 404, same words as one that does
//   not exist.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { isUuid } from "../http/read-api.mjs";
import { InvalidError, StaleError, NotFoundError } from "./http.mjs";
import { enqueueRepoWrite } from "../repo/outbox.mjs";
import { REGISTRY_PATH, LANES } from "../ads/registry.mjs";
import { checkScriptText } from "../../scripts/ads/check-script.mjs";
import { serializeScript, scriptFilePath, scriptSlug } from "./script-file.mjs";
import { diffVoicePairs, keepMachineLines, PART_KINDS } from "./voice.mjs";

export { PART_KINDS };

export const SCRIPT_STATUSES = Object.freeze(["draft", "locked", "rejected", "filmed", "superseded", "expired"]);

/** The reason a rejection gets when Chris does not say one (spec §4 trap 17). */
export const DEFAULT_REJECT_REASON = "rejected from the app, no reason given";

/** The Script object's keys, in the contract's order (docs/specs/marketing-machine-api.md §4). */
export const SCRIPT_VIEW_KEYS = Object.freeze([
  "id", "root_script_id", "version", "status", "ad_id", "title", "body", "parts",
  "script_format", "style", "funnel_key", "angle_key", "hook_key", "offer_key", "lane",
  "batch_id", "idea_id", "source", "check_results", "flagged", "fix_note",
  "animation_plan", "meta_copy", "film_order", "needs_retake", "locked_at", "locked_by",
  "rejected_at", "rejected_reason", "filmed_at", "repo_path", "repo_commit",
  "created_at", "updated_at"
]);

export const MAX_BODY_CHARS = 100_000;
export const MAX_PARTS = 200;
export const MAX_REASON_CHARS = 2000;
export const MAX_ORDER = 500;

/* ── reading rows ────────────────────────────────────────────────────────── */

/* Every column a view or a save needs, plus the batch's week (for the file
   folder) and whether a screen may see the row. */
const COLS = `
  s.id, s.org_id, s.partner_id, s.root_script_id, s.parent_script_id, s.version,
  s.status, s.ad_id, s.title, s.body, s.hook_text, s.parts, s.script_type,
  s.script_format, s.style, s.funnel_key, s.angle_key, s.hook_key, s.offer_key,
  s.lane::text AS lane, s.batch_id, s.idea_id, s.source, s.check_results,
  s.fix_note, s.animation_plan, s.meta_copy, s.film_order, s.needs_retake,
  s.locked_at, s.locked_by, s.rejected_at, s.rejected_by, s.rejected_reason,
  s.filmed_at, s.repo_path, s.repo_commit, s.archived_at, s.created_at,
  s.updated_at, b.week_key AS batch_week_key`;

const FROM = `FROM ad_scripts s LEFT JOIN marketing_batches b ON b.id = s.batch_id`;

/** The visibility rule as SQL over `s` and `b` (see the header). */
export const VISIBLE_SQL =
  `(s.source <> 'import' AND (s.batch_id IS NULL OR (b.status = 'released' AND b.release_at <= now())))`;

const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/**
 * "needs a look": the machine's own draft that still failed a check after its
 * loop (spec §7.6). Read from check_results, which the writer (U24) fills: an
 * explicit `flagged: true`, or any check section with `passed: false`. A
 * version a person saved is never machine-flagged; its checker result is in
 * check_results and its warnings came back on the save.
 * @param {any} row
 */
export function isFlagged(row) {
  if (!row || row.source !== "machine") return false;
  const c = row.check_results;
  if (!c || typeof c !== "object" || Array.isArray(c)) return false;
  if (c.flagged === true) return true;
  return Object.values(c).some((v) => v && typeof v === "object" && !Array.isArray(v) && v.passed === false);
}

/** One ad_scripts row as the Script object S. */
export function scriptView(row) {
  return {
    id: row.id,
    root_script_id: row.root_script_id,
    version: Number(row.version),
    status: row.status,
    ad_id: row.ad_id == null ? null : String(row.ad_id),
    title: row.title ?? null,
    body: row.body,
    parts: row.parts ?? null,
    script_format: row.script_format ?? null,
    style: row.style ?? null,
    funnel_key: row.funnel_key ?? null,
    angle_key: row.angle_key ?? null,
    hook_key: row.hook_key ?? null,
    offer_key: row.offer_key ?? null,
    lane: row.lane ?? null,
    batch_id: row.batch_id ?? null,
    idea_id: row.idea_id ?? null,
    source: row.source,
    check_results: row.check_results ?? null,
    flagged: isFlagged(row),
    fix_note: row.fix_note ?? null,
    animation_plan: row.animation_plan ?? null,
    meta_copy: row.meta_copy ?? null,
    film_order: row.film_order == null ? null : Number(row.film_order),
    needs_retake: row.needs_retake === true,
    locked_at: iso(row.locked_at),
    locked_by: row.locked_by ?? null,
    rejected_at: iso(row.rejected_at),
    rejected_reason: row.rejected_reason ?? null,
    filmed_at: iso(row.filmed_at),
    repo_path: row.repo_path ?? null,
    repo_commit: row.repo_commit ?? null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at)
  };
}

/* ── checking what the screen sent (no database) ─────────────────────────── */

/** GET marketing/scripts ?status=&batch= */
export function parseListQuery(query = {}) {
  const q = query || {};
  const status = q.status == null || q.status === "" ? null : String(q.status);
  if (status !== null && !SCRIPT_STATUSES.includes(status)) {
    throw new InvalidError("status", `status must be one of: ${SCRIPT_STATUSES.join(", ")}.`);
  }
  const batch = q.batch == null || q.batch === "" ? null : String(q.batch);
  if (batch !== null && !isUuid(batch)) throw new InvalidError("batch", "batch must be a batch id (a uuid).");
  return { status, batch };
}

/** The script a write names: {id, version}. */
export function parseScriptRef(body) {
  const id = body?.id;
  if (!isUuid(id)) throw new InvalidError("id", "id must be the script's id (a uuid).");
  const v = body?.version;
  const version = typeof v === "string" && /^[0-9]{1,9}$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(version) || version < 1) {
    throw new InvalidError("version", "version must be the version you opened (a whole number from 1).");
  }
  return { id: String(id), version: Number(version) };
}

/** parts: [{kind, text}] with a known kind, or null when not sent. */
export function parseParts(parts) {
  if (parts === undefined || parts === null) return null;
  const fail = () => new InvalidError("parts", `parts must be a list of {kind, text}, kind one of ${PART_KINDS.join(", ")}.`);
  if (!Array.isArray(parts) || parts.length > MAX_PARTS) throw fail();
  return parts.map((p) => {
    if (!p || typeof p !== "object" || Array.isArray(p)) throw fail();
    if (typeof p.kind !== "string" || !PART_KINDS.includes(p.kind)) throw fail();
    if (typeof p.text !== "string") throw fail();
    return { kind: p.kind, text: p.text };
  });
}

/** body: the whole teleprompter text. */
export function parseBody(body) {
  if (typeof body !== "string" || body.trim() === "") {
    throw new InvalidError("body", "body is empty. Send the whole script.");
  }
  if (body.length > MAX_BODY_CHARS) throw new InvalidError("body", `body is longer than ${MAX_BODY_CHARS} characters.`);
  if (body.includes("\u0000")) throw new InvalidError("body", "body has a character the database cannot hold.");
  return body;
}

/** meta_copy: an object, or null when not sent. */
export function parseMetaCopy(meta) {
  if (meta === undefined || meta === null) return null;
  if (typeof meta !== "object" || Array.isArray(meta)) {
    throw new InvalidError("meta_copy", "meta_copy must be {primary_text, headline, description, cta_type}.");
  }
  return meta;
}

/** reason: optional words; none means the default reason. */
export function parseReason(reason) {
  if (reason === undefined || reason === null) return DEFAULT_REJECT_REASON;
  if (typeof reason !== "string") throw new InvalidError("reason", "reason must be words.");
  const r = reason.trim();
  if (r.length > MAX_REASON_CHARS) throw new InvalidError("reason", `reason is longer than ${MAX_REASON_CHARS} characters.`);
  return r || DEFAULT_REJECT_REASON;
}

/** order: root_script_id values in film order, each once. */
export function parseOrder(order) {
  const fail = (m) => new InvalidError("order", m);
  if (!Array.isArray(order)) throw fail("order must be a list of script ids (root_script_id), first to film first.");
  if (order.length > MAX_ORDER) throw fail(`order can hold at most ${MAX_ORDER} scripts.`);
  const seen = new Set();
  for (const id of order) {
    if (!isUuid(id)) throw fail("every item in order must be a script id (a uuid).");
    const k = String(id).toLowerCase();
    if (seen.has(k)) throw fail("a script is in the order twice.");
    seen.add(k);
  }
  return order.map((id) => String(id).toLowerCase());
}

/* ── reads ───────────────────────────────────────────────────────────────── */

/**
 * GET marketing/scripts. Live versions only, unless status = superseded (those
 * are the replaced, archived versions). Newest first.
 */
export async function listScripts(tx, { orgId, status = null, batch = null }) {
  const where = [`s.org_id = $1`, VISIBLE_SQL];
  const params = [orgId];
  where.push(status === "superseded" ? `s.archived_at IS NOT NULL` : `s.archived_at IS NULL`);
  if (status) { params.push(status); where.push(`s.status = $${params.length}`); }
  if (batch) { params.push(batch); where.push(`s.batch_id = $${params.length}`); }
  const r = await tx.query(
    `SELECT ${COLS} ${FROM} WHERE ${where.join(" AND ")}
      ORDER BY s.created_at DESC, s.version DESC, s.id`,
    params
  );
  return r.rows;
}

/** GET marketing/script: the row `id` names, and every version of it, newest first. */
export async function getScriptWithVersions(tx, { orgId, id }) {
  const row = (await tx.query(
    `SELECT ${COLS} ${FROM} WHERE s.id = $1 AND s.org_id = $2 AND ${VISIBLE_SQL}`,
    [id, orgId]
  )).rows[0];
  if (!row) return null;
  const versions = (await tx.query(
    `SELECT ${COLS} ${FROM} WHERE s.root_script_id = $1 AND s.org_id = $2
      ORDER BY s.version DESC, s.created_at DESC`,
    [row.root_script_id, orgId]
  )).rows;
  return { row, versions };
}

async function readRow(tx, id) {
  return (await tx.query(`SELECT ${COLS} ${FROM} WHERE s.id = $1`, [id])).rows[0];
}

/** What is saved now, for a 409: {version, body, parts} of the live version, or null. */
async function currentOf(tx, { orgId, rootId }) {
  const live = (await tx.query(
    `SELECT version, body, parts FROM ad_scripts
      WHERE root_script_id = $1 AND org_id = $2 AND archived_at IS NULL`,
    [rootId, orgId]
  )).rows[0];
  return live ? { version: Number(live.version), body: live.body, parts: live.parts ?? null } : null;
}

/**
 * Lock the version a write names and prove it is the live one the screen saw.
 * FOR UPDATE: a second save of the same version waits here for the first one,
 * then reads what the first one left (archived, or a new status) and answers
 * from that.
 */
export async function lockLiveScript(tx, { orgId, id, version }) {
  const row = (await tx.query(
    `SELECT ${COLS}, ${VISIBLE_SQL} AS visible ${FROM}
      WHERE s.id = $1 AND s.org_id = $2
        FOR UPDATE OF s`,
    [id, orgId]
  )).rows[0];
  if (!row || !row.visible) throw new NotFoundError("That script was not found.");
  if (row.archived_at || Number(row.version) !== version) {
    throw new StaleError(await currentOf(tx, { orgId, rootId: row.root_script_id }));
  }
  return row;
}

/* ── the repo file (§7.9) ────────────────────────────────────────────────── */

/** An outbox op id: one per request and per file it writes, at most 200 long. */
export function opIdFor(kind, requestId) {
  const base = `u25:${kind}:${requestId}`;
  if (base.length <= 200) return base;
  return `u25:${kind}:${createHash("sha256").update(String(requestId)).digest("hex").slice(0, 40)}`;
}

/* The script's place in its batch (1, 2, 3 …), counted on version 1 rows by
   when they were made. A script with no batch is counted among this company's
   scripts with no batch. Only used for the FIRST save of a file. */
async function placeInBatch(tx, row) {
  const root = (await tx.query(`SELECT created_at FROM ad_scripts WHERE id = $1`, [row.root_script_id])).rows[0];
  const at = root ? root.created_at : row.created_at;
  const r = row.batch_id
    ? await tx.query(
        `SELECT count(*)::int AS n FROM ad_scripts
          WHERE batch_id = $1 AND id = root_script_id AND (created_at, id) <= ($2, $3)`,
        [row.batch_id, at, row.root_script_id])
    : await tx.query(
        `SELECT count(*)::int AS n FROM ad_scripts
          WHERE org_id = $1 AND batch_id IS NULL AND id = root_script_id AND (created_at, id) <= ($2, $3)`,
        [row.org_id, at, row.root_script_id]);
  return Math.max(1, Number(r.rows[0]?.n) || 1);
}

/**
 * The file's path: the one the script already has, or a new one stored on this
 * row now (first save). A path another script already holds gets the script's
 * first 8 id characters added, so two scripts never share one file.
 */
async function ensureRepoPath(tx, row) {
  if (row.repo_path) return row.repo_path;
  const n = await placeInBatch(tx, row);
  const slug = scriptSlug(row);
  let path = scriptFilePath({ weekKey: row.batch_week_key, n, slug });
  const taken = (await tx.query(
    `SELECT 1 FROM ad_scripts WHERE repo_path = $1 AND root_script_id <> $2 LIMIT 1`,
    [path, row.root_script_id]
  )).rows.length > 0;
  if (taken) {
    const id8 = String(row.root_script_id).replace(/-/g, "").slice(0, 8).toLowerCase();
    path = scriptFilePath({ weekKey: row.batch_week_key, n, slug: `${slug}-${id8}` });
  }
  await tx.query(`UPDATE ad_scripts SET repo_path = $1 WHERE id = $2`, [path, row.id]);
  return path;
}

/**
 * Queue this version's repo file (mode 'replace') in the caller's transaction.
 * Exported for U35's release step. Returns the path.
 * @param {{query: Function}} tx
 * @param {{orgId: string, scriptId: string, opId: string, updatedBy: string|null}} args
 */
export async function queueScriptFile(tx, { orgId, scriptId, opId, updatedBy }) {
  const row = await readRow(tx, scriptId);
  if (!row) throw new Error(`queueScriptFile: script ${scriptId} was not found`);
  const path = await ensureRepoPath(tx, row);
  const { content } = serializeScript({ ...row, repo_path: path, updated_by: updatedBy ?? null });
  await enqueueRepoWrite(tx, { orgId, opId, path, mode: "replace", content });
  return path;
}

/* ── the registry entry (approve) ────────────────────────────────────────── */

/**
 * The lanes that have a rule in marketing/ads/registry.json (rules[lane]).
 * Read from the copy beside the code, then from the working directory (Netlify
 * included_files). If neither can be read, the five lanes the registry knows
 * (src/ads/registry.mjs LANES), which are the five with rules today. The
 * outbox applies the entry to the real file at commit time and records a
 * plain error there if the lane turns out to have no rule.
 * @returns {Set<string>}
 */
export function registryRuleLanes({ read = readFileSync, paths = null } = {}) {
  const list = paths || [REGISTRY_PATH, join(process.cwd(), "marketing", "ads", "registry.json")];
  for (const p of list) {
    try {
      const doc = JSON.parse(String(read(p, "utf8")));
      if (doc && doc.rules && typeof doc.rules === "object" && !Array.isArray(doc.rules)) {
        return new Set(Object.keys(doc.rules));
      }
    } catch { /* try the next copy */ }
  }
  return new Set(LANES);
}

/* ── approve ─────────────────────────────────────────────────────────────── */

/**
 * POST marketing/scripts/approve. Locks the script and gives it its number
 * (next_ad_number, in this transaction), once. A script that already has a
 * number keeps it. Only a person approves: locked_by is the caller's staff id.
 * @returns {Promise<{script: object, ad_number: string, registry: 'queued'|'skipped', registry_note: string|null}>}
 */
export async function approveScript(tx, { orgId, id, version, staffId, requestId, ruleLanes = registryRuleLanes }) {
  const row = await lockLiveScript(tx, { orgId, id, version });

  if (row.status === "locked" || row.status === "filmed") {
    return {
      script: scriptView(row),
      ad_number: String(row.ad_id),
      registry: "skipped",
      registry_note: `This script was already approved as Ad ${row.ad_id}. It kept its number, and nothing new was queued.`
    };
  }
  if (row.status !== "draft") {
    throw new InvalidError("id", `This script is ${row.status}, so it cannot be approved.`);
  }

  let adId = row.ad_id == null ? null : String(row.ad_id);
  if (!adId) {
    const n = (await tx.query(`SELECT next_ad_number($1) AS n`, [orgId])).rows[0].n;
    adId = String(n);
  }

  const upd = await tx.query(
    `UPDATE ad_scripts
        SET status = 'locked', ad_id = $2, locked_at = now(), locked_by = $3
      WHERE id = $1 AND archived_at IS NULL`,
    [row.id, adId, staffId ?? null]
  );
  if (upd.rowCount !== 1) throw new StaleError(await currentOf(tx, { orgId, rootId: row.root_script_id }));

  /** @type {'queued'|'skipped'} */
  let registry = "skipped";
  /** @type {string|null} */
  let registryNote = null;
  const lane = row.lane;
  if (!lane) {
    registryNote = `This script has no lane, so Ad ${adId} was not added to the ad list (registry.json). The ad still tracks by its number.`;
  } else if (!ruleLanes().has(lane)) {
    registryNote = `The ${lane} lane has no rule in the ad list (registry.json), so Ad ${adId} was not added to it. That is on purpose. The ad still tracks by its number.`;
  } else {
    await enqueueRepoWrite(tx, {
      orgId,
      opId: opIdFor("approve-registry", requestId),
      path: "marketing/ads/registry.json",
      mode: "edit",
      edit: { op: "registry_add_ad", id: adId, title: row.title ?? null, lane }
    });
    registry = "queued";
  }

  await queueScriptFile(tx, { orgId, scriptId: row.id, opId: opIdFor("approve-file", requestId), updatedBy: staffId ?? null });

  return {
    script: scriptView(await readRow(tx, row.id)),
    ad_number: adId,
    registry,
    registry_note: registryNote
  };
}

/* ── edit ────────────────────────────────────────────────────────────────── */

/** The checker's findings as {rule, message}, in plain words. They never block. */
export function editWarnings(check) {
  const out = [];
  for (const f of check?.failures || []) {
    const where = typeof f.line === "number" ? ` (line ${f.line})` : "";
    out.push({ rule: String(f.rule || "check"), message: `${upper(String(f.message || "this line breaks a rule."))}${where} Saved anyway, because a person wrote it.` });
  }
  for (const w of check?.warnings || []) {
    out.push({ rule: String(w.rule || "check"), message: upper(String(w.message || "")) });
  }
  return out;
}

const upper = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * POST marketing/scripts/edit. Archives the version Chris edited and inserts
 * the new one with the same root and number, in this transaction (archive
 * first: one live version per root, one live script per number). A locked or
 * filmed script's new version is locked (its new words still have to be
 * filmed), as api/scripts/write.mjs does. Checker warnings never block.
 * Voice pairs are saved for the machine lines Chris changed.
 * @returns {Promise<{script: object, warnings: Array<{rule: string, message: string}>, voice_pairs: number}>}
 */
export async function editScript(tx, { orgId, id, version, body, parts, metaCopy, staffId, requestId, check = checkScriptText }) {
  const row = await lockLiveScript(tx, { orgId, id, version });
  if (row.status === "rejected" || row.status === "expired" || row.status === "superseded") {
    throw new InvalidError("id", `This script is ${row.status}, so it cannot be edited.`);
  }

  const warnings = [];
  let newParts = parts;
  if (newParts === null) {
    if (body === row.body) newParts = row.parts ?? null;
    else if (row.parts != null) {
      warnings.push({
        rule: "parts",
        message: "The words changed but no parts were sent, so the part marks (hook, line 2, cues) were cleared on this version."
      });
    }
  }
  const newMeta = metaCopy === null ? row.meta_copy ?? null : metaCopy;
  const hookPart = Array.isArray(newParts) ? newParts.find((p) => p.kind === "hook") : null;
  const hookText = hookPart ? hookPart.text : body === row.body ? row.hook_text ?? null : null;

  const result = check(body, {
    format: row.script_format || undefined,
    style: row.style || undefined,
    strict: true,
    parts: Array.isArray(newParts) ? newParts : undefined
  });
  warnings.push(...editWarnings(result));
  const checkResults = {
    strict: {
      passed: result.ok === true,
      rounds: 0,
      failures: (result.failures || []).map((f) => ({ rule: f.rule, match: f.match ?? null, message: f.message, line: f.line ?? null })),
      warnings: (result.warnings || []).map((w) => ({ rule: w.rule, message: w.message }))
    }
  };

  // The new version's status, read before anything changes: a locked or
  // filmed script stays locked (keeps its number); a draft stays a draft.
  const status = row.status === "locked" || row.status === "filmed" ? "locked" : "draft";

  // 1. The old version stops being live (§4 trap 9).
  const archived = await tx.query(
    `UPDATE ad_scripts SET archived_at = now(), status = 'superseded'
      WHERE id = $1 AND archived_at IS NULL`,
    [row.id]
  );
  if (archived.rowCount !== 1) throw new StaleError(await currentOf(tx, { orgId, rootId: row.root_script_id }));

  // 2. The new version: same root, same number, version + 1, written by a person.
  const inserted = (await tx.query(
    `INSERT INTO ad_scripts
       (org_id, partner_id, parent_script_id, root_script_id, version,
        title, body, hook_text, script_type, lane, angle_key, hook_key, offer_key,
        status, ad_id, script_format, style, funnel_key, batch_id, idea_id,
        parts, check_results, fix_note, animation_plan, meta_copy, source,
        film_order, needs_retake, locked_at, locked_by, repo_path)
     SELECT org_id, partner_id, id, root_script_id, version + 1,
            title, $2, $3, script_type, lane, angle_key, hook_key, offer_key,
            $4, ad_id, script_format, style, funnel_key, batch_id, idea_id,
            $5::jsonb, $6::jsonb, fix_note, animation_plan, $7::jsonb, 'chris',
            film_order, needs_retake, locked_at, locked_by, repo_path
       FROM ad_scripts WHERE id = $1
     RETURNING id`,
    [row.id, body, hookText, status,
     newParts == null ? null : JSON.stringify(newParts),
     JSON.stringify(checkResults),
     newMeta == null ? null : JSON.stringify(newMeta)]
  )).rows[0];

  // 3. Voice pairs: the machine's lines Chris changed (§7.2).
  const machine = (await tx.query(
    `SELECT body, parts FROM ad_scripts
      WHERE root_script_id = $1 AND org_id = $2 AND source = 'machine'
      ORDER BY version DESC LIMIT 1`,
    [row.root_script_id, orgId]
  )).rows[0];
  const pairs = keepMachineLines(
    diffVoicePairs({ body: row.body, parts: row.parts }, { body, parts: newParts }),
    machine
  );
  if (pairs.length) {
    await tx.query(
      `INSERT INTO voice_pairs (org_id, script_id, "before", "after", kind)
       SELECT $1, $2, p."before", p."after", p.kind
         FROM jsonb_to_recordset($3::jsonb) AS p("before" text, "after" text, kind text)`,
      [orgId, inserted.id, JSON.stringify(pairs)]
    );
  }

  // 4. The repo file, same path as before (§7.9).
  await queueScriptFile(tx, { orgId, scriptId: inserted.id, opId: opIdFor("edit-file", requestId), updatedBy: staffId ?? null });

  return { script: scriptView(await readRow(tx, inserted.id)), warnings, voice_pairs: pairs.length };
}

/* ── reject ──────────────────────────────────────────────────────────────── */

/**
 * POST marketing/scripts/reject. Only a draft can be rejected (§7.4). Stores
 * the caller's staff id and the reason, or the default reason (§4 trap 17).
 */
export async function rejectScript(tx, { orgId, id, version, reason, staffId, requestId }) {
  const row = await lockLiveScript(tx, { orgId, id, version });
  if (row.status !== "draft") {
    throw new InvalidError("id", `Only a draft can be rejected. This script is ${row.status}.`);
  }
  const upd = await tx.query(
    `UPDATE ad_scripts
        SET status = 'rejected', rejected_at = now(), rejected_by = $2, rejected_reason = $3
      WHERE id = $1 AND archived_at IS NULL`,
    [row.id, staffId ?? null, reason]
  );
  if (upd.rowCount !== 1) throw new StaleError(await currentOf(tx, { orgId, rootId: row.root_script_id }));
  await queueScriptFile(tx, { orgId, scriptId: row.id, opId: opIdFor("reject-file", requestId), updatedBy: staffId ?? null });
  return { script: scriptView(await readRow(tx, row.id)) };
}

/* ── film order ──────────────────────────────────────────────────────────── */

/**
 * POST marketing/scripts/order. film_order follows the list, first = 1, on the
 * live version of each script. Scripts not in the list keep their order. Every
 * id must be a script this company's screens can see.
 */
export async function orderScripts(tx, { orgId, order }) {
  if (!order.length) return { ok: true };
  const found = (await tx.query(
    `SELECT s.root_script_id ${FROM}
      WHERE s.org_id = $1 AND s.root_script_id = ANY($2::uuid[]) AND s.archived_at IS NULL
        AND ${VISIBLE_SQL}
        FOR UPDATE OF s`,
    [orgId, order]
  )).rows;
  if (found.length !== order.length) {
    throw new InvalidError("order", "One or more scripts in the list were not found. Reload and try again.");
  }
  await tx.query(
    `UPDATE ad_scripts s SET film_order = o.n
       FROM unnest($2::uuid[]) WITH ORDINALITY AS o(root, n)
      WHERE s.org_id = $1 AND s.root_script_id = o.root AND s.archived_at IS NULL`,
    [orgId, order]
  );
  return { ok: true };
}
