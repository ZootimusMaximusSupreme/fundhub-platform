// @ts-check
// Model provider "claude-code": the Claude Code command line, run on Chris's Mac.
//
// WHY (owner-set 2026-10-06). There is no Anthropic API credit and none will be bought
// for now. Every marketing AI job is still STARTED from the dashboard, but the writing
// is done by `claude -p` on the Mac, under Chris's own Claude subscription. The Mac
// command is scripts/marketing-run-queue.mjs; it turns this provider on for its whole
// process with routeModelCallsToClaudeCode(true). Nothing else ever turns it on, so the
// Netlify site and every other caller keep using the Anthropic API exactly as before.
//
// HOW ONE CALL RUNS
//   * The system words and every message go to `claude -p` as ONE prompt, on stdin.
//   * No tools at all (`--tools ""`), unless the caller offered Anthropic's web search or
//     web fetch server tools. Then Claude Code's own WebSearch / WebFetch are allowed
//     instead, the output is stream-json (so every tool call and result is seen), and the
//     links come back as the same web_search_tool_result / web_fetch_tool_result blocks
//     the Anthropic API returns. src/marketing/avatar/sources.mjs and
//     src/marketing/research/provenance.mjs read those blocks, so the source-link checks
//     keep working unchanged.
//   * outputSchema: the prompt asks for one JSON object matching the schema; the reply is
//     parsed and checked against it here; one bad reply gets ONE retry; a second bad reply
//     is the same `no_json` error the Anthropic path gives.
//   * The child never sees ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN: with either set,
//     Claude Code would bill the API account (no credit) instead of the subscription.
//     The stored key is not touched (CLAUDE.md §11) — it is only left out of the child.
//   * It runs in the system temp folder, so the repo's CLAUDE.md is not loaded into it.
//
// COST. Recorded as model 'claude-code' at $0 (src/marketing/model-usage.mjs). The token
// counts are Claude Code's own. Never a made-up dollar figure.
//
// The result has the same shape as callModel's provider:'anthropic' result, so every
// caller reads it unchanged.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MODEL_NO_JSON, MODEL_NOT_SENT } from "./model.mjs";

/** The provider name and the model name written to the usage ledger. */
export const CLAUDE_CODE = "claude-code";

/** Default time for one call, and the least any call gets (the CLI starts slower than an API call). */
export const CLAUDE_CODE_TIMEOUT_MS = 600_000;
export const CLAUDE_CODE_MIN_TIMEOUT_MS = 120_000;

/** Env names that would make Claude Code bill the API account instead of the subscription. */
export const CHILD_ENV_DROP = Object.freeze(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDECODE"]);

/* ── the switch the Mac runner flips ─────────────────────────────────────── */

let routeAll = false;

/** Send EVERY callModel call in this process to Claude Code. Only the Mac runner calls this. */
export function routeModelCallsToClaudeCode(on = true) {
  routeAll = on === true;
}

/** True when this process sends every model call to Claude Code. */
export function claudeCodeRouting() {
  return routeAll;
}

/* ── live children, so Ctrl-C can stop them ──────────────────────────────── */

/** @type {Set<import("node:child_process").ChildProcess>} */
const live = new Set();

function killTree(child, signal) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  try {
    if (child.pid) process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

/** Stop every running `claude` child (the Mac runner calls this on Ctrl-C). */
export function stopClaudeCodeCalls() {
  for (const c of live) killTree(c, "SIGTERM");
  return live.size;
}

/* ── finding the command ─────────────────────────────────────────────────── */

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * findClaudeBinary(env) → the path of the `claude` command, or null.
 * CLAUDE_CODE_BIN wins when set. Then every folder on PATH, then the usual install
 * places (Claude Code's own local install, Homebrew, and every nvm Node version).
 * @param {Record<string, any>} [env]
 * @param {{ exists?: (f: string) => boolean, home?: string, listDir?: (d: string) => string[] }} [opts]
 */
export function findClaudeBinary(env = process.env, opts = {}) {
  const exists = opts.exists || isExecutable;
  const home = opts.home || os.homedir();
  const listDir = opts.listDir || ((d) => { try { return fs.readdirSync(d); } catch { return []; } });
  const explicit = env && typeof env.CLAUDE_CODE_BIN === "string" ? env.CLAUDE_CODE_BIN.trim() : "";
  if (explicit) return exists(explicit) ? explicit : null;
  const candidates = [];
  for (const dir of String((env && env.PATH) || "").split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, "claude"));
  }
  candidates.push(
    path.join(home, ".claude", "local", "claude"),
    path.join(home, ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude"
  );
  const nvm = path.join(home, ".nvm", "versions", "node");
  for (const v of listDir(nvm).sort().reverse()) candidates.push(path.join(nvm, v, "bin", "claude"));
  for (const c of candidates) if (exists(c)) return c;
  return null;
}

/** The child's environment: this process's, minus the keys that would bill the API. */
export function childEnv(base = process.env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(base || {})) {
    if (v == null || CHILD_ENV_DROP.includes(k)) continue;
    out[k] = String(v);
  }
  return out;
}

/* ── the prompt ──────────────────────────────────────────────────────────── */

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** The words of a message's content (a string, or a list of blocks). */
function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => {
    if (!b || typeof b !== "object") return "";
    if (b.type === "text" && typeof b.text === "string") return b.text;
    return `[a ${String(b.type || "block")} block was left out]`;
  }).filter(Boolean).join("\n");
}

