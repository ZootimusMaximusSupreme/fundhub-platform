// @ts-check
// Shoot Day, the database half: the open shoot, the scripts ready to film, the
// progress board, and the three writes (save the plan, change it, mark a take).
// Every function takes the transaction it runs in; nothing here opens its own.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §8.2; design
// docs/specs/command-center-design-2026-10-05.md §3.4; shapes
// docs/specs/marketing-machine-api.md §7.1. Table marketing_shoots (migration
// 411, U04). Unit X5.
//
// WHO CALLS IT
//   api/marketing/shoot.mjs (GET through staffRead, POST through withRequest)
//   and api/marketing/shoot/mark.mjs (POST through withRequest). ad_scripts,
//   ad_videos, marketing_funnels, ad_ideas and marketing_shoots all force row
//   security: outside a staff transaction a read sees nothing.
//
// THE RULES THIS FILE HOLDS
//   * One open shoot per company (any status but done). A second "save the
//     plan" while one is open is refused with what to do instead. The check
//     runs under a per-company lock, so two taps cannot both create one.
//   * A plan holds approved scripts only: the live version is locked, or it is
//     filmed and needs a retake. A script already on the shoot stays allowed
//     when the plan is reordered, whatever its status is now.
//   * Saving the plan also sets the film order (ad_scripts.film_order, first =
//     1) to the shoot's order, through the same orderScripts() the Scripts tab
//     uses — so Scripts and Shoot never show two different orders.
//   * Got it marks the shoot only. A script becomes `filmed` when the video
//     pipeline matches its take (spec §7.4) — never here.
//   * A closed (done) shoot is never changed again.

import { isUuid } from "../http/read-api.mjs";
import { InvalidError, NotFoundError } from "./http.mjs";
import { scriptView, VISIBLE_SQL, orderScripts } from "./scripts-store.mjs";
import {
  DEFAULT_WPM, MIN_WPM, MAX_WPM, MARKS, JOINED_PREFIX,
  planFields, planCompare, estimateMinutes, boardRow, sortBoard, applyMark
} from "./shoot-plan.mjs";

export const SHOOT_STATUSES = Object.freeze(["planned", "filming", "uploaded", "done"]);
export const MAX_SHOOT_SCRIPTS = 100;
export const PAST_SHOOTS = 5;

/* ── checking what the screen sent (no database) ─────────────────────────── */

/** GET ?wpm= : the reading speed the estimate uses (80 to 260, default 150). */
export function parseWpm(query = {}) {
  const raw = query && query.wpm;
  if (raw === undefined || raw === null || raw === "") return DEFAULT_WPM;
  const n = typeof raw === "string" && /^[0-9]{1,3}$/.test(raw) ? Number(raw) : raw;
  if (!Number.isInteger(n) || n < MIN_WPM || n > MAX_WPM) {
    throw new InvalidError("wpm", `wpm must be a whole number from ${MIN_WPM} to ${MAX_WPM}.`);
  }
  return Number(n);
}

/** root_script_ids: uuids, each once, at least one, at most 100. */
export function parseRootIds(ids) {
  const fail = (m) => new InvalidError("root_script_ids", m);
  if (!Array.isArray(ids) || !ids.length) throw fail("root_script_ids must list at least one script id (root_script_id), first to film first.");
  if (ids.length > MAX_SHOOT_SCRIPTS) throw fail(`A shoot holds at most ${MAX_SHOOT_SCRIPTS} scripts.`);
  const seen = new Set();
  for (const id of ids) {
    if (!isUuid(id)) throw fail("Every item in root_script_ids must be a script id (a uuid).");
    const k = String(id).toLowerCase();
    if (seen.has(k)) throw fail("A script is on the list twice.");
    seen.add(k);
  }
  return ids.map((id) => String(id).toLowerCase());
}

