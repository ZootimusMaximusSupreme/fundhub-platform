// @ts-check
// src/marketing/voice-export.mjs — once a week, the lines Chris rewrote go into VOICE.md.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §7.2 second bullet: every edit Chris
// makes to a machine line saves a voice_pairs row (src/marketing/scripts-store.mjs
// editScript); "a weekly worker job adds the new pairs to VOICE.md through an outbox
// edit". Plan unit U35. Table voice_pairs (migration 414); the edit op is
// voice_append_pairs (src/repo/edit-ops.mjs), applied by the outbox drain to the newest
// copy of marketing/ads/VOICE.md, so a retry never adds a pair twice and never
// overwrites someone else's change.
//
// THE JOB: voice_export {week_key} (src/marketing/job-kinds.mjs, group 'system'). The
// clock queues one per week, 5 hours before the weekly release (src/marketing/schedule.mjs).
//
// ONCE PER PAIR. In ONE staff transaction: lock the unexported pairs (exported_at IS NULL,
// FOR UPDATE SKIP LOCKED, oldest first), queue the outbox edits (at most 50 pairs each, the
// op's own limit), stamp exported_at on exactly those pairs. Either all of that commits or
// none of it does, and a second run finds nothing left to export.
//
// The staff transaction is there for the script's lane (ad_scripts forces partner row
// security); voice_pairs and repo_outbox have app-wide policies. No network call here:
// the commit happens later, in the worker's outbox drain.

import { enqueueRepoWrite } from "../repo/outbox.mjs";
import { VOICE_PATH } from "../repo/edit-ops.mjs";
import { inStaff } from "./batch-run.mjs";

/** voice_append_pairs takes at most this many pairs in one edit (edit-ops.mjs MAX_PAIRS). */
export const PAIRS_PER_EDIT = 50;

/** One run exports at most this many pairs; the rest wait for next week's run. */
export const PAIRS_PER_RUN = 500;

/** Each line in a pair block is at most this long (edit-ops.mjs MAX_PAIR_FIELD). */
export const MAX_PAIR_TEXT = 2000;

/** One line, at most `max` characters. @param {unknown} v @param {number} max */
function clip(v, max) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * One voice_pairs row as the pair the edit op writes. Pure.
 * kind: the part of the script ('hook', 'cue' …), 'line' when not known.
 * lane: the script's lane, null when not known (the block says "unknown").
 * @param {any} row
 */
export function pairForFile(row) {
  return {
    kind: clip(row.kind || "line", 40) || "line",
    lane: row.lane ? clip(row.lane, 40) : null,
    before: clip(row.before, MAX_PAIR_TEXT),
    after: clip(row.after, MAX_PAIR_TEXT),
    why: null,
    script_id: row.script_id ? String(row.script_id) : "none",
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  };
}

/**
 * exportVoicePairs(db, {orgId, weekKey}, deps) → {exported, edits, op_ids}
 * @param {any} db @param {{ orgId: string, weekKey?: string|null }} args @param {any} [deps]
 */
export async function exportVoicePairs(db, { orgId, weekKey = null }, deps = {}) {
  if (!orgId) throw new TypeError("exportVoicePairs: orgId is required");
  return inStaff(db, deps, async (tx) => {
    const rows = (await tx.query(
      `SELECT p.id, p.script_id, p."before", p."after", p.kind, p.created_at, s.lane::text AS lane
         FROM voice_pairs p
         LEFT JOIN ad_scripts s ON s.id = p.script_id
        WHERE p.org_id = $1 AND p.exported_at IS NULL
        ORDER BY p.created_at, p.id
        LIMIT ${PAIRS_PER_RUN}
          FOR UPDATE OF p SKIP LOCKED`,
      [orgId]
    )).rows;
    /* A pair that is only blanks after tidying cannot be written (the op refuses an
       empty line); it is stamped with the rest so it is not picked up every week. */
    const usable = rows.filter((r) => clip(r.before, 1) && clip(r.after, 1));
    if (!rows.length) return { exported: 0, edits: 0, op_ids: [], week_key: weekKey };

    const opIds = [];
    for (let i = 0; i < usable.length; i += PAIRS_PER_EDIT) {
      const chunk = usable.slice(i, i + PAIRS_PER_EDIT);
      const opId = `u35:voice:${chunk[0].id}`;
      await enqueueRepoWrite(tx, {
        orgId, opId, path: VOICE_PATH, mode: "edit",
        edit: { op: "voice_append_pairs", pairs: chunk.map(pairForFile) }
      });
      opIds.push(opId);
    }
    const stamped = await tx.query(
      `UPDATE voice_pairs SET exported_at = now()
        WHERE org_id = $1 AND id = ANY($2::uuid[]) AND exported_at IS NULL`,
      [orgId, rows.map((r) => r.id)]
    );
    return { exported: usable.length, stamped: stamped.rowCount ?? 0, edits: opIds.length, op_ids: opIds, week_key: weekKey };
  });
}

/** voice_export's handler. @param {any} job @param {{ db?: any, env?: any, deps?: any }} [ctx] */
export async function run(job, ctx = {}) {
  const p = (job && job.payload) || {};
  return exportVoicePairs(ctx.db, { orgId: job.org_id, weekKey: typeof p.week_key === "string" ? p.week_key : null }, ctx.deps || {});
}
