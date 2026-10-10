// @ts-check
// What the marketing machine's model calls cost, and whether a cost cap is reached.
// Table: marketing_model_usage (db/migrations/411_marketing_buzzes_usage_shoots.sql).
// Spec: docs/specs/marketing-machine-2026-10-04.md §7.6 "Cost" and Appendix E:
// log every call; when spending reaches max_batch_cost_usd (default $40) or
// max_month_cost_usd (default $300), the writer stops, releases what is done and buzzes once.
//
// NOT recordUsage / partner_ai_usage: that table's purpose CHECK (172_wl_marketing.sql:39)
// refuses new values and it charges the token cap Social Studio shares.
//
// These are model bills in dollars (numeric(12,6)), not client money, so they are not
// integer cents. A price that is not known is NULL, never 0.

/* PRICES — US dollars per MILLION tokens.
   Source: the claude-api skill, "Current Models (cached: 2026-09-25)" table and its model
   notes (Opus 5.5: "$4 / $20 per MTok, cache reads $0.20"; Sonnet 5.5: "$2 / $10 per MTok,
   cache reads $0.20"). Copied from the skill on 2026-10-05, never priced from memory.
   Cache WRITE is 1.25x the input price: the 5-minute ("ephemeral") cache this machine
   uses. A 1-hour cache write costs 2x and is not used here.
   A model that is not in this table gets cost_usd NULL. When a new model is used, copy
   its prices from the skill into this table with the skill's cache date. */
export const PRICES_SOURCE = "claude-api skill, Current Models table (cached: 2026-09-25)";

const CACHE_WRITE_MULTIPLIER = 1.25;

const price = (input, output, cacheRead) =>
  Object.freeze({ input, output, cache_read: cacheRead, cache_write: input * CACHE_WRITE_MULTIPLIER });

/* 'claude-code' (added 2026-10-06): the Claude Code command line on Chris's Mac, run
   by scripts/marketing-run-queue.mjs under his Claude subscription
   (src/agents/claude-code.mjs). There is no bill per call, so it is $0 — a real zero,
   not an unknown. Its web searches carry no fee either (FREE_MODELS below). */
export const MODEL_PRICES = Object.freeze({
  "claude-opus-5-5": price(4, 20, 0.2),
  "claude-sonnet-5-5": price(2, 10, 0.2),
  "claude-code": price(0, 0, 0)
});

/** Models with no bill per call: their web searches cost nothing either. */
export const FREE_MODELS = Object.freeze(["claude-code"]);

const PER = 1_000_000;

/** The highest known rate for each kind of token. Unpriced calls are counted at this for the cap. */
export const HIGHEST_KNOWN_RATE = Object.freeze({
  input: Math.max(...Object.values(MODEL_PRICES).map((p) => p.input)),
  output: Math.max(...Object.values(MODEL_PRICES).map((p) => p.output)),
  cache_read: Math.max(...Object.values(MODEL_PRICES).map((p) => p.cache_read)),
  cache_write: Math.max(...Object.values(MODEL_PRICES).map((p) => p.cache_write))
});

/* WEB SEARCH — Anthropic bills $10 per 1,000 searches on top of tokens (design
   docs/specs/command-center-design-2026-10-05.md, prices read from platform.claude.com
   on 2026-10-05; the web search tool page: "$10 per 1,000 searches ... If an error
   occurs during web search, the web search will not be billed"). Web fetch costs
   nothing beyond the tokens it reads. */
export const WEB_SEARCH_USD = 0.01;

export const DEFAULT_MAX_BATCH_USD = 40;
export const DEFAULT_MAX_MONTH_USD = 300;
export const COST_TZ = "America/Phoenix";

/**
 * @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[], rowCount?: number | null }> }} Db
 * @typedef {{ input_tokens: number, output_tokens: number, cache_read_tokens: number, cache_write_tokens: number }} Tokens
 */

const round6 = (n) => Math.round(n * PER) / PER;
const count = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * tokensOf(row) → the four token counts. Takes explicit fields (inputTokens, outputTokens,
 * cacheReadTokens, cacheWriteTokens) or an Anthropic `usage` object (input_tokens,
 * output_tokens, cache_read_input_tokens, cache_creation_input_tokens). Explicit wins.
 * @returns {Tokens}
 */
export function tokensOf(row = {}) {
  const u = row.usage || {};
  return {
    input_tokens: count(row.inputTokens ?? u.input_tokens),
    output_tokens: count(row.outputTokens ?? u.output_tokens),
    cache_read_tokens: count(row.cacheReadTokens ?? u.cache_read_input_tokens),
    cache_write_tokens: count(row.cacheWriteTokens ?? u.cache_creation_input_tokens)
  };
}

