// @ts-check
// The ideas inbox and Write now: what POST/GET marketing/ideas, GET
// marketing/batches and POST marketing/batches/write-now read and write.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §7.8 (ideas, batches,
// write-now), §7.4 (ad_ideas, marketing_batches), §7.5 step 7 (accepting a
// planner suggestion turns it into an idea), §2 item 1 (Write now) and §7.7
// (Write now releases as soon as it is done). Tables: migration 414. Shapes:
// docs/specs/marketing-machine-api.md §6.3 (plan unit U26).
//
// WHO WRITES WHAT
//   * POST marketing/ideas saves ONE ad_ideas row (source 'chris' or
//     'suggestion' — never 'machine': the planner writes its own) and, in the
//     same transaction, ONE outbox row that writes the idea's file
//     marketing/ads/ideas/<YYYY-MM-DD>-<id8>.md (the Arizona day it was made,
//     the first 8 characters of its id).
//   * Write now makes ONE marketing_batches row (kind on_command, status
//     planned, release_at now) and queues ONE job, kind 'start_batch', with
//     {batch_id, count, funnel_key, idea_ids}. Plan unit U35 owns that job;
//     until its handler is registered in JOB_KINDS the job waits in the queue,
//     harmlessly, and GET marketing/batches says write_now_ready:false so no
//     screen shows a button that cannot produce drafts (UI-STANDARDS §5).
//   * Write now spends model money, so it is checked against the cost caps
//     (costStatus) first. A cap reached → CapReachedError, nothing is queued.
//     It never reads `enabled`: Write now works while the weekly schedule is
//     off (spec §2 item 1, M1 Done #1 comes before #6).
//
// Every function that writes takes the caller's transaction (withRequest's tx)
// and never opens its own. No network call happens here; the caller wakes the
// worker after its transaction commits.

import { randomUUID } from "node:crypto";
import { adAccountDay } from "../lib/ad-account-day.mjs";
import { enqueueJob } from "./jobs.mjs";
import { costStatus } from "./model-usage.mjs";
import { FORMATS } from "./settings-store.mjs";
import { InvalidError } from "./http.mjs";

/* ── the words ───────────────────────────────────────────────────────────── */

/** Every status an idea can have (414 ad_ideas_status_ck). */
export const IDEA_STATUSES = Object.freeze(["new", "writing", "written", "failed", "dropped"]);

/** The sources this route takes. 'machine' is the planner's and never comes in here. */
export const POSTED_SOURCES = Object.freeze(["chris", "suggestion"]);

/** The keys of one idea in an answer (API contract §6.3), in order. */
export const IDEA_VIEW_KEYS = Object.freeze([
  "id", "source", "kind", "raw_points", "topic", "script_format", "funnel_key",
  "angle_key", "status", "script_id", "created_at"
]);

/** The job U35 handles. Write now queues it; nothing here runs it. */
export const START_BATCH_KIND = "start_batch";

/** Where each idea's file goes (src/repo/allow-list.mjs has this folder). */
export const IDEAS_DIR = "marketing/ads/ideas/";

/** Most ideas one GET answers with, newest first. */
export const IDEAS_LIST_LIMIT = 200;

/** Most batches GET marketing/batches answers with, newest first. */
export const BATCHES_LIST_LIMIT = 50;

/* A long ad keeps every point Chris gave (Appendix A rule 44), so the cap is
   generous; it only stops a paste that is not an idea at all. */
export const MAX_RAW_POINTS = 20000;

/** Most scripts one Write now may ask for. A whole weekly batch is 21. */
export const MAX_WRITE_NOW_COUNT = 50;

/** Most ideas one Write now may name. */
export const MAX_IDEA_IDS = 50;

/* Same shape as the label keys in 377/414 (ad_ideas_*_ck). */
const KEY_RE = /^[a-z][a-z0-9_]{1,48}$/;
/* A funnel key as marketing_funnels takes it (410 marketing_funnels_key_ck). */
const FUNNEL_KEY_RE = /^[a-z0-9][a-z0-9_]{0,62}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/* ── checking a POST ─────────────────────────────────────────────────────── */