/** shoot_date: YYYY-MM-DD, a real day; null when not sent (the database fills Arizona's today). */
export function parseShootDate(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new InvalidError("shoot_date", "shoot_date must be a day written YYYY-MM-DD.");
  }
  const d = new Date(v + "T12:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new InvalidError("shoot_date", "shoot_date is not a real day.");
  }
  return v;
}

/** status: one of planned, filming, uploaded, done; null when not sent. */
export function parseStatus(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !SHOOT_STATUSES.includes(v)) {
    throw new InvalidError("status", `status must be one of: ${SHOOT_STATUSES.join(", ")}.`);
  }
  return v;
}

/**
 * POST marketing/shoot body → one of three moves.
 *   create  {shoot_date?, root_script_ids}
 *   update  {id, root_script_ids?, status?, shoot_date?}
 */
export function parseShootWrite(body) {
  const id = body && body.id !== undefined && body.id !== null && body.id !== "" ? body.id : null;
  if (id !== null && !isUuid(id)) throw new InvalidError("id", "id must be the shoot's id (a uuid).");
  const shootDate = parseShootDate(body && body.shoot_date);
  const status = parseStatus(body && body.status);
  const hasIds = body && body.root_script_ids !== undefined && body.root_script_ids !== null;
  const ids = hasIds ? parseRootIds(body.root_script_ids) : null;
  if (id === null) {
    if (!ids) throw new InvalidError("root_script_ids", "Pick at least one script to plan a shoot.");
    if (status && status !== "planned") {
      throw new InvalidError("status", "A new shoot starts as planned. Save the plan first, then change it.");
    }
    return { kind: "create", shootDate, ids };
  }
  if (!ids && !status && !shootDate) {
    throw new InvalidError("body", "Send root_script_ids to change the plan, or status to move the shoot.");
  }
  return { kind: "update", id: String(id).toLowerCase(), shootDate, status, ids };
}

/** POST marketing/shoot/mark body. */
export function parseMarkWrite(body) {
  const shootId = body && body.shoot_id;
  if (!isUuid(shootId)) throw new InvalidError("shoot_id", "shoot_id must be the shoot's id (a uuid).");
  const root = body && body.root_script_id;
  if (!isUuid(root)) throw new InvalidError("root_script_id", "root_script_id must be the script's id (a uuid).");
  const mark = body && body.mark;
  if (typeof mark !== "string" || !MARKS.includes(mark)) {
    throw new InvalidError("mark", "mark must be got_it or another_take.");
  }
  return { shootId: String(shootId).toLowerCase(), root: String(root).toLowerCase(), mark: /** @type {"got_it"|"another_take"} */ (mark) };
}

/* ── reads ───────────────────────────────────────────────────────────────── */

/* The script columns scriptView() reads, plus the offer the file name needs
   (the script's own, else its funnel's) and the idea kind ("opening" = first
   line only). Visibility is the Scripts tab's rule (VISIBLE_SQL). */
const SCRIPT_SQL = `
  SELECT s.*, b.week_key AS batch_week_key,
         COALESCE(s.offer_key, f.offer_key) AS plan_offer_key,
         i.kind AS idea_kind
    FROM ad_scripts s
    LEFT JOIN marketing_batches b ON b.id = s.batch_id
    LEFT JOIN marketing_funnels f ON f.org_id = s.org_id AND f.key = s.funnel_key
    LEFT JOIN ad_ideas i ON i.id = s.idea_id AND i.org_id = s.org_id`;

/* Ready to film: the live version is locked, or filmed and needs a retake. */
const READY_SQL = `(s.status = 'locked' OR (s.status = 'filmed' AND s.needs_retake))`;