/**
 * serverToolsOf(row) → { web_search_requests, web_fetch_requests }. Explicit fields
 * win; then callModel's usage (web_search_requests), then Anthropic's raw
 * usage.server_tool_use.
 */
export function serverToolsOf(row = {}) {
  const u = row.usage || {};
  const st = u.server_tool_use || {};
  return {
    web_search_requests: count(row.webSearchRequests ?? u.web_search_requests ?? st.web_search_requests),
    web_fetch_requests: count(row.webFetchRequests ?? u.web_fetch_requests ?? st.web_fetch_requests)
  };
}

function cost(rates, t) {
  return round6(
    (t.input_tokens * rates.input +
      t.output_tokens * rates.output +
      t.cache_read_tokens * rates.cache_read +
      t.cache_write_tokens * rates.cache_write) / PER
  );
}

/** costUsd(model, tokens) → dollars (6 places), or null when the model's price is not known. */
export function costUsd(model, tokens) {
  const rates = Object.prototype.hasOwnProperty.call(MODEL_PRICES, String(model))
    ? MODEL_PRICES[/** @type {keyof typeof MODEL_PRICES} */ (String(model))]
    : null;
  return rates ? cost(rates, tokens) : null;
}

/**
 * callCostUsd(model, tokens, webSearches) → tokens at the model's price plus the
 * search fee, or null when the model's price is not known.
 */
export function callCostUsd(model, tokens, webSearches = 0) {
  const t = costUsd(model, tokens);
  if (t == null) return null;
  return FREE_MODELS.includes(String(model)) ? t : round6(t + count(webSearches) * WEB_SEARCH_USD);
}

/** worstCaseUsd(tokens) → what unpriced tokens count as for the cap: the highest known rate. */
export function worstCaseUsd(tokens) {
  return cost(HIGHEST_KNOWN_RATE, tokens);
}

/**
 * logUsage(db, { orgId, batchId, jobId, model, usage | inputTokens, outputTokens,
 *   cacheReadTokens, cacheWriteTokens, webSearchRequests, webFetchRequests, step })
 *   → the saved row.
 *
 * `model` must be the model that SERVED the call (callModel's servedModel), which can
 * differ from the one asked for when a refusal fallback ran. An unknown model is saved
 * with cost_usd NULL.
 *
 * Web searches (explicit webSearchRequests, else usage.web_search_requests or
 * usage.server_tool_use.web_search_requests) are saved on the row and their fee is in
 * cost_usd. `step` names the saved step of a multi-step run (migration 418).
 */
