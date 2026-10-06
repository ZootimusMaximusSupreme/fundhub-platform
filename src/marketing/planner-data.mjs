// @ts-check
// src/marketing/planner-data.mjs — the planner's database half: read the room, save
// the plan. The planning itself is pure (src/marketing/planner.mjs planBatch).
//
// Spec docs/specs/marketing-machine-2026-10-04.md §7.5 and §7.4, §4 traps 3 and 10.
// Plan unit U23. Callers:
//   api/marketing/batches/next.mjs  GET: gatherPlanInputs → planBatch (a live preview)
//                                   POST: saveOverrides → gatherPlanInputs → planBatch
//   U35's start_batch job           gatherPlanInputs → planBatch → savePlan
//
//   gatherPlanInputs(tx, {orgId, now, onCommand?, angles?})
//                         everything planBatch reads, in the caller's staff transaction
//   savePlan(tx, {batchId, plan, rulesSha})
//                         writes the plan onto a 'planned' batch, holds the ideas it
//                         used for that batch, and uses up next_overrides on a weekly one
//   saveOverrides(tx, orgId, {overrides, updatedAt, staffId})
//                         POST marketing/batches/next's write (409 stale, 400 bad)
//
// WHO THE QUERIES RUN AS. ads, ad_scripts, campaigns and ad_metrics_daily FORCE partner
// row security (§4 trap 3): a bare query reads nothing and looks like "no spend". Every
// function here takes the `tx` the caller opened with asStaff() (staffRead for a GET,
// withRequest for a write) and never opens its own. Nothing here calls a model, GitHub,
// Meta or any network.
//
// TWO KINDS OF ad_id (§4 trap 10). ad_metrics_daily.ad_id is ads.id (a uuid);
// ad_scripts.ad_id and client_ad_attribution.ad_id are OUR ad number, as text. The
// bridge is ads.fundhub_ad_number.
//
// Every query starts with a `-- planner:<name>` line so a test can tell them apart.

import fs from "node:fs";
import path from "node:path";
import { getOrCreateSettings, listFunnels, saveSettings } from "./settings-store.mjs";
import { readAdNumbers } from "./metrics.mjs";
import { candidateRoots } from "./flywheel-status.mjs";
import { InvalidError, StaleError } from "./http.mjs";
import { isoWeek } from "../creative-intel/weekly.mjs";
import { TAXONOMY_VERSION } from "../creative-intel/taxonomy.mjs";
import { AD_ACCOUNT_TZ } from "../lib/ad-account-day.mjs";
import { addDays } from "../metro2/dates.mjs";
import { planWindows, checkOverrides, COMPETITOR_MAX_AGE_DAYS } from "./planner.mjs";

/** Where the angle list lives (bundled with every function: netlify.toml included_files). */
export const ANGLES_FILE = "marketing/ads/angles.json";
/** Most waiting ideas one plan reads, oldest first. A batch is 21 by default. */
export const IDEAS_READ_LIMIT = 500;
/** Most competitor new entrants one plan reads. */
export const COMPETITORS_READ_LIMIT = 20;

const TZ = AD_ACCOUNT_TZ; // a constant, never user input — safe in SQL text

/** A transaction from asStaff(): anything with a pg-style query().
    @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[], rowCount?: number|null }> }} Tx */

/** @param {any} tx @param {string} who @returns {asserts tx is Tx} */
function needTx(tx, who) {
  if (!tx || typeof tx.query !== "function") {
    throw new TypeError(`${who}: pass the tx from asStaff() — ads, ad_scripts, campaigns and ad_metrics_daily FORCE row-level security`);
  }
}

/** @param {unknown} orgId @param {string} who @returns {asserts orgId is string} */
function needOrg(orgId, who) {
  if (!orgId || typeof orgId !== "string") throw new TypeError(`${who}: orgId is required`);
}

/* ── the angle list ─────────────────────────────────────────────────────── */

/**
 * marketing/ads/angles.json as a list of {key, name}: the repo copy locally, the copy
 * bundled with the function on Netlify. [] when no copy can be read or it is not a list
 * (the plan then says the writer picks the angle; it never crashes).
 * @param {string[]} [roots]
 * @returns {Array<{ key: string, name: string|null }>}
 */
