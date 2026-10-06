// @ts-check
// The avatar run's plan: its 10 saved steps, the models, the search ceiling and the
// cost guard. Pure: no database, no network, no clock.
//
// Design docs/specs/command-center-design-2026-10-05.md §6 slice 5a ("10 saved steps on
// the worker: foundation -> overview -> up to 4 rounds of 5 parallel web-search calls for
// buyer quotes, one per source family -> sort the quotes and name the mechanism -> merge
// the word bank in code -> new-information research with web fetch capped at 3 uses ->
// assemble the facts -> write the avatar -> check and repair -> save"), §5 rule 13 (cost
// caps in code: spend so far plus the next step's worst case, before every step and every
// parallel batch; shrink the batch first, then stop) and §5 rule 18 (a step is paid for
// once). Owner question §7.6, recommended default: Opus 5.5 writes, Sonnet 5.5 searches
// and checks; MARKETING_RESEARCH_MODEL flips the searches and checks to another model.

import { MODEL_PRICES, HIGHEST_KNOWN_RATE, WEB_SEARCH_USD } from "../model-usage.mjs";
import { DESIRE_SOURCES, INFO_SOURCES } from "./prompts.mjs";

/** The job kind on marketing_jobs. */
export const AVATAR_KIND = "avatar";

/** The 10 saved steps, in order. `word` finishes "Running: step N of 10, …". */
export const STEPS = Object.freeze([
  { key: "foundation", n: 1, word: "writing down the business facts" },
  { key: "overview", n: 2, word: "turning the facts into what the buyer wants" },
  { key: "quotes", n: 3, word: "searching the web for buyer quotes" },
  { key: "sort", n: 4, word: "sorting the quotes and naming the mechanism" },
  { key: "word_bank", n: 5, word: "adding the new quotes to the word bank" },
  { key: "new_info", n: 6, word: "looking on the web for new facts" },
  { key: "facts", n: 7, word: "putting the new facts together" },
  { key: "avatar", n: 8, word: "writing the avatar" },
  { key: "check", n: 9, word: "checking and fixing the avatar" },
  { key: "save", n: 10, word: "saving it to the repo" }
].map((s) => Object.freeze(s)));

export const STEPS_TOTAL = STEPS.length;
export const DONE_STEP = "done";
export const FIRST_STEP = STEPS[0].key;

/** @param {string} key */
export function stepOf(key) {
  return STEPS.find((s) => s.key === key) || null;
}

/** The step after this one, or "done". */
export function nextStep(key) {
  const i = STEPS.findIndex((s) => s.key === key);
  return i >= 0 && i + 1 < STEPS.length ? STEPS[i + 1].key : DONE_STEP;
}

/* ── models ── */

export const WRITE_MODEL = "claude-opus-5-5";
export const DEFAULT_RESEARCH_MODEL = "claude-sonnet-5-5";

/** The model that searches and checks: MARKETING_RESEARCH_MODEL when it names a Claude model. */
export function researchModel(env = process.env) {
  const m = String((env && env.MARKETING_RESEARCH_MODEL) || "").trim();
  return /^claude-[a-z0-9-]+$/.test(m) ? m : DEFAULT_RESEARCH_MODEL;
}

/* ── searches ── */

export const DESIRE_ROUNDS_MAX = 4;
export const DRY_ROUNDS_TO_STOP = 2;
export const SEARCHES_PER_CALL = 8;
export const FETCHES_PER_INFO_CALL = 3;
/** A family that fails this many times is skipped for the rest of its round. */
export const FAMILY_TRIES = 2;

/** The most searches one run can make: 4 rounds x 5 families x 8, plus 3 info calls x 8. */
export const RUN_SEARCH_CEILING =
  DESIRE_ROUNDS_MAX * DESIRE_SOURCES.length * SEARCHES_PER_CALL + INFO_SOURCES.length * SEARCHES_PER_CALL;

/** Searches held back for step 6 while the quote rounds run. */
export const INFO_SEARCH_RESERVE = INFO_SOURCES.length * SEARCHES_PER_CALL;

/**
 * How many searches each of `calls` parallel calls may make now, given what the run
 * already used and what later steps still need. 0 means the run's searches are spent.
 */
export function searchesPerCall({ used, calls, reserve = 0 }) {
  const left = RUN_SEARCH_CEILING - Math.max(0, used) - Math.max(0, reserve);
  if (calls <= 0 || left <= 0) return 0;
  return Math.max(0, Math.min(SEARCHES_PER_CALL, Math.floor(left / calls)));
}

/* ── the cost guard ── */

/** The default per-run stop amount for the avatar (marketing_settings.run_caps.avatar). */
export const DEFAULT_RUN_CAP_USD = 20;

/**
 * Each kind of call: model role, output ceiling, effort, searches and an input
 * estimate (tokens). The input estimate is a reserve, not a price: search results are
 * read back on every server-side search turn, so it is set high on purpose. Real usage
 * replaces it as soon as the call answers (the ledger row).
 */
