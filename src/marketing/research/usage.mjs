// @ts-check
// What a research call cost, saved to the ledger, and what a run has spent so far.
//
// Design docs/specs/command-center-design-2026-10-05.md §1 (the price lines) and §5
// safety rule 13 (caps enforced in code). Unit X2. The ledger is marketing_model_usage
// (migration 411) with the web search and web fetch counts and the step name from
// migration 429.
//
// PRICES. Tokens are priced by src/marketing/model-usage.mjs costUsd (the claude-api
// skill's table). A web search is $10 per 1,000 = $0.01 each, plus its tokens; a
// search that fails is not billed, and Anthropic's own usage.server_tool_use count is
// what is charged here (it counts billed searches). A web fetch costs nothing beyond
// the tokens it reads. Both prices were read from platform.claude.com/docs on
// 2026-10-05 (web-search-tool and web-fetch-tool pages) and again on 2026-10-06.
//
// These are model bills in dollars (numeric(12,6)), not client money, so they are not
// integer cents — same rule as model-usage.mjs. A price that is not known is NULL,
// never 0, and counts at the highest known rate wherever a cap is checked.

import { costUsd, worstCaseUsd, tokensOf, costStatus } from "../model-usage.mjs";

/** One web search: $10 per 1,000. */
export const SEARCH_USD = 0.01;

const round6 = (n) => Math.round(n * 1_000_000) / 1_000_000;
const count = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * callCostUsd(model, usage, searches) → dollars for one call (tokens + search fees),
 * or null when the model's token price is not known.
 */
export function callCostUsd(model, usage, searches = 0) {
  const tokens = costUsd(model, tokensOf({ usage }));
  if (tokens == null) return null;
  return round6(tokens + count(searches) * SEARCH_USD);
}

/**
 * logResearchUsage(db, { orgId, jobId, model, usage, searches, fetches, step }) → the row.
 * `model` is the model that SERVED the call (callModel's servedModel). The search fee is
 * inside cost_usd, so every month and run total that sums cost_usd already includes it.
 */
export async function logResearchUsage(db, row = /** @type {any} */ ({})) {
  if (!row.orgId) throw new TypeError("logResearchUsage: orgId is required");
  const model = String(row.model || "").trim();
  if (!model) throw new TypeError("logResearchUsage: model is required (the model that served the call)");
  const t = tokensOf({ usage: row.usage || {} });
  const searches = count(row.searches);
  const fetches = count(row.fetches);
  const usd = callCostUsd(model, row.usage || {}, searches);
  const r = await db.query(
    `INSERT INTO marketing_model_usage
       (org_id, job_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        cost_usd, web_search_requests, web_fetch_requests, step)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [row.orgId, row.jobId || null, model, t.input_tokens, t.output_tokens, t.cache_read_tokens,
      t.cache_write_tokens, usd == null ? null : usd.toFixed(6), searches, fetches,
      row.step ? String(row.step).slice(0, 120) : null]
  );
  return r.rows[0];
}

/**
 * jobSpend(db, jobId) → { usd, searches, fetches, calls } for one run so far.
 * A call with an unknown price counts at the highest known rate (never as free), and
 * its searches still cost a cent each.
 */
export async function jobSpend(db, jobId) {
  const r = await db.query(
    `SELECT COALESCE(sum(cost_usd), 0)                                         AS priced_usd,
            COALESCE(sum(input_tokens) FILTER (WHERE cost_usd IS NULL), 0)        AS null_input,
            COALESCE(sum(output_tokens) FILTER (WHERE cost_usd IS NULL), 0)       AS null_output,
            COALESCE(sum(cache_read_tokens) FILTER (WHERE cost_usd IS NULL), 0)   AS null_cache_read,
            COALESCE(sum(cache_write_tokens) FILTER (WHERE cost_usd IS NULL), 0)  AS null_cache_write,
            COALESCE(sum(web_search_requests) FILTER (WHERE cost_usd IS NULL), 0) AS null_searches,
            COALESCE(sum(web_search_requests), 0)                                 AS searches,
            COALESCE(sum(web_fetch_requests), 0)                                  AS fetches,
            count(*)::int                                                         AS calls
       FROM marketing_model_usage WHERE job_id = $1`,
    [jobId]
  );
  const s = r.rows[0] || {};
  const num = (v) => (v == null ? 0 : Number(v) || 0);
  const unpriced = worstCaseUsd({
    input_tokens: num(s.null_input), output_tokens: num(s.null_output),
    cache_read_tokens: num(s.null_cache_read), cache_write_tokens: num(s.null_cache_write)
  }) + num(s.null_searches) * SEARCH_USD;
  return {
    usd: round6(num(s.priced_usd) + unpriced),
    searches: num(s.searches),
    fetches: num(s.fetches),
    calls: num(s.calls)
  };
}

/**
 * monthUsedUsd(db, orgId, { now }) → this Arizona calendar month's model spend for the
 * company (every marketing call, research included), from costStatus.
 */
export async function monthUsedUsd(db, orgId, { now } = /** @type {{ now?: Date }} */ ({})) {
  const s = await costStatus(db, { orgId, now });
  return s.month_usd;
}