function systemText(system) {
  if (Array.isArray(system)) {
    return system.map((b) => (b && typeof b.text === "string" ? b.text : "")).filter(Boolean).join("\n");
  }
  return String(system || "");
}

/**
 * buildPrompt({ system, user, messages, outputSchema, web }) → the one prompt string.
 * web: { search: number | null, fetch: number | null } — the allowed uses, or null when
 * that tool is not offered (a number 0 means not offered either).
 */
export function buildPrompt({ system, user, messages, outputSchema, web } = /** @type {any} */ ({})) {
  const parts = [];
  const sys = systemText(system).trim();
  if (sys) parts.push(`<instructions>\n${sys}\n</instructions>`);

  if (Array.isArray(messages) && messages.length) {
    if (messages.length === 1 && messages[0].role === "user") {
      parts.push(contentText(messages[0].content));
    } else {
      const turns = messages.map((m) => `<${m.role}>\n${contentText(m.content)}\n</${m.role}>`);
      parts.push(`<conversation>\n${turns.join("\n")}\n</conversation>\n\nWrite the next assistant turn.`);
    }
  } else {
    parts.push(String(user || ""));
  }

  if (web && (web.search || web.fetch)) {
    const can = [];
    if (web.search) can.push(`the WebSearch tool (at most ${web.search} searches)`);
    if (web.fetch) can.push(`the WebFetch tool (at most ${web.fetch} pages)`);
    parts.push(
      `You may use ${can.join(" and ")} to research this. Use no other tool. ` +
      "Only cite links you actually found with these tools. When the research is done, " +
      "write your final answer exactly as asked above."
    );
  }

  if (outputSchema) {
    parts.push(
      "Reply with ONE JSON object and nothing else: no words before or after it, no code fences. " +
      `It must match this JSON schema:\n${JSON.stringify(outputSchema)}`
    );
  }
  return parts.filter((p) => String(p).trim()).join("\n\n");
}

/* ── JSON: parse and check ───────────────────────────────────────────────── */

/** The JSON value in a reply: the whole text, a fenced block, or the outermost {...}. undefined when none. */
export function parseJsonLoose(text) {
  if (typeof text !== "string" || !text.trim()) return undefined;
  const tries = [text.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) tries.push(fence[1].trim());
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a !== -1 && b > a) tries.push(text.slice(a, b + 1));
  for (const t of tries) {
    try {
      const v = JSON.parse(t);
      if (v !== null) return v;
    } catch { /* next */ }
  }
  return undefined;
}

