// The "claude-code" model provider (src/agents/claude-code.mjs), run against a FAKE
// `claude` command (src/agents/fixtures/fake-claude.mjs). No real Claude Code, no
// network, no database.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  callClaudeCode, findClaudeBinary, childEnv, buildPrompt, parseJsonLoose, schemaProblems,
  readCliOutput, searchResultLinks, webBlocks, routeModelCallsToClaudeCode, claudeCodeRouting,
  CLAUDE_CODE, CHILD_ENV_DROP
} from "./claude-code.mjs";
import { callModel, classifyModelFailure, MODEL_NO_JSON, MODEL_NOT_SENT } from "./model.mjs";
import { callProvenance } from "../marketing/avatar/sources.mjs";
import { researchCall, webTools } from "../marketing/research/web-call.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_SRC = path.join(HERE, "fixtures", "fake-claude.mjs");

let dir;
let bin;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-claude-"));
  bin = path.join(dir, "claude");
  fs.copyFileSync(FAKE_SRC, bin);
  fs.chmodSync(bin, 0o755);
});
after(() => {
  routeModelCallsToClaudeCode(false);
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
/** One fresh log and state file per call; the args a test passes to the provider. */
function fake(mode, extra = {}) {
  n += 1;
  const log = path.join(dir, `log-${n}.jsonl`);
  const state = path.join(dir, `state-${n}`);
  const hostEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    ANTHROPIC_API_KEY: "sk-ant-must-not-reach-the-child", ANTHROPIC_AUTH_TOKEN: "nor-this",
    FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_STATE: state, ...extra
  };
  const runs = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { args: { hostEnv, findBinary: () => bin }, runs };
}

describe("callClaudeCode — one plain call", () => {
  test("system + user go in as one prompt on stdin; the answer comes back like the Anthropic path", async () => {
    const f = fake("text");
    const out = await callClaudeCode({ ...f.args, provider: "claude-code", system: "You write ads.", user: "Write one line.", model: "claude-opus-5-5" });
    assert.equal(out.error, null);
    assert.equal(out.mode, "live");
    assert.equal(out.status, 200);
    assert.equal(out.text, "Hello from the fake.");
    assert.equal(out.servedModel, CLAUDE_CODE);
    assert.equal(out.stopReason, "end_turn");
    assert.deepEqual(out.content, [{ type: "text", text: "Hello from the fake." }]);
    assert.equal(out.usage.input_tokens, 100);
    assert.equal(out.usage.output_tokens, 20);
    assert.equal(out.usage.cache_read_input_tokens, 5);
    assert.deepEqual(out.serverToolUse, { web_search_requests: 0, web_fetch_requests: 0 });
    assert.equal(out.request.model, CLAUDE_CODE);
    assert.equal(out.request.asked_model, "claude-opus-5-5");

    const [run] = f.runs();
    assert.match(run.prompt, /You write ads\./);
    assert.match(run.prompt, /Write one line\./);
    assert.deepEqual(run.args.slice(0, 3), ["-p", "--output-format", "json"]);
    assert.ok(run.args.includes("--no-session-persistence"));
    const t = run.args.indexOf("--tools");
    assert.equal(run.args[t + 1], "", "no tools at all for a plain call");
    assert.equal(run.anthropicKey, false, "the API key never reaches Claude Code (it would bill the API, not the subscription)");
    assert.equal(run.hasPath, true);
    assert.equal(fs.realpathSync(run.cwd), fs.realpathSync(os.tmpdir()), "runs outside the repo, so the repo's CLAUDE.md is not loaded");
  });

  test("callModel({provider:'claude-code'}) goes through the same shared client", async () => {
    const f = fake("text");
    const out = await callModel({ ...f.args, provider: "claude-code", user: "hi" });
    assert.equal(out.text, "Hello from the fake.");
    assert.equal(f.runs().length, 1);
  });

  test("the Mac runner's switch sends provider:'anthropic' and the default path to Claude Code; off again, nothing does", async () => {
    const f = fake("text");
    assert.equal(claudeCodeRouting(), false);
    routeModelCallsToClaudeCode(true);
    try {
      const a = await callModel({ ...f.args, provider: "anthropic", model: "claude-opus-5-5", user: "one", env: {} });
      const b = await callModel({ ...f.args, system: "s", user: "two", env: {} });
      assert.equal(a.servedModel, CLAUDE_CODE);
      assert.equal(b.text, "Hello from the fake.");
      assert.equal(f.runs().length, 2);
    } finally {
      routeModelCallsToClaudeCode(false);
    }
    const c = await callModel({ provider: "anthropic", user: "three", env: {} });
    assert.match(String(c.error), /ANTHROPIC_API_KEY is not set/, "switched off: the Anthropic path again, untouched");
    assert.equal(f.runs().length, 2);
  });
});

describe("callClaudeCode — structured output", () => {
  const schema = {
    type: "object", additionalProperties: false, required: ["ok", "n"],
    properties: { ok: { type: "boolean" }, n: { type: "integer" } }
  };

  test("a reply that fits the schema comes back as json", async () => {
    const f = fake("json");
    const out = await callClaudeCode({ ...f.args, user: "give json", outputSchema: schema });
    assert.equal(out.error, null);
    assert.deepEqual(out.json, { ok: true, n: 3 });
    assert.match(f.runs()[0].prompt, /JSON schema/);
    assert.match(f.runs()[0].prompt, /"additionalProperties":false/);
  });

  test("a bad reply gets exactly one retry, told what was wrong; token counts add up", async () => {
    const f = fake("json-bad-once");
    const out = await callClaudeCode({ ...f.args, user: "give json", outputSchema: schema });
    assert.equal(out.error, null);
    assert.deepEqual(out.json, { ok: true, n: 4 });
    const runs = f.runs();
    assert.equal(runs.length, 2);
    assert.match(runs[1].prompt, /YOUR LAST ANSWER COULD NOT BE USED/);
    assert.equal(out.usage.input_tokens, 200);
  });

  test("two bad replies: the same no_json error the Anthropic path gives, and no third try", async () => {
    const f = fake("json-bad");
    const out = await callClaudeCode({ ...f.args, user: "give json", outputSchema: schema });
    assert.equal(out.error, MODEL_NO_JSON);
    assert.equal(out.json, null);
    assert.equal(f.runs().length, 2);
  });
});

describe("callClaudeCode — web research keeps its source links", () => {
  test("web tools become WebSearch/WebFetch, and the links come back as the blocks the source checks read", async () => {
    const f = fake("web");
    const out = await callClaudeCode({
      ...f.args, provider: "anthropic", user: "research it",
      messages: [{ role: "user", content: "research it" }],
      tools: webTools({ searches: 3, fetches: 2 })
    });
    assert.equal(out.error, null);
    const run = f.runs()[0];
    assert.ok(run.args.includes("stream-json"));
    assert.ok(run.args.includes("--verbose"));
    assert.equal(run.args[run.args.indexOf("--tools") + 1], "WebSearch,WebFetch");
    assert.equal(run.args[run.args.indexOf("--allowedTools") + 1], "WebSearch,WebFetch");
    assert.match(run.prompt, /at most 3 searches/);
    assert.match(run.prompt, /at most 2 pages/);

    assert.deepEqual(out.serverToolUse, { web_search_requests: 1, web_fetch_requests: 1 });
    assert.equal(out.usage.web_search_requests, 1);
    const prov = callProvenance(out.content);
    assert.ok(prov.urls.has("example.com/guide"));
    assert.ok(prov.urls.has("sba.gov/funding-programs"));
    assert.match(prov.fetched.get("example.com/guide"), /credit file is thin/);
    assert.equal(out.content[out.content.length - 1].type, "text", "the answer comes after the last tool block");
  });

  test("researchCall (the deep research and market research path) gets its sources through the switch", async () => {
    const f = fake("web");
    routeModelCallsToClaudeCode(true);
    let r;
    try {
      r = await researchCall({
        callModel: (args) => callModel({ ...args, ...f.args }),
        env: {}, model: "claude-sonnet-5-5", system: "sys", prompt: "find it", searches: 3, fetches: 2
      });
    } finally {
      routeModelCallsToClaudeCode(false);
    }
    assert.equal(r.ok, true);
    assert.deepEqual(r.json, { findings: [{ claim: "Thin files get turned down", url: "https://example.com/guide" }] });
    assert.equal(r.searches, 1);
    assert.equal(r.calls[0].model, CLAUDE_CODE);
    assert.ok(r.sources, "collectSources ran on the blocks");
  });
});

describe("callClaudeCode — failures say what happened", () => {
  test("a run Claude Code marks as an error (a usage limit) is a temporary failure", async () => {
    const f = fake("error");
    const out = await callClaudeCode({ ...f.args, user: "x" });
    assert.match(out.error, /^claude-code error: Claude AI usage limit reached/);
    assert.equal(classifyModelFailure({ status: out.status, error: out.error }).temporary, true);
  });

  test("no answer in time: the child is stopped and the error says so", async () => {
    const f = fake("sleep");
    const t0 = Date.now();
    const out = await callClaudeCode({ ...f.args, user: "x", timeoutMs: 300, minTimeoutMs: 0 });
    assert.match(out.error, /^claude-code timeout/);
    assert.ok(Date.now() - t0 < 10_000);
  });

  test("a crash with no result: the exit code and its words", async () => {
    const f = fake("crash");
    const out = await callClaudeCode({ ...f.args, user: "x" });
    assert.match(out.error, /^claude-code exited 2: fake crash/);
  });

  test("no claude command: refused before anything runs", async () => {
    const out = await callClaudeCode({ user: "x", findBinary: () => null });
    assert.equal(out.mode, "shadow");
    assert.ok(out.error.startsWith(MODEL_NOT_SENT));
    assert.match(out.error, /claude command was not found/);
  });

  test("pictures and the caller's own tools are refused, not silently dropped", async () => {
    const f = fake("text");
    const a = await callClaudeCode({ ...f.args, user: "x", media: [{ type: "image", dataBase64: "AAA" }] });
    assert.ok(a.error.startsWith(MODEL_NOT_SENT));
    const b = await callClaudeCode({ ...f.args, user: "x", tools: [{ name: "pick", input_schema: { type: "object" } }] });
    assert.ok(b.error.startsWith(MODEL_NOT_SENT));
    assert.equal(f.runs().length, 0);
  });
});

describe("helpers", () => {
  test("childEnv drops the keys that would bill the API and keeps the rest", () => {
    const e = childEnv({ PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", CLAUDECODE: "1", X: undefined });
    assert.deepEqual(e, { PATH: "/bin", HOME: "/h" });
    assert.deepEqual([...CHILD_ENV_DROP].sort(), ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDECODE"]);
  });

  test("findClaudeBinary: CLAUDE_CODE_BIN, then PATH, then the usual places (nvm included)", () => {
    const has = (set) => (f) => set.has(f);
    assert.equal(findClaudeBinary({ CLAUDE_CODE_BIN: "/x/claude" }, { exists: has(new Set(["/x/claude"])) }), "/x/claude");
    assert.equal(findClaudeBinary({ CLAUDE_CODE_BIN: "/x/claude" }, { exists: () => false }), null);
    assert.equal(findClaudeBinary({ PATH: "/a:/b" }, { exists: has(new Set(["/b/claude"])), home: "/h", listDir: () => [] }), "/b/claude");
    assert.equal(
      findClaudeBinary({ PATH: "" }, { exists: has(new Set(["/h/.nvm/versions/node/v22.1.0/bin/claude"])), home: "/h", listDir: () => ["v20.0.0", "v22.1.0"] }),
      "/h/.nvm/versions/node/v22.1.0/bin/claude"
    );
    assert.equal(findClaudeBinary({ PATH: "" }, { exists: () => false, home: "/h", listDir: () => [] }), null);
  });

  test("buildPrompt joins a conversation and adds the JSON rule", () => {
    const p = buildPrompt({
      system: [{ type: "text", text: "Rules." }],
      messages: [{ role: "user", content: "Q1" }, { role: "assistant", content: [{ type: "text", text: "A1" }] }, { role: "user", content: "Q2" }],
      outputSchema: { type: "object" }
    });
    assert.match(p, /<instructions>\nRules\.\n<\/instructions>/);
    assert.match(p, /<user>\nQ1\n<\/user>\n<assistant>\nA1\n<\/assistant>\n<user>\nQ2\n<\/user>/);
    assert.match(p, /ONE JSON object/);
  });

  test("parseJsonLoose: whole text, a fenced block, or the outermost braces", () => {
    assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
    assert.deepEqual(parseJsonLoose('```json\n{"a":2}\n```'), { a: 2 });
    assert.deepEqual(parseJsonLoose('Here: {"a":3} thanks'), { a: 3 });
    assert.equal(parseJsonLoose("no json"), undefined);
    assert.equal(parseJsonLoose(""), undefined);
  });

  test("schemaProblems names what is wrong", () => {
    const s = {
      type: "object", required: ["a", "b"], additionalProperties: false,
      properties: {
        a: { type: "string", enum: ["x", "y"] },
        b: { type: "array", minItems: 1, items: { $ref: "#/$defs/item" } }
      },
      $defs: { item: { type: "object", required: ["n"], properties: { n: { type: "integer" } } } }
    };
    assert.deepEqual(schemaProblems({ a: "x", b: [{ n: 1 }] }, s), []);
    const p = schemaProblems({ a: "z", b: [{ n: "1" }], c: 1 }, s);
    assert.ok(p.some((x) => /must be one of/.test(x)));
    assert.ok(p.some((x) => /\[0\]\.n must be integer/.test(x)));
    assert.ok(p.some((x) => /not allowed: "c"/.test(x)));
    assert.ok(schemaProblems({ a: "x" }, s).some((x) => /missing "b"/.test(x)));
    assert.deepEqual(schemaProblems(null, { anyOf: [{ type: "null" }, { type: "string" }] }), []);
  });

  test("readCliOutput reads one json result or a stream of events", () => {
    assert.equal(readCliOutput('{"type":"result","result":"a"}').result.result, "a");
    const s = readCliOutput('{"type":"system"}\n{"type":"result","result":"b"}\n');
    assert.equal(s.result.result, "b");
    assert.equal(s.events.length, 2);
    assert.equal(readCliOutput("garbage").result, null);
  });

  test("searchResultLinks finds titled links and bare links", () => {
    const links = searchResultLinks('Links: [{"title":"A \\"q\\"","url":"https://a.com/x"}] also see https://b.org/y.');
    assert.deepEqual(links, [{ url: "https://a.com/x", title: 'A "q"' }, { url: "https://b.org/y", title: "" }]);
  });

  test("webBlocks: a failed fetch is an error block, not a source", () => {
    const { blocks, fetches } = webBlocks([
      { type: "assistant", message: { content: [{ type: "tool_use", id: "f", name: "WebFetch", input: { url: "https://c.com" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "f", is_error: true, content: "403" }] } }
    ]);
    assert.equal(fetches, 1);
    assert.equal(callProvenance(blocks).urls.size, 0);
  });
});
