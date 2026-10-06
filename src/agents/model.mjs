// Model call — OpenAI Chat Completions first, Anthropic Messages as fallback.
//
// Owner-set (2026-08-25): use OPENAI_API_KEY for now. COMPANY_BRAIN_OPENAI_API_KEY
// is accepted as the same key (embeddings already read it). ANTHROPIC_API_KEY
// still works when no OpenAI key is set. PDF/document media stays on Anthropic
// when that key is present, because that path already knows documents.
//
// With no key, callModel() returns a shadow result: nothing is sent, nothing
// throws, and the caller logs the would-be request.
//
// FORCED CLAUDE (added 2026-10-05, marketing machine spec §6 step 4, §4 trap 8).
// Pass `provider: "anthropic"` and the call goes to Anthropic and nowhere else:
// no OpenAI first, no gpt-4o-mini swap, no masked key quietly skipped. That path
// also takes timeoutMs, cache, effort, outputSchema, tools/toolChoice and
// fallbacks — see callAnthropicForced below. Without `provider`, everything in
// this file behaves exactly as it did before (the old callers depend on it).
//
// No new npm dependency — raw fetch, same posture as src/messaging/providers/*.

export const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_MAX_TOKENS = 600;

// ── Forced-Claude defaults ──────────────────────────────────────────────────
// Facts below are from the claude-api skill (model table cached 2026-09-25):
//   * claude-opus-5-5 is the current default model.
//   * Thinking cannot be turned off on Opus 5.5 and counts toward max_tokens,
//     so 600 cuts replies off. The skill's non-streaming default is ~16000.
//   * Opus 5.5's own effort default is "medium" (one level below Opus 5), so
//     effort is always sent, never left to the vendor's default.
//   * The SDKs' own request timeout is 10 minutes; a call with no timer at all
//     could hold a 15-minute background worker until Netlify kills it.
//   * `fallbacks: "default"` (beta header server-side-fallback-2026-07-01)
//     re-runs a classifier refusal on the model Anthropic picks for that
//     category. Only these four models take it; any other model would 400.
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 16000;
export const DEFAULT_ANTHROPIC_TIMEOUT_MS = 600_000;
export const DEFAULT_EFFORT = "medium";
export const EFFORT_LEVELS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
export const FALLBACK_DEFAULT_BETA = "server-side-fallback-2026-07-01";
export const FALLBACK_MODELS = Object.freeze([
  "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"
]);

/** Plain error when outputSchema was asked for and the reply did not parse. */
export const MODEL_NO_JSON = "no_json";
/** Plain error when tools were offered (choice auto) and none was called. */
export const MODEL_NO_TOOL_CALL = "no_tool_call";
/** Every refusal made here, before any request, starts with these words. */
export const MODEL_NOT_SENT = "not sent: ";

// ── WHY A FAILURE IS CLASSIFIED AND NOT JUST REPORTED ──────────────────────
//
// Measured 2026-09-16 on the live walk: eight document reads in a row came back
// `openai 429: {"error":{"message":"You have no credits remaining..."}}`. Every
// caller treated that exactly like "the model read the file and said nothing" —
// one error string, no verdict, done. An empty wallet is not a verdict and it is
// not permanent: it is "not right now". Something has to be able to tell those
// two apart before anything can try again on its own.
//
// Same shape as src/company-brain/transcribe.mjs isWhisperCreditsError, which
// has classified the identical 429 on the Whisper path since 2026-08. Kept here
// rather than imported from there because that module is about audio files and
// this one is about the chat/vision call — the two happen to share a vendor.
export const MODEL_NO_CREDIT = "no_credit";
export const MODEL_RATE_LIMITED = "rate_limited";
export const MODEL_SERVER_ERROR = "server_error";
export const MODEL_UNREACHABLE = "unreachable";

const NO_CREDIT_TEXT =
  /insufficient_quota|no credits remaining|exceeded your current quota|check your plan and billing|credit balance is too low|billing_hard_limit|quota_exceeded/;

/** The `openai 429: …` / `anthropic 400: …` prefix callOpenAI and callAnthropic write. */
function statusFromErrorText(text) {
  const m = /^\s*(?:openai|anthropic)\s+(\d{3})\s*:/i.exec(String(text || ""));
  return m ? Number(m[1]) : null;
}

