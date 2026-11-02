// portal:progress-read-real-client — the real client progress read, run for the newest real paying client, with
// every read failure underneath counted and the answer held against the client's own rows. Report only. Read only.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). This SQL and verdict used to live in src/pulse/coverage/gap-portal.mjs, and
// the read it runs (src/progress/read.mjs) could not be loaded by a beat. The read now lives in this library
// (./progress-read.mjs, re-exported by src/progress/read.mjs), so the check moved here too: the morning lane
// gap-portal.mjs imports it back, and the hourly beat client-progress runs the same check through the read box.
// The only change: the read is this library's own copy, imported, not loaded by path at run time (so the old
// "the progress read code would not load" row is gone; a broken import now stops the lane module, which the
// self-audit reports as a lane that would not load). The referral link's env is handed in (`env`).

import { INTERNAL_CLIENT_EMAIL_RE, PAID, PAID_THROUGH_THE_DOOR_SQL, check, clip, raceTimeout } from "./portal-truth.mjs";
import { readClientProgress } from "./progress-read.mjs";
import { REPAIR_PIPELINE } from "./repair-stage.mjs";

/* The newest real paying client: the one whose progress page we read. */
export const PROGRESS_CLIENT_SQL = `
/* gap:portal-progress-client */
SELECT t.client_id::text AS id
  FROM transactions t
  JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
 WHERE t.org_id = $1::uuid
   AND lower(btrim(COALESCE(t.status, ''))) = $2
   AND t.is_demo IS NOT TRUE
   AND NOT (c.is_demo IS TRUE
            OR COALESCE(c.custom_fields ->> 'synthetic', '') = 'true'
            OR COALESCE(c.email, '') ~* $3)
   AND ${PAID_THROUGH_THE_DOOR_SQL}
 ORDER BY t.created_at DESC
 LIMIT 1
`.trim();

/* What the client's own rows say, counted without the progress code, so the page
   can be held against them. Three plain facts: how many steps they have, how
   many documents, and which repair stage their card is in. */
export const PROGRESS_ROWS_SQL = `
/* gap:portal-progress-rows */
SELECT
  (SELECT count(*) FROM client_waypoints w
    WHERE w.org_id = $1::uuid AND w.client_id = $2::uuid)::int AS waypoints,
  (SELECT count(*) FROM documents d
    WHERE d.org_id = $1::uuid AND d.client_id = $2::uuid
      AND d.kind = 'deliverable')::int AS deliverables,
  (SELECT COALESCE(array_agg(ps.key), '{}'::text[])
     FROM cards c
     JOIN pipeline_stages ps ON ps.id = c.stage_id
     JOIN pipelines p ON p.id = c.pipeline_id AND p.key = $3
    WHERE c.org_id = $1::uuid AND c.client_id = $2::uuid) AS repair_stages
`.trim();

/* ── portal:progress-read-real-client ───────────────────────────────────────
   The progress page is a screen that draws whatever readClientProgress hands it.
   That function is built to fail soft: a read that throws is logged and the
   section comes back empty, so a dropped column does not give a 500. It gives a
   client an empty page that looks like a new client. This check runs the real
   function for the newest paying client and counts every read that failed
   underneath, then holds the answer against the client's own rows. */

export const PROGRESS_TIMEOUT_MS = 12000;

const WRITE_WORDS = Object.freeze([
  "insert", "update", "delete", "truncate", "alter", "drop", "create", "grant", "revoke"
]);

/** True when the text is one plain read: it starts with select or with, and
    names no write word. The progress read is held to this, so a future change
    that makes it write is refused here and shows up red. */
export function isPlainRead(sql) {
  const text = String(typeof sql === "string" ? sql : (sql && sql.text) || "");
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").trim().toLowerCase();
  if (!/^(select|with)\b/.test(bare)) return false;
  const words = bare.split(/[^a-z_]+/);
  return !WRITE_WORDS.some((w) => words.includes(w));
}

function guardedDb(db) {
  const errors = [];
  return {
    errors,
    query: async (sql, params) => {
      if (!isPlainRead(sql)) {
        const err = Object.assign(new Error("the pulse refused a query that is not a plain read"), { refused: true });
        errors.push(err);
        throw err;
      }
      try {
        return await db.query(sql, params);
      } catch (err) {
        errors.push(err);
        throw err;
      }
    }
  };
}

/* The real progress read and the repair rail's name: this library's own copies, the ones
   src/progress/read.mjs and src/repair/pipeline.mjs re-export. */
const PROGRESS_MODULES = Object.freeze({ readClientProgress, REPAIR_PIPELINE });

function shapeProblems(payload) {
  const bad = [];
  if (!payload || typeof payload !== "object") return ["the read gave back nothing"];
  if (!payload.stage || typeof payload.stage !== "object") bad.push("no stage block");
  if (!payload.scores || !Array.isArray(payload.scores.personal) || payload.scores.personal.length !== 3) {
    bad.push("no three score panels");
  }
  if (!payload.movement || typeof payload.movement !== "object") bad.push("no movement block");
  for (const key of ["waypoints", "timeline", "deliverables"]) {
    if (!Array.isArray(payload[key])) bad.push(`no ${key} list`);
  }
  return bad;
}

