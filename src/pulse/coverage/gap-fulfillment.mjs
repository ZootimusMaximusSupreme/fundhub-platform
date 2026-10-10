// Staff fulfillment breakage for the morning pulse. Read only. Report only.
// Slice 33 names the funding and repair desk doors. This file does not repeat that list.
// Not letter copy. Not inquiry.
//
// Three breaks: a repair file with no next step past the clock the code already
// defines, a fulfillment read that fails, and an apply step that is blocked with
// no reason saved.
//
// Funding queue files with no next step are read by gap-funding.mjs
// (funding:advisor-queue). The code defines no funding clock besides the
// 72-hour no-progress line, and that lane owns it. They are not read twice.
//
// Tripwire is existing Recon (AG-07) on daily-pulse. This file does not start
// another watcher. It does not apply to a lender. It does not upload.
//
// Claude review 2026-10-08: the old file pinged eight doors with no login (always
// 401, so a 500 behind the login was invisible), and called a file "without a
// next step" when its saved field was blank (the screen works the step out from
// the file, so a blank saved field proves nothing). Now it reads the step the
// Client Control Panel shows.

import { STAGE_SLA, isBreached } from "../../repair/sla.mjs";

export const REPAIR_PIPELINE = "optimization";
export const FUNDING_PIPELINE = "funding_card_stacking";

/** Repair stages that already have a clock in src/repair/sla.mjs. */
export const REPAIR_QUEUE_STAGES = Object.freeze(Object.keys(STAGE_SLA));

/** Boards a staff member works from. */
export const DESK_PIPELINES = Object.freeze([REPAIR_PIPELINE, FUNDING_PIPELINE]);

/** Apply statuses that mean the step stopped. A reason has to be stored. */
export const APPLY_BLOCKED_STATUSES = Object.freeze(["Missing Docs", "Action Required"]);

/** Proxy apply rows that stopped. The error columns are the stored reason. */
export const APPLY_FAIL_SESSION_STATUSES = Object.freeze(["failed", "mismatch"]);

/**
 * A proxy launch closes its own row in seconds (see the proxy folder in src). The code
 * says nothing sweeps a row left at 'verifying', and such a row has no reason
 * saved. Ten minutes is far past any launch.
 */
export const VERIFYING_STUCK_MS = 10 * 60 * 1000;

/** The most late repair files whose step is read in one run. */
export const MAX_FILES_READ = 25;

/** The most desk files the control panel read is tried on in one run. */
export const MAX_DESK_READS = 5;

export const CHECK_IDS = Object.freeze([
  "fulfillment:next-action",
  "fulfillment:api",
  "fulfillment:apply-blocked"
]);

const RECON =
  "Recon (AG-07) is the one tripwire. Do not auto-fix from this pulse. " +
  "Do not apply to a real lender. Do not upload.";

// Same "when is this file waiting on the response" rule the repair desk uses
// (src/repair/read-repair-signals.mjs DUE_SQL), so this agrees with its Stuck chip.
export const NEXT_ACTION_SQL = `
/* gap:fulfillment-next-action */
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
   AND p.key = '${REPAIR_PIPELINE}'
  JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
 WHERE c.org_id = $1::uuid
   AND COALESCE(c.is_demo, false) = false
   AND COALESCE(cl.is_demo, false) = false
   AND ps.key = ANY($2::text[])
 ORDER BY COALESCE(c.entered_at, c.updated_at) ASC
 LIMIT 200`;

export const DESK_CLIENTS_SQL = `
/* gap:fulfillment-desk-clients */
SELECT c.client_id::text AS client_id,
       max(c.updated_at) AS last_move
  FROM cards c
  JOIN pipelines p
    ON p.id = c.pipeline_id
   AND p.org_id = c.org_id
   AND p.key = ANY($2::text[])
  JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
 WHERE c.org_id = $1::uuid
   AND COALESCE(c.is_demo, false) = false
   AND COALESCE(cl.is_demo, false) = false
 GROUP BY c.client_id
 ORDER BY max(c.updated_at) DESC
 LIMIT ${MAX_DESK_READS}`;

