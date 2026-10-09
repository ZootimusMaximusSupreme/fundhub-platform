// The hourly pulse's records — three tables, one module (migration 475).
//
//   pulse_beats       one row per beat per run. Insert-only.
//   pulse_incidents   one row per break; at most one OPEN row per beat.
//   pulse_bank_links  the last result per bank Apply URL (sha-256 of the URL, never the URL).
//
// Contract: ops/workflows/pulse-layer-2026-10-09-contract.md 4.2, cut by
// ops/workflows/pulse-layer-2026-10-09-v1.md (deltas 6, 11, 13).
//
// RULES THIS FILE KEEPS
//   - Every function takes `rdb`, anything with `query(sql, params)` that answers { rows, rowCount }.
//   - One SQL statement per call. No transaction, no BEGIN, no savepoint, no advisory lock.
//   - No function throws. Every failure comes back as { ok:false, error } with a short, redacted message.
//   - A table that is not there yet (the migration ships in the same deploy) is a handled error, not a crash.
//   - Nothing here deletes. There is no DELETE grant and no retention job (owner decision, not yet made).
//   - A beat never imports this file. Beats get their data from the runner (ctx.state) and hand rows
//     back; the runner calls upsertBankLinks. The static pin in the beat guard keeps beats off this module.
//   - Time that was not measured stays NULL. Never 0.
//
// ROW SHAPES
//   listOpenIncidents, last24 and lastResults return the database's own snake_case columns, so the alert
//   words can read opened_at, last_alert_at, alerts_sent and so on straight off the row.
//   loadBankLinks / upsertBankLinks use the camelCase shape of v1 delta 13.

