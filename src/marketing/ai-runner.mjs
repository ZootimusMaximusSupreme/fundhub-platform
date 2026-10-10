// @ts-check
// Who runs the marketing AI jobs: Netlify (the Anthropic API) or Chris's Mac (Claude Code).
//
// THE SWITCH. MARKETING_AI_RUNNER=local (owner-set 2026-10-06: there is no Anthropic API
// credit). Then:
//   * the Netlify worker (src/marketing/worker.mjs), the clock, the offer background
//     function and the funnel background function never run an AI job kind. Those jobs
//     stay queued, and the dashboard says "Waiting for your Mac to run it."
//   * every job that is not AI (funnel_push, meta_load, the batch chores, the outbox
//     drain, the buzzes) keeps running on Netlify exactly as before.
//   * `npm run marketing:run-queue` on the Mac (scripts/marketing-run-queue.mjs) claims
//     the AI jobs with the worker's own claim and run code and writes them with Claude
//     Code (src/agents/claude-code.mjs).
// Unset, or any other value: nothing changes — Netlify runs everything, as before.
//
// AN AI JOB KIND is one whose handler calls the model. The list is checked against
// src/marketing/job-kinds.mjs by ai-runner.test.mjs: every kind there must be named in
// exactly one of AI_JOB_KINDS or NOT_AI_JOB_KINDS, so a new kind can never slip through
// unsorted.

import { JOB_KINDS } from "./job-kinds.mjs";
import { OFFER_KIND } from "./jobs.mjs";

export const AI_RUNNER_ENV = "MARKETING_AI_RUNNER";

/** Kinds in the worker's registry whose handler calls the model. */
export const AI_JOB_KINDS = Object.freeze(["write_slot", "fix_script", "funnel", "avatar", "flywheel_stage", "deep_research"]);

/** Kinds in the worker's registry that never call the model. They stay on Netlify. */
export const NOT_AI_JOB_KINDS = Object.freeze([
  "funnel_push", "meta_load", "start_batch", "finish_batch", "release_batch",
  "expire_drafts", "voice_export", "nightly_script_check"
]);

/** Creative factory asset kinds written by the model ("Write ad copy"). */
export const AI_ASSET_KINDS = Object.freeze(["copy"]);

/** The plain line the dashboard shows on an AI job the Mac has not picked up yet. */
export const MAC_WAIT_LINE = "Waiting for your Mac to run it.";

/** True when MARKETING_AI_RUNNER=local: the Mac runs the AI jobs, Netlify does not. */
export function runnerIsLocal(env = process.env) {
  return String((env && env[AI_RUNNER_ENV]) || "").trim().toLowerCase() === "local";
}

/** True for a marketing_jobs kind the model writes (the offer included). */
export function isAiKind(kind) {
  return kind === OFFER_KIND || AI_JOB_KINDS.includes(String(kind));
}

/**
 * The registry the Netlify worker and clock use: every kind, or — when the Mac runs the
 * AI — every kind except the AI ones.
 * @param {Record<string, any>} [env] @param {Record<string, any>} [registry]
 */
export function netlifyRegistry(env = process.env, registry = JOB_KINDS) {
  if (!runnerIsLocal(env)) return registry;
  return Object.fromEntries(Object.entries(registry).filter(([k]) => !isAiKind(k)));
}

/** The registry the Mac runner uses: the AI kinds only. @param {Record<string, any>} [registry] */
export function macRegistry(registry = JOB_KINDS) {
  return Object.fromEntries(Object.entries(registry).filter(([k]) => AI_JOB_KINDS.includes(k)));
}

/**
 * readMacQueue(db, { orgId, env }) → null when Netlify runs the AI, else
 * { waiting, running, line } — the AI jobs (offer included) that sit queued for the Mac
 * or that the Mac is running now.
 * @param {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }} db
 * @param {{ orgId: string, env?: Record<string, any> }} opts
 */
export async function readMacQueue(db, { orgId, env = process.env }) {
  if (!runnerIsLocal(env)) return null;
  const r = await db.query(
    `-- mac_queue
     SELECT count(*) FILTER (WHERE status = 'queued')::int  AS waiting,
            count(*) FILTER (WHERE status = 'running')::int AS running
       FROM marketing_jobs
      WHERE org_id = $1 AND kind = ANY($2::text[]) AND status IN ('queued', 'running')`,
    [orgId, [OFFER_KIND, ...AI_JOB_KINDS]]
  );
  const row = r.rows[0] || {};
  const waiting = Number(row.waiting) || 0;
  const running = Number(row.running) || 0;
  return { waiting, running, line: macQueueLine(waiting, running) };
}

/** One plain sentence about the Mac's queue, or "" when it is empty. */
export function macQueueLine(waiting, running) {
  const parts = [];
  if (waiting > 0) parts.push(`${waiting} AI ${waiting === 1 ? "job is" : "jobs are"} waiting for your Mac to run ${waiting === 1 ? "it" : "them"}.`);
  if (running > 0) parts.push(`Your Mac is running ${running} now.`);
  return parts.join(" ");
}