export async function checkProgressRead({
  run, orgId, deps = null, env = {}, timeoutMs = PROGRESS_TIMEOUT_MS
} = {}) {
  const id = "portal:progress-read-real-client";
  if (typeof run !== "function") return check(id, "skip", "no database in this run — progress read not run");
  if (!orgId) return check(id, "skip", "no org in this run — progress read not run");

  const mods = deps || PROGRESS_MODULES;
  const fix = "Fix the read named above behind GET /api/read/client-progress. Do not auto-fix from this pulse.";

  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(1, deadline - Date.now());
  const seconds = Math.round(timeoutMs / 1000);

  // 1. Who to read: the newest real paying client.
  let clientId;
  try {
    clientId = await raceTimeout(run(async (tx) => {
      const r = await tx.query(PROGRESS_CLIENT_SQL, [orgId, PAID, INTERNAL_CLIENT_EMAIL_RE]);
      return r && r.rows && r.rows[0] ? r.rows[0].id : null;
    }), left());
  } catch (err) {
    return check(id, "skip", `could not pick a paying client to read: ${err && err.isTimeout ? `no answer in ${seconds} seconds` : clip(err)}`);
  }
  if (!clientId) return check(id, "skip", "no real paying client on file — progress read not run");

  // 2. The real read and its independent row-count cross-check run together.
  // Both are read-only; the count no longer adds a round trip after the page read.
  const rowsTask = raceTimeout(run(async (tx) => {
    const r = await tx.query(PROGRESS_ROWS_SQL, [orgId, clientId, mods.REPAIR_PIPELINE]);
    return r && r.rows ? r.rows[0] || null : null;
  }), left()).then(
    (rows) => ({ rows, error: null }),
    (error) => ({ rows: null, error })
  );
  let outcome;
  try {
    outcome = await raceTimeout(run(async (tx) => {
      const guard = guardedDb(tx);
      try {
        const payload = await mods.readClientProgress(guard, { orgId, clientId, env });
        return { payload, threw: null, errors: guard.errors };
      } catch (err) {
        return { payload: null, threw: err, errors: guard.errors };
      }
    }), left());
  } catch (err) {
    if (err && err.isTimeout) {
      return check(
        id,
        "FAIL",
        `the progress read for the newest paying client did not finish inside ${seconds} seconds — the page would hang`,
        fix
      );
    }
    return check(id, "skip", `could not run the progress read: ${clip(err)}`);
  }

  const problems = [];
  if (outcome.threw) problems.push(`the read threw: ${clip(outcome.threw)}`);
  if (outcome.errors.some((e) => e && e.refused)) {
    problems.push("the progress read tried to run a query that is not a plain read, and the pulse refused it");
  } else if (outcome.errors.length) {
    const n = outcome.errors.length;
    problems.push(
      `${n} read${n === 1 ? "" : "s"} behind the page failed and the page would show an empty section: ${clip(outcome.errors[0])}`
    );
  }
  if (!outcome.threw) problems.push(...shapeProblems(outcome.payload));

  // 3. Hold the answer against the client's own rows.
  let rows = null;
  let rowsError = null;
  if (!outcome.threw && !outcome.errors.length) {
    const checkedRows = await rowsTask;
    rows = checkedRows.rows;
    rowsError = checkedRows.error;
  }
  const payload = outcome.payload;
  if (rows && payload && !problems.length) {
    const steps = Number(rows.waypoints);
    if (Array.isArray(payload.waypoints) && payload.waypoints.length !== steps) {
      problems.push(`the client has ${steps} checklist step${steps === 1 ? "" : "s"} on file and the page gets ${payload.waypoints.length}`);
    }
    const docs = Number(rows.deliverables);
    if (Array.isArray(payload.deliverables) && payload.deliverables.length !== docs) {
      problems.push(`the client has ${docs} document${docs === 1 ? "" : "s"} on file and the page gets ${payload.deliverables.length}`);
    }
    const stages = Array.isArray(rows.repair_stages) ? rows.repair_stages : [];
    if (stages.length && !stages.includes(payload.stage && payload.stage.key)) {
      problems.push(`the client's repair card is at "${stages[0]}" and the page shows "${(payload.stage && payload.stage.key) || "no stage"}"`);
    }
  }

  if (problems.length) {
    return check(id, "FAIL", `progress read for the newest paying client: ${problems.join("; ")}`, fix);
  }
  if (rowsError) {
    return check(id, "skip", `the read ran clean but its rows could not be counted for the cross-check: ${rowsError.isTimeout ? "no answer in time" : clip(rowsError)}`);
  }
  const scored = payload.scores.personal.filter((p) => p && p.score != null).length;
  return check(
    id,
    "PASS",
    `the real progress read ran for the newest paying client with no read failing: ` +
      `stage ${(payload.stage && payload.stage.key) || "not started"}, ${scored} of 3 scores, ` +
      `${payload.waypoints.length} checklist steps, ${payload.deliverables.length} documents, and the counts match the client's own rows`
  );
}