/**
 * The idea fields from a POST body, checked. Throws InvalidError (→ 400) with
 * the field and a plain sentence. Does not look anything up: whether the funnel
 * exists is checked inside the transaction (funnelExists).
 * @param {Record<string, any>} body
 * @returns {{rawPoints: string, source: string, scriptFormat: string|null,
 *            funnelKey: string|null, angleKey: string|null, writeNow: boolean}}
 */
export function validateIdeaInput(body) {
  const b = body || {};
  if (typeof b.raw_points !== "string" || !b.raw_points.trim()) {
    throw new InvalidError("raw_points", "Type or say the idea first. The box is empty.");
  }
  if (b.raw_points.length > MAX_RAW_POINTS) {
    throw new InvalidError("raw_points", `That is too long for one idea (over ${MAX_RAW_POINTS.toLocaleString("en-US")} characters). Split it into two ideas.`);
  }

  let source = "chris";
  if (b.source !== undefined && b.source !== null) {
    if (!POSTED_SOURCES.includes(b.source)) {
      throw new InvalidError("source", "An idea comes from you ('chris') or from a planner suggestion you accepted ('suggestion'). The machine never posts here.");
    }
    source = b.source;
  }

  const scriptFormat = optionalKey(b.script_format, "script_format");
  if (scriptFormat !== null && !FORMATS.includes(scriptFormat)) {
    throw new InvalidError("script_format", `The format must be one of: ${FORMATS.join(", ")}.`);
  }
  const funnelKey = optionalKey(b.funnel_key, "funnel_key");
  const angleKey = optionalKey(b.angle_key, "angle_key");

  if (b.write_now !== undefined && b.write_now !== null && typeof b.write_now !== "boolean") {
    throw new InvalidError("write_now", "write_now must be true or false.");
  }

  // Kept word for word: the writer gets Chris's points exactly as he gave them.
  return { rawPoints: b.raw_points, source, scriptFormat, funnelKey, angleKey, writeNow: b.write_now === true };
}

/** A label key that may be left out: null, or the key's shape. */
function optionalKey(v, field, re = KEY_RE) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !re.test(v)) {
    throw new InvalidError(field, `${field} must be a short key: lower case letters, numbers and underscores, like roadmap_147.`);
  }
  return v;
}

/**
 * The Write now fields from a POST body, checked. Throws InvalidError.
 * @param {Record<string, any>} body
 * @returns {{count: number|null, funnelKey: string|null, ideaIds: string[]}}
 */
export function validateWriteNowInput(body) {
  const b = body || {};
  let count = null;
  if (b.count !== undefined && b.count !== null) {
    if (typeof b.count !== "number" || !Number.isInteger(b.count) || b.count < 1) {
      throw new InvalidError("count", "How many scripts? Use a whole number of 1 or more.");
    }
    if (b.count > MAX_WRITE_NOW_COUNT) {
      throw new InvalidError("count", `Write now makes at most ${MAX_WRITE_NOW_COUNT} scripts at a time.`);
    }
    count = b.count;
  }
  // Not saved on an idea, so any key marketing_funnels takes; assertFunnel then checks it exists.
  const funnelKey = optionalKey(b.funnel_key, "funnel_key", FUNNEL_KEY_RE);

  let ideaIds = [];
  if (b.idea_ids !== undefined && b.idea_ids !== null) {
    if (!Array.isArray(b.idea_ids) || !b.idea_ids.every((x) => typeof x === "string" && UUID_RE.test(x))) {
      throw new InvalidError("idea_ids", "idea_ids must be a list of idea ids.");
    }
    if (b.idea_ids.length > MAX_IDEA_IDS) {
      throw new InvalidError("idea_ids", `Write now takes at most ${MAX_IDEA_IDS} ideas at a time.`);
    }
    ideaIds = [...new Set(b.idea_ids.map((x) => x.toLowerCase()))];
  }
  return { count, funnelKey, ideaIds };
}

/** The ?status= filter of GET marketing/ideas, checked. null = every status. */
export function validateIdeaStatus(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !IDEA_STATUSES.includes(v)) {
    throw new InvalidError("status", `status must be one of: ${IDEA_STATUSES.join(", ")}.`);
  }
  return v;
}