function typeIs(value, type) {
  switch (type) {
    case "object": return isPlainObject(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return true;
  }
}

function resolveRef(ref, root) {
  const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(String(ref || ""));
  if (!m || !root || !isPlainObject(root[m[1]])) return null;
  return root[m[1]][m[2]] || null;
}

/**
 * schemaProblems(value, schema) → a short list of plain problems ([] when it fits).
 * Covers what the marketing schemas use: type, enum, const, required, properties,
 * additionalProperties:false, items, min/maxItems, anyOf/oneOf, and $defs refs.
 */
export function schemaProblems(value, schema, at = "the answer", root = schema, out = []) {
  if (out.length >= 8 || !isPlainObject(schema)) return out;
  if (schema.$ref) {
    const target = resolveRef(schema.$ref, root);
    return target ? schemaProblems(value, target, at, root, out) : out;
  }
  const alts = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : null;
  if (alts) {
    if (!alts.some((s) => schemaProblems(value, s, at, root, []).length === 0)) out.push(`${at} matches none of the allowed shapes`);
    return out;
  }
  if (schema.const !== undefined && value !== schema.const) out.push(`${at} must be ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === value)) {
    out.push(`${at} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  }
  const types = schema.type == null ? null : [].concat(schema.type);
  if (types && !types.some((t) => typeIs(value, t))) {
    out.push(`${at} must be ${types.join(" or ")}`);
    return out;
  }
  if (isPlainObject(value)) {
    const props = isPlainObject(schema.properties) ? schema.properties : {};
    for (const k of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.prototype.hasOwnProperty.call(value, k)) out.push(`${at} is missing "${k}"`);
    }
    for (const [k, v] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(props, k)) schemaProblems(v, props[k], `${at}.${k}`, root, out);
      else if (schema.additionalProperties === false) out.push(`${at} has a key that is not allowed: "${k}"`);
    }
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) out.push(`${at} needs at least ${schema.minItems} items`);
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) out.push(`${at} may hold at most ${schema.maxItems} items`);
    if (isPlainObject(schema.items)) value.forEach((v, i) => schemaProblems(v, schema.items, `${at}[${i}]`, root, out));
  }
  return out.slice(0, 8);
}

/* ── the command's output ────────────────────────────────────────────────── */

/**
 * readCliOutput(stdout) → { result, events }.
 * `--output-format json` prints one result object; stream-json prints one event per line
 * (the last one is the result). Either is read here.
 */
export function readCliOutput(stdout) {
  const text = String(stdout || "").trim();
  /** @type {any[]} */
  let events = [];
  try {
    const whole = JSON.parse(text);
    events = Array.isArray(whole) ? whole : [whole];
  } catch {
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      if (!l) continue;
      try { events.push(JSON.parse(l)); } catch { /* not an event */ }
    }
  }
  let result = null;
  for (const e of events) if (e && e.type === "result") result = e;
  return { result, events };
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c.text === "string" ? c.text : typeof c === "string" ? c : "")).join("\n");
  }
  return "";
}

const URL_RE = /https?:\/\/[^\s"'<>\])}]+/g;

/** Every link in a WebSearch result, with its title when the result names one. */
export function searchResultLinks(text) {
  const t = String(text || "");
  /** @type {Map<string, string>} */
  const found = new Map();
  const pair = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"url"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = pair.exec(t))) {
    let title = m[1];
    try { title = JSON.parse(`"${m[1]}"`); } catch { /* keep raw */ }
    found.set(m[2], title);
  }
  for (const u of t.match(URL_RE) || []) {
    const url = u.replace(/[.,;:]+$/, "");
    if (!found.has(url)) found.set(url, "");
  }
  return [...found.entries()].map(([url, title]) => ({ url, title }));
}

/**
 * webBlocks(events) → { blocks, searches, fetches }: Claude Code's WebSearch and WebFetch
 * calls, turned into the Anthropic server-tool blocks the source checks read.
 */
