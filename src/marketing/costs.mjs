// @ts-check
// GET marketing/costs: the last measured cost and time of each job kind, this month's
// model spend against its cap, and the per-run caps. Every cost line on the Command
// Center reads this; a kind with no ledger row is null and the page prints "unknown,
// not measured yet" (design docs/specs/command-center-design-2026-10-05.md §3.0, §3.1
// Endpoints, §5 rule 3). Unit X1 (the avatar's cost line).
//
// WHERE A NUMBER COMES FROM. marketing_model_usage (the ledger, migrations 411 and 418):
// one row per model call, joined to its marketing_jobs row. "Last run" is the newest
// finished job of that kind that has at least one ledger row. Its cost is the sum of
// its rows (search fees included); its minutes run from the job's creation to its
// finish. Nothing is estimated here except the avatar's search ceiling, which is code
// (src/marketing/avatar/plan.mjs), not a guess.
//
// Unit GL (so every cost line on the Blueprint chain reads a real measured run):
//   * the flywheel steps that run as kind 'flywheel_stage' are told apart by their
//     stage: ad_research = stage 2, copy = stage 4, ad_strategy = stage 5;
//   * funnel = kind 'funnel' (the funnel builder's page writer);
//   * the offer: its runs never write the ledger (the Write offer path counts its own
//     tokens in marketing_jobs.result.usage), so when the ledger has no offer run its
//     cost is those counted tokens at the price table's rate (src/marketing/model-
//     usage.mjs costUsd). A token count with no known price is null, never $0.

import { costStatus, costUsd, DEFAULT_MAX_MONTH_USD, WEB_SEARCH_USD } from "./model-usage.mjs";
import { RUN_SEARCH_CEILING, STEPS_TOTAL, DEFAULT_RUN_CAP_USD, dollars } from "./avatar/plan.mjs";

/**
 * The design's cost kinds (§3.1 GET marketing/costs) and the marketing_jobs kind each
 * one is measured from: a kind, or {kind, stage} for one flywheel step. null: no job of
 * that kind exists in this build yet, so it can only be unknown.
 * @type {Readonly<Record<string, string | {kind: string, stage: number} | null>>}
 */
export const COST_KINDS = Object.freeze({
  offer: "offer",
  script: "write_slot",
  opening: null,
  quick_copy: null,
  brief: null,
  avatar: "avatar",
  ad_research: Object.freeze({ kind: "flywheel_stage", stage: 2 }),
  copy: Object.freeze({ kind: "flywheel_stage", stage: 4 }),
  ad_strategy: Object.freeze({ kind: "flywheel_stage", stage: 5 }),
  funnel: "funnel",
  research: "deep_research",
  page_draft: "page_draft",
  proof_read: "proof_card",
  proof_check: "proof_card_finish",
  testimonial_hook: null,
  testimonial_frames: null,
  testimonial_check: null
});

/**
 * The last finished, measured job of one kind → { last_cost_usd, last_minutes,
 * measured_at, last_searches, last_fetches, last_calls, unpriced_calls, job_id } or null.
 * stage: only flywheel_stage jobs of that step (payload.stage).
 * @param {{query: Function}} db
 * @param {{ orgId: string, jobKind: string, stage?: number|null }} opts
 */
export async function lastMeasured(db, { orgId, jobKind, stage = null }) {
  const r = await db.query(
    `SELECT j.id, j.created_at, j.finished_at,
            COALESCE(sum(u.cost_usd), 0)::float8 AS cost_usd,
            count(*) FILTER (WHERE u.cost_usd IS NULL)::int AS unpriced,
            COALESCE(sum(u.web_search_requests), 0)::int AS searches,
            COALESCE(sum(u.web_fetch_requests), 0)::int AS fetches,
            count(*)::int AS calls
       FROM marketing_jobs j
       JOIN marketing_model_usage u ON u.job_id = j.id
      WHERE j.org_id = $1 AND j.kind = $2 AND j.status = 'done' AND j.finished_at IS NOT NULL
        AND ($3::text IS NULL OR j.payload->>'stage' = $3::text)
      GROUP BY j.id
      ORDER BY j.finished_at DESC
      LIMIT 1`,
    [orgId, jobKind, stage == null ? null : String(stage)]
  );
  const row = r.rows[0];
  if (!row) return null;
  const minutes = Math.max(0, Math.round((new Date(row.finished_at).getTime() - new Date(row.created_at).getTime()) / 60000));
  return {
    job_id: row.id,
    last_cost_usd: Math.round(Number(row.cost_usd) * 1e6) / 1e6,
    last_minutes: minutes,
    measured_at: new Date(row.finished_at).toISOString(),
    last_searches: Number(row.searches) || 0,
    last_fetches: Number(row.fetches) || 0,
    last_calls: Number(row.calls) || 0,
    unpriced_calls: Number(row.unpriced) || 0
  };
}

/**
 * What one offer run cost, from the tokens it counted itself (result.usage.calls, each
 * at its own model's price, else result.model's). null when it counted nothing or a
 * call's model has no price on file (unknown, never $0).
 * @param {any} result  marketing_jobs.result of a done offer run
 */