/* ── shapes ──────────────────────────────────────────────────────────────── */

/** One ad_ideas row as the API answers it. */
export function ideaView(row) {
  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    raw_points: row.raw_points ?? null,
    topic: row.topic ?? null,
    script_format: row.script_format ?? null,
    funnel_key: row.funnel_key ?? null,
    angle_key: row.angle_key ?? null,
    status: row.status,
    script_id: row.script_id ?? null,
    created_at: iso(row.created_at)
  };
}

/** One marketing_batches row as GET marketing/batches answers it. */
export function batchView(row) {
  return {
    id: row.id,
    kind: row.kind,
    week_key: row.week_key ?? null,
    status: row.status,
    release_at: iso(row.release_at),
    released_at: iso(row.released_at),
    counts: {
      total: Number(row.total),
      ready: Number(row.ready),
      flagged: Number(row.flagged),
      failed: Number(row.failed)
    },
    error: row.error ?? null
  };
}

/* ── the idea's file in the repo ─────────────────────────────────────────── */

/** marketing/ads/ideas/<YYYY-MM-DD>-<id8>.md — the Arizona day it was made. */
export function ideaFilePath(row) {
  const made = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return `${IDEAS_DIR}${adAccountDay(made)}-${String(row.id).slice(0, 8)}.md`;
}

/**
 * The idea's file: flat front matter (the repo has no YAML library, spec §7.9),
 * then Chris's points exactly as he gave them.
 */
export function ideaFileContent(row) {
  const v = ideaView(row);
  const lines = [
    "---",
    `idea: ${v.id}`,
    `source: ${v.source}`,
    `kind: ${v.kind}`,
    `status: ${v.status}`,
    `format: ${v.script_format ?? "none"}`,
    `funnel: ${v.funnel_key ?? "none"}`,
    `angle: ${v.angle_key ?? "none"}`,
    `created_at: ${v.created_at}`,
    "---"
  ];
  const points = String(row.raw_points ?? "");
  return `${lines.join("\n")}\n\n${points}${points.endsWith("\n") ? "" : "\n"}`;
}

/* ── reads and writes (caller's transaction) ─────────────────────────────── */

/** @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[], rowCount?: number | null }> }} Db */

/** True when the company has a funnel with this key. */
export async function funnelExists(tx, orgId, key) {
  const r = await tx.query(`SELECT 1 FROM marketing_funnels WHERE org_id = $1 AND key = $2`, [orgId, key]);
  return r.rows.length > 0;
}

/** Throws InvalidError('funnel_key') when the company has no funnel with this key. */
export async function assertFunnel(tx, orgId, key) {
  if (key == null) return;
  if (!(await funnelExists(tx, orgId, key))) {
    throw new InvalidError("funnel_key", `There is no funnel called "${key}". Pick one from Settings > Funnels.`);
  }
}

/**
 * Save one idea. Returns the row.
 * @param {Db} tx
 * @param {string} orgId
 * @param {{rawPoints: string, source: string, scriptFormat: string|null, funnelKey: string|null,
 *          angleKey: string|null, staffId: string|null}} idea
 */
export async function insertIdea(tx, orgId, idea) {
  const r = await tx.query(
    `INSERT INTO ad_ideas (org_id, source, kind, raw_points, script_format, funnel_key, angle_key, status, created_by)
     VALUES ($1, $2, 'script', $3, $4, $5, $6, 'new', $7)
     RETURNING *`,
    [orgId, idea.source, idea.rawPoints, idea.scriptFormat, idea.funnelKey, idea.angleKey, idea.staffId ?? null]
  );
  return r.rows[0];
}

/** The company's ideas, newest first, optionally one status only. */
export async function listIdeas(db, orgId, { status = null } = {}) {
  const r = await db.query(
    `SELECT * FROM ad_ideas
      WHERE org_id = $1 AND ($2::text IS NULL OR status = $2::text)
      ORDER BY created_at DESC, id DESC
      LIMIT ${IDEAS_LIST_LIMIT}`,
    [orgId, status]
  );
  return r.rows;
}