export function readBundledAngles(roots = candidateRoots()) {
  for (const root of roots) {
    let text;
    try { text = fs.readFileSync(path.join(root, ANGLES_FILE), "utf8"); } catch { continue; }
    try {
      const list = JSON.parse(text);
      if (!Array.isArray(list)) return [];
      return list
        .filter((a) => a && typeof a.key === "string")
        .map((a) => ({ key: a.key, name: typeof a.name === "string" ? a.name : null }));
    } catch { return []; }
  }
  return [];
}

/* ── the reads ──────────────────────────────────────────────────────────── */

/* One row per ads row that has any saved ad-day: its number, the funnel and angle its
   number's LIVE script names, the angle it inherits through v_ad_label_spine, the
   funnel its campaign is mapped to, its spend over the 7-day window, and the last day
   it spent anything (all time, for "last ran"). One live script per number per company
   (ad_scripts_live_ad_id_uq, 393). */
const AD_ROWS_SQL = `-- planner:ad_rows
SELECT a.id                 AS ad_row_id,
       a.fundhub_ad_number  AS ad_number,
       sc.funnel_key        AS script_funnel_key,
       sc.angle_key         AS script_angle_key,
       v.angle_key          AS spine_angle_key,
       f.key                AS campaign_funnel_key,
       m.spend_7d_cents,
       m.ad_days_7d,
       m.last_spend_day
  FROM ads a
  JOIN LATERAL (
         SELECT sum(d.spend_cents) FILTER (WHERE d.date BETWEEN $2::date AND $3::date)::bigint AS spend_7d_cents,
                count(*) FILTER (WHERE d.date BETWEEN $2::date AND $3::date)::int             AS ad_days_7d,
                (max(d.date) FILTER (WHERE d.spend_cents > 0 AND d.date <= $3::date))::text   AS last_spend_day
           FROM ad_metrics_daily d
          WHERE d.ad_id = a.id
       ) m ON true
  LEFT JOIN v_ad_label_spine v ON v.ad_row_id = a.id
  LEFT JOIN campaigns c ON c.id = a.campaign_id
  LEFT JOIN LATERAL (
         SELECT mf.key
           FROM marketing_funnels mf
          WHERE mf.org_id = a.org_id
            AND c.external_id IS NOT NULL
            AND c.external_id = ANY (mf.meta_campaign_ids)
          ORDER BY mf.active DESC, mf.key
          LIMIT 1
       ) f ON true
  LEFT JOIN LATERAL (
         SELECT s.funnel_key, s.angle_key
           FROM ad_scripts s
          WHERE a.fundhub_ad_number IS NOT NULL
            AND s.org_id = a.org_id
            AND s.ad_id = a.fundhub_ad_number
            AND s.archived_at IS NULL
          ORDER BY s.version DESC, s.created_at DESC
          LIMIT 1
       ) sc ON true
 WHERE a.org_id = $1
   AND (m.ad_days_7d > 0 OR m.last_spend_day IS NOT NULL)
 ORDER BY a.id`;

/* The live script of each ad number that brought leads: the funnel and angle it names. */
const SCRIPT_LABELS_SQL = `-- planner:script_labels
SELECT s.ad_id AS ad_number, s.funnel_key, s.angle_key
  FROM ad_scripts s
 WHERE s.org_id = $1
   AND s.ad_id IS NOT NULL
   AND s.archived_at IS NULL
   AND s.ad_id = ANY ($2::text[])`;

/* Angles used in the last 30 days by something other than spend: a script written then
   (never an import: imports are the old hand-made ads), or a slot in the plan of a
   batch that is not released yet (planned, writing, ready). */
const RECENT_ANGLES_SQL = `-- planner:recent_angles
SELECT angle_key, (max(at) AT TIME ZONE '${TZ}')::date::text AS last_used_on
  FROM (
        SELECT s.angle_key, s.created_at AS at
          FROM ad_scripts s
         WHERE s.org_id = $1
           AND s.angle_key IS NOT NULL
           AND s.source <> 'import'
           AND s.created_at >= ($2::date::timestamp AT TIME ZONE '${TZ}')
        UNION ALL
        SELECT slot->>'angle_key', b.created_at
          FROM marketing_batches b
          CROSS JOIN LATERAL jsonb_array_elements(
                 CASE WHEN jsonb_typeof(b.plan->'slots') = 'array' THEN b.plan->'slots' ELSE '[]'::jsonb END
               ) slot
         WHERE b.org_id = $1
           AND b.status IN ('planned', 'writing', 'ready')
           AND b.created_at >= ($2::date::timestamp AT TIME ZONE '${TZ}')
           AND slot->>'angle_key' IS NOT NULL
       ) used
 GROUP BY angle_key`;

