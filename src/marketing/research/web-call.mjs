// @ts-check
// One research call: Claude with Anthropic's own web search and web fetch server tools,
// continued after a pause, with every link it read collected for the source checks.
//
// Design docs/specs/command-center-design-2026-10-05.md §6 "Slice 1 additions" (the
// callModel extension: server tools, a pause_turn loop that resends the paused content
// unchanged, continuations capped at 2 to 3, max_uses lowered by the searches already
// used, refusal and max_tokens as errors) and "Slice 10". Unit X2.
//
// THE TOOL VERSIONS. web_search_20260318 and web_fetch_20260318: the current versions on
// platform.claude.com/docs (web-search-tool, web-fetch-tool), read 2026-10-06. Both run
// dynamic filtering on Opus 5.5 and Sonnet 5.5 and default response_inclusion to
// "full", so every result block comes back and the source checks can see it. Fetch
// citations stay OFF (the default): with them on, the JSON answer is split around
// char_location citations the parser cannot use.
//
// TIME. Each call is capped at 270 seconds. Node's fetch drops a call that waits 300
// seconds for headers, and a worker step must finish inside its 15-minute function.
//
// Everything outside is injected (callModel), so the tests run with no network.

import { callModel as realCallModel, classifyModelFailure } from "../../agents/model.mjs";
import { collectSources, textAfterLastToolResult, parseJsonObject } from "./provenance.mjs";

export const WEB_SEARCH_TOOL = "web_search_20260318";
export const WEB_FETCH_TOOL = "web_fetch_20260318";

/** The longest one HTTP call may wait (Node's fetch gives up on headers at 300 s). */
export const CALL_TIMEOUT_MS = 270_000;

/** A paused turn is resent at most this many times. */
export const MAX_CONTINUATIONS = 2;

/** Default size limit for one fetched page, in tokens (web_fetch max_content_tokens). */
export const FETCH_MAX_TOKENS = 12_000;

export const WRITER_MODEL = "claude-opus-5-5";
export const SEARCHER_MODEL = "claude-sonnet-5-5";

/**
 * The model that searches and checks: claude-sonnet-5-5, or MARKETING_RESEARCH_MODEL when
 * it names a Claude model (design §7 question 6: "one env name flips the sweeps to Opus if
 * the first run comes back thin"). Anything else is ignored, never sent.
 */
export function searcherModel(env = process.env) {
  const v = env && typeof env.MARKETING_RESEARCH_MODEL === "string" ? env.MARKETING_RESEARCH_MODEL.trim() : "";
  return /^claude-[a-z0-9-]+$/.test(v) && !v.includes("*") ? v : SEARCHER_MODEL;
}

/** The tool list for a call that may search `searches` times and fetch `fetches` pages. */
export function webTools({ searches = 0, fetches = 0, fetchMaxTokens = FETCH_MAX_TOKENS } = {}) {
  const tools = [];
  if (searches > 0) tools.push({ type: WEB_SEARCH_TOOL, name: "web_search", max_uses: Math.floor(searches) });
  if (fetches > 0) tools.push({ type: WEB_FETCH_TOOL, name: "web_fetch", max_uses: Math.floor(fetches), max_content_tokens: Math.floor(fetchMaxTokens) });
  return tools;
}

const NO_KEY = "No Anthropic key is set on the site. An agent must set it.";
const SEARCH_OFF = "Web search is turned off for our Anthropic account. One click turns it on: https://platform.claude.com/settings/capabilities.";

/**
 * plainError(error) → { plain, final, temporary }: what a failed call means in words, and
 * whether trying again could help. final = waiting will not fix it (no key, search off,
 * a malformed request); temporary = rate limit, a vendor 5xx, no answer.
 */
export function plainError(error) {
  const text = String(error || "");
  if (/ANTHROPIC_API_KEY is (not set|masked)/.test(text)) return { plain: NO_KEY, final: true, temporary: false };
  if (/^anthropic 400/.test(text) && /web.?search/i.test(text) && /(not enabled|disabled|turned off)/i.test(text)) {
    return { plain: SEARCH_OFF, final: true, temporary: false };
  }
  if (/^refused:/.test(text)) return { plain: "Claude declined this request.", final: true, temporary: false };
  if (/^cut off:/.test(text)) return { plain: "The answer was cut off before it finished.", final: false, temporary: false };
  if (/^anthropic timeout/.test(text)) return { plain: "Claude took too long to answer.", final: false, temporary: true };
  const c = classifyModelFailure({ error: text });
  if (c.temporary) {
    const why = c.reason === "no_credit" ? "The Anthropic account is out of credit."
      : c.reason === "rate_limited" ? "Anthropic said to slow down."
        : c.reason === "server_error" ? "Anthropic had a problem on its side."
          : "Anthropic could not be reached.";
    return { plain: why, final: false, temporary: true };
  }
  if (/^not sent: /.test(text)) return { plain: `The request was not sent: ${text.slice(10, 200)}`, final: true, temporary: false };
  return { plain: `Anthropic refused the request: ${text.slice(0, 200)}`, final: true, temporary: false };
}