export async function logUsage(db, row = /** @type {any} */ ({})) {
  if (!row.orgId) throw new TypeError("logUsage: orgId is required");
  const model = String(row.model || "").trim();
  if (!model) throw new TypeError("logUsage: model is required (the model that served the call)");
  const t = tokensOf(row);
  const s = serverToolsOf(row);
  const usd = callCostUsd(model, t, s.web_search_requests);
  if (!s.web_search_requests && !s.web_fetch_requests && row.step == null) {
    // The original shape: a database without migration 418 still takes it.
    const r = await db.query(
      `INSERT INTO marketing_model_usage
         (org_id, batch_id, job_id, model, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [row.orgId, row.batchId || null, row.jobId || null, model,
        t.input_tokens, t.output_tokens, t.cache_read_tokens, t.cache_write_tokens,
        usd == null ? null : usd.toFixed(6)]
    );
    return r.rows[0];
  }
  const r = await db.query(
    `INSERT INTO marketing_model_usage
       (org_id, batch_id, job_id, model, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, cost_usd,
        web_search_requests, web_fetch_requests, step)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [row.orgId, row.batchId || null, row.jobId || null, model,
      t.input_tokens, t.output_tokens, t.cache_read_tokens, t.cache_write_tokens,
      usd == null ? null : usd.toFixed(6),
      s.web_search_requests, s.web_fetch_requests,
      row.step == null ? null : String(row.step).slice(0, 80)]
  );
  return r.rows[0];
}

/** A cap from settings. Missing or unreadable → the spec default, never "no cap". */
function capOf(v, fallback) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * costTotals(sums, { maxBatchUsd, maxMonthUsd, hasBatch }) → the costStatus answer. Pure.
 * sums: { batch_priced_usd, batch_null_* tokens, month_priced_usd, month_null_* tokens,
 *         unpriced_rows } as the query returns them.
 */
export function costTotals(sums, { maxBatchUsd, maxMonthUsd, hasBatch = true } = /** @type {{ maxBatchUsd?: number | string | null, maxMonthUsd?: number | string | null, hasBatch?: boolean }} */ ({})) {
  const num = (v) => (v == null ? 0 : Number(v) || 0);
  const nullTokens = (prefix) => ({
    input_tokens: num(sums[`${prefix}_null_input`]),
    output_tokens: num(sums[`${prefix}_null_output`]),
    cache_read_tokens: num(sums[`${prefix}_null_cache_read`]),
    cache_write_tokens: num(sums[`${prefix}_null_cache_write`])
  });
  const month = round6(num(sums.month_priced_usd) + worstCaseUsd(nullTokens("month")));
  const batch = hasBatch ? round6(num(sums.batch_priced_usd) + worstCaseUsd(nullTokens("batch"))) : null;
  const batchCap = capOf(maxBatchUsd, DEFAULT_MAX_BATCH_USD);
  const monthCap = capOf(maxMonthUsd, DEFAULT_MAX_MONTH_USD);
  return {
    batch_usd: batch,
    month_usd: month,
    unpriced_rows: num(sums.unpriced_rows),
    batch_capped: batch != null && batch >= batchCap,
    month_capped: month >= monthCap
  };
}

/**
 * costStatus(db, { orgId, batchId, maxBatchUsd, maxMonthUsd, now })
 *   → { batch_usd, month_usd, unpriced_rows, batch_capped, month_capped }
 *
 * batch_usd: every call logged against that batch (null when no batchId is passed).
 * month_usd: every call this org made in the current calendar month in Arizona.
 * A call with cost_usd NULL (price unknown) is counted at the HIGHEST known rate for its
 * tokens, never as free; unpriced_rows says how many were counted that way.
 * A cap is reached when spend is at or above it. A missing cap uses the spec default
 * ($40 a batch, $300 a month).
 */
export async function costStatus(db, { orgId, batchId = null, maxBatchUsd, maxMonthUsd, now } = /** @type {any} */ ({})) {
  if (!orgId) throw new TypeError("costStatus: orgId is required");
  const at = now == null ? new Date() : new Date(now);
  if (Number.isNaN(at.getTime())) throw new TypeError("costStatus: now is not a time");
  const r = await db.query(
    `WITH bounds AS (
       SELECT date_trunc('month', $3::timestamptz AT TIME ZONE '${COST_TZ}') AT TIME ZONE '${COST_TZ}' AS m0,
              (date_trunc('month', $3::timestamptz AT TIME ZONE '${COST_TZ}') + interval '1 month') AT TIME ZONE '${COST_TZ}' AS m1
     ),
     usage_rows AS (
       SELECT u.*,
              (u.created_at >= b.m0 AND u.created_at < b.m1) AS in_month,
              ($2::uuid IS NOT NULL AND u.batch_id = $2::uuid) AS in_batch
         FROM marketing_model_usage u, bounds b
        WHERE u.org_id = $1
          AND ((u.created_at >= b.m0 AND u.created_at < b.m1)
               OR ($2::uuid IS NOT NULL AND u.batch_id = $2::uuid))
     )
     SELECT
       COALESCE(sum(cost_usd) FILTER (WHERE in_month), 0)                              AS month_priced_usd,
       COALESCE(sum(input_tokens) FILTER (WHERE in_month AND cost_usd IS NULL), 0)       AS month_null_input,
       COALESCE(sum(output_tokens) FILTER (WHERE in_month AND cost_usd IS NULL), 0)      AS month_null_output,
       COALESCE(sum(cache_read_tokens) FILTER (WHERE in_month AND cost_usd IS NULL), 0)  AS month_null_cache_read,
       COALESCE(sum(cache_write_tokens) FILTER (WHERE in_month AND cost_usd IS NULL), 0) AS month_null_cache_write,
       COALESCE(sum(cost_usd) FILTER (WHERE in_batch), 0)                              AS batch_priced_usd,
       COALESCE(sum(input_tokens) FILTER (WHERE in_batch AND cost_usd IS NULL), 0)       AS batch_null_input,
       COALESCE(sum(output_tokens) FILTER (WHERE in_batch AND cost_usd IS NULL), 0)      AS batch_null_output,
       COALESCE(sum(cache_read_tokens) FILTER (WHERE in_batch AND cost_usd IS NULL), 0)  AS batch_null_cache_read,
       COALESCE(sum(cache_write_tokens) FILTER (WHERE in_batch AND cost_usd IS NULL), 0) AS batch_null_cache_write,
       count(*) FILTER (WHERE cost_usd IS NULL)::int                                    AS unpriced_rows
     FROM usage_rows`,
    [orgId, batchId || null, at.toISOString()]
  );
  return costTotals(r.rows[0] || {}, { maxBatchUsd, maxMonthUsd, hasBatch: !!batchId });
}
