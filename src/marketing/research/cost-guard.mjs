// @ts-check
// The research cost guard, pure: what a call could cost at worst, and how many calls of
// a batch fit under the caps before it starts.
//
// Design docs/specs/command-center-design-2026-10-05.md §5 safety rule 13: "The worker
// checks spend so far plus the next step's worst case before every step and every
// parallel batch; it shrinks the batch first, then stops with a plain sentence and Retry
// or Resume; a step already running can overshoot by at most that step's own calls."
// And §6 slice 10: "per-call cost reserves (output at max_tokens, searches at max_uses,
// an input estimate) settled to real usage".
//
// A RESERVE IS NOT A PRICE. It is the most one call could plausibly cost, held back
// before the call so a run never STARTS past its cap. After the call the real bill is
// written to the ledger (research/usage.mjs) and the next check reads the ledger, so
// the reserve never shows up on a screen as a cost.

import { MODEL_PRICES, HIGHEST_KNOWN_RATE } from "../model-usage.mjs";
import { SEARCH_USD } from "./usage.mjs";

/** Tokens one web search's results are assumed to add to the context (the reserve only). */
export const SEARCH_RESULT_TOKENS = 4000;

/** The server-side tool loop can read the growing context more than once. */
export const CONTEXT_REREAD = 2;

/** Characters per token for the prompt estimate (English text is about 4; 3 is cautious). */
export const CHARS_PER_TOKEN = 3;

const round6 = (n) => Math.round(n * 1_000_000) / 1_000_000;
const nonNeg = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function ratesOf(model) {
  return Object.prototype.hasOwnProperty.call(MODEL_PRICES, String(model))
    ? MODEL_PRICES[/** @type {keyof typeof MODEL_PRICES} */ (String(model))]
    : HIGHEST_KNOWN_RATE;
}

/**
 * reserveUsd({ model, promptChars, maxTokens, searches, fetches, fetchTokens }) → dollars.
 *   input   the prompt estimate plus every search result and every fetched page at its
 *           max_content_tokens, read CONTEXT_REREAD times;
 *   output  max_tokens (thinking counts toward it);
 *   fees    one cent per search the call may make (max_uses).
 * An unpriced model is reserved at the highest known rate.
 */
export function reserveUsd({ model, promptChars = 0, maxTokens = 0, searches = 0, fetches = 0, fetchTokens = 0 } = /** @type {any} */ ({})) {
  const r = ratesOf(model);
  const input = Math.ceil(nonNeg(promptChars) / CHARS_PER_TOKEN)
    + (nonNeg(searches) * SEARCH_RESULT_TOKENS + nonNeg(fetches) * nonNeg(fetchTokens)) * CONTEXT_REREAD;
  return round6((input * r.input + nonNeg(maxTokens) * r.output) / 1_000_000 + nonNeg(searches) * SEARCH_USD);
}

/**
 * fitBatch({ wanted, perCallUsd, spentUsd, runCapUsd, monthUsedUsd, monthCapUsd, holdBackUsd })
 *   → { allowed, shrunk, stop, roomUsd }
 *
 * How many of `wanted` calls (each reserved at perCallUsd) fit under BOTH caps:
 *   run    runCapUsd − holdBackUsd − spentUsd   (holdBackUsd: the write-up's reserve,
 *          kept back so a run that stops early still ends with a report)
 *   month  monthCapUsd − monthUsedUsd            (null monthCapUsd: research has its
 *          own budget, so only the run cap applies)
 * stop is 'run_cap' or 'month_cap' (whichever is tighter) when not even one call fits.
 */
export function fitBatch({ wanted, perCallUsd, spentUsd = 0, runCapUsd, monthUsedUsd = 0, monthCapUsd = null, holdBackUsd = 0 } = /** @type {any} */ ({})) {
  const want = Math.max(0, Math.floor(Number(wanted) || 0));
  const per = Math.max(0, Number(perCallUsd) || 0);
  const runRoom = Number(runCapUsd) - nonNeg(holdBackUsd) - nonNeg(spentUsd);
  const monthRoom = monthCapUsd == null ? Infinity : Number(monthCapUsd) - nonNeg(monthUsedUsd);
  const room = Math.min(runRoom, monthRoom);
  let allowed;
  if (!(room > 0)) allowed = 0;
  else if (per === 0) allowed = want;
  else allowed = Math.min(want, Math.floor(room / per + 1e-9));
  const stop = want > 0 && allowed === 0 ? (runRoom <= monthRoom ? "run_cap" : "month_cap") : null;
  return { allowed, shrunk: allowed > 0 && allowed < want, stop, roomUsd: round6(Math.max(0, room === Infinity ? 0 : room)) };
}

/** "$40", "$2.50", "$0.62" — dollars the way the page prints them. */
export function dollars(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n)) return "unknown";
  const cents = Math.round(n * 100);
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : `$${(cents / 100).toFixed(2)}`;
}

/** The plain sentence for a stop at a cap. */
export function capSentence({ stop, runCapUsd, monthCapUsd, afterStep }) {
  if (stop === "month_cap") {
    return `Stopped at the ${dollars(monthCapUsd)} month cap. Raise it in Settings or wait for next month. What it found so far is saved.`;
  }
  if (!(Number(afterStep) >= 1)) return `Stopped at the ${dollars(runCapUsd)} run cap before step 1. Nothing was spent on this run.`;
  return `Stopped at the ${dollars(runCapUsd)} run cap after step ${afterStep}. What it found so far is saved.`;
}
