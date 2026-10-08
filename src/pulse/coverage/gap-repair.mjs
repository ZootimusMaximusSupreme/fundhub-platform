// Credit repair breakage for the morning pulse. Read only.
// Workflow registry coverage stays in slice-15-repair.mjs. This file does not repeat it.
// Recon (AG-07) is the only tripwire. Do not add a second watchdog.
// Do not send bureau mail. Do not pull credit. Do not rewrite a dispute letter.

const FENCE =
  "Recon (AG-07) is the only tripwire. Do not add a second watchdog. " +
  "Do not send bureau mail. Do not pull credit. " +
  "Do not rewrite a dispute letter that contradicts itself. " +
  "Do not auto-fix from this check.";

const STUCK_FIX = `A repair case is stuck. A person can look on the Repair desk. ${FENCE}`;
const LETTER_FIX =
  `A letter round should have been written and was not. A person can look on the Repair desk. Do not mail it. ${FENCE}`;

const STUCK_SQL = `
SELECT dc.id::text AS id
  FROM dispute_cases dc
 WHERE dc.org_id = $1::uuid
   AND dc.status = 'stalled'
UNION ALL
SELECT c.id::text AS id
  FROM cards c
  JOIN pipeline_stages ps ON ps.id = c.stage_id
  JOIN pipelines p ON p.id = c.pipeline_id AND p.key = 'optimization'
 WHERE c.org_id = $1::uuid
   AND ps.key = 'stalled'
`;

// Any letter row counts as written. This check does not read letter words.
const MISSING_SQL = `
SELECT dc.id::text AS id, dc.round AS round
  FROM dispute_cases dc
 WHERE dc.org_id = $1::uuid
   AND dc.status = 'open'
   AND EXISTS (
     SELECT 1
       FROM dispute_items di
      WHERE di.case_id = dc.id
        AND di.org_id = dc.org_id
   )
   AND NOT EXISTS (
     SELECT 1
       FROM dispute_letters dl
      WHERE dl.case_id = dc.id
        AND dl.org_id = dc.org_id
   )
UNION ALL
SELECT c.id::text AS id, NULL::text AS round
  FROM cards c
  JOIN pipeline_stages ps ON ps.id = c.stage_id
  JOIN pipelines p ON p.id = c.pipeline_id AND p.key = 'optimization'
 WHERE c.org_id = $1::uuid
   AND ps.key IN ('letters_generated', 'ready_to_send')
   AND NOT EXISTS (
     SELECT 1
       FROM dispute_letters dl
      WHERE dl.org_id = c.org_id
        AND dl.client_id = c.client_id
   )
`;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function assertSelect(sql) {
  const bare = String(sql).replace(/--[^\n]*/g, "").trim();
  if (!/^select\b/i.test(bare)) {
    throw new Error("repair gap check is read-only");
  }
}

function clip(err) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, 160);
}

function ids(rows) {
  return (rows || []).map((row) => row && row.id).filter(Boolean);
}

function stuckDetail(rows) {
  const n = rows.length;
  const noun = n === 1 ? "repair case is" : "repair cases are";
  const shown = ids(rows).slice(0, 5);
  const more = n > shown.length ? ` and ${n - shown.length} more` : "";
  const tail = shown.length ? ` Look at ${shown.join(", ")}${more}.` : "";
  return `${n} ${noun} stuck.${tail}`;
}

function letterDetail(rows) {
  const n = rows.length;
  const noun = n === 1 ? "letter round" : "letter rounds";
  const verb = n === 1 ? "was" : "were";
  const shown = (rows || []).slice(0, 5).map((row) => {
    const round = row && row.round ? ` ${row.round}` : "";
    return `${row.id}${round}`;
  }).filter((bit) => bit && !bit.startsWith("undefined"));
  const more = n > 5 ? ` and ${n - 5} more` : "";
  const tail = shown.length ? `: ${shown.join(", ")}${more}` : "";
  return `${n} ${noun} should have been written and ${verb} not${tail}.`;
}

async function readRows(db, sql, params) {
  assertSelect(sql);
  const result = await db.query(sql, params);
  return Array.isArray(result && result.rows) ? result.rows : [];
}

async function stuckCheck(db, orgId) {
  try {
    const rows = await readRows(db, STUCK_SQL, [orgId]);
    if (rows.length === 0) {
      return check("repair-case-stuck", "PASS", "no stuck repair cases", null);
    }
    return check("repair-case-stuck", "FAIL", stuckDetail(rows), STUCK_FIX);
  } catch (err) {
    return check("repair-case-stuck", "FAIL", `could not read repair rows: ${clip(err)}`, STUCK_FIX);
  }
}

async function letterCheck(db, orgId) {
  try {
    const rows = await readRows(db, MISSING_SQL, [orgId]);
    if (rows.length === 0) {
      return check("repair-letter-round", "PASS", "no letter round is waiting to be written", null);
    }
    return check("repair-letter-round", "FAIL", letterDetail(rows), LETTER_FIX);
  } catch (err) {
    return check("repair-letter-round", "FAIL", `could not read repair rows: ${clip(err)}`, LETTER_FIX);
  }
}

/**
 * Live credit-repair breakage. Two checks. SELECT only.
 * @param {{ db?: { query: Function }, orgId?: string }} [ctx]
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx) {
  const src = ctx && typeof ctx === "object" ? ctx : {};
  const db = src.db;
  const orgId = src.orgId;
  if (!db || typeof db.query !== "function" || !orgId) {
    return [
      check("repair-case-stuck", "skip", "no database — stuck repair cases not read", null),
      check("repair-letter-round", "skip", "no database — letter rounds not read", null)
    ];
  }
  return Promise.all([stuckCheck(db, orgId), letterCheck(db, orgId)]);
}