export function webBlocks(events) {
  /** @type {Map<string, { name: string, input: any }>} */
  const uses = new Map();
  /** @type {any[]} */
  const blocks = [];
  let searches = 0;
  let fetches = 0;
  for (const e of Array.isArray(events) ? events : []) {
    const content = e && e.message && Array.isArray(e.message.content) ? e.message.content : [];
    if (e && e.type === "assistant") {
      for (const b of content) {
        if (b && b.type === "tool_use" && (b.name === "WebSearch" || b.name === "WebFetch")) {
          uses.set(String(b.id), { name: b.name, input: b.input || {} });
          if (b.name === "WebSearch") searches += 1;
          else fetches += 1;
          blocks.push({
            type: "server_tool_use", id: String(b.id),
            name: b.name === "WebSearch" ? "web_search" : "web_fetch", input: b.input || {}
          });
        }
      }
    } else if (e && e.type === "user") {
      for (const b of content) {
        if (!b || b.type !== "tool_result") continue;
        const use = uses.get(String(b.tool_use_id));
        if (!use) continue;
        const text = resultText(b.content);
        if (use.name === "WebSearch") {
          blocks.push({
            type: "web_search_tool_result", tool_use_id: String(b.tool_use_id),
            content: b.is_error
              ? { type: "web_search_tool_result_error", error_code: "unavailable" }
              : searchResultLinks(text).map((r) => ({ type: "web_search_result", url: r.url, title: r.title }))
          });
        } else {
          const url = use.input && typeof use.input.url === "string" ? use.input.url : null;
          blocks.push({
            type: "web_fetch_tool_result", tool_use_id: String(b.tool_use_id),
            content: b.is_error || !url
              ? { type: "web_fetch_tool_error", error_code: "unavailable" }
              : { type: "web_fetch_result", url, content: { type: "document", source: { type: "text", media_type: "text/plain", data: text } } }
          });
        }
      }
    }
  }
  return { blocks, searches, fetches };
}

/* ── running the command ─────────────────────────────────────────────────── */

/**
 * runCli({ bin, args, input, env, timeoutMs, cwd }) →
 *   { code, signal, stdout, stderr, timedOut, spawnError }
 * Its own process group, so a Ctrl-C in the terminal reaches the runner first and the
 * runner decides; stopClaudeCodeCalls() ends it.
 */
export function runCli({ bin, args, input, env, timeoutMs, cwd, spawnImpl = spawn }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
    } catch (err) {
      resolve({ code: null, signal: null, stdout: "", stderr: "", timedOut: false, spawnError: String((err && err.message) || err) });
      return;
    }
    live.add(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, "SIGTERM");
      setTimeout(() => killTree(child, "SIGKILL"), 5000).unref();
    }, timeoutMs);
    const finish = (out) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      live.delete(child);
      resolve(out);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (err) => finish({ code: null, signal: null, stdout, stderr, timedOut, spawnError: String((err && err.message) || err) }));
    child.on("close", (code, signal) => finish({ code, signal, stdout, stderr, timedOut, spawnError: null }));
    child.stdin.on("error", () => { /* the child left early; its exit says why */ });
    child.stdin.end(String(input || ""));
  });
}

function emptyUsage() {
  return {
    input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    web_search_requests: 0, web_fetch_requests: 0
  };
}

function usageOfResult(r) {
  const u = (r && r.usage) || {};
  const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
  return {
    input_tokens: n(u.input_tokens),
    output_tokens: n(u.output_tokens),
    cache_read_input_tokens: n(u.cache_read_input_tokens),
    cache_creation_input_tokens: n(u.cache_creation_input_tokens),
    web_search_requests: 0,
    web_fetch_requests: 0
  };
}

function addUsage(a, b) {
  const out = { ...a };
  for (const k of Object.keys(out)) out[k] = (Number(a[k]) || 0) + (Number(b[k]) || 0);
  return out;
}

const tail = (s, n = 300) => String(s || "").replace(/\s+/g, " ").trim().slice(-n);