const ZERO_USAGE = () => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

/**
 * researchCall(opts) → {
 *   ok, error, plain, final, temporary,
 *   text,        // the words after the last tool result, joined with no separator
 *   json,        // the parsed object (outputSchema reply, or the JSON in `text`), or null
 *   blocks,      // every content block from every continuation, in order
 *   calls,       // [{ model, usage, searches, fetches }] — one per HTTP call, for the ledger
 *   searches, fetches, continuations, stopReason, servedModel,
 *   sources      // collectSources(blocks)
 * }
 *
 * opts: { callModel?, env, model, system, prompt | content, searches, fetches,
 *         fetchMaxTokens, maxTokens, effort, timeoutMs, maxContinuations, outputSchema }
 * `searches` is this call's whole search budget across continuations: each resend lowers
 * max_uses by what was already used, and a call that has used them all is not resent.
 */
export async function researchCall(opts = /** @type {any} */ ({})) {
  const call = typeof opts.callModel === "function" ? opts.callModel : realCallModel;
  const maxCont = opts.maxContinuations == null ? MAX_CONTINUATIONS : Math.max(0, Math.floor(opts.maxContinuations));
  const searchBudget = Math.max(0, Math.floor(Number(opts.searches) || 0));
  const fetchBudget = Math.max(0, Math.floor(Number(opts.fetches) || 0));
  const user = { role: "user", content: opts.content != null ? opts.content : String(opts.prompt || "") };

  /** @type {any[]} */ const blocks = [];
  /** @type {any[]} */ const calls = [];
  let searches = 0;
  let fetches = 0;
  let continuations = 0;
  let last = null;
  /** @type {any[]} */ let pausedContent = [];

  for (;;) {
    const tools = webTools({
      searches: searchBudget - searches,
      fetches: fetchBudget - fetches,
      fetchMaxTokens: opts.fetchMaxTokens || FETCH_MAX_TOKENS
    });
    const messages = pausedContent.length ? [user, { role: "assistant", content: pausedContent }] : [user];
    last = await call({
      provider: "anthropic",
      env: opts.env || process.env,
      model: opts.model,
      system: opts.system,
      messages,
      tools: tools.length ? tools : undefined,
      maxTokens: opts.maxTokens,
      effort: opts.effort || "medium",
      timeoutMs: Math.min(Number(opts.timeoutMs) || CALL_TIMEOUT_MS, CALL_TIMEOUT_MS),
      outputSchema: tools.length ? undefined : opts.outputSchema
    });
    const st = last && last.serverToolUse ? last.serverToolUse : { web_search_requests: 0, web_fetch_requests: 0 };
    const usage = last && last.usage ? last.usage : ZERO_USAGE();
    const answered = last && last.mode === "live" && (last.status != null || last.raw != null);
    if (answered) {
      calls.push({
        model: last.servedModel || opts.model,
        usage,
        searches: st.web_search_requests || 0,
        fetches: st.web_fetch_requests || 0
      });
    }
    searches += st.web_search_requests || 0;
    fetches += st.web_fetch_requests || 0;
    const content = Array.isArray(last && last.content) ? last.content : [];
    blocks.push(...content);

    if (last && last.error) {
      const p = plainError(last.error);
      return {
        ok: false, error: String(last.error), ...p,
        text: "", json: null, blocks, calls, searches, fetches, continuations,
        stopReason: last.stopReason || null, servedModel: last.servedModel || null,
        sources: collectSources(blocks)
      };
    }
    if (last && last.stopReason === "pause_turn" && continuations < maxCont && (searchBudget === 0 || searches < searchBudget || fetches < fetchBudget)) {
      continuations += 1;
      pausedContent = [...pausedContent, ...content];
      continue;
    }
    break;
  }

  const text = textAfterLastToolResult(blocks);
  const json = last && last.json && typeof last.json === "object" ? last.json : parseJsonObject(text);
  return {
    ok: true, error: null, plain: null, final: false, temporary: false,
    text, json, blocks, calls, searches, fetches, continuations,
    stopReason: (last && last.stopReason) || null,
    servedModel: (last && last.servedModel) || null,
    sources: collectSources(blocks)
  };
}