export const BEAT_ID_RE = /^[a-z0-9][a-z0-9-]{0,43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const ISSUE_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/issues\/[0-9]+$/;
const SESSION_URL_RE = /^https:\/\/claude\.ai\/[^\s]+$/;

export const CAUSE_CATEGORIES = Object.freeze([
  "code_bug", "missing_route", "config_or_env", "migration_not_applied", "schema_or_data",
  "deploy_or_bundle", "vendor_down", "vendor_changed", "bank_site_changed",
  "timeout_or_capacity", "pulse_false_alarm", "unknown"
]);
export const CLOSED_BY = Object.freeze(["auto", "claude", "chris"]);
export const FIXER_STATUSES = Object.freeze(["not_set_up", "no_issue", "dispatched", "session_started", "capped", "fire_failed"]);
export const BANK_LINK_CLASSES = Object.freeze(["OK", "WALL", "HARD", "SLOW", "BAD_URL"]);

/* The caps match the CHECK constraints in 475, so one long string cannot fail a whole batch. */
export const LIMITS = Object.freeze({
  step: 120, detail: 2000, firstDetail: 2000, note: 2000, linkDetail: 300, host: 255,
  stepsJson: 6000, stepName: 60, stepsMax: 40,
  resultsPerWrite: 100, bankLinksPerWrite: 500, bankLinksLoad: 5000, openIncidents: 200, last24: 30
});

/* ---------- small helpers ---------- */

function failure(error, extra = {}) {
  return { ok: false, error: cleanError(error), ...extra };
}

/** A short message with any database URL stripped. Never throws. */
export function cleanError(err) {
  let msg = "";
  try { msg = String((err && err.message) || err || "unknown error"); } catch { msg = "unknown error"; }
  return msg.replace(/postgres(?:ql)?:\/\/\S+/gi, "[database url]").replace(/\s+/g, " ").trim().slice(0, 300) || "unknown error";
}

/** True when the failure means a pulse table is not there yet (the migration has not been applied). */
export function isMissingTable(err) {
  if (!err) return false;
  if (err.code === "42P01") return true;
  return /relation .*pulse_(beats|incidents|bank_links).* does not exist/i.test(String(err.message || err));
}

function haveDb(rdb) {
  return !!rdb && typeof rdb.query === "function";
}

function isUuid(v) { return typeof v === "string" && UUID_RE.test(v); }
function isBeatId(v) { return typeof v === "string" && BEAT_ID_RE.test(v); }

/*
 * Text that Postgres will take. A NUL (U+0000) and a lone surrogate half make jsonb_to_recordset refuse the WHOLE
 * multi-row statement ("unsupported Unicode escape sequence" / "invalid input syntax for type json"), and one row
 * that comes back with the same text every hour would then never be saved. So both are stripped, and a cut never
 * splits an emoji in half. A real pair (an emoji) is kept: the high half must be followed by a low half.
 */
const BAD_TEXT_RE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const HAS_BAD_TEXT_RE = new RegExp(BAD_TEXT_RE.source); // no /g flag, so .test() keeps no state between calls
function wellFormed(s) { return s.replace(BAD_TEXT_RE, ""); }

function cut(value, max) {
  if (value === null || value === undefined) return null;
  let s;
  try { s = String(value); } catch { return null; } // an object whose toString throws is not text
  // Look one unit past the limit so a pair that straddles the cut is seen whole, then drop a half left dangling.
  s = wellFormed(s.length > max + 1 ? s.slice(0, max + 1) : s);
  return s.length > max ? wellFormed(s.slice(0, max)) : s;
}

/** A non-empty string cut to `max`, or null. */
function text(value, max) {
  const s = cut(value, max);
  return s !== null && s.trim() !== "" ? s : null;
}

/** An ISO time Postgres accepts (year 1970 to 9999), or null. A time outside that is dropped, never sent. */
function isoOrNull(value) {
  try {
    if (value === null || value === undefined || value === "") return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const year = d.getUTCFullYear();
    if (year < 1970 || year > 9999) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

/** The biggest value of an integer column. A longer time is cut to it, so one huge number cannot fail the batch. */
export const MAX_INT = 2147483647;

/** A whole number from 0 to MAX_INT, or null. Never defaults to 0. */
function wholeMs(value) {
  try {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.min(Math.round(n), MAX_INT);
  } catch {
    return null;
  }
}

async function run(rdb, sql, params) {
  // The caller's query may throw or reject; both end up here.
  return rdb.query(sql, params);
}

/* ---------- org ---------- */

export const SQL_DEFAULT_ORG = `SELECT id FROM orgs WHERE is_default ORDER BY created_at LIMIT 1`;

export async function defaultOrgId(rdb) {
  if (!haveDb(rdb)) return failure("no database handle", { orgId: null });
  try {
    const r = await run(rdb, SQL_DEFAULT_ORG, []);
    const id = r && r.rows && r.rows[0] && r.rows[0].id;
    if (!id) return failure("no default org", { orgId: null });
    return { ok: true, orgId: id, error: null };
  } catch (err) {
    return failure(err, { orgId: null });
  }
}

/* ---------- pulse_beats ---------- */

/** One beat result -> the JSON row the insert reads, or null when the row cannot be saved at all. */
function beatRow(r) {
  if (!r || typeof r !== "object") return null;
  const beatId = r.beatId ?? r.beat_id;
  if (!isBeatId(beatId)) return null;
  const ok = r.ok === true;
  let step = text(r.step, LIMITS.step);
  let detail = text(r.detail, LIMITS.detail);
  // 475 refuses a red row that does not say where and why. Say so instead of losing the whole batch.
  if (!ok) {
    step = step || "unknown";
    detail = detail || "(no detail)";
  }
  // `ms` is the BeatResult field; `durationMs` is accepted too. null / missing / negative = not measured.
  const ms = wholeMs(r.durationMs !== undefined ? r.durationMs : r.ms);
  const row = { beat_id: beatId, ok };
  if (step !== null) row.step = step;
  if (detail !== null) row.detail = detail;
  if (ms !== null) row.duration_ms = ms;
  const ranAt = isoOrNull(r.ranAt);
  if (ranAt) row.ran_at = ranAt;
  const steps = stepsJson(r.steps);
  if (steps) row.steps = steps;
  return row;
}

/*
 * [{name, ms, ok}] kept small enough for the 8,000 byte CHECK (pg_column_size of the jsonb, so BYTES, not characters).
 * A name of 4-byte emoji is 4x its character count, so the budget counts UTF-8 bytes plus the room jsonb spends on
 * each object (measured read-only on live Postgres: a step with a 10 digit time costs about 52 bytes plus its name; 64 is the safe figure). null = leave the column empty.
 */
const STEP_OVERHEAD_BYTES = 64;
const STEPS_BYTE_BUDGET = 7000;

function stepsJson(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const out = [];
  let used = 2;
  for (const s of steps.slice(0, LIMITS.stepsMax)) {
    if (!s || typeof s !== "object") continue;
    const name = text(s.name, LIMITS.stepName);
    if (!name) continue;
    const cost = STEP_OVERHEAD_BYTES + Buffer.byteLength(name, "utf8");
    if (used + cost > STEPS_BYTE_BUDGET) break;
    used += cost;
    const e = { name, ok: s.ok === true };
    const ms = wholeMs(s.ms);
    if (ms !== null) e.ms = ms;
    out.push(e);
  }
  while (out.length && JSON.stringify(out).length > LIMITS.stepsJson) out.pop();
  return out.length ? out : null;
}

export const SQL_WRITE_BEATS = `INSERT INTO pulse_beats (org_id, run_id, beat_id, ran_at, ok, step, detail, duration_ms, steps)
SELECT $1::uuid, $2::uuid, r.beat_id, COALESCE(r.ran_at, now()), r.ok, r.step, r.detail, r.duration_ms, r.steps
  FROM jsonb_to_recordset($3::jsonb)
       AS r(beat_id text, ran_at timestamptz, ok boolean, step text, detail text, duration_ms integer, steps jsonb)
ON CONFLICT (run_id, beat_id) DO NOTHING`;

/**
 * One multi-row insert of this run's beat results. A retried run cannot double-insert (run_id, beat_id).
 * results: [{ beatId, ok, step?, detail?, ms? (null = not measured), steps?: [{name, ms, ok}] }]
 * Rows that cannot be saved (bad beat id) are counted in `skipped`, never silently.
 */
export async function writeBeatResults(rdb, { orgId, runId, results } = {}) {
  if (!haveDb(rdb)) return failure("no database handle", { written: 0 });
  if (!isUuid(orgId)) return failure("orgId must be a uuid", { written: 0 });
  if (!isUuid(runId)) return failure("runId must be a uuid", { written: 0 });
  if (!Array.isArray(results)) return failure("results must be an array", { written: 0 });
  const rows = [];
  let skipped = 0;
  for (const r of results.slice(0, LIMITS.resultsPerWrite)) {
    let row = null;
    try { row = beatRow(r); } catch { row = null; } // a hostile object costs its own row, never the batch
    if (row) rows.push(row); else skipped++;
  }
  skipped += Math.max(0, results.length - LIMITS.resultsPerWrite);
  if (rows.length === 0) return { ok: true, written: 0, skipped, error: null };
  try {
    const r = await run(rdb, SQL_WRITE_BEATS, [orgId, runId, JSON.stringify(rows)]);
    return { ok: true, written: Number(r && r.rowCount) || 0, skipped, error: null };
  } catch (err) {
    return failure(err, { written: 0, skipped, missingTable: isMissingTable(err) });
  }
}

export const SQL_LAST_RESULTS = `SELECT r.beat_id, r.run_id, r.ran_at, r.ok, r.step, r.detail
  FROM unnest($2::text[]) AS b(beat_id)
 CROSS JOIN LATERAL (
   SELECT p.beat_id, p.run_id, p.ran_at, p.ok, p.step, p.detail
     FROM pulse_beats p
    WHERE p.org_id = $1::uuid AND p.beat_id = b.beat_id
    ORDER BY p.ran_at DESC
    LIMIT 2
 ) AS r
 ORDER BY r.beat_id, r.ran_at DESC`;

/**
 * The newest 2 rows per beat, for flap damping. Rows are { beat_id, run_id, ran_at, ok, step, detail },
 * newest first within a beat. If the read fails the caller must NOT damp (alert on the first red).
 */
export async function lastResults(rdb, { orgId, beatIds } = {}) {
  if (!haveDb(rdb)) return failure("no database handle", { rows: [] });
  if (!isUuid(orgId)) return failure("orgId must be a uuid", { rows: [] });
  if (!Array.isArray(beatIds)) return failure("beatIds must be an array", { rows: [] });
  const ids = [...new Set(beatIds.filter(isBeatId))];
  if (ids.length === 0) return { ok: true, rows: [], error: null };
  try {
    const r = await run(rdb, SQL_LAST_RESULTS, [orgId, ids]);
    return { ok: true, rows: (r && r.rows) || [], error: null };
  } catch (err) {
    return failure(err, { rows: [], missingTable: isMissingTable(err) });
  }
}

export const SQL_LAST_24 = `SELECT run_id, ran_at, ok, step, detail, duration_ms
  FROM pulse_beats
 WHERE org_id = $1::uuid AND beat_id = $2 AND ran_at > now() - interval '24 hours'
 ORDER BY ran_at DESC
 LIMIT ${LIMITS.last24}`;

/** The last 24 hours of one beat, newest first (for the alert words). */
export async function last24(rdb, { orgId, beatId } = {}) {
  if (!haveDb(rdb)) return failure("no database handle", { rows: [] });
  if (!isUuid(orgId)) return failure("orgId must be a uuid", { rows: [] });
  if (!isBeatId(beatId)) return failure("beatId is not a valid beat id", { rows: [] });
  try {
    const r = await run(rdb, SQL_LAST_24, [orgId, beatId]);
    return { ok: true, rows: (r && r.rows) || [], error: null };
  } catch (err) {
    return failure(err, { rows: [], missingTable: isMissingTable(err) });
  }
}

/* ---------- pulse_incidents ---------- */

export const SQL_LIST_OPEN = `SELECT id, beat_id, opened_at, opened_run_id, first_step, first_detail, last_alert_at, alerts_sent,
       github_issue_number, github_issue_url, fixer_status, claude_session_url
  FROM pulse_incidents
 WHERE org_id = $1::uuid AND closed_at IS NULL
 ORDER BY opened_at
 LIMIT ${LIMITS.openIncidents}`;

export async function listOpenIncidents(rdb, orgId) {
  if (!haveDb(rdb)) return failure("no database handle", { rows: [] });
  if (!isUuid(orgId)) return failure("orgId must be a uuid", { rows: [] });
  try {
    const r = await run(rdb, SQL_LIST_OPEN, [orgId]);
    return { ok: true, rows: (r && r.rows) || [], error: null };
  } catch (err) {
    return failure(err, { rows: [], missingTable: isMissingTable(err) });
  }
}

export const SQL_OPEN_INCIDENT = `INSERT INTO pulse_incidents
  (org_id, beat_id, opened_run_id, first_step, first_detail, github_issue_number, github_issue_url)
VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7)
ON CONFLICT (org_id, beat_id) WHERE closed_at IS NULL DO NOTHING
RETURNING id`;

/**
 * Open a break. `won` is true when THIS call made the row; false when an open incident for the beat already
 * exists (another invocation owns it). `issue` is optional: { number, url } (both or neither; NULL tonight).
 */
export async function openIncident(rdb, { orgId, beatId, runId, step, detail, issue } = {}) {
  if (!haveDb(rdb)) return failure("no database handle", { id: null, won: false });
  if (!isUuid(orgId)) return failure("orgId must be a uuid", { id: null, won: false });
  if (!isUuid(runId)) return failure("runId must be a uuid", { id: null, won: false });
  if (!isBeatId(beatId)) return failure("beatId is not a valid beat id", { id: null, won: false });
  let number = null;
  let url = null;
  if (issue !== undefined && issue !== null) {
    number = Number(issue.number);
    url = issue.url;
    if (!Number.isInteger(number) || number <= 0 || typeof url !== "string" || !ISSUE_URL_RE.test(url)) {
      return failure("issue needs a positive number and a github.com issue url", { id: null, won: false });
    }
  }
  try {
    const r = await run(rdb, SQL_OPEN_INCIDENT, [
      orgId, String(beatId), runId,
      text(step, LIMITS.step) || "unknown",
      text(detail, LIMITS.firstDetail) || "(no detail)",
      number, url
    ]);
    const row = r && r.rows && r.rows[0];
    return { ok: true, id: row ? row.id : null, won: !!row, error: null };
  } catch (err) {
    return failure(err, { id: null, won: false, missingTable: isMissingTable(err) });
  }
}

export const SQL_CLAIM_ALERT = `UPDATE pulse_incidents
   SET last_alert_at = now(), alerts_sent = alerts_sent + 1
 WHERE id = $1::uuid AND closed_at IS NULL
   AND (last_alert_at IS NULL OR last_alert_at < now() - interval '50 minutes')
RETURNING id, alerts_sent`;

/** Take the right to text about this break. At most one claim per 50 minutes, so a re-run cannot double-text. */
export async function claimAlert(rdb, incidentId) {
  if (!haveDb(rdb)) return failure("no database handle", { claimed: false });
  if (!isUuid(incidentId)) return failure("incidentId must be a uuid", { claimed: false });
  try {
    const r = await run(rdb, SQL_CLAIM_ALERT, [incidentId]);
    const row = r && r.rows && r.rows[0];
    return { ok: true, claimed: !!row, alertsSent: row ? row.alerts_sent : null, error: null };
  } catch (err) {
    return failure(err, { claimed: false, missingTable: isMissingTable(err) });
  }
}

export const SQL_SET_ISSUE = `UPDATE pulse_incidents
   SET github_issue_number = $2, github_issue_url = $3, fixer_status = COALESCE($4, fixer_status)
 WHERE id = $1::uuid
RETURNING id`;

export async function setIssue(rdb, incidentId, { number, url, fixerStatus } = {}) {
  if (!haveDb(rdb)) return failure("no database handle");
  if (!isUuid(incidentId)) return failure("incidentId must be a uuid");
  if (!Number.isInteger(number) || number <= 0) return failure("issue number must be a positive whole number");
  if (typeof url !== "string" || !ISSUE_URL_RE.test(url)) return failure("issue url must be a github.com issue url");
  if (fixerStatus !== undefined && fixerStatus !== null && !FIXER_STATUSES.includes(fixerStatus)) {
    return failure("fixerStatus is not in the list");
  }
  try {
    const r = await run(rdb, SQL_SET_ISSUE, [incidentId, number, url, fixerStatus ?? null]);
    return { ok: true, updated: !!(r && r.rows && r.rows[0]), error: null };
  } catch (err) {
    return failure(err, { missingTable: isMissingTable(err) });
  }
}

export const SQL_SET_FIXER = `UPDATE pulse_incidents
   SET fixer_status = COALESCE($2, fixer_status), claude_session_url = COALESCE($3, claude_session_url)
 WHERE id = $1::uuid
RETURNING id`;

export async function setFixer(rdb, incidentId, { fixerStatus, sessionUrl } = {}) {
  if (!haveDb(rdb)) return failure("no database handle");
  if (!isUuid(incidentId)) return failure("incidentId must be a uuid");
  const status = fixerStatus === undefined ? null : fixerStatus;
  const session = sessionUrl === undefined ? null : sessionUrl;
  if (status === null && session === null) return failure("nothing to set");
  if (status !== null && !FIXER_STATUSES.includes(status)) return failure("fixerStatus is not in the list");
  if (session !== null && (typeof session !== "string" || session.length > 500 || !SESSION_URL_RE.test(session) || HAS_BAD_TEXT_RE.test(session))) {
    return failure("sessionUrl must be a claude.ai link of 500 characters or fewer");
  }
  try {
    const r = await run(rdb, SQL_SET_FIXER, [incidentId, status, session]);
    return { ok: true, updated: !!(r && r.rows && r.rows[0]), error: null };
  } catch (err) {
    return failure(err, { missingTable: isMissingTable(err) });
  }
}

export const SQL_CLOSE_INCIDENT = `UPDATE pulse_incidents
   SET closed_at = now(), closed_by = $2,
       cause_category = $3, cause_note = $4, fix_summary = $5, guard_added = $6
 WHERE id = $1::uuid AND closed_at IS NULL
RETURNING id`;

/**
 * Close an incident. closedBy 'auto' = the beat went green; the four learning fields stay NULL.
 * closedBy 'claude' or 'chris' needs lesson = { cause_category, cause_note, fix_summary, guard_added },
 * all four filled (475 refuses the row otherwise; this checks first so the error is plain).
 * `closed` is false when the incident was already closed.
 */
export async function closeIncident(rdb, incidentId, { closedBy, lesson } = {}) {
  if (!haveDb(rdb)) return failure("no database handle", { closed: false });
  if (!isUuid(incidentId)) return failure("incidentId must be a uuid", { closed: false });
  if (!CLOSED_BY.includes(closedBy)) return failure("closedBy must be auto, claude or chris", { closed: false });
  let category = null, note = null, fix = null, guard = null;
  if (closedBy !== "auto") {
    const l = lesson && typeof lesson === "object" ? lesson : {};
    category = l.cause_category ?? null;
    note = text(l.cause_note, LIMITS.note);
    fix = text(l.fix_summary, LIMITS.note);
    guard = text(l.guard_added, LIMITS.note);
    if (!CAUSE_CATEGORIES.includes(category)) return failure("lesson.cause_category is not in the list", { closed: false });
    if (!note || !fix || !guard) {
      return failure("a close by claude or chris needs cause_note, fix_summary and guard_added", { closed: false });
    }
  }
  try {
    const r = await run(rdb, SQL_CLOSE_INCIDENT, [incidentId, closedBy, category, note, fix, guard]);
    return { ok: true, closed: !!(r && r.rows && r.rows[0]), error: null };
  } catch (err) {
    return failure(err, { closed: false, missingTable: isMissingTable(err) });
  }
}

/* ---------- pulse_bank_links ---------- */

export const SQL_LOAD_BANK_LINKS = `SELECT url_hash, host, lender_ids, first_seen_at, last_checked_at, last_class, last_status,
       last_detail, last_good_at, fail_streak, final_host
  FROM pulse_bank_links
 WHERE org_id = $1::uuid
 ORDER BY last_checked_at NULLS FIRST, url_hash
 LIMIT ${LIMITS.bankLinksLoad}`;

function bankLinkOut(r) {
  const lenderIds = Array.isArray(r.lender_ids) ? r.lender_ids : [];
  return {
    urlHash: r.url_hash,
    lenderId: lenderIds[0] || null,
    lenderIds,
    host: r.host,
    firstSeenAt: isoOrNull(r.first_seen_at),
    lastCheckedAt: isoOrNull(r.last_checked_at),
    lastGoodAt: isoOrNull(r.last_good_at),
    lastClass: r.last_class || null,
    lastStatus: r.last_status === null || r.last_status === undefined ? null : Number(r.last_status),
    lastDetail: r.last_detail || null,
    failStreak: Number(r.fail_streak) || 0,
    finalHost: r.final_host || null,
    // The host the last check ended on (after redirects); falls back to the URL's own host.
    lastHost: r.final_host || r.host || null
  };
}

/**
 * Everything the apply-links beat remembers, never-checked first. A missing table (migration not applied yet)
 * returns { ok:false, rows:[] }; the beat treats that as a first pass. Times come back as ISO strings.
 */
export async function loadBankLinks(rdb, orgId) {
  if (!haveDb(rdb)) return failure("no database handle", { rows: [] });
  if (!isUuid(orgId)) return failure("orgId must be a uuid", { rows: [] });
  try {
    const r = await run(rdb, SQL_LOAD_BANK_LINKS, [orgId]);
    return { ok: true, rows: ((r && r.rows) || []).map(bankLinkOut), error: null };
  } catch (err) {
    return failure(err, { rows: [], missingTable: isMissingTable(err) });
  }
}

/** One camelCase bank link -> the JSON row the upsert reads, or null when it cannot be saved. */
function bankLinkRow(r) {
  if (!r || typeof r !== "object") return null;
  const urlHash = String(r.urlHash ?? r.url_hash ?? "").toLowerCase();
  if (!HASH_RE.test(urlHash)) return null;
  const host = text(r.host ?? r.lastHost, LIMITS.host);
  if (!host) return null;
  const ids = [];
  const wanted = Array.isArray(r.lenderIds) ? [...r.lenderIds] : [];
  if (r.lenderId) wanted.push(r.lenderId);
  for (const id of wanted) {
    if (isUuid(id) && !ids.includes(String(id).toLowerCase())) ids.push(String(id).toLowerCase());
  }
  const cls = BANK_LINK_CLASSES.includes(r.lastClass) ? r.lastClass : null;
  const status = r.lastStatus === null || r.lastStatus === undefined ? null : Number(r.lastStatus);
  const row = { url_hash: urlHash, host, lender_ids: ids };
  const checked = isoOrNull(r.lastCheckedAt);
  if (checked) row.last_checked_at = checked;
  if (cls) row.last_class = cls;
  if (Number.isInteger(status) && status >= 0 && status <= 999) row.last_status = status;
  const detail = text(r.lastDetail, LIMITS.linkDetail);
  if (detail) row.last_detail = detail;
  const good = isoOrNull(r.lastGoodAt);
  if (good) row.last_good_at = good;
  const fin = text(r.finalHost ?? r.lastHost, LIMITS.host);
  if (fin) row.final_host = fin;
  return row;
}

/*
 * ONE statement, many rows. A row with no last_class is a registration only (a URL seen on a lender but not
 * checked yet): host and lender ids are saved and the old check result is kept. A row with a last_class is a
 * check result: the streak is counted here (OK resets it, anything else adds one), last_good_at only moves
 * forward, and the old value of any field the new row left empty is kept. An OK check IS a good time: if the caller
 * sent no last_good_at, the check's own time (or now) is used, so "was good, now dead" can never be blinded by a
 * caller that forgot to send it. The conflict branch reads EXCLUDED, which already carries that value.
 */
export const SQL_UPSERT_BANK_LINKS = `INSERT INTO pulse_bank_links AS b
  (org_id, url_hash, host, lender_ids, last_checked_at, last_class, last_status, last_detail, last_good_at, fail_streak, final_host)
SELECT $1::uuid, r.url_hash, r.host,
       COALESCE(ARRAY(SELECT jsonb_array_elements_text(r.lender_ids))::uuid[], '{}'::uuid[]),
       r.last_checked_at, r.last_class, r.last_status, r.last_detail,
       CASE WHEN r.last_class = 'OK' THEN COALESCE(r.last_good_at, r.last_checked_at, now()) ELSE r.last_good_at END,
       CASE WHEN r.last_class IS NULL OR r.last_class = 'OK' THEN 0 ELSE 1 END,
       r.final_host
  FROM jsonb_to_recordset($2::jsonb)
       AS r(url_hash text, host text, lender_ids jsonb, last_checked_at timestamptz, last_class text, last_status integer,
            last_detail text, last_good_at timestamptz, final_host text)
ON CONFLICT (org_id, url_hash) DO UPDATE SET
  host            = EXCLUDED.host,
  lender_ids      = CASE WHEN cardinality(EXCLUDED.lender_ids) > 0 THEN EXCLUDED.lender_ids ELSE b.lender_ids END,
  last_checked_at = COALESCE(EXCLUDED.last_checked_at, b.last_checked_at),
  last_class      = COALESCE(EXCLUDED.last_class, b.last_class),
  last_status     = CASE WHEN EXCLUDED.last_class IS NULL THEN b.last_status ELSE EXCLUDED.last_status END,
  last_detail     = CASE WHEN EXCLUDED.last_class IS NULL THEN b.last_detail ELSE EXCLUDED.last_detail END,
  last_good_at    = GREATEST(b.last_good_at, EXCLUDED.last_good_at),
  fail_streak     = CASE WHEN EXCLUDED.last_class IS NULL THEN b.fail_streak
                         WHEN EXCLUDED.last_class = 'OK' THEN 0
                         ELSE b.fail_streak + 1 END,
  final_host      = CASE WHEN EXCLUDED.last_class IS NULL THEN b.final_host ELSE EXCLUDED.final_host END`;

/**
 * Save what the apply-links beat learned, in one statement. Nothing else is touched (v1 delta 13).
 * rows: [{ urlHash, host?, lastHost?, lenderId?, lenderIds?, lastCheckedAt?, lastGoodAt?, lastClass?, lastStatus?,
 *          lastDetail?, finalHost? }]. Rows that cannot be saved (bad hash, no host) are counted in `skipped`.
 * A missing table returns { ok:false, written:0 } and never throws.
 */
export async function upsertBankLinks(rdb, { orgId, rows } = {}) {
  if (!haveDb(rdb)) return failure("no database handle", { written: 0 });
  if (!isUuid(orgId)) return failure("orgId must be a uuid", { written: 0 });
  if (!Array.isArray(rows)) return failure("rows must be an array", { written: 0 });
  const byHash = new Map();
  let skipped = 0;
  for (const r of rows.slice(0, LIMITS.bankLinksPerWrite)) {
    let row = null;
    try { row = bankLinkRow(r); } catch { row = null; } // a hostile object costs its own row, never the batch
    if (row) byHash.set(row.url_hash, row); else skipped++; // two rows for one URL in a batch: the last one wins
  }
  skipped += Math.max(0, rows.length - LIMITS.bankLinksPerWrite);
  if (byHash.size === 0) return { ok: true, written: 0, skipped, error: null };
  try {
    const r = await run(rdb, SQL_UPSERT_BANK_LINKS, [orgId, JSON.stringify([...byHash.values()])]);
    return { ok: true, written: Number(r && r.rowCount) || 0, skipped, error: null };
  } catch (err) {
    return failure(err, { written: 0, skipped, missingTable: isMissingTable(err) });
  }
}
