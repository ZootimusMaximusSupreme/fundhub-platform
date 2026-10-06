// @ts-check
// The avatar run's rows on marketing_jobs (kind 'avatar'): start one, retry one, read
// them back in plain words. Unit X1; design docs/specs/command-center-design-2026-10-05.md
// §3.0 (the word table), §3.2 (row 1 "Who we sell to"), §6 slice 5a.
//
// One run in flight per company and campaign: the partial unique index
// marketing_jobs_one_avatar_in_flight_uq (migration 418). A second tap gets the running
// row back ("The avatar is already being built. This is that run.").
//
// Every statement takes the caller's handle (a withRequest transaction for the writes,
// a staffRead transaction or the plain db for the reads). No model call, no GitHub.

import { AVATAR_KIND, STEPS, STEPS_TOTAL, FIRST_STEP, DONE_STEP, stepOf, dollars, DEFAULT_RUN_CAP_USD } from "./plan.mjs";
import { runCounts } from "./document.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The run cap for avatar runs from a settings row ({"avatar": 20} by default). */
export function avatarRunCap(settingsRow) {
  const caps = settingsRow && settingsRow.run_caps && typeof settingsRow.run_caps === "object" ? settingsRow.run_caps : {};
  const n = Number(caps.avatar);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RUN_CAP_USD;
}

/**
 * createAvatarJob(tx, { orgId, campaign, serviceDescription, tweak, runCapUsd, staffId })
 *   → { job, created }. created false: a run for this campaign is already in flight
 *   and `job` is that run.
 */
export async function createAvatarJob(tx, { orgId, campaign, serviceDescription, tweak = null, runCapUsd, staffId = null }) {
  const payload = {
    campaign,
    step: FIRST_STEP,
    service_description: serviceDescription,
    run_cap_usd: runCapUsd,
    ...(tweak ? { tweak } : {}),
    progress: {}
  };
  const ins = await tx.query(
    `INSERT INTO marketing_jobs (org_id, kind, payload, requested_by)
     VALUES ($1, '${AVATAR_KIND}', $2::jsonb, $3)
     ON CONFLICT (org_id, (payload ->> 'campaign'))
       WHERE kind = '${AVATAR_KIND}' AND status IN ('queued', 'running')
     DO NOTHING
     RETURNING *`,
    [orgId, JSON.stringify(payload), staffId]
  );
  if (ins.rows[0]) return { job: ins.rows[0], created: true };
  return { job: await inFlightAvatarJob(tx, { orgId, campaign }), created: false };
}

/** The run for this campaign that is queued or running, or null. */
export async function inFlightAvatarJob(db, { orgId, campaign }) {
  const r = await db.query(
    `SELECT * FROM marketing_jobs
      WHERE org_id = $1 AND kind = '${AVATAR_KIND}' AND payload ->> 'campaign' = $2
        AND status IN ('queued', 'running')
      ORDER BY created_at DESC LIMIT 1`,
    [orgId, campaign]
  );
  return r.rows[0] || null;
}

/**
 * retryAvatarJob(tx, { orgId, id, runCapUsd }) → the row back in the queue, or null when
 * it is not a failed avatar run of this company. Keeps every saved step (payload) and
 * takes the run cap as it is in Settings now, so "raise the cap, tap Retry" finishes.
 * Throws the database's unique violation when another run of the campaign is in flight.
 */
export async function retryAvatarJob(tx, { orgId, id, runCapUsd }) {
  if (!UUID_RE.test(String(id || ""))) return null;
  const r = await tx.query(
    `UPDATE marketing_jobs
        SET status = 'queued', attempts = 0, error = NULL, claimed_at = NULL, finished_at = NULL,
            run_after = now(),
            payload = jsonb_set(payload #- '{progress,stopped_at_cap}', '{run_cap_usd}', to_jsonb($3::numeric))
      WHERE id = $1 AND org_id = $2 AND kind = '${AVATAR_KIND}' AND status = 'failed'
      RETURNING *`,
    [id, orgId, runCapUsd]
  );
  return r.rows[0] || null;
}

/** One avatar row of this company, or null. */
export async function getAvatarJob(db, { orgId, id }) {
  if (!UUID_RE.test(String(id || ""))) return null;
  const r = await db.query(
    `SELECT * FROM marketing_jobs WHERE id = $1 AND org_id = $2 AND kind = '${AVATAR_KIND}'`,
    [id, orgId]
  );
  return r.rows[0] || null;
}

/** The newest avatar run for a campaign (any state), or null. */
export async function latestAvatarJob(db, { orgId, campaign }) {
  const r = await db.query(
    `SELECT * FROM marketing_jobs
      WHERE org_id = $1 AND kind = '${AVATAR_KIND}' AND payload ->> 'campaign' = $2
      ORDER BY created_at DESC LIMIT 1`,
    [orgId, campaign]
  );
  return r.rows[0] || null;
}