export const APPLY_BLOCKED_SQL = `
/* gap:fulfillment-apply-blocked */
SELECT count(*)::int AS n
  FROM (
    SELECT a.id
      FROM applications a
      LEFT JOIN clients cl ON cl.id = a.client_id AND cl.org_id = a.org_id
     WHERE a.org_id = $1::uuid
       AND COALESCE(a.is_demo, false) = false
       AND COALESCE(cl.is_demo, false) = false
       AND a.status = ANY($2::text[])
       AND btrim(COALESCE(a.condition_text, '')) = ''
       AND NOT EXISTS (
         SELECT 1
           FROM application_decisions d
          WHERE d.org_id = a.org_id
            AND d.application_id = a.id
            AND btrim(COALESCE(d.notes, '')) <> ''
       )
    UNION ALL
    SELECT ps.id
      FROM proxy_sessions ps
      JOIN clients cl ON cl.id = ps.client_id AND cl.org_id = ps.org_id
     WHERE ps.org_id = $1::uuid
       AND COALESCE(cl.is_demo, false) = false
       AND ps.status = ANY($3::text[])
       AND btrim(COALESCE(ps.error_code, '')) = ''
       AND btrim(COALESCE(ps.error_message, '')) = ''
    UNION ALL
    SELECT ps.id
      FROM proxy_sessions ps
      JOIN clients cl ON cl.id = ps.client_id AND cl.org_id = ps.org_id
     WHERE ps.org_id = $1::uuid
       AND COALESCE(cl.is_demo, false) = false
       AND ps.status = 'verifying'
       AND ps.started_at < $4::timestamptz
  ) blocked`;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, 160);
}

function assertSelect(sql) {
  const bare = String(sql).replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").trim();
  if (!/^select\b/i.test(bare)) throw new Error("fulfillment gap check is read-only");
  if (/\b(insert|update|delete|drop)\b/i.test(bare)) {
    throw new Error("fulfillment gap check is read-only");
  }
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** True when the screen shows this file a next step. */
export function showsNextStep(fulfillment) {
  if (!fulfillment || typeof fulfillment !== "object") return false;
  if (fulfillment.degraded === true) return false;
  const label = fulfillment.next_action && fulfillment.next_action.label;
  return typeof label === "string" && label.trim() !== "";
}

/**
 * True when this repair card is past the clock the code already defines
 * (src/repair/sla.mjs isBreached). Funding files have no clock here.
 */
export function pastDefinedWait(row, now = new Date()) {
  if (!row || typeof row !== "object") return false;
  const stage = String(row.stage_key || "");
  if (!STAGE_SLA[stage]) return false;
  return isBreached({
    stageKey: stage,
    enteredAt: row.entered_at || row.updated_at || null,
    asOf: now,
    responseDueAt: row.response_due_at
  }).breached === true;
}

// The Client Control Panel's own read (api/dashboard/client.mjs runs the same
// two functions). Reads only. Literal import so the live bundle carries it.
async function readShownStep(db, orgId, clientId) {
  const step = await import("../../fulfillment/client-step.mjs");
  const rows = await step.readClientStepRows(db, { orgId, clientId });
  if (!rows || !rows.client) return { found: false, fulfillment: null };
  const inquiryCase = await step.readActiveInquiryCase(db, { orgId, clientId });
  const out = await step.workOutClientStep(db, { orgId, clientId, rows, inquiryCase });
  return { found: true, fulfillment: out ? out.fulfillment : null };
}

// One read per client per run. Both checks may ask about the same file.
function stepReader(ctx, db, orgId) {
  const read = typeof ctx.readShownStep === "function" ? ctx.readShownStep : readShownStep;
  const seen = new Map();
  return (clientId) => {
    if (!seen.has(clientId)) {
      seen.set(clientId, Promise.resolve().then(() => read(db, orgId, clientId)).then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error })
      ));
    }
    return seen.get(clientId);
  };
}

async function checkNextAction({ db, orgId, now, step }) {
  const id = "fulfillment:next-action";
  if (!db || typeof db.query !== "function" || !orgId) {
    return check(id, "skip", "no database — files with no next step not read");
  }
  try {
    assertSelect(NEXT_ACTION_SQL);
    const result = await db.query(NEXT_ACTION_SQL, [orgId, [...REPAIR_QUEUE_STAGES]]);
    const rows = Array.isArray(result && result.rows) ? result.rows : [];
    const late = rows.filter((row) => pastDefinedWait(row, now));
    if (late.length === 0) {
      return check(id, "PASS", "no repair file is past its clock");
    }
    const looked = late.slice(0, MAX_FILES_READ);
    const noStep = [];
    let unread = 0;
    let lastError = "";
    for (const row of looked) {
      const seen = await step(row.client_id);
      if (!seen.ok) {
        unread += 1;
        lastError = clip(seen.error);
      } else if (!seen.value || seen.value.found === false) {
        unread += 1;
        lastError = "client not found";
      } else if (!showsNextStep(seen.value.fulfillment)) {
        noStep.push(row);
      }
    }
    if (noStep.length > 0) {
      const shown = noStep.slice(0, 5).map((row) => `${row.client_id} (${row.stage_key})`).join(", ");
      const more = noStep.length > 5 ? ` and ${noStep.length - 5} more` : "";
      return check(
        id,
        "FAIL",
        `${plural(noStep.length, "repair file")} past the clock and the screen shows no next step. Look at ${shown}${more}.`,
        `Open the repair desk and set the next step on the file that has been waiting. ${RECON}`
      );
    }
    if (unread > 0) {
      return check(
        id,
        "skip",
        `${plural(unread, "late repair file")} could not be read for a next step (${lastError})`
      );
    }
    const more = late.length > looked.length ? ` (read the oldest ${looked.length} of ${late.length})` : "";
    return check(
      id,
      "PASS",
      `${plural(looked.length, "repair file")} past the clock and every one shows a next step${more}`
    );
  } catch (err) {
    return check(
      id,
      "FAIL",
      `could not read next steps: ${clip(err)}`,
      `Read the repair queue. ${RECON}`
    );
  }
}