export function offerRunUsd(result) {
  const usage = result && result.usage && typeof result.usage === "object" ? result.usage : null;
  const calls = usage && Array.isArray(usage.calls) ? usage.calls : [];
  if (!calls.length) return null;
  let usd = 0;
  for (const c of calls) {
    const tokens = {
      input_tokens: Number(c && c.input_tokens) || 0,
      output_tokens: Number(c && c.output_tokens) || 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0
    };
    const cost = costUsd(String((c && c.model) || ""), tokens) ?? costUsd(String((result && result.model) || ""), tokens);
    if (cost == null) return null;
    usd += cost;
  }
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * The last finished offer run, measured from its own token counts (the offer path
 * writes no ledger rows). Same shape as lastMeasured, or null.
 * @param {{query: Function}} db
 * @param {{ orgId: string }} opts
 */
export async function lastOfferRun(db, { orgId }) {
  const r = await db.query(
    `SELECT id, created_at, finished_at, result
       FROM marketing_jobs
      WHERE org_id = $1 AND kind = 'offer' AND status = 'done' AND finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1`,
    [orgId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const usd = offerRunUsd(row.result);
  if (usd == null) return null;
  const calls = row.result && row.result.usage && Array.isArray(row.result.usage.calls) ? row.result.usage.calls.length : 0;
  return {
    job_id: row.id,
    last_cost_usd: usd,
    last_minutes: Math.max(0, Math.round((new Date(row.finished_at).getTime() - new Date(row.created_at).getTime()) / 60000)),
    measured_at: new Date(row.finished_at).toISOString(),
    last_searches: 0,
    last_fetches: 0,
    last_calls: calls,
    unpriced_calls: 0,
    measured_from: "the run's own token counts"
  };
}

/**
 * readCosts(db, { orgId, settings, now }) → the GET marketing/costs body.
 * @param {{query: Function}} db
 * @param {{ orgId: string, settings: any, now?: Date }} opts
 */
export async function readCosts(db, { orgId, settings, now = new Date() }) {
  const monthCap = settings && settings.max_month_cost_usd != null ? Number(settings.max_month_cost_usd) : DEFAULT_MAX_MONTH_USD;
  const caps = settings && settings.run_caps && typeof settings.run_caps === "object" ? settings.run_caps : { avatar: DEFAULT_RUN_CAP_USD };
  /** @type {Record<string, any>} */
  const kinds = {};
  for (const [name, source] of Object.entries(COST_KINDS)) {
    if (!source) { kinds[name] = null; continue; }
    const jobKind = typeof source === "string" ? source : source.kind;
    const stage = typeof source === "string" ? null : source.stage;
    kinds[name] = await lastMeasured(db, { orgId, jobKind, stage });
  }
  if (!kinds.offer) kinds.offer = await lastOfferRun(db, { orgId });
  if (kinds.avatar) kinds.avatar.run_cap_usd = Number(caps.avatar) || DEFAULT_RUN_CAP_USD;
  const month = await costStatus(db, { orgId, maxMonthUsd: monthCap, now });
  return {
    ok: true,
    as_of: now.toISOString(),
    kinds,
    month: { used_usd: month.month_usd, cap_usd: monthCap, unpriced_calls: month.unpriced_rows },
    run_caps: { avatar: Number(caps.avatar) || DEFAULT_RUN_CAP_USD, ...caps },
    limits: {
      avatar: {
        steps: STEPS_TOTAL,
        max_searches: RUN_SEARCH_CEILING,
        max_search_usd: Math.round(RUN_SEARCH_CEILING * WEB_SEARCH_USD * 100) / 100
      }
    },
    submagic: null
  };
}

/**
 * The words under "Build the avatar" before the tap (design §3.2 row 1). Built only
 * from a GET marketing/costs body, so the page and the server can never disagree.
 * @param {any} costs
 */
export function avatarCostLine(costs) {
  const cap = Number(costs?.run_caps?.avatar) || DEFAULT_RUN_CAP_USD;
  const lim = costs?.limits?.avatar || { max_searches: RUN_SEARCH_CEILING, max_search_usd: RUN_SEARCH_CEILING * WEB_SEARCH_USD, steps: STEPS_TOTAL };
  const month = costs?.month
    ? `${dollars(Math.round(Number(costs.month.used_usd) * 100) / 100)} of ${dollars(costs.month.cap_usd)} used this month.`
    : "Month spend unknown.";
  const last = costs?.kinds?.avatar;
  if (last) {
    const when = new Date(last.measured_at).toLocaleDateString("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric" });
    return `About ${dollars(Math.round(last.last_cost_usd * 100) / 100)} and ${last.last_minutes} minutes (last run, ${when}). Stops at ${dollars(cap)}. ${month}`;
  }
  return `Cost: unknown, not measured yet. This run stops by itself at ${dollars(cap)} (the cap is in Settings). ${month} ` +
    `Web searches cost 1 cent each (Anthropic: $10 per 1,000). This run makes at most ${lim.max_searches} searches, so at most ${dollars(lim.max_search_usd)} of it is search. ` +
    `It runs in ${lim.steps} steps on the server; the row shows each step. Time: unknown, not measured yet. The word bank is kept and added to, not replaced.`;
}