/**
 * classifyModelFailure({ status, error }) → { temporary, reason, status }
 *
 * temporary:true means "try this again later and it may well work" — an empty
 * wallet, a rate limit, a vendor 5xx, or a call that never reached the vendor.
 * temporary:false means the answer will not change by waiting (a 401 on a bad
 * key, a 400 on a malformed request), or there was no failure at all.
 *
 * NEVER guesses on behalf of the caller. A caller that cannot wait is free to
 * treat a temporary failure as final; what it must not do is treat a temporary
 * failure as an ANSWER.
 */
export function classifyModelFailure({ status = null, error = null } = {}) {
  const text = String(error == null ? "" : error);
  if (!text && status == null) return { temporary: false, reason: null, status: null };

  // Refused here before anything was sent (no key, a forced tool choice, a bad
  // argument). Waiting will not fix it, and no vendor was ever reached, so it
  // must not read as "unreachable". Only the provider:'anthropic' path writes
  // these words; no older error string starts with them.
  if (text.startsWith(MODEL_NOT_SENT)) return { temporary: false, reason: null, status: null };

  const code = Number(status) || statusFromErrorText(text) || null;
  const lower = text.toLowerCase();

  if (NO_CREDIT_TEXT.test(lower)) {
    return { temporary: true, reason: MODEL_NO_CREDIT, status: code };
  }
  if (code === 429) return { temporary: true, reason: MODEL_RATE_LIMITED, status: 429 };
  if (code != null && code >= 500) return { temporary: true, reason: MODEL_SERVER_ERROR, status: code };
  // No HTTP status at all means the request never got an answer — fetch threw,
  // DNS failed, the socket timed out. Bounded retries are the right response;
  // the caller's attempt ceiling is what stops a genuine code fault looping.
  if (code == null) return { temporary: true, reason: MODEL_UNREACHABLE, status: null };
  return { temporary: false, reason: null, status: code };
}

// A MASKED KEY IS NOT A KEY. Measured 2026-09-17: the live OPENAI_API_KEY was the
// blanked-out form of one — sixteen asterisks and four characters, i.e. what the
// screen shows when a password is hidden. Someone copied the mask instead of the
// value. OpenAI answered it with 401. That alone would be a small fault, but because
// SOMETHING was set, liveModelProvider() below returned "openai" and the valid
// Anthropic key was never reached — so Social Studio's "Write 3 posts for me" wrote
// nothing, and Company Brain took the same 401s silently.
//
// A real OpenAI key never contains an asterisk, so a value carrying one is a mask and
// is treated here as not set. The stored value is left exactly where it is: owner rule,
// CLAUDE.md §11 "Never remove a key" — we route around a bad credential, we never
// delete one.
function isMasked(value) {
  return String(value).includes("*");
}

function openaiKeyOf(env) {
  if (!env) return null;
  const key = env.OPENAI_API_KEY || env.COMPANY_BRAIN_OPENAI_API_KEY || null;
  if (!key || isMasked(key)) return null;
  return key;
}

/**
 * Which live vendor callModel will use for a text turn.
 * OpenAI wins when its key is set (owner: use OpenAI for now).
 */
