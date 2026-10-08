// Credit repair breakage for the morning pulse. Read only.
// Workflow registry coverage stays in slice-15-repair.mjs. This file does not repeat it.
// Recon (AG-07) is the only tripwire. Do not add a second watchdog.
// Do not send bureau mail. Do not pull credit. Do not rewrite a dispute letter.
//
// Claude review 2026-10-08: the old file only fired on a card sitting in the
// literal "stalled" stage. Nothing moves a card there when its clock runs out;
// the desk shows its Stuck chip from the clock (src/repair/sla.mjs). A real paid
// file sat in "analysis" for 3 days with no case and no letters and this file
// said PASS. It now reads the same clocks the desk reads.
//
// Where the lines are drawn, so one stuck file is not reported twice:
//  - src/pulse/pipeline-motion.mjs ("pipeline:repair") already reds any card in
//    stalled, letters_generated, ready_to_send or response_received. This file
//    leaves those stages' clocks to it.
//  - repair-case-stuck reads files waiting on a person, a client or a bureau
//    (intake, awaiting_documents, in_transit, awaiting_response) and cases the
//    system itself marked stalled.
//  - repair-letter-round reads the letter engine: a file still in analysis past
//    its hour, an open case with items and no letter, or a card that says
//    letters were made and no letter exists.
//  - fulfillment:next-action (gap-fulfillment.mjs) reads the same late files for
//    the step the screen shows. It is a different symptom, not a copy.

import { STAGE_SLA, isBreached } from "../../repair/sla.mjs";

const FENCE =
  "Recon (AG-07) is the only tripwire. Do not add a second watchdog. " +
  "Do not send bureau mail. Do not pull credit. " +
  "Do not rewrite a dispute letter that contradicts itself. " +
  "Do not auto-fix from this check.";

const STUCK_FIX = `A repair case is stuck. A person can look on the Repair desk. ${FENCE}`;
const LETTER_FIX =
  `A letter round should have been written and was not. A person can look on the Repair desk. Do not mail it. ${FENCE}`;

export const CHECK_IDS = Object.freeze(["repair-case-stuck", "repair-letter-round"]);

/** Stages pipeline:repair (src/pulse/pipeline-motion.mjs) already reds. A test keeps this equal to it. */
export const PIPELINE_MOTION_STAGES = Object.freeze([
  "stalled",
  "letters_generated",
  "ready_to_send",
  "response_received"
]);

/** Where the letter engine runs. Its clock is STAGE_SLA.analysis (1 hour). */
export const ENGINE_STAGE = "analysis";

/** Stages with a clock that wait on a person, a client or a bureau. */
export const WAITING_STAGES = Object.freeze(
  Object.keys(STAGE_SLA).filter(
    (stage) => stage !== ENGINE_STAGE && !PIPELINE_MOTION_STAGES.includes(stage)
  )
);

/** A case gets this long to grow its first letter, the same as the card clock. */
export const LETTER_GRACE_MS = STAGE_SLA.letters_generated.minutes * 60 * 1000;

// Demo clients do not count. dispute_cases has no is_demo column of its own.
export const STALLED_CASES_SQL = `
SELECT dc.id::text AS id
  FROM dispute_cases dc
  JOIN clients cl ON cl.id = dc.client_id AND cl.org_id = dc.org_id
 WHERE dc.org_id = $1::uuid
   AND dc.status = 'stalled'
   AND COALESCE(cl.is_demo, false) = false
 ORDER BY dc.created_at ASC
 LIMIT 200
`;

// Same "when is the bureau answer due" rule the desk uses
// (src/repair/read-repair-signals.mjs DUE_SQL), so this agrees with its Stuck chip.
export const CLOCK_CARDS_SQL = `
SELECT c.id::text AS id,
       c.client_id::text AS client_id,
       ps.key AS stage_key,
       c.entered_at,
       c.updated_at,
       (
         SELECT MIN(dc.response_due_at)
           FROM dispute_cases dc
          WHERE dc.org_id = c.org_id
            AND dc.client_id = c.client_id
            AND dc.status NOT IN ('closed', 'cancelled')
            AND dc.response_due_at IS NOT NULL
       ) AS response_due_at
  FROM cards c
  JOIN pipeline_stages ps ON ps.id = c.stage_id
  JOIN pipelines p
    ON p.id = c.pipeline_id
   AND p.org_id = c.org_id
   AND p.key = 'optimization'
  JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
 WHERE c.org_id = $1::uuid
   AND COALESCE(c.is_demo, false) = false
   AND COALESCE(cl.is_demo, false) = false
   AND ps.key = ANY($2::text[])
 ORDER BY COALESCE(c.entered_at, c.updated_at) ASC
 LIMIT 200
`;

// Any letter row counts as written. This check does not read letter words.
export const OPEN_CASE_NO_LETTER_SQL = `
SELECT dc.id::text AS id, dc.round AS round
  FROM dispute_cases dc
  JOIN clients cl ON cl.id = dc.client_id AND cl.org_id = dc.org_id
 WHERE dc.org_id = $1::uuid
   AND dc.status = 'open'
   AND dc.created_at < $2::timestamptz
   AND COALESCE(cl.is_demo, false) = false
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
 ORDER BY dc.created_at ASC
 LIMIT 200
`;