/* Chris's waiting ideas (and planner suggestions he accepted): new, a whole script,
   not held by another batch. On command, the ideas Write now named (U26 stamps them
   with the new batch) come back too. Oldest first. */
const IDEAS_SQL = `-- planner:ideas
SELECT i.id, i.source, i.raw_points, i.topic, i.script_format, i.funnel_key, i.angle_key,
       i.created_at, i.batch_id
  FROM ad_ideas i
 WHERE i.org_id = $1
   AND i.kind = 'script'
   AND i.status = 'new'
   AND i.source IN ('chris', 'suggestion')
   AND (i.batch_id IS NULL OR i.batch_id = $2::uuid OR i.id = ANY ($3::uuid[]))
 ORDER BY i.created_at, i.id
 LIMIT ${IDEAS_READ_LIMIT}`;

/* The competitor board's new entrants (api/adintel/board.mjs, view new-entrants) from
   its latest rolled-up week, only when that week is recent. Our own accounts are never
   on it (watch_group 'own'). Each with its name and the angle most of its new ads take. */
const COMPETITORS_SQL = `-- planner:competitors
SELECT c.advertiser_id,
       c.platform,
       max(w.display_name)                          AS name,
       count(DISTINCT c.content_hash)::int          AS creatives,
       mode() WITHIN GROUP (ORDER BY k.angle)       AS angle
  FROM ad_creative_signals s
  JOIN ad_creatives_seen c
         ON c.org_id = s.org_id AND c.content_hash = s.content_hash
  LEFT JOIN ad_watch_advertisers w
         ON w.org_id = c.org_id AND w.platform = c.platform
        AND w.external_advertiser_id = c.advertiser_id
  LEFT JOIN ad_creative_classification k
         ON k.org_id = c.org_id AND k.content_hash = c.content_hash
        AND k.taxonomy_version = $3
 WHERE s.org_id = $1
   AND s.iso_week = (SELECT max(iso_week) FROM ad_creative_signals WHERE org_id = $1)
   AND s.iso_week >= $2
   AND s.new_entrant IS TRUE
   AND coalesce(w.watch_group, 'direct') <> 'own'
 GROUP BY c.advertiser_id, c.platform
 ORDER BY creatives DESC, c.advertiser_id
 LIMIT ${COMPETITORS_READ_LIMIT}`;

/** The next weekly batch, once its plan is saved. */
const SAVED_SQL = `-- planner:saved
SELECT id, status
  FROM marketing_batches
 WHERE org_id = $1
   AND kind = 'weekly'
   AND week_key = $2
   AND plan IS NOT NULL
 ORDER BY created_at DESC
 LIMIT 1`;

/** @param {unknown} v */
const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/**
 * @typedef {{ count?: number|null, funnel_key?: string|null, idea_ids?: string[]|null,
 *             batch_id?: string|null }} OnCommandIn
 */

/**
 * gatherPlanInputs(tx, {orgId, now, onCommand?, angles?}) → the input planBatch takes,
 * plus `settings` (the whole settings row) for the caller.
 *
 * onCommand (Write now, U35): {count, funnel_key, idea_ids, batch_id}. On command the
 * one-time overrides are not read (they belong to the next weekly batch).
 * angles: a list to use instead of the bundled angles.json (U35 may read it at the
 * batch's rules_sha).
 *
 * @param {any} tx
 * @param {{ orgId: string, now?: Date|string, onCommand?: OnCommandIn|null,
 *           angles?: Array<{ key: string, name?: string|null }>|null }} opts
 */