const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const day = (v) => {
  if (v == null) return null;
  if (typeof v === "string") return v.slice(0, 10);
  // A DATE comes back as a local-midnight Date from node-pg; read it as the
  // calendar day it names, never shifted through UTC.
  const d = v instanceof Date ? v : new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The Script object S plus the fields the plan reads. */
function withPlan(row, opts) {
  const s = scriptView(row);
  return { ...s, ...planFields({ ...s, offer_key: row.plan_offer_key ?? s.offer_key, idea_kind: row.idea_kind ?? null }, opts) };
}

/** The open shoot (any status but done), newest first, or null. */
export async function readOpenShoot(tx, { orgId, forUpdate = false }) {
  const r = await tx.query(
    `SELECT * FROM marketing_shoots WHERE org_id = $1 AND status <> 'done'
      ORDER BY created_at DESC, id LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [orgId]
  );
  return r.rows[0] || null;
}

/** Live, visible versions of these roots (any status), keyed by root id. */
async function liveScripts(tx, { orgId, roots }) {
  if (!roots.length) return new Map();
  const r = await tx.query(
    `${SCRIPT_SQL}
      WHERE s.org_id = $1 AND s.root_script_id = ANY($2::uuid[]) AND s.archived_at IS NULL AND ${VISIBLE_SQL}`,
    [orgId, roots]
  );
  return new Map(r.rows.map((row) => [String(row.root_script_id), row]));
}

/** Every script ready to film, live versions only. */
async function readyScripts(tx, { orgId }) {
  return (await tx.query(
    `${SCRIPT_SQL}
      WHERE s.org_id = $1 AND s.archived_at IS NULL AND ${VISIBLE_SQL} AND ${READY_SQL}
        AND s.ad_id IS NOT NULL`,
    [orgId]
  )).rows;
}

/**
 * The highest take number filed per ad, counting only clips that came in
 * before `before` (the shoot's start) when given. {ad_id: n}.
 */
async function priorTakes(tx, { orgId, adIds, before }) {
  if (!adIds.length) return new Map();
  const r = await tx.query(
    `SELECT ad_id, max(take_no)::int AS n FROM ad_videos
      WHERE org_id = $1 AND ad_id = ANY($2::text[]) AND take_no IS NOT NULL
        AND ($3::timestamptz IS NULL OR created_at < $3)
      GROUP BY ad_id`,
    [orgId, adIds, before ?? null]
  );
  return new Map(r.rows.map((x) => [String(x.ad_id), Number(x.n) || 0]));
}

/** The newest clip per ad that came in since the shoot started (a joined take is not the ad). */
async function boardVideos(tx, { orgId, adIds, since }) {
  if (!adIds.length) return new Map();
  const r = await tx.query(
    `SELECT DISTINCT ON (ad_id) ad_id, status, updated_at, failure_reason, take_no
       FROM ad_videos
      WHERE org_id = $1 AND ad_id = ANY($2::text[]) AND created_at >= $3
        AND status NOT IN ('scripted', 'filming')
        AND (failure_reason IS NULL OR failure_reason NOT LIKE $4)
      ORDER BY ad_id, take_no DESC NULLS LAST, created_at DESC, id`,
    [orgId, adIds, since, JOINED_PREFIX + "%"]
  );
  return new Map(r.rows.map((x) => [String(x.ad_id), x]));
}

/** Clips that landed since the shoot started and have no ad yet. */
async function unmatchedCount(tx, { orgId, since }) {
  const r = await tx.query(
    `SELECT count(*)::int AS n FROM ad_videos
      WHERE org_id = $1 AND ad_id IS NULL AND created_at >= $2
        AND status IN ('raw_landed', 'staged', 'transcribed', 'editing')`,
    [orgId, since]
  );
  return Number(r.rows[0]?.n) || 0;
}

/**
 * The shoot as the API returns it: the row, its scripts (live versions, in the
 * shoot's order, each with its plan fields), the board and the estimate.
 */
export async function shootView(tx, { orgId, row, wpm = DEFAULT_WPM }) {
  const roots = (row.root_script_ids || []).map(String);
  const marks = row.marks && typeof row.marks === "object" && !Array.isArray(row.marks) ? row.marks : {};
  const live = await liveScripts(tx, { orgId, roots });
  const adIds = [...live.values()].map((s) => s.ad_id).filter((a) => a != null).map(String);
  const prior = await priorTakes(tx, { orgId, adIds, before: row.created_at });
  const videos = await boardVideos(tx, { orgId, adIds, since: row.created_at });

  const scripts = [];
  const board = [];
  for (const root of roots) {
    const r = live.get(root);
    if (!r) continue; // a script that is no longer visible drops off the plan
    const mark = marks[root] || null;
    const p = withPlan(r, { wpm, priorTake: prior.get(String(r.ad_id)) || 0, mark });
    scripts.push(p);
    const b = boardRow({ ad_id: p.ad_id, angle: p.angle_name, mark, video: videos.get(String(r.ad_id)) || null });
    if (b) board.push(b);
  }

  return {
    id: row.id,
    shoot_date: day(row.shoot_date),
    status: row.status,
    root_script_ids: roots,
    marks,
    estimated_minutes: estimateMinutes(scripts),
    board: sortBoard(board),
    landed_unmatched: await unmatchedCount(tx, { orgId, since: row.created_at }),
    scripts,
    started_at: iso(row.started_at),
    finished_at: iso(row.finished_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at)
  };
}

/**
 * GET marketing/shoot: the open shoot (or null), the scripts ready to film
 * that are not marked Got it on it, the estimate for those, and the last few
 * closed shoots.
 */
export async function readShootPage(tx, { orgId, wpm = DEFAULT_WPM }) {
  const open = await readOpenShoot(tx, { orgId });
  const shoot = open ? await shootView(tx, { orgId, row: open, wpm }) : null;
  const marks = shoot ? shoot.marks : {};
  const rows = (await readyScripts(tx, { orgId })).filter((r) => !(marks[String(r.root_script_id)] && marks[String(r.root_script_id)].got_it === true));
  const adIds = rows.map((r) => String(r.ad_id));
  const prior = await priorTakes(tx, { orgId, adIds, before: open ? open.created_at : null });
  const candidates = rows
    .map((r) => withPlan(r, { wpm, priorTake: prior.get(String(r.ad_id)) || 0, mark: marks[String(r.root_script_id)] || null }))
    .sort(planCompare);

  const past = (await tx.query(
    `SELECT id, shoot_date, root_script_ids, marks, finished_at FROM marketing_shoots
      WHERE org_id = $1 AND status = 'done'
      ORDER BY finished_at DESC NULLS LAST, created_at DESC LIMIT ${PAST_SHOOTS}`,
    [orgId]
  )).rows.map((p) => {
    const m = p.marks && typeof p.marks === "object" ? p.marks : {};
    return {
      id: p.id,
      shoot_date: day(p.shoot_date),
      scripts: (p.root_script_ids || []).length,
      filmed: Object.values(m).filter((x) => x && x.got_it === true).length,
      finished_at: iso(p.finished_at)
    };
  });

  return {
    shoot,
    plan_candidates: candidates,
    plan_estimated_minutes: estimateMinutes(candidates),
    past_shoots: past,
    wpm
  };
}

/* ── writes ──────────────────────────────────────────────────────────────── */

const ORG_LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtextextended('marketing_shoots:' || $1, 0))`;

/**
 * Every id must be a script this company can see; new ones must be ready to
 * film. `allowed` ids (already on the shoot) skip the ready check.
 */
async function checkPlanIds(tx, { orgId, ids, allowed = new Set() }) {
  const live = await liveScripts(tx, { orgId, roots: ids });
  for (const id of ids) {
    const r = live.get(id);
    if (!r) {
      throw new InvalidError("root_script_ids", "One or more scripts on the list were not found. Reload and try again.");
    }
    if (allowed.has(id)) continue;
    const ready = r.ad_id != null && (r.status === "locked" || (r.status === "filmed" && r.needs_retake === true));
    if (!ready) {
      throw new InvalidError("root_script_ids", "Only approved scripts go on a shoot. Approve it in Scripts first.");
    }
  }
}

/** POST marketing/shoot, create. */
async function createShoot(tx, { orgId, ids, shootDate, wpm }) {
  await tx.query(ORG_LOCK_SQL, [orgId]);
  const open = await readOpenShoot(tx, { orgId, forUpdate: true });
  if (open) {
    throw new InvalidError("id", "A shoot is already planned. Change that one, or close it before you plan a new one.");
  }
  await checkPlanIds(tx, { orgId, ids });
  const row = (await tx.query(
    `INSERT INTO marketing_shoots (org_id, shoot_date, root_script_ids)
     VALUES ($1, COALESCE($2::date, (now() AT TIME ZONE 'America/Phoenix')::date), $3::uuid[])
     RETURNING *`,
    [orgId, shootDate, ids]
  )).rows[0];
  await orderScripts(tx, { orgId, order: ids });
  return { shoot: await shootView(tx, { orgId, row, wpm }) };
}

/** POST marketing/shoot, change the order, the day, or the status. */
async function updateShoot(tx, { orgId, id, ids, status, shootDate, wpm }) {
  await tx.query(ORG_LOCK_SQL, [orgId]);
  const cur = (await tx.query(
    `SELECT * FROM marketing_shoots WHERE id = $1 AND org_id = $2 FOR UPDATE`, [id, orgId]
  )).rows[0];
  if (!cur) throw new NotFoundError("That shoot was not found.");
  if (cur.status === "done") throw new InvalidError("id", "This shoot is closed. Plan a new one.");

  if (ids) {
    await checkPlanIds(tx, { orgId, ids, allowed: new Set((cur.root_script_ids || []).map(String)) });
  }
  const row = (await tx.query(
    `UPDATE marketing_shoots
        SET root_script_ids = COALESCE($3::uuid[], root_script_ids),
            shoot_date      = COALESCE($4::date, shoot_date),
            status          = COALESCE($5::text, status),
            started_at      = CASE WHEN $5::text IN ('filming', 'uploaded', 'done') THEN COALESCE(started_at, now()) ELSE started_at END,
            finished_at     = CASE WHEN $5::text = 'done' THEN now() ELSE finished_at END,
            updated_at      = now()
      WHERE id = $1 AND org_id = $2
      RETURNING *`,
    [id, orgId, ids, shootDate, status]
  )).rows[0];
  if (ids) await orderScripts(tx, { orgId, order: ids });
  return { shoot: await shootView(tx, { orgId, row, wpm }) };
}

/** POST marketing/shoot: create, reorder, or move (close = status done). */
export async function writeShoot(tx, { orgId, move, wpm = DEFAULT_WPM }) {
  if (move.kind === "create") return createShoot(tx, { orgId, ids: move.ids, shootDate: move.shootDate, wpm });
  return updateShoot(tx, { orgId, id: move.id, ids: move.ids, status: move.status, shootDate: move.shootDate, wpm });
}

/**
 * POST marketing/shoot/mark: one take rolled. Got it keeps it; Another take
 * rolls the script again. The first mark moves a planned shoot to filming.
 */
export async function markShoot(tx, { orgId, shootId, root, mark, now = new Date() }) {
  const cur = (await tx.query(
    `SELECT * FROM marketing_shoots WHERE id = $1 AND org_id = $2 FOR UPDATE`, [shootId, orgId]
  )).rows[0];
  if (!cur || !(cur.root_script_ids || []).map(String).includes(root)) {
    throw new NotFoundError("That shoot was not found, or that script is not on it.");
  }
  if (cur.status === "done") throw new InvalidError("shoot_id", "This shoot is closed. Plan a new one.");
  const marks = applyMark(cur.marks, root, mark, now.toISOString());
  await tx.query(
    `UPDATE marketing_shoots
        SET marks = $3::jsonb,
            status = CASE WHEN status = 'planned' THEN 'filming' ELSE status END,
            started_at = COALESCE(started_at, now()),
            updated_at = now()
      WHERE id = $1 AND org_id = $2`,
    [shootId, orgId, JSON.stringify(marks)]
  );
  return { marks };
}