/**
 * One run of the command → { text, events, usage, error, raw }.
 * @param {{ bin: string, prompt: string, web: any, model: string | null, timeoutMs: number, env: Record<string, string>, spawnImpl?: any }} o
 */
async function runOnce(o) {
  const tools = [];
  if (o.web && o.web.search) tools.push("WebSearch");
  if (o.web && o.web.fetch) tools.push("WebFetch");
  const args = ["-p", "--output-format", tools.length ? "stream-json" : "json"];
  if (tools.length) args.push("--verbose");
  args.push("--no-session-persistence", "--strict-mcp-config", "--tools", tools.join(","));
  if (tools.length) args.push("--allowedTools", tools.join(","));
  if (o.model) args.push("--model", o.model);

  const run = await runCli({
    bin: o.bin, args, input: o.prompt, env: o.env, timeoutMs: o.timeoutMs, cwd: os.tmpdir(), spawnImpl: o.spawnImpl
  });
  if (run.spawnError) return { text: null, events: [], usage: emptyUsage(), raw: null, error: `claude-code could not start: ${tail(run.spawnError)}` };
  if (run.timedOut) {
    return { text: null, events: [], usage: emptyUsage(), raw: null, error: `claude-code timeout: no answer after ${o.timeoutMs} ms, so it was stopped.` };
  }
  const { result, events } = readCliOutput(run.stdout);
  const usage = usageOfResult(result);
  if (!result) {
    return { text: null, events, usage, raw: null, error: `claude-code exited ${run.code ?? run.signal}: ${tail(run.stderr || run.stdout) || "it printed no answer"}` };
  }
  if (result.is_error || (result.subtype && result.subtype !== "success")) {
    return { text: null, events, usage, raw: result, error: `claude-code error: ${tail(result.result || result.subtype || "it said the run failed")}` };
  }
  const text = typeof result.result === "string" ? result.result : "";
  return { text, events, usage, raw: result, error: null };
}

/* ── the provider ────────────────────────────────────────────────────────── */

function isServerTool(t) {
  return isPlainObject(t) && typeof t.type === "string" && t.type !== "" && t.type !== "custom" && !isPlainObject(t.input_schema);
}

/**
 * callClaudeCode(args) — the same arguments and the same result shape as callModel's
 * provider:'anthropic' path (src/agents/model.mjs). Never throws.
 * Extra deps for tests: args.spawnImpl, args.findBinary.
 */