export async function gatherPlanInputs(tx, { orgId, now = new Date(), onCommand = null, angles = null }) {
  needTx(tx, "gatherPlanInputs");
  needOrg(orgId, "gatherPlanInputs");
  const at = now instanceof Date ? now : new Date(now);
  const { today, spendFrom, freshFrom } = planWindows(at);

  const settings = await getOrCreateSettings(tx, orgId);
  const funnels = await listFunnels(tx, orgId);

  const adRows = (await tx.query(AD_ROWS_SQL, [orgId, spendFrom, today])).rows;

  const leads = (await readAdNumbers(tx, { orgId, from: spendFrom, to: today, now: at }))
    .filter((r) => Number(r.leads) > 0)
    .map((r) => ({ ad_number: String(r.ad_number), leads: Number(r.leads) }));
  const scriptLabels = leads.length
    ? (await tx.query(SCRIPT_LABELS_SQL, [orgId, leads.map((l) => l.ad_number)])).rows
    : [];

  const recent = (await tx.query(RECENT_ANGLES_SQL, [orgId, freshFrom])).rows;

  const ideaIds = onCommand && Array.isArray(onCommand.idea_ids) ? onCommand.idea_ids.map(String) : [];
  const ideas = (await tx.query(IDEAS_SQL, [orgId, (onCommand && onCommand.batch_id) || null, ideaIds])).rows;

  const oldestWeek = isoWeek(new Date(`${addDays(today, -COMPETITOR_MAX_AGE_DAYS)}T00:00:00.000Z`));
  const competitors = (await tx.query(COMPETITORS_SQL, [orgId, oldestWeek, TAXONOMY_VERSION])).rows;

  return {
    now: at,
    settings,
    funnels: funnels.map((f) => ({
      key: f.key,
      name: f.name,
      active: f.active,
      weight: f.weight == null ? null : Number(f.weight),
      format_mix: f.format_mix,
      book_call: f.book_call
    })),
    ad_rows: adRows.map((r) => ({
      ad_row_id: String(r.ad_row_id),
      ad_number: r.ad_number ?? null,
      script_funnel_key: r.script_funnel_key ?? null,
      script_angle_key: r.script_angle_key ?? null,
      spine_angle_key: r.spine_angle_key ?? null,
      campaign_funnel_key: r.campaign_funnel_key ?? null,
      spend_7d_cents: r.spend_7d_cents == null ? null : Number(r.spend_7d_cents),
      ad_days_7d: Number(r.ad_days_7d) || 0,
      last_spend_day: r.last_spend_day ?? null
    })),
    lead_rows: leads,
    script_labels: scriptLabels.map((r) => ({
      ad_number: String(r.ad_number), funnel_key: r.funnel_key ?? null, angle_key: r.angle_key ?? null
    })),
    recent_angles: recent.map((r) => ({ angle_key: r.angle_key, last_used_on: r.last_used_on })),
    angles: Array.isArray(angles) ? angles : readBundledAngles(),
    ideas: ideas.map((i) => ({
      id: String(i.id),
      source: i.source,
      raw_points: i.raw_points ?? null,
      topic: i.topic ?? null,
      script_format: i.script_format ?? null,
      funnel_key: i.funnel_key ?? null,
      angle_key: i.angle_key ?? null,
      created_at: iso(i.created_at)
    })),
    competitors: competitors.map((c) => ({
      advertiser_id: String(c.advertiser_id),
      platform: c.platform ?? null,
      name: c.name ?? null,
      creatives: Number(c.creatives) || 0,
      angle: c.angle ?? null
    })),
    overrides: onCommand ? null : (settings ? settings.next_overrides ?? null : null),
    on_command: onCommand
      ? { count: onCommand.count ?? null, funnel_key: onCommand.funnel_key ?? null, idea_ids: ideaIds }
      : null
  };
}

/**
 * The next weekly batch, once its plan is saved (3 hours before release): {batch_id,
 * status}, else null.
 * @param {any} tx @param {{ orgId: string, weekKey: string }} opts
 */
export async function readSavedNext(tx, { orgId, weekKey }) {
  needTx(tx, "readSavedNext");
  const r = await tx.query(SAVED_SQL, [orgId, weekKey]);
  const row = r.rows[0];
  return row ? { batch_id: String(row.id), status: row.status } : null;
}

/* ── the writes ─────────────────────────────────────────────────────────── */

/**
 * savePlan(tx, {batchId, plan, rulesSha}) — writes the plan onto a batch that is still
 * 'planned', inside the caller's transaction (U35's start_batch job).
 *   * marketing_batches: plan, rules_sha, total = the plan's slot count.
 *   * ad_ideas: every idea a slot uses is held for this batch (batch_id), so the next
 *     plan does not pick it again; ideas Write now already holds for it stay as they are.
 *   * marketing_settings.next_overrides: a weekly plan that used them clears them (they
 *     are one-time), but only when they are still exactly what the plan used, so a
 *     change Chris saved a moment later is never wiped.
 * Returns {batch_id, kind, status, ideas_held, overrides_cleared}, or null when the
 * batch is not this company's 'planned' batch (already writing, released or gone).
 *
 * @param {any} tx
 * @param {{ batchId: string, plan: any, rulesSha?: string|null }} opts
 */