export const CALL_SHAPES = Object.freeze({
  write: Object.freeze({ role: "write", maxTokens: 16000, effort: "high", inputTokens: 25000, searches: 0 }),
  write_long: Object.freeze({ role: "write", maxTokens: 32000, effort: "high", inputTokens: 60000, searches: 0 }),
  search: Object.freeze({ role: "research", maxTokens: 8000, effort: "medium", inputTokens: 150000, searches: SEARCHES_PER_CALL }),
  info: Object.freeze({ role: "research", maxTokens: 8000, effort: "medium", inputTokens: 250000, searches: SEARCHES_PER_CALL }),
  verify: Object.freeze({ role: "research", maxTokens: 6000, effort: "medium", inputTokens: 40000, searches: 0 })
});

/** The calls each step makes (a quote round and step 6 are parallel batches). */
export const STEP_CALLS = Object.freeze({
  foundation: ["write"],
  overview: ["write"],
  quotes: DESIRE_SOURCES.map(() => "search"),
  sort: ["write", "write"],
  word_bank: [],
  new_info: INFO_SOURCES.map(() => "info"),
  facts: ["write"],
  avatar: ["write_long"],
  check: ["verify", "verify", "write_long"],
  save: []
});

/** The worst a call of this shape can cost, in dollars. */
export function worstCallUsd(shapeKey, env = process.env) {
  const shape = CALL_SHAPES[/** @type {keyof typeof CALL_SHAPES} */ (shapeKey)];
  if (!shape) return 0;
  const model = shape.role === "write" ? WRITE_MODEL : researchModel(env);
  const p = Object.prototype.hasOwnProperty.call(MODEL_PRICES, model)
    ? MODEL_PRICES[/** @type {keyof typeof MODEL_PRICES} */ (model)]
    : HIGHEST_KNOWN_RATE;
  const usd = (shape.inputTokens * p.input + shape.maxTokens * p.output) / 1_000_000 + shape.searches * WEB_SEARCH_USD;
  return Math.round(usd * 1e6) / 1e6;
}

/** The worst a whole run can cost (every step, every round). */
export function worstRunUsd(env = process.env) {
  let total = 0;
  for (const [step, calls] of Object.entries(STEP_CALLS)) {
    const times = step === "quotes" ? DESIRE_ROUNDS_MAX : 1;
    for (const c of calls) total += worstCallUsd(c, env) * times;
  }
  return Math.round(total * 100) / 100;
}

/** "$20" / "$1.84" — whole dollars print with no cents. */
export function dollars(n) {
  if (n == null || n === "") return "unknown";
  const v = Number(n);
  if (!Number.isFinite(v)) return "unknown";
  return Number.isInteger(v) ? `$${v.toLocaleString("en-US")}` : `$${v.toFixed(2)}`;
}

/**
 * fitCalls({ spentUsd, perCallUsd, calls, runCapUsd, monthUsedUsd, monthCapUsd }) →
 *   { fit, stop: null | { cap: 'run' | 'month', capUsd } }
 *
 * How many of `calls` (each costing up to perCallUsd) fit under both caps right now.
 * fit === calls: run them all. 0 < fit < calls: shrink the batch. fit === 0: stop,
 * and `stop` names the cap that stopped it (the run cap is checked first).
 */
export function fitCalls({ spentUsd, perCallUsd, calls, runCapUsd, monthUsedUsd, monthCapUsd }) {
  const per = Math.max(0, Number(perCallUsd) || 0);
  if (calls <= 0) return { fit: 0, stop: null };
  const room = (cap, used) => (cap == null ? Infinity : Number(cap) - (Number(used) || 0));
  const runRoom = room(runCapUsd, spentUsd);
  const monthRoom = room(monthCapUsd, monthUsedUsd);
  if (per === 0) {
    if (runRoom < 0) return { fit: 0, stop: { cap: "run", capUsd: Number(runCapUsd) } };
    if (monthRoom < 0) return { fit: 0, stop: { cap: "month", capUsd: Number(monthCapUsd) } };
    return { fit: calls, stop: null };
  }
  const byRun = Math.floor(runRoom / per);
  const byMonth = Math.floor(monthRoom / per);
  const fit = Math.max(0, Math.min(calls, byRun, byMonth));
  if (fit > 0) return { fit, stop: null };
  return byRun <= 0
    ? { fit: 0, stop: { cap: "run", capUsd: Number(runCapUsd) } }
    : { fit: 0, stop: { cap: "month", capUsd: Number(monthCapUsd) } };
}

/** The plain sentence a cap stop prints on the row (design §3.2 empty and error states). */
export function capStopSentence({ cap, capUsd, afterStep }) {
  if (cap === "month") {
    return `Stopped at the ${dollars(capUsd)} month cap. What it found so far is saved. Raise it in Settings or wait for next month.`;
  }
  const after = afterStep > 0 ? ` after step ${afterStep}` : " before step 1";
  return `Stopped at the ${dollars(capUsd)} run cap${after}. What it found so far is saved. Raise the cap in Settings and tap Retry to finish.`;
}