/** The company's batches, newest first. */
export async function listBatches(db, orgId) {
  const r = await db.query(
    `SELECT * FROM marketing_batches
      WHERE org_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT ${BATCHES_LIST_LIMIT}`,
    [orgId]
  );
  return r.rows;
}

/* ── Write now ───────────────────────────────────────────────────────────── */

/** A model-bill cap is reached; nothing was queued. The route answers 400 cap_reached. */
export class CapReachedError extends Error {
  /** @param {string} message @param {{batch_capped:boolean, month_capped:boolean}} cost costStatus's answer */
  constructor(message, cost) {
    super(message);
    this.name = "CapReachedError";
    this.cost = cost;
  }
}

const usd = (n) => `$${Number(n).toFixed(2)}`;

/** The sentence that says which cap is reached, in plain words. */
export function capMessage(status, settings) {
  const monthCap = settings?.max_month_cost_usd;
  const batchCap = settings?.max_batch_cost_usd;
  if (status.month_capped) {
    return `This month's model spend is ${usd(status.month_usd)}, and the month cap is ` +
      `${monthCap == null ? "set" : usd(monthCap)}. Nothing was queued. Raise the cap in Settings or wait for next month.`;
  }
  return `The cap for one batch is ${batchCap == null ? "set" : usd(batchCap)}, so a new batch cannot start. ` +
    "Nothing was queued. Raise the cap in Settings.";
}

/**
 * Start one on-command batch: check the caps, make the batch row, queue
 * start_batch. Runs inside the caller's transaction (withRequest's tx); the
 * caller wakes the worker after COMMIT.
 *
 * Ideas named in ideaIds must belong to the company. Those not already in a
 * batch are stamped with this batch, so the weekly planner does not pick the
 * same idea again while this one is being written.
 *
 * @param {Db} tx
 * @param {string} orgId
 * @param {{settings: any, count?: number|null, funnelKey?: string|null, ideaIds?: string[],
 *          deps?: {costStatus?: Function, enqueueJob?: Function}}} args
 * @returns {Promise<{batch: any, job: any}>}
 * @throws CapReachedError | InvalidError
 */
export async function startWriteNow(tx, orgId, { settings, count = null, funnelKey = null, ideaIds = [], deps = {} }) {
  const checkCost = deps.costStatus ?? costStatus;
  const queue = deps.enqueueJob ?? enqueueJob;

  await assertFunnel(tx, orgId, funnelKey);
  if (ideaIds.length) {
    const found = await tx.query(
      `SELECT id FROM ad_ideas WHERE org_id = $1 AND id = ANY($2::uuid[])`,
      [orgId, ideaIds]
    );
    if (found.rows.length !== ideaIds.length) {
      throw new InvalidError("idea_ids", "One or more of those ideas is not in your ideas list.");
    }
  }

  // The new batch has spent nothing, so its own cap is reached only when the
  // cap is $0. The month counts every call this company made this month.
  const batchId = randomUUID();
  const cost = await checkCost(tx, {
    orgId, batchId,
    maxBatchUsd: settings?.max_batch_cost_usd,
    maxMonthUsd: settings?.max_month_cost_usd
  });
  if (cost.batch_capped || cost.month_capped) {
    throw new CapReachedError(capMessage(cost, settings), cost);
  }

  const n = count ?? Number(settings?.scripts_per_day ?? 3);
  const tz = settings?.timezone || "America/Phoenix";
  const batch = (await tx.query(
    `INSERT INTO marketing_batches (id, org_id, kind, week_key, status, release_at)
     VALUES ($1, $2, 'on_command', to_char(now() AT TIME ZONE $3::text, 'IYYY-"W"IW'), 'planned', now())
     RETURNING *`,
    [batchId, orgId, tz]
  )).rows[0];

  if (ideaIds.length) {
    await tx.query(
      `UPDATE ad_ideas SET batch_id = $3
        WHERE org_id = $1 AND id = ANY($2::uuid[]) AND batch_id IS NULL`,
      [orgId, ideaIds, batchId]
    );
  }

  const job = await queue(tx, {
    orgId,
    kind: START_BATCH_KIND,
    payload: { batch_id: batchId, count: n, funnel_key: funnelKey, idea_ids: ideaIds }
  });
  return { batch, job };
}