export async function callClaudeCode(args = {}) {
  const {
    system, user, messages, media = [], tools, toolChoice, outputSchema,
    model, timeoutMs
  } = /** @type {any} */ (args);
  /* The machine's own environment, never the caller's `env`: some callers hand callModel
     an env holding only ANTHROPIC_API_KEY (offer-transport.mjs, funnel-build.mjs), and
     the child needs PATH and HOME to start and to find Chris's sign-in. The keys that
     would bill the API are dropped by childEnv(). Tests pass args.hostEnv. */
  const env = isPlainObject(args.hostEnv) ? args.hostEnv : process.env;
  const toolList = Array.isArray(tools) ? tools.filter(Boolean) : [];
  const serverTools = toolList.filter(isServerTool);
  const clientTools = toolList.filter((t) => !isServerTool(t));
  const searchTool = serverTools.find((t) => /^web_search_/.test(t.type));
  const fetchTool = serverTools.find((t) => /^web_fetch_/.test(t.type));
  const web = {
    search: searchTool ? (Number.isInteger(searchTool.max_uses) ? searchTool.max_uses : 5) : 0,
    fetch: fetchTool ? (Number.isInteger(fetchTool.max_uses) ? fetchTool.max_uses : 5) : 0
  };
  const floor = Number.isFinite(args.minTimeoutMs) ? Number(args.minTimeoutMs) : CLAUDE_CODE_MIN_TIMEOUT_MS; // tests only
  const timeout = Math.max(floor, Number(timeoutMs) > 0 ? Number(timeoutMs) : CLAUDE_CODE_TIMEOUT_MS);
  const chosen = env && typeof env.MARKETING_CLAUDE_CODE_MODEL === "string" && /^[a-z0-9.\-[\]]+$/i.test(env.MARKETING_CLAUDE_CODE_MODEL.trim())
    ? env.MARKETING_CLAUDE_CODE_MODEL.trim()
    : null;

  const request = {
    model: CLAUDE_CODE,
    asked_model: model == null ? null : String(model),
    system: systemText(system),
    user: String(user || ""),
    provider: CLAUDE_CODE,
    output_schema: outputSchema != null,
    tools: toolList.map((t) => (t && t.name) || null),
    timeout_ms: timeout,
    messages: Array.isArray(messages) ? messages.length : null
  };

  /** @param {any} fields */
  const result = (fields) => {
    const usage = (fields && fields.usage) || emptyUsage();
    return {
      mode: "live", text: null, raw: null, request, error: null, status: null,
      json: null, toolInput: null, stopReason: null, servedModel: CLAUDE_CODE,
      usage, content: [], continuations: 0,
      ...fields,
      serverToolUse: { web_search_requests: usage.web_search_requests || 0, web_fetch_requests: usage.web_fetch_requests || 0 }
    };
  };
  const notSent = (why) => result({ mode: "shadow", servedModel: null, error: `${MODEL_NOT_SENT}${why}` });

  if (Array.isArray(media) && media.filter(Boolean).length) return notSent("claude-code cannot take pictures or files; this call needs the Anthropic API.");
  if (clientTools.length && toolChoice !== "none" && !(isPlainObject(toolChoice) && toolChoice.type === "none")) {
    return notSent("claude-code does not run the caller's own tools; ask for JSON with outputSchema instead.");
  }
  if (outputSchema != null && !isPlainObject(outputSchema)) return notSent("outputSchema must be a JSON schema object.");
  const find = typeof args.findBinary === "function" ? args.findBinary : findClaudeBinary;
  const bin = find(env);
  if (!bin) return notSent("the claude command was not found on this Mac. Install Claude Code, or set CLAUDE_CODE_BIN to its path.");

  const basePrompt = buildPrompt({ system, user, messages, outputSchema, web });
  const childEnvironment = childEnv(env);
  let usage = emptyUsage();
  let prompt = basePrompt;
  /** @type {any} */
  let last = null;
  let webSeen = { blocks: /** @type {any[]} */ ([]), searches: 0, fetches: 0 };

  for (let attempt = 1; attempt <= 2; attempt++) {
    last = await runOnce({ bin, prompt, web, model: chosen, timeoutMs: timeout, env: childEnvironment, spawnImpl: args.spawnImpl });
    const w = webBlocks(last.events);
    webSeen = { blocks: webSeen.blocks.concat(w.blocks), searches: webSeen.searches + w.searches, fetches: webSeen.fetches + w.fetches };
    usage = addUsage(usage, { ...last.usage, web_search_requests: w.searches, web_fetch_requests: w.fetches });

    const content = [...webSeen.blocks];
    if (last.text) content.push({ type: "text", text: last.text });
    const answered = { raw: last.raw, usage, content };

    if (last.error) return result({ ...answered, error: last.error });
    if (outputSchema == null) {
      return result({ ...answered, status: 200, stopReason: "end_turn", text: last.text });
    }
    const parsed = parseJsonLoose(last.text);
    const problems = parsed === undefined ? ["the reply held no JSON object"] : schemaProblems(parsed, outputSchema);
    if (!problems.length) {
      return result({ ...answered, status: 200, stopReason: "end_turn", text: last.text, json: parsed });
    }
    if (attempt === 2) {
      return result({ ...answered, status: 200, stopReason: "end_turn", text: last.text, error: MODEL_NO_JSON });
    }
    prompt = `${basePrompt}\n\nYOUR LAST ANSWER COULD NOT BE USED: ${problems.join("; ")}. ` +
      "Reply again with only the JSON object, matching the schema exactly.";
  }
  return result({ error: MODEL_NO_JSON }); // not reached
}

export default callClaudeCode;
