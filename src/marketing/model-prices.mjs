// Model list prices, so a measured run can be said in dollars.
//
// ONLY PRICES WITH A SOURCE. Each row names where its number came from. A model
// that is not listed has no price on file here, and any cost line that needs it
// prints "unknown" — it is never filled in with a nearby model's price, and never
// guessed (Command Center design §5 rule 3: "No constant, no guess").
//
//   claude-opus-5-5   $4 per million input tokens, $20 per million output.
//                     Anthropic's published list price (the claude-api model
//                     table, cached 2026-09-25). The same rate
//                     docs/specs/marketing-offer-contract.md used for its one
//                     measured offer run.
//
// Not listed on purpose, because no price for them is written down anywhere this
// repo can point at: claude-sonnet-4-5-20250929 (the copy writer's default,
// src/agents/model.mjs DEFAULT_MODEL) and gpt-4o-mini (the OpenAI default). Add a
// row only with its source beside it.
//
// Money is integer cents (CLAUDE.md §12). The sum is kept exact until the end and
// rounded once.

export const MODEL_PRICES = Object.freeze({
  "claude-opus-5-5": Object.freeze({ inCentsPerMTok: 400, outCentsPerMTok: 2000 })
});

/** The price row for a model name, or null when none is on file. Exact name only. */
export function priceOf(model) {
  if (typeof model !== "string" || !model) return null;
  return Object.prototype.hasOwnProperty.call(MODEL_PRICES, model) ? MODEL_PRICES[model] : null;
}

function tokens(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * costOfCalls(calls) → { cents, exact_cents, unpriced }
 *
 * calls: [{ model, input_tokens, output_tokens }]. When every call's model has a
 * price, cents is the total rounded to whole cents and exact_cents keeps the
 * fraction (so "under 1 cent" can be told from a measured 0). When any call's
 * model has none, cents and exact_cents are null and `unpriced` names the
 * models — a partial total would be a smaller number than the truth.
 */
export function costOfCalls(calls) {
  const list = Array.isArray(calls) ? calls : [];
  const unpriced = new Set();
  let exact = 0;
  for (const c of list) {
    const p = priceOf(c && c.model);
    if (!p) { unpriced.add((c && c.model) || "a model with no name recorded"); continue; }
    exact += (tokens(c.input_tokens) * p.inCentsPerMTok + tokens(c.output_tokens) * p.outCentsPerMTok) / 1_000_000;
  }
  if (!list.length || unpriced.size) {
    return { cents: null, exact_cents: null, unpriced: [...unpriced] };
  }
  return { cents: Math.round(exact), exact_cents: exact, unpriced: [] };
}

export default { MODEL_PRICES, priceOf, costOfCalls };