export async function savePlan(tx, { batchId, plan, rulesSha = null }) {
  needTx(tx, "savePlan");
  if (!batchId || typeof batchId !== "string") throw new TypeError("savePlan: batchId is required");
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.slots)) {
    throw new TypeError("savePlan: plan must be planBatch's answer (it has slots)");
  }
  const upd = await tx.query(
    `-- planner:save_plan
     UPDATE marketing_batches
        SET plan = $2::jsonb,
            rules_sha = $3,
            total = $4,
            updated_at = now()
      WHERE id = $1 AND status = 'planned'
      RETURNING id, org_id, kind, status`,
    [batchId, JSON.stringify(plan), rulesSha, plan.slots.length]
  );
  const batch = upd.rows[0];
  if (!batch) return null;

  const ideaIds = [...new Set(plan.slots.map((/** @type {any} */ s) => s && s.idea_id).filter(Boolean).map(String))];
  let held = 0;
  if (ideaIds.length) {
    const r = await tx.query(
      `-- planner:hold_ideas
       UPDATE ad_ideas
          SET batch_id = $3, updated_at = now()
        WHERE org_id = $1 AND id = ANY ($2::uuid[]) AND batch_id IS NULL`,
      [batch.org_id, ideaIds, batch.id]
    );
    held = r.rowCount ?? 0;
  }

  let cleared = false;
  if (batch.kind === "weekly" && plan.overrides && typeof plan.overrides === "object") {
    const r = await tx.query(
      `-- planner:use_overrides
       UPDATE marketing_settings
          SET next_overrides = NULL,
              updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
        WHERE org_id = $1 AND next_overrides = $2::jsonb`,
      [batch.org_id, JSON.stringify(plan.overrides)]
    );
    cleared = (r.rowCount ?? 0) > 0;
  }
  return { batch_id: String(batch.id), kind: batch.kind, status: batch.status, ideas_held: held, overrides_cleared: cleared };
}

/**
 * The overrides in a POST body, checked (planner.mjs checkOverrides). InvalidError → 400
 * with the field. {} → null (clears them).
 * @param {unknown} overrides
 */
export function validateOverrides(overrides) {
  const c = /** @type {any} */ (checkOverrides(overrides));
  if (!c.ok) throw new InvalidError(c.field, c.message);
  return /** @type {import("./planner.mjs").Overrides|null} */ (c.value);
}

/**
 * saveOverrides(tx, orgId, {overrides, updatedAt, staffId}) — POST marketing/batches/
 * next's write, inside withRequest's transaction. Every funnel in funnel_slots must be
 * an active funnel of the company (400 otherwise). updated_at is marketing_settings'
 * (the overrides live on that row): an older one → 409 with current {updated_at,
 * overrides}. Returns the saved settings row.
 * @param {any} tx @param {string} orgId
 * @param {{ overrides: unknown, updatedAt: unknown, staffId?: string|null }} opts
 */
export async function saveOverrides(tx, orgId, { overrides, updatedAt, staffId = null }) {
  needTx(tx, "saveOverrides");
  const value = validateOverrides(overrides);
  if (value && value.funnel_slots) {
    const funnels = await listFunnels(tx, orgId);
    const byKey = new Map(funnels.map((f) => [f.key, f]));
    for (const key of Object.keys(value.funnel_slots)) {
      const f = byKey.get(key);
      if (!f) throw new InvalidError(`overrides.funnel_slots.${key}`, `There is no funnel named ${key}. Add it in Settings first.`);
      if (f.active === false) throw new InvalidError(`overrides.funnel_slots.${key}`, `The ${key} funnel is turned off. Turn it on in Settings first.`);
    }
  }
  try {
    return await saveSettings(tx, orgId, /** @type {any} */ ({
      patch: { next_overrides: value },
      updatedAt,
      staffId
    }));
  } catch (err) {
    if (err instanceof StaleError) {
      const cur = /** @type {any} */ (err.current) || {};
      throw new StaleError({ updated_at: cur.updated_at ?? null, overrides: cur.next_overrides ?? null },
        "Someone changed the next batch after you opened it. Here is what is saved now. Look it over and save again.");
    }
    throw err;
  }
}