// "Fulfillment API 500": the desk screens run the control panel read for a file.
// An unsigned ping only ever sees the login (401). This runs the same read.
async function checkApi({ db, orgId, step }) {
  const id = "fulfillment:api";
  if (!db || typeof db.query !== "function" || !orgId) {
    return check(id, "skip", "no database — fulfillment read not tried");
  }
  try {
    assertSelect(DESK_CLIENTS_SQL);
    const result = await db.query(DESK_CLIENTS_SQL, [orgId, [...DESK_PIPELINES]]);
    const files = Array.isArray(result && result.rows) ? result.rows : [];
    if (files.length === 0) {
      return check(id, "skip", "no file is on the funding or repair board — nothing to read");
    }
    const broken = [];
    for (const file of files) {
      const seen = await step(file.client_id);
      if (!seen.ok) {
        broken.push(`${file.client_id} threw: ${clip(seen.error)}`);
      } else if (!seen.value || seen.value.found === false) {
        broken.push(`${file.client_id} was not found`);
      } else if (!seen.value.fulfillment) {
        broken.push(`${file.client_id} had no answer`);
      } else if (seen.value.fulfillment.degraded === true) {
        broken.push(`${file.client_id} says "Not worked out yet"`);
      }
    }
    if (broken.length === 0) {
      return check(id, "PASS", `fulfillment read answered for ${plural(files.length, "desk file")}`);
    }
    return check(
      id,
      "FAIL",
      `fulfillment read failed for ${broken.length} of ${plural(files.length, "desk file")}: ${broken.slice(0, 3).join("; ")}`,
      `Fix the fulfillment read that failed. ${RECON}`
    );
  } catch (err) {
    return check(
      id,
      "FAIL",
      `could not read desk files: ${clip(err)}`,
      `Restore the fulfillment desk reads. ${RECON}`
    );
  }
}

async function checkApplyBlocked({ db, orgId, now }) {
  const id = "fulfillment:apply-blocked";
  if (!db || typeof db.query !== "function" || !orgId) {
    return check(id, "skip", "no database — blocked apply steps not read");
  }
  try {
    assertSelect(APPLY_BLOCKED_SQL);
    const result = await db.query(APPLY_BLOCKED_SQL, [
      orgId,
      [...APPLY_BLOCKED_STATUSES],
      [...APPLY_FAIL_SESSION_STATUSES],
      new Date(now.getTime() - VERIFYING_STUCK_MS)
    ]);
    const n = Number(result?.rows?.[0]?.n);
    if (!Number.isFinite(n)) {
      return check(
        id,
        "FAIL",
        "blocked apply count was not a number",
        `Read applications and proxy sessions. ${RECON}`
      );
    }
    if (n === 0) {
      return check(id, "PASS", "no blocked apply step is missing its reason");
    }
    return check(
      id,
      "FAIL",
      `${plural(n, "apply step")} blocked with no reason stored`,
      `Write the reason on the blocked apply step. ${RECON}`
    );
  } catch (err) {
    return check(
      id,
      "FAIL",
      `could not read blocked apply steps: ${clip(err)}`,
      `Read applications and proxy sessions. ${RECON}`
    );
  }
}

/**
 * Three read-only checks.
 * ctx: { db, orgId, now, readShownStep }. A fetch is not used.
 * Each row is { id, status, detail, suggestedFix }. Status is PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const step = stepReader(ctx, db, orgId);
  return [
    await checkNextAction({ db, orgId, now, step }),
    await checkApi({ db, orgId, step }),
    await checkApplyBlocked({ db, orgId, now })
  ];
}