export const CARD_NO_LETTER_SQL = `
SELECT c.id::text AS id, ps.key AS stage_key
  FROM cards c
  JOIN pipeline_stages ps ON ps.id = c.stage_id
  JOIN pipelines p
    ON p.id = c.pipeline_id
   AND p.org_id = c.org_id
   AND p.key = 'optimization'
  JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
 WHERE c.org_id = $1::uuid
   AND COALESCE(c.is_demo, false) = false
   AND COALESCE(cl.is_demo, false) = false
   AND ps.key IN ('letters_generated', 'ready_to_send')
   AND NOT EXISTS (
     SELECT 1
       FROM dispute_letters dl
      WHERE dl.org_id = c.org_id
        AND dl.client_id = c.client_id
   )
 ORDER BY COALESCE(c.entered_at, c.updated_at) ASC
 LIMIT 200
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

async function readRows(db, sql, params) {
  assertSelect(sql);
  const result = await db.query(sql, params);
  return Array.isArray(result && result.rows) ? result.rows : [];
}

/** Cards past the clock the code defines (src/repair/sla.mjs isBreached). */
export function breachedCards(rows, now = new Date()) {
  return (rows || []).filter((row) => row && isBreached({
    stageKey: row.stage_key,
    enteredAt: row.entered_at || row.updated_at || null,
    asOf: now,
    responseDueAt: row.response_due_at
  }).breached === true);
}

function cardLabel(row) {
  return `${row.client_id || row.id} (${row.stage_key})`;
}

function stuckDetail(cases, cards) {
  const parts = [];
  if (cases.length > 0) {
    parts.push(`${cases.length} repair ${cases.length === 1 ? "case is" : "cases are"} marked stalled`);
  }
  if (cards.length > 0) {
    parts.push(
      `${cards.length} repair ${cards.length === 1 ? "file is" : "files are"} past ${cards.length === 1 ? "its" : "their"} clock`
    );
  }
  const labels = [
    ...cases.map((row) => `case ${row.id}`),
    ...cards.map(cardLabel)
  ];
  const shown = labels.slice(0, 5);
  const more = labels.length > shown.length ? ` and ${labels.length - shown.length} more` : "";
  return `${parts.join("; ")}.${shown.length ? ` Look at ${shown.join(", ")}${more}.` : ""}`;
}

function letterDetail(cases, cards, engine) {
  const parts = [];
  if (engine.length > 0) {
    parts.push(
      `${engine.length} repair ${engine.length === 1 ? "file has" : "files have"} sat in analysis past the ${STAGE_SLA.analysis.hours} hour clock with no letters made`
    );
  }
  if (cases.length > 0) {
    parts.push(
      `${cases.length} open ${cases.length === 1 ? "case has" : "cases have"} dispute items and no letter`
    );
  }
  if (cards.length > 0) {
    parts.push(
      `${cards.length} ${cards.length === 1 ? "card says" : "cards say"} letters were made and none exist`
    );
  }
  const labels = [
    ...engine.map(cardLabel),
    ...cases.map((row) => `case ${row.id}${row.round ? ` ${row.round}` : ""}`),
    ...cards.map(cardLabel)
  ];
  const shown = labels.slice(0, 5);
  const more = labels.length > shown.length ? ` and ${labels.length - shown.length} more` : "";
  return `${parts.join("; ")}.${shown.length ? ` Look at ${shown.join(", ")}${more}.` : ""}`;
}

async function stuckCheck(db, orgId, now) {
  try {
    const cases = await readRows(db, STALLED_CASES_SQL, [orgId]);
    const waiting = await readRows(db, CLOCK_CARDS_SQL, [orgId, [...WAITING_STAGES]]);
    const cards = breachedCards(waiting, now);
    if (cases.length === 0 && cards.length === 0) {
      return check("repair-case-stuck", "PASS", "no stuck repair cases", null);
    }
    return check("repair-case-stuck", "FAIL", stuckDetail(cases, cards), STUCK_FIX);
  } catch (err) {
    return check("repair-case-stuck", "FAIL", `could not read repair rows: ${clip(err)}`, STUCK_FIX);
  }
}

async function letterCheck(db, orgId, now) {
  try {
    const grace = new Date(now.getTime() - LETTER_GRACE_MS);
    const inAnalysis = await readRows(db, CLOCK_CARDS_SQL, [orgId, [ENGINE_STAGE]]);
    const engine = breachedCards(inAnalysis, now);
    const cases = await readRows(db, OPEN_CASE_NO_LETTER_SQL, [orgId, grace]);
    const cards = await readRows(db, CARD_NO_LETTER_SQL, [orgId]);
    if (engine.length === 0 && cases.length === 0 && cards.length === 0) {
      return check("repair-letter-round", "PASS", "no letter round is waiting to be written", null);
    }
    return check("repair-letter-round", "FAIL", letterDetail(cases, cards, engine), LETTER_FIX);
  } catch (err) {
    return check("repair-letter-round", "FAIL", `could not read repair rows: ${clip(err)}`, LETTER_FIX);
  }
}

/**
 * Live credit-repair breakage. Two checks. SELECT only.
 * @param {{ db?: { query: Function }, orgId?: string, now?: Date }} [ctx]
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
  const now = src.now instanceof Date ? src.now : new Date();
  return Promise.all([stuckCheck(db, orgId, now), letterCheck(db, orgId, now)]);
}
