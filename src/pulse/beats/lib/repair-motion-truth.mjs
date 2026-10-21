// pipeline:repair — are repair files moving, or sitting in a stage that needs a person?
// Audit only. SELECT only. Never fixes, never sends.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). This is the repair half of src/pulse/pipeline-motion.mjs. It moved
// here, unchanged except for the read path, so the morning pulse (pipeline-motion.mjs imports it back) and
// the hourly beat (beat-repair-trip.mjs) count the same stuck stages with the same SQL and say the same
// words. The client and outbound halves stay in pipeline-motion.mjs (they read workflow code a beat may
// not import). Pure: no imports, no I/O of its own; the caller hands in the reader.

export const REPAIR_STUCK_STAGES = Object.freeze(["stalled", "letters_generated", "ready_to_send", "response_received"]);

/** $1 org, $2 REPAIR_STUCK_STAGES. One count. */
export const REPAIR_STUCK_SQL = `SELECT count(*)::int AS n
         FROM cards c
         JOIN pipeline_stages ps ON ps.id = c.stage_id
         JOIN pipelines p ON p.id = c.pipeline_id AND p.key = 'optimization'
        WHERE c.org_id = $1::uuid
          AND ps.key = ANY($2::text[])`;

function row(id, status, detail, suggestedFix = null, customerSees = null, na = null) {
  return { id, status, detail, suggestedFix, customerSees, ...(na ? { na } : {}) };
}

/** Pure. The pipeline:repair row for a count of repair files in a stuck need-me stage. */
export function judgeRepairMotion(repairStuck) {
  const n = Number(repairStuck || 0);
  if (n > 0) {
    return row(
      "pipeline:repair",
      "FAIL",
      `${n} repair file${n === 1 ? "" : "s"} need staff (stuck stage or letters waiting).`,
      "Open Repair desk and work the stuck queue. Do not auto-fix from this pulse.",
      "A repair client may be waiting on letters or a bureau answer with no one moving their file."
    );
  }
  return row("pipeline:repair", "PASS", "no repair files in a stuck need-me stage");
}

/**
 * The hourly read: the same count through io.read, then the same verdict. A read that fails is a skip
 * with the reason, never a PASS.
 * @param {{ read: Function, orgId: string }} io
 */
export async function readRepairMotion(io) {
  try {
    const out = await io.read(REPAIR_STUCK_SQL, [io.orgId, REPAIR_STUCK_STAGES]);
    const first = out && Array.isArray(out.rows) ? out.rows[0] : null;
    // A count always comes back as one row. No row, or no number in it, is unread, never a green zero.
    const n = first ? Number(first.n) : NaN;
    if (!Number.isFinite(n)) return row("pipeline:repair", "skip", "the stuck repair count came back empty, so it was not judged");
    return judgeRepairMotion(n);
  } catch (err) {
    const why = String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, 180);
    return row("pipeline:repair", "skip", `could not count the stuck repair files: ${why}`);
  }
}