export function liveModelProvider(env = process.env) {
  if (openaiKeyOf(env)) return "openai";
  if (env && env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

function openaiModelName(requested, env) {
  const override = env && env.OPENAI_MODEL;
  if (override) return String(override);
  const m = String(requested || "");
  if (/^gpt-|^o[1-9]|^chatgpt-/i.test(m)) return m;
  return DEFAULT_OPENAI_MODEL;
}

function openaiBaseUrl(env) {
  return String((env && env.OPENAI_API_BASE) || "https://api.openai.com").replace(/\/+$/, "");
}

function hasDocumentMedia(mediaParts) {
  return (mediaParts || []).some((m) => {
    const mediaType = (m && (m.mediaType || m.media_type)) || "";
    return (m && m.type === "document") || mediaType === "application/pdf";
  });
}

function pickProvider(env, mediaParts) {
  const openai = openaiKeyOf(env);
  const anthropic = env && env.ANTHROPIC_API_KEY;
  if (hasDocumentMedia(mediaParts) && anthropic) return "anthropic";
  if (openai) return "openai";
  if (anthropic) return "anthropic";
  return null;
}

/**
 * callModel({ system, user, env?, fetchImpl?, model?, maxTokens?, media? })
 * → {
 *     mode: 'live' | 'shadow',
 *     text: string | null,          // assistant reply (synthetic marker when keyless)
 *     raw: object | null,
 *     request: { model, system, user, max_tokens },
 *     error: string | null
 *   }
 *
 * With `provider: 'anthropic'` the call is forced onto Claude and takes more
 * options (timeoutMs, cache, effort, outputSchema, tools, toolChoice,
 * fallbacks); the result then also carries json, toolInput, stopReason,
 * servedModel and the full Anthropic usage. See callAnthropicForced.
 * Without `provider`, nothing about this function changed.
 */
export async function callModel(args = {}) {
  if (args && args.provider != null) return callAnthropicForced(args);
  return callModelDefault(args);
}

async function callModelDefault({
  system, user, env = process.env, fetchImpl = globalThis.fetch,
  model = DEFAULT_MODEL, maxTokens = DEFAULT_MAX_TOKENS,
  media = []
} = {}) {
  const mediaParts = Array.isArray(media) ? media.filter(Boolean) : [];
  const provider = pickProvider(env, mediaParts);
  const request = {
    model: provider === "openai" ? openaiModelName(model, env) : model,
    system: String(system || ""),
    user: String(user || ""),
    max_tokens: maxTokens,
    media_count: mediaParts.length,
    provider: provider || null
  };

  if (!provider) {
    // Intended reply is unavailable without a key — still return a non-empty
    // shadow body so agent_shadow_log is inspectable (empty log = unverifiable).
    const inbound = String(user || "").slice(0, 280);
    return {
      mode: "shadow",
      text: `[SHADOW — no API key] Model was not called. Inbound: ${inbound || "(empty)"}`,
      raw: null,
      request,
      error: null,
      detail: "no live model key — shadow mode, no model call",
      usage: { input_tokens: 0, output_tokens: 0 }
    };
  }

  if (typeof fetchImpl !== "function") {
    return {
      mode: "shadow",
      text: null,
      raw: null,
      request,
      error: "fetch unavailable",
      detail: "no fetch implementation",
      usage: { input_tokens: 0, output_tokens: 0 }
    };
  }

  try {
    if (provider === "openai") {
      return await callOpenAI({ env, fetchImpl, request, mediaParts });
    }
    return await callAnthropic({ env, fetchImpl, request, mediaParts });
  } catch (err) {
    return {
      mode: "live",
      text: null,
      raw: null,
      request,
      // No status: the call never reached the vendor. classifyModelFailure
      // reads that as temporary, which is what a dropped socket is.
      status: null,
      error: String((err && err.message) || err).slice(0, 300),
      usage: { input_tokens: 0, output_tokens: 0 }
    };
  }
}

async function callOpenAI({ env, fetchImpl, request, mediaParts }) {
  const key = openaiKeyOf(env);
  const userContent = buildOpenAIUserContent(request.user, mediaParts);
  const messages = [];
  if (request.system) messages.push({ role: "system", content: request.system });
  messages.push({ role: "user", content: userContent });

  const res = await fetchImpl(`${openaiBaseUrl(env)}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.max_tokens,
      messages
    })
  });

  const raw = await res.json().catch(() => null);
  const usage = usageOf(raw);
  if (!res.ok) {
    return {
      mode: "live",
      text: null,
      raw,
      request,
      // The status travels with the error. Reading "429" back out of a message
      // string works until the message changes; the number does not.
      status: res.status,
      error: `openai ${res.status}: ${JSON.stringify(raw).slice(0, 300)}`,
      usage
    };
  }

  const text = extractText(raw);
  return { mode: "live", text, raw, request, error: null, usage };
}

async function callAnthropic({ env, fetchImpl, request, mediaParts }) {
  const key = env.ANTHROPIC_API_KEY;
  const userContent = buildUserContent(request.user, mediaParts);
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.max_tokens,
      system: request.system,
      messages: [{ role: "user", content: userContent }]
    })
  });

  const raw = await res.json().catch(() => null);
  const usage = usageOf(raw);
  if (!res.ok) {
    return {
      mode: "live",
      text: null,
      raw,
      request,
      status: res.status,
      error: `anthropic ${res.status}: ${JSON.stringify(raw).slice(0, 300)}`,
      usage
    };
  }

  const text = extractText(raw);
  return { mode: "live", text, raw, request, error: null, usage };
}

// ── FORCED CLAUDE: callModel({ provider: 'anthropic', ... }) ────────────────
//
// WHY IT EXISTS. The default path above answers "which vendor has a key?" and
// picks OpenAI first. The marketing machine's writer has to run on Claude, with
// a schema it can trust, a timer, a cache and a cost it can log. Until now the
// only way to force Claude was to hand callModel an env holding just the
// Anthropic key (src/ad-videos/match.mjs, src/marketing/offer-transport.mjs);
// that still works and is left alone.
//
// WHAT IT NEVER SENDS. Request shapes come from the claude-api skill (cache
// 2026-09-25), "Migrating to Claude Opus 5.5":
//   * no `thinking` field at all — {type:"disabled"} and budget_tokens are
//     HTTP 400 on Opus 5.5; effort is the only control;
//   * no temperature / top_p / top_k — HTTP 400 on the current models;
//   * no assistant prefill — HTTP 400; outputSchema replaces it;
//   * no forced tool_choice ({type:"any"} or {type:"tool"}) — HTTP 400 on
//     claude-opus-5-5 and claude-sonnet-5-5. It is refused HERE, before any
//     call, so a caller finds out in a test and not on a live run.
//
// WHAT COMES BACK. The old result shape, plus:
//   json        — the parsed reply when outputSchema was given
//   toolInput   — the input of the first tool_use block when tools were given
//   stopReason  — Anthropic's stop_reason
//   servedModel — response.model: the model that actually answered. With a
//                 refusal fallback this is NOT the model asked for, and the
//                 cost log has to price the one that ran.
//   usage       — input, output, cache read and cache write tokens
//   status      — the HTTP status whenever a reply came back
//   content     — the reply's whole content array (every block, in order)
//   serverToolUse — {web_search_requests, web_fetch_requests} from
//                 usage.server_tool_use (0 when the call used no server tool)
// Errors are plain words. Anything refused before sending starts "not sent: ".
//
// SERVER TOOLS AND CONTINUATIONS (added 2026-10-06 for the research jobs, design
// docs/specs/command-center-design-2026-10-05.md §6 "Slice 1 additions"):
//   * a tool with a `type` and no input_schema (web_search_20260318,
//     web_fetch_20260318) is an Anthropic server tool and is sent exactly as given;
//     only client tools get the strict schema treatment and the "no tool call" check;
//   * `messages` replaces `user` when given, so a caller can resend a paused turn
//     (stop_reason "pause_turn") unchanged — the caller owns that loop;
//   * `system` may be a list of content blocks (cache marks the last one).
// pause_turn is NOT an error here: the reply comes back with stopReason
// "pause_turn" and its content, and the caller decides whether to continue.

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

function emptyAnthropicUsage() {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
}

function anthropicUsageOf(raw) {
  const u = (raw && raw.usage) || {};
  const n = (v) => Math.max(0, Number(v) || 0);
  return {
    input_tokens: n(u.input_tokens),
    output_tokens: n(u.output_tokens),
    cache_read_input_tokens: n(u.cache_read_input_tokens),
    cache_creation_input_tokens: n(u.cache_creation_input_tokens)
  };
}

/** usage.server_tool_use as two whole numbers (searches are billed, fetches are not). */
function serverToolUseOf(raw) {
  const s = (raw && raw.usage && raw.usage.server_tool_use) || {};
  const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
  return { web_search_requests: n(s.web_search_requests), web_fetch_requests: n(s.web_fetch_requests) };
}

/** An Anthropic server tool: has a `type` (web_search_20260318, …) and no input_schema. */
function isServerTool(t) {
  return isPlainObject(t) && typeof t.type === "string" && t.type !== "custom" && !isPlainObject(t.input_schema);
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** 'auto' | 'none' | {type:'auto'|'none'} → the wire form, or { error }. */
function toolChoiceOf(choice) {
  if (choice == null) return { type: "auto" };
  const type = typeof choice === "string" ? choice : (isPlainObject(choice) ? choice.type : undefined);
  if (type === "auto" || type === "none") {
    const out = { type };
    if (type === "auto" && isPlainObject(choice) && choice.disable_parallel_tool_use === true) {
      out.disable_parallel_tool_use = true;
    }
    return out;
  }
  return {
    error: `${MODEL_NOT_SENT}toolChoice ${JSON.stringify(choice)} forces a tool call. ` +
      "Forced tool use ('any' or a named tool) is HTTP 400 on claude-opus-5-5 and " +
      "claude-sonnet-5-5. Use 'auto' and name the tool in the prompt, or use outputSchema."
  };
}

/**
 * Strict tool schemas need additionalProperties:false and a required list on
 * every object (claude-api skill, "Strict tool use"). Missing required lists
 * are filled with every property. Returns a copy; the caller's schema is
 * never changed.
 */
function strictSchema(node) {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (!isPlainObject(node)) return node;
  const out = { ...node };
  if (isPlainObject(out.properties)) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([k, v]) => [k, strictSchema(v)])
    );
  }
  if (out.type === "object" || isPlainObject(out.properties)) {
    out.additionalProperties = false;
    if (!Array.isArray(out.required)) out.required = Object.keys(out.properties || {});
  }
  if (out.items !== undefined) out.items = strictSchema(out.items);
  for (const k of ["anyOf", "allOf", "oneOf"]) {
    if (Array.isArray(out[k])) out[k] = out[k].map(strictSchema);
  }
  for (const k of ["$defs", "definitions"]) {
    if (isPlainObject(out[k])) {
      out[k] = Object.fromEntries(Object.entries(out[k]).map(([name, v]) => [name, strictSchema(v)]));
    }
  }
  return out;
}

function strictTool(tool) {
  const out = { name: String(tool.name) };
  if (tool.description) out.description = String(tool.description);
  out.input_schema = strictSchema({ type: "object", ...tool.input_schema });
  out.strict = true;
  return out;
}

/** The parsed reply, or undefined when there is nothing usable to parse. */
function parseJsonReply(text) {
  if (typeof text !== "string" || !text.trim()) return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed === null ? undefined : parsed;
  } catch {
    return undefined;
  }
}

function parseToolInput(input) {
  if (isPlainObject(input)) return input;
  if (typeof input === "string") {
    const parsed = parseJsonReply(input);
    return isPlainObject(parsed) ? parsed : null;
  }
  return null;
}

async function callAnthropicForced(args) {
  const {
    system, user, env = process.env, fetchImpl = globalThis.fetch,
    model, maxTokens, media = [], provider,
    timeoutMs, cache = false, effort, outputSchema, tools, toolChoice,
    fallbacks = "default", messages
  } = args;

  const mediaParts = Array.isArray(media) ? media.filter(Boolean) : [];
  const allTools = Array.isArray(tools) ? tools.filter(Boolean) : [];
  const serverTools = allTools.filter(isServerTool);
  const toolList = allTools.filter((t) => !isServerTool(t));
  const messageList = messages == null ? null : messages;
  const modelName = model == null || model === "" ? DEFAULT_ANTHROPIC_MODEL : String(model);
  const maxTok = maxTokens == null ? DEFAULT_ANTHROPIC_MAX_TOKENS : maxTokens;
  const effortLevel = effort == null ? DEFAULT_EFFORT : effort;
  const timeout = timeoutMs == null ? DEFAULT_ANTHROPIC_TIMEOUT_MS : timeoutMs;
  const choice = toolChoiceOf(toolChoice);
  const fallbackOn = fallbacks == null || fallbacks === true || fallbacks === "default";
  const sendFallbacks = fallbackOn && FALLBACK_MODELS.includes(modelName);
  const systemBlocks = Array.isArray(system) ? system.filter(Boolean) : null;
  const systemText = systemBlocks
    ? systemBlocks.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("\n")
    : String(system || "");

  const request = {
    model: modelName,
    system: systemText,
    user: String(user || ""),
    max_tokens: maxTok,
    media_count: mediaParts.length,
    provider: provider === "anthropic" ? "anthropic" : String(provider),
    effort: effortLevel,
    cache: cache === true,
    timeout_ms: timeout,
    output_schema: outputSchema != null,
    tools: allTools.map((t) => (t && t.name) || null),
    tool_choice: allTools.length && !choice.error ? choice.type : null,
    fallbacks: sendFallbacks ? "default" : null,
    messages_count: Array.isArray(messageList) ? messageList.length : null
  };

  const result = (fields) => ({
    mode: "live", text: null, raw: null, request, error: null, status: null,
    json: null, toolInput: null, stopReason: null, servedModel: null,
    usage: emptyAnthropicUsage(),
    content: [],
    serverToolUse: { web_search_requests: 0, web_fetch_requests: 0 },
    ...fields
  });
  const notSent = (why) => result({ mode: "shadow", error: `${MODEL_NOT_SENT}${why}` });

  // ── Refuse before sending ────────────────────────────────────────────────
  if (provider !== "anthropic") {
    return notSent(`unknown provider ${JSON.stringify(provider)}. The only forced provider is 'anthropic'.`);
  }
  const key = env && env.ANTHROPIC_API_KEY;
  if (!key) return notSent("ANTHROPIC_API_KEY is not set, so Claude was not called.");
  if (isMasked(key)) {
    // Same rule as the OpenAI key above: a value with an asterisk is the hidden
    // form of a key, not the key. It is never sent and never removed (§11).
    return notSent("ANTHROPIC_API_KEY is masked (it holds * characters, the hidden form of a key), so Claude was not called.");
  }
  if (!/^claude-/.test(modelName)) {
    return notSent(`model ${JSON.stringify(modelName)} is not a Claude model; provider 'anthropic' only calls Claude.`);
  }
  if (!EFFORT_LEVELS.includes(effortLevel)) {
    return notSent(`effort ${JSON.stringify(effortLevel)} is not one of ${EFFORT_LEVELS.join(", ")}.`);
  }
  if (!Number.isInteger(maxTok) || maxTok < 1) {
    return notSent(`maxTokens ${JSON.stringify(maxTok)} is not a whole number above 0.`);
  }
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
    return notSent(`timeoutMs ${JSON.stringify(timeout)} is not a number of milliseconds above 0.`);
  }
  if (choice.error) return result({ mode: "shadow", error: choice.error });
  for (const t of serverTools) {
    if (typeof t.name !== "string" || !t.name) {
      return notSent(`server tool ${JSON.stringify(t.type)} needs a name (web_search, web_fetch).`);
    }
  }
  if (messageList != null) {
    if (!Array.isArray(messageList) || !messageList.length) {
      return notSent("messages must be a non-empty list of {role, content}.");
    }
    for (const m of messageList) {
      if (!isPlainObject(m) || (m.role !== "user" && m.role !== "assistant") || m.content == null) {
        return notSent("every message needs role 'user' or 'assistant' and content.");
      }
    }
    if (messageList[0].role !== "user") return notSent("the first message must be the user's.");
  }
  if (serverTools.length && outputSchema != null) {
    // Web search always cites, and citations plus structured outputs is HTTP 400.
    return notSent("outputSchema cannot be used with a server tool (web search citations plus structured output is HTTP 400).");
  }
  for (const t of toolList) {
    if (!isPlainObject(t) || typeof t.name !== "string" || !t.name) {
      return notSent("every tool needs a name.");
    }
    if (!isPlainObject(t.input_schema)) {
      return notSent(`tool ${JSON.stringify(t.name)} has no input_schema object.`);
    }
  }
  if (outputSchema != null && !isPlainObject(outputSchema)) {
    return notSent("outputSchema must be a JSON schema object.");
  }
  if (!(fallbacks == null || fallbacks === true || fallbacks === false || fallbacks === "default")) {
    return notSent(`fallbacks ${JSON.stringify(fallbacks)} must be 'default' or false.`);
  }
  if (typeof fetchImpl !== "function") return notSent("fetch is unavailable.");

  // ── Build the request ────────────────────────────────────────────────────
  const body = {
    model: modelName,
    max_tokens: maxTok
  };
  if (systemBlocks && systemBlocks.length) {
    body.system = systemBlocks.map((b, i) => (cache === true && i === systemBlocks.length - 1)
      ? { ...b, cache_control: { type: "ephemeral" } }
      : b);
  } else if (systemText) {
    body.system = cache === true
      ? [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }]
      : systemText;
  }
  body.messages = messageList != null
    ? messageList
    : [{ role: "user", content: buildUserContent(request.user, mediaParts) }];
  if (allTools.length) {
    body.tools = [...serverTools, ...toolList.map(strictTool)];
    body.tool_choice = choice;
  }
  body.output_config = { effort: effortLevel };
  if (outputSchema != null) {
    body.output_config.format = { type: "json_schema", schema: outputSchema };
  }
  if (sendFallbacks) body.fallbacks = "default";

  const headers = {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01"
  };
  if (sendFallbacks) headers["anthropic-beta"] = FALLBACK_DEFAULT_BETA;

  // ── Send, with a timer that aborts the request itself ───────────────────
  // The race makes the timer win even against a fetch that ignores its signal.
  const controller = new AbortController();
  const TIMED_OUT = Symbol("timed out");
  let timer = null;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(TIMED_OUT); }, timeout);
  });
  const timeoutResult = () => result({
    error: `anthropic timeout: no answer from Claude after ${timeout} ms, so the request was stopped.`
  });

  const send = async () => {
    const res = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const raw = await res.json().catch(() => null);
    return { res, raw };
  };

  let reply;
  try {
    reply = await Promise.race([send(), timedOut]);
  } catch (err) {
    if (controller.signal.aborted) return timeoutResult();
    // No status: the call never got an answer, which classifyModelFailure
    // reads as temporary.
    return result({ error: String((err && err.message) || err).slice(0, 300) });
  } finally {
    clearTimeout(timer);
  }
  if (reply === TIMED_OUT) return timeoutResult();

  const { res, raw } = reply;
  const usage = anthropicUsageOf(raw);
  const servedModel = raw && typeof raw.model === "string" && raw.model ? raw.model : null;
  const stopReason = (raw && raw.stop_reason) || null;
  const answered = {
    raw, status: res.status, usage, servedModel, stopReason,
    content: Array.isArray(raw && raw.content) ? raw.content : [],
    serverToolUse: serverToolUseOf(raw)
  };

  if (!res.ok) {
    return result({ ...answered, error: `anthropic ${res.status}: ${JSON.stringify(raw).slice(0, 300)}` });
  }

  // Check the stop reason before reading any content (claude-api skill).
  if (stopReason === "refusal") {
    const category = raw.stop_details && raw.stop_details.category;
    return result({
      ...answered,
      error: `refused: Claude declined this request (category: ${category || "none given"}).`
    });
  }
  if (stopReason === "max_tokens") {
    return result({
      ...answered,
      error: `cut off: the reply hit the ${maxTok}-token limit before it finished (thinking counts toward it). Raise maxTokens.`
    });
  }

  const text = extractText(raw);
  const blocks = Array.isArray(raw && raw.content) ? raw.content : [];
  const toolUse = blocks.find((b) => b && b.type === "tool_use") || null;
  const toolInput = toolUse ? parseToolInput(toolUse.input) : null;

  let json = null;
  let error = null;
  if (outputSchema != null && !toolUse) {
    const parsed = parseJsonReply(text);
    if (parsed === undefined) error = MODEL_NO_JSON;
    else json = parsed;
  }
  if (toolList.length && choice.type !== "none" && outputSchema == null && !toolInput) {
    error = MODEL_NO_TOOL_CALL;
  }

  return result({ ...answered, text, json, toolInput, error });
}

function buildUserContent(userText, mediaParts = []) {
  if (!mediaParts.length) return String(userText || "");
  const parts = [];
  for (const m of mediaParts) {
    const data = m.dataBase64 || m.data;
    const mediaType = m.mediaType || m.media_type || "image/jpeg";
    if (!data) continue;
    if (m.type === "document" || mediaType === "application/pdf") {
      parts.push({ type: "document", source: { type: "base64", media_type: mediaType, data } });
    } else {
      parts.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
    }
  }
  parts.push({ type: "text", text: String(userText || "") });
  return parts;
}

function buildOpenAIUserContent(userText, mediaParts = []) {
  if (!mediaParts.length) return String(userText || "");
  const parts = [];
  for (const m of mediaParts) {
    const data = m.dataBase64 || m.data;
    const mediaType = m.mediaType || m.media_type || "image/jpeg";
    if (!data) continue;
    if (m.type === "document" || mediaType === "application/pdf") continue;
    parts.push({
      type: "image_url",
      image_url: { url: `data:${mediaType};base64,${data}` }
    });
  }
  parts.push({ type: "text", text: String(userText || "") });
  return parts.length === 1 ? String(userText || "") : parts;
}

function extractText(raw) {
  if (!raw) return null;
  if (Array.isArray(raw.content)) {
    const parts = raw.content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text);
    const joined = parts.join("\n").trim();
    if (joined) return joined;
  }
  const choice = raw.choices && raw.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const parts = content
      .filter((b) => b && (b.type === "text" || typeof b.text === "string") && typeof b.text === "string")
      .map((b) => b.text);
    const joined = parts.join("\n").trim();
    if (joined) return joined;
  }
  return null;
}

function usageOf(raw) {
  const u = raw && raw.usage;
  return {
    input_tokens: Math.max(0, Number(u && (u.input_tokens || u.prompt_tokens)) || 0),
    output_tokens: Math.max(0, Number(u && (u.output_tokens || u.completion_tokens)) || 0)
  };
}

export default callModel;