/** What one job has spent and searched, from the ledger. */
export async function jobLedger(db, jobId) {
  const r = await db.query(
    `SELECT COALESCE(sum(cost_usd), 0)::float8 AS cost_usd,
            count(*) FILTER (WHERE cost_usd IS NULL)::int AS unpriced,
            COALESCE(sum(web_search_requests), 0)::int AS searches,
            COALESCE(sum(web_fetch_requests), 0)::int AS fetches,
            count(*)::int AS calls
       FROM marketing_model_usage WHERE job_id = $1`,
    [jobId]
  );
  return r.rows[0] || { cost_usd: 0, unpriced: 0, searches: 0, fetches: 0, calls: 0 };
}

const iso = (v) => {
  if (v == null || v === "") return null;
  const t = v instanceof Date ? v : new Date(v);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
};

/**
 * The row in the design's words (§3.0 word table, §3.2 row 1). `ledger` is jobLedger()'s
 * answer; without it the spend reads from the run's own last save.
 * @param {any} row
 * @param {{ cost_usd?: number, searches?: number, fetches?: number, unpriced?: number } | null} [ledger]
 */
export function avatarJobView(row, ledger = null) {
  if (!row) return null;
  const payload = row.payload || {};
  const progress = payload.progress || {};
  const stepKey = String(payload.step || FIRST_STEP);
  const step = stepOf(stepKey);
  const counts = runCounts(progress);
  const spent = ledger && ledger.cost_usd != null ? Number(ledger.cost_usd) : (progress.cost_so_far_usd ?? null);
  const searches = ledger && ledger.searches != null ? Number(ledger.searches) : counts.searches;
  const fetches = ledger && ledger.fetches != null ? Number(ledger.fetches) : counts.fetches;
  const round = stepKey === "quotes" && progress.quotes ? Number(progress.quotes.round) || 1 : null;
  const stop = progress.stopped_at_cap || null;
  const result = row.result || null;

  let sentence;
  if (row.status === "done") {
    sentence = (result && result.sentence) || "Done.";
  } else if (row.status === "failed") {
    sentence = stop && stop.sentence ? stop.sentence : `Could not finish: ${String(row.error || "no reason was saved").replace(/\s+/g, " ").trim()}`;
  } else {
    const spend = spent == null ? "Spend unknown so far" : `${dollars(Math.round(spent * 100) / 100)} spent so far`;
    const roundWords = round ? `, round ${round}` : "";
    const sofar = stepKey === "quotes" || STEPS.findIndex((s) => s.key === stepKey) > 2
      ? ` ${counts.quotes} new quote${counts.quotes === 1 ? "" : "s"} so far.` : "";
    const retrying = row.status === "queued" && Number(row.attempts) > 0 && row.error
      ? ` Trying again: ${String(row.error).replace(/\s+/g, " ").trim()}` : "";
    sentence = step
      ? `Running: step ${step.n} of ${STEPS_TOTAL}, ${step.word}${roundWords}.${sofar} ${spend}, ${searches} search${searches === 1 ? "" : "es"}.${retrying}`
      : "Running.";
  }

  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    campaign: payload.campaign || null,
    step: stepKey,
    step_n: step ? step.n : (stepKey === DONE_STEP ? STEPS_TOTAL : null),
    steps_total: STEPS_TOTAL,
    step_word: step ? step.word : null,
    round,
    counts_so_far: {
      quotes: counts.quotes, verbatim: counts.verbatim, paraphrase: counts.paraphrases,
      kept: counts.keptEntries, added: counts.newQuotes, phrases: counts.languageEntries,
      findings: counts.findings, dropped: counts.dropped
    },
    searches_so_far: searches,
    fetches_so_far: fetches,
    cost_so_far_usd: spent,
    run_cap_usd: Number(payload.run_cap_usd) || null,
    shrunk: Array.isArray(progress.shrunk) ? progress.shrunk : [],
    stopped_at_cap: stop,
    resumable: row.status === "failed",
    attempts: Number(row.attempts) || 0,
    started_at: iso(progress.started_at || row.created_at),
    finished_at: iso(row.finished_at),
    error: row.error || null,
    sentence,
    result: row.status === "done" ? result : null
  };
}

/** Every step of a run, for GET marketing/flywheel/job. */
export function avatarStepsView(row) {
  const progress = (row && row.payload && row.payload.progress) || {};
  const steps = progress.steps || {};
  const current = row && row.payload ? row.payload.step : null;
  return STEPS.map((s) => {
    const rec = steps[s.key] || {};
    return {
      n: s.n,
      key: s.key,
      word: s.word,
      status: rec.status || (current === s.key ? "next" : "not_started"),
      attempts: Number(rec.attempts) || 0,
      started_at: iso(rec.started_at),
      finished_at: iso(rec.finished_at)
    };
  });
}
