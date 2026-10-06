import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callModel, liveModelProvider, DEFAULT_OPENAI_MODEL,
  classifyModelFailure,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_MAX_TOKENS,
  FALLBACK_DEFAULT_BETA,
  MODEL_NO_JSON,
  MODEL_NO_TOOL_CALL
} from "./model.mjs";

test("liveModelProvider prefers OpenAI when that key is set", () => {
  assert.equal(liveModelProvider({}), null);
  assert.equal(liveModelProvider({ OPENAI_API_KEY: "sk-openai" }), "openai");
  assert.equal(liveModelProvider({ COMPANY_BRAIN_OPENAI_API_KEY: "sk-brain" }), "openai");
  assert.equal(liveModelProvider({ ANTHROPIC_API_KEY: "sk-ant" }), "anthropic");
  assert.equal(liveModelProvider({
    OPENAI_API_KEY: "sk-openai",
    ANTHROPIC_API_KEY: "sk-ant"
  }), "openai");
});

test("callModel with no key stays shadow and fetches nothing", async () => {
  let fetched = 0;
  const res = await callModel({
    system: "sys",
    user: "hi",
    env: {},
    fetchImpl: async () => { fetched += 1; throw new Error("should not fetch"); }
  });
  assert.equal(res.mode, "shadow");
  assert.match(res.text, /\[SHADOW — no API key\]/);
  assert.match(res.text, /hi/);
  assert.equal(fetched, 0);
});

test("callModel with only OPENAI_API_KEY posts to OpenAI chat completions", async () => {
  const res = await callModel({
    system: "sys",
    user: "hi",
    env: { OPENAI_API_KEY: "sk-openai" },
    fetchImpl: async (url, opts) => {
      assert.match(url, /api\.openai\.com\/v1\/chat\/completions/);
      assert.equal(opts.headers.authorization, "Bearer sk-openai");
      const body = JSON.parse(opts.body);
      assert.equal(body.model, DEFAULT_OPENAI_MODEL);
      assert.equal(body.messages[0].role, "system");
      assert.equal(body.messages[1].role, "user");
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Why $32?" } }],
          usage: { prompt_tokens: 5, completion_tokens: 7 }
        })
      };
    }
  });
  assert.equal(res.mode, "live");
  assert.equal(res.text, "Why $32?");
  assert.equal(res.request.provider, "openai");
  assert.equal(res.usage.input_tokens, 5);
  assert.equal(res.usage.output_tokens, 7);
});

test("callModel with only ANTHROPIC_API_KEY still posts to Anthropic", async () => {
  const res = await callModel({
    system: "sys",
    user: "hi",
    env: { ANTHROPIC_API_KEY: "test-key" },
    fetchImpl: async (url, opts) => {
      assert.match(url, /anthropic\.com/);
      assert.equal(opts.headers["x-api-key"], "test-key");
      return {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Book Thursday at 2?" }],
          usage: { input_tokens: 3, output_tokens: 9 }
        })
      };
    }
  });
  assert.equal(res.mode, "live");
  assert.equal(res.text, "Book Thursday at 2?");
  assert.equal(res.request.provider, "anthropic");
  assert.equal(res.usage.input_tokens, 3);
  assert.equal(res.usage.output_tokens, 9);
});

test("callModel with both keys uses OpenAI, not Anthropic", async () => {
  const res = await callModel({
    system: "sys",
    user: "drill",
    env: { OPENAI_API_KEY: "sk-openai", ANTHROPIC_API_KEY: "sk-ant" },
    fetchImpl: async (url) => {
      assert.match(url, /api\.openai\.com/);
      assert.doesNotMatch(url, /anthropic/);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "I am the buyer." } }]
        })
      };
    }
  });
  assert.equal(res.mode, "live");
  assert.equal(res.text, "I am the buyer.");
  assert.equal(res.request.provider, "openai");
});

// A MASKED KEY IS NOT A KEY. These guard the 2026-09-17 fault: the live
// OPENAI_API_KEY was the blanked-out form of one (asterisks), OpenAI answered 401,
// and because SOMETHING was set the valid Anthropic key was never reached — so
// Social Studio's "Write 3 posts for me" wrote nothing at all. The stored value is
// never removed (CLAUDE.md §11 "Never remove a key"); it is routed around here.
test("a masked OpenAI key counts as not set, so Anthropic is reached", () => {
  const MASK = "****************Ab3d";

  // The exact live shape: sixteen asterisks then four characters.
  assert.equal(liveModelProvider({ OPENAI_API_KEY: MASK }), null);
  assert.equal(liveModelProvider({
    OPENAI_API_KEY: MASK,
    ANTHROPIC_API_KEY: "sk-ant"
  }), "anthropic", "a mask must not shadow a working Anthropic key");

  // The Company Brain variable is the same door and must behave the same way.
  assert.equal(liveModelProvider({
    COMPANY_BRAIN_OPENAI_API_KEY: MASK,
    ANTHROPIC_API_KEY: "sk-ant"
  }), "anthropic");

  // Any asterisk marks a mask — a real OpenAI key never carries one.
  assert.equal(liveModelProvider({ OPENAI_API_KEY: "sk-proj-abc*def" }), null);

  // A genuine key is untouched by this. If this line ever fails, the check has
  // grown too wide and is refusing real credentials.
  assert.equal(liveModelProvider({ OPENAI_API_KEY: "sk-proj-abcDEF123" }), "openai");
});

test("a masked OpenAI key sends the request to Anthropic, not OpenAI", async () => {
  const res = await callModel({
    system: "sys",
    user: "write me three posts",
    env: { OPENAI_API_KEY: "****************Ab3d", ANTHROPIC_API_KEY: "sk-ant" },
    fetchImpl: async (url) => {
      assert.match(url, /anthropic/, "a mask must not route the call to OpenAI");
      assert.doesNotMatch(url, /api\.openai\.com/);
      return { ok: true, json: async () => ({ content: [{ type: "text", text: "Post one." }] }) };
    }
  });
  assert.equal(res.mode, "live");
  assert.equal(res.text, "Post one.");
  assert.equal(res.request.provider, "anthropic");
});

// ── provider: 'anthropic' — forced Claude (spec §6 step 4, §4 trap 8) ─────────
//
// These are fake-fetch tests. They prove what this module puts on the wire and
// how it reads a reply. They cannot prove Anthropic accepts the shape: that is
// the one small live call after the ship (a 400 means the shape is wrong).

const BOTH_KEYS = Object.freeze({
  OPENAI_API_KEY: "sk-openai-real",
  OPENAI_MODEL: "gpt-4o",
  ANTHROPIC_API_KEY: "sk-ant-real"
});

/** A fake fetch that records every call and answers with `reply`. */
function recorder(reply = {}, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok, status, json: async () => reply };
  };
  return { calls, fetchImpl };
}

const textReply = (text, extra = {}) => ({
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  content: [{ type: "text", text }],
  usage: { input_tokens: 11, output_tokens: 22 },
  ...extra
});

/** Every key name anywhere in a JSON value. */
function allKeys(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { out.add(k); allKeys(v, out); }
  }
  return out;
}

const STRICT_EMPTY = Object.freeze({ type: "object", properties: {}, required: [], additionalProperties: false });

test("anthropic: with BOTH keys set, the only call goes to api.anthropic.com", async () => {
  const { calls, fetchImpl } = recorder(textReply("Hi from Claude"));
  const res = await callModel({
    provider: "anthropic", system: "sys", user: "hi", env: BOTH_KEYS, fetchImpl
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.doesNotMatch(calls[0].url, /openai/);
  assert.equal(calls[0].init.headers["x-api-key"], "sk-ant-real");
  assert.equal(calls[0].init.headers["anthropic-version"], "2023-06-01");
  assert.equal(calls[0].init.headers.authorization, undefined, "no OpenAI bearer header");
  assert.equal(res.mode, "live");
  assert.equal(res.error, null);
  assert.equal(res.text, "Hi from Claude");
  assert.equal(res.request.provider, "anthropic");
});

test("anthropic: a missing or masked key is a plain error and nothing is sent", async () => {
  for (const env of [
    {},
    { OPENAI_API_KEY: "sk-openai-real" },
    { ANTHROPIC_API_KEY: "" },
    { ANTHROPIC_API_KEY: "****************Ab3d", OPENAI_API_KEY: "sk-openai-real" }
  ]) {
    let fetched = 0;
    const res = await callModel({
      provider: "anthropic", system: "s", user: "u", env,
      fetchImpl: async () => { fetched += 1; throw new Error("must not fetch"); }
    });
    assert.equal(fetched, 0, `no call for env ${JSON.stringify(Object.keys(env))}`);
    assert.equal(res.text, null);
    assert.match(res.error, /^not sent: ANTHROPIC_API_KEY is (not set|masked)/);
    assert.doesNotMatch(res.error, /Ab3d/, "the stored value is never echoed");
    assert.deepEqual(classifyModelFailure(res), { temporary: false, reason: null, status: null },
      "a missing key is not something waiting fixes");
  }
});

test("anthropic: timeoutMs aborts the request and returns a timeout error", async () => {
  let sawSignal = null;
  const started = Date.now();
  const res = await callModel({
    provider: "anthropic", user: "slow", env: BOTH_KEYS, timeoutMs: 30,
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
      sawSignal = init.signal;
      init.signal.addEventListener("abort", () => reject(new Error("The operation was aborted")));
    })
  });
  assert.ok(sawSignal, "the request carries an AbortSignal");
  assert.equal(sawSignal.aborted, true, "the request itself was aborted, not just the wait");
  assert.match(res.error, /timeout/);
  assert.match(res.error, /30 ms/);
  assert.equal(res.text, null);
  assert.ok(Date.now() - started < 2000);
  assert.equal(classifyModelFailure(res).temporary, true, "a timeout may work next time");

  // A fetch that ignores its signal still cannot hold the caller past the timer.
  const stubborn = await callModel({
    provider: "anthropic", user: "slow", env: BOTH_KEYS, timeoutMs: 30,
    fetchImpl: () => new Promise(() => {})
  });
  assert.match(stubborn.error, /timeout/);
});

test("anthropic: cache sends the system block with cache_control; effort goes in output_config", async () => {
  const { calls, fetchImpl } = recorder(textReply("ok"));
  await callModel({
    provider: "anthropic", system: "Big stable prompt", user: "go", env: BOTH_KEYS, fetchImpl,
    cache: true, effort: "high"
  });
  assert.deepEqual(calls[0].body.system, [
    { type: "text", text: "Big stable prompt", cache_control: { type: "ephemeral" } }
  ]);
  assert.deepEqual(calls[0].body.output_config, { effort: "high" });

  // No cache: the system prompt stays a plain string. No effort given: Opus
  // 5.5's own default is still sent, so the vendor never picks for us.
  const plain = recorder(textReply("ok"));
  await callModel({ provider: "anthropic", system: "sys", user: "go", env: BOTH_KEYS, fetchImpl: plain.fetchImpl });
  assert.equal(plain.calls[0].body.system, "sys");
  assert.deepEqual(plain.calls[0].body.output_config, { effort: "medium" });

  // A made-up effort level is refused before sending.
  const bad = recorder(textReply("ok"));
  const res = await callModel({ provider: "anthropic", user: "go", env: BOTH_KEYS, fetchImpl: bad.fetchImpl, effort: "turbo" });
  assert.equal(bad.calls.length, 0);
  assert.match(res.error, /^not sent: effort "turbo"/);
});

test("anthropic: outputSchema goes out as output_config.format and comes back as json", async () => {
  const schema = {
    type: "object",
    properties: { title: { type: "string" }, lines: { type: "array", items: { type: "string" } } },
    required: ["title", "lines"],
    additionalProperties: false
  };
  const { calls, fetchImpl } = recorder({
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    // Opus 5.5 always thinks: the reply can open with an (empty) thinking block.
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "{\"title\":\"Ad 91\",\"lines\":[\"one\",\"two\"]}" }
    ],
    usage: { input_tokens: 5, output_tokens: 9 }
  });
  const res = await callModel({
    provider: "anthropic", system: "sys", user: "write", env: BOTH_KEYS, fetchImpl,
    outputSchema: schema, effort: "medium"
  });
  assert.deepEqual(calls[0].body.output_config, {
    effort: "medium",
    format: { type: "json_schema", schema }
  });
  assert.equal(res.error, null);
  assert.deepEqual(res.json, { title: "Ad 91", lines: ["one", "two"] });
  assert.equal(res.stopReason, "end_turn");

  const broken = recorder(textReply("Sure! Here is your script: {title"));
  const bad = await callModel({
    provider: "anthropic", user: "write", env: BOTH_KEYS, fetchImpl: broken.fetchImpl, outputSchema: schema
  });
  assert.equal(bad.error, MODEL_NO_JSON);
  assert.equal(bad.error, "no_json");
  assert.equal(bad.json, null);
});

test("anthropic: tools go out strict, with additionalProperties:false and required", async () => {
  const tool = {
    name: "save_note",
    description: "Save one note",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string" },
        tags: { type: "array", items: { type: "object", properties: { tag: { type: "string" } } } }
      }
    }
  };
  const before = JSON.stringify(tool);
  const { calls, fetchImpl } = recorder({
    model: "claude-opus-5-5",
    stop_reason: "tool_use",
    content: [
      { type: "text", text: "Saving it." },
      { type: "tool_use", id: "toolu_1", name: "save_note", input: { note: "hi", tags: [{ tag: "a" }] } }
    ],
    usage: { input_tokens: 1, output_tokens: 2 }
  });
  const res = await callModel({
    provider: "anthropic", user: "save hi", env: BOTH_KEYS, fetchImpl, tools: [tool], toolChoice: "auto"
  });
  const sent = calls[0].body.tools[0];
  assert.equal(sent.strict, true);
  assert.equal(sent.name, "save_note");
  assert.equal(sent.description, "Save one note");
  assert.equal(sent.input_schema.additionalProperties, false);
  assert.deepEqual(sent.input_schema.required, ["note", "tags"]);
  const nested = sent.input_schema.properties.tags.items;
  assert.equal(nested.additionalProperties, false, "nested objects are strict too");
  assert.deepEqual(nested.required, ["tag"]);
  assert.deepEqual(calls[0].body.tool_choice, { type: "auto" });
  assert.equal(JSON.stringify(tool), before, "the caller's tool is not changed");
  assert.equal(res.error, null);
  assert.deepEqual(res.toolInput, { note: "hi", tags: [{ tag: "a" }] });
  assert.equal(res.stopReason, "tool_use");
});

test("anthropic: a forced toolChoice is refused before any fetch", async () => {
  const tool = { name: "save_note", input_schema: { type: "object", properties: { note: { type: "string" } } } };
  for (const toolChoice of ["any", "tool", "save_note", { type: "any" }, { type: "tool", name: "save_note" }]) {
    let fetched = 0;
    const res = await callModel({
      provider: "anthropic", user: "u", env: BOTH_KEYS, tools: [tool], toolChoice,
      fetchImpl: async () => { fetched += 1; throw new Error("must not fetch"); }
    });
    assert.equal(fetched, 0, `no call for toolChoice ${JSON.stringify(toolChoice)}`);
    assert.match(res.error, /^not sent: toolChoice .* forces a tool call/);
    assert.equal(classifyModelFailure(res).temporary, false);
  }
});

test("anthropic: tools offered and none called is the error 'no_tool_call'; choice 'none' is not", async () => {
  const tool = { name: "save_note", input_schema: { type: "object", properties: { note: { type: "string" } } } };
  const { fetchImpl } = recorder(textReply("I would rather just talk."));
  const res = await callModel({ provider: "anthropic", user: "u", env: BOTH_KEYS, fetchImpl, tools: [tool] });
  assert.equal(res.error, MODEL_NO_TOOL_CALL);
  assert.equal(res.error, "no_tool_call");
  assert.equal(res.toolInput, null);

  const none = recorder(textReply("Just words."));
  const out = await callModel({
    provider: "anthropic", user: "u", env: BOTH_KEYS, fetchImpl: none.fetchImpl, tools: [tool], toolChoice: "none"
  });
  assert.deepEqual(none.calls[0].body.tool_choice, { type: "none" });
  assert.equal(out.error, null);
  assert.equal(out.text, "Just words.");
});

test("anthropic: a refusal names its category; max_tokens is a plain 'cut off'", async () => {
  const refused = recorder({
    model: "claude-opus-5-5",
    stop_reason: "refusal",
    stop_details: { type: "refusal", category: "cyber", explanation: "x" },
    content: [],
    usage: { input_tokens: 4, output_tokens: 0 }
  });
  const r = await callModel({
    provider: "anthropic", user: "u", env: BOTH_KEYS, fetchImpl: refused.fetchImpl, outputSchema: STRICT_EMPTY
  });
  assert.match(r.error, /^refused: .*category: cyber/);
  assert.equal(r.text, null);
  assert.equal(r.json, null);
  assert.equal(r.stopReason, "refusal");
  assert.equal(classifyModelFailure(r).temporary, false);

  const nullCategory = recorder({ model: "claude-opus-5-5", stop_reason: "refusal", stop_details: null, content: [] });
  const r2 = await callModel({ provider: "anthropic", user: "u", env: BOTH_KEYS, fetchImpl: nullCategory.fetchImpl });
  assert.match(r2.error, /category: none given/);

  const cut = recorder(textReply("The first half of a scr", { stop_reason: "max_tokens" }));
  const c = await callModel({ provider: "anthropic", user: "u", env: BOTH_KEYS, fetchImpl: cut.fetchImpl, maxTokens: 50 });
  assert.match(c.error, /^cut off: /);
  assert.match(c.error, /50-token limit/);
  assert.equal(c.text, null);
});

test("anthropic: the request never carries sampling params, budget_tokens or a thinking block", async () => {
  const { calls, fetchImpl } = recorder(textReply("{}"));
  await callModel({
    provider: "anthropic", system: "s", user: "u", env: BOTH_KEYS, fetchImpl,
    cache: true, effort: "max", outputSchema: STRICT_EMPTY,
    tools: [{ name: "t", input_schema: { type: "object", properties: { a: { type: "string" } } } }],
    // Callers cannot smuggle these in either: unknown options are not forwarded.
    temperature: 0.2, top_p: 0.9, top_k: 5, thinking: { type: "disabled" }, budget_tokens: 1024
  });
  const keys = allKeys(calls[0].body);
  for (const banned of ["temperature", "top_p", "top_k", "budget_tokens", "thinking"]) {
    assert.equal(keys.has(banned), false, `request must not carry ${banned}`);
  }
  assert.equal(calls[0].body.messages.length, 1, "no assistant prefill");
  assert.equal(calls[0].body.messages[0].role, "user");
});

test("anthropic: fallbacks 'default' goes with its beta header unless fallbacks:false; servedModel is response.model", async () => {
  const served = recorder(textReply("Rescued.", { model: "claude-opus-4-8" }));
  const res = await callModel({ provider: "anthropic", user: "u", env: BOTH_KEYS, fetchImpl: served.fetchImpl });
  assert.equal(served.calls[0].body.fallbacks, "default");
  assert.equal(served.calls[0].init.headers["anthropic-beta"], FALLBACK_DEFAULT_BETA);
  assert.equal(FALLBACK_DEFAULT_BETA, "server-side-fallback-2026-07-01");
  assert.equal(res.request.model, "claude-opus-5-5");
  assert.equal(res.servedModel, "claude-opus-4-8", "cost logging prices the model that actually ran");

  const off = recorder(textReply("ok"));
  await callModel({ provider: "anthropic", user: "u", env: BOTH_KEYS, fetchImpl: off.fetchImpl, fallbacks: false });
  assert.equal("fallbacks" in off.calls[0].body, false);
  assert.equal(off.calls[0].init.headers["anthropic-beta"], undefined);

  // A model the skill does not list for fallbacks gets none (it would 400).
  const older = recorder(textReply("ok", { model: "claude-haiku-4-5" }));
  await callModel({ provider: "anthropic", user: "u", env: BOTH_KEYS, fetchImpl: older.fetchImpl, model: "claude-haiku-4-5" });
  assert.equal("fallbacks" in older.calls[0].body, false);
  assert.equal(older.calls[0].init.headers["anthropic-beta"], undefined);
});

test("anthropic: an explicit Claude model is kept (no gpt swap) and maxTokens passes through", async () => {
  const { calls, fetchImpl } = recorder(textReply("ok", { model: "claude-sonnet-5-5" }));
  const res = await callModel({
    provider: "anthropic", user: "u", env: BOTH_KEYS, fetchImpl, model: "claude-sonnet-5-5", maxTokens: 777
  });
  assert.equal(calls[0].body.model, "claude-sonnet-5-5", "OPENAI_MODEL and the gpt-4o-mini swap do not apply");
  assert.equal(calls[0].body.max_tokens, 777);
  assert.equal(res.request.model, "claude-sonnet-5-5");
  assert.equal(res.servedModel, "claude-sonnet-5-5");

  // Nothing given: the current Opus and room for thinking plus the reply.
  const defaults = recorder(textReply("ok"));
  await callModel({ provider: "anthropic", user: "u", env: BOTH_KEYS, fetchImpl: defaults.fetchImpl });
  assert.equal(defaults.calls[0].body.model, DEFAULT_ANTHROPIC_MODEL);
  assert.equal(DEFAULT_ANTHROPIC_MODEL, "claude-opus-5-5");
  assert.equal(defaults.calls[0].body.max_tokens, DEFAULT_ANTHROPIC_MAX_TOKENS);

  // A gpt model name on the Claude path is refused, not sent to Anthropic.
  const gpt = recorder(textReply("ok"));
  const g = await callModel({ provider: "anthropic", user: "u", env: BOTH_KEYS, fetchImpl: gpt.fetchImpl, model: "gpt-4o" });
  assert.equal(gpt.calls.length, 0);
  assert.match(g.error, /^not sent: model "gpt-4o" is not a Claude model/);
});

test("anthropic: usage carries all four token counts on every result", async () => {
  const { fetchImpl } = recorder(textReply("ok", {
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 40 }
  }));
  const res = await callModel({ provider: "anthropic", user: "u", env: BOTH_KEYS, fetchImpl, cache: true, system: "s" });
  assert.deepEqual(res.usage, {
    input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 40
  });

  const zero = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const noKey = await callModel({ provider: "anthropic", user: "u", env: {}, fetchImpl });
  assert.deepEqual(noKey.usage, zero);

  const http = recorder({ type: "error", error: { type: "invalid_request_error", message: "bad" } }, { ok: false, status: 400 });
  const failed = await callModel({ provider: "anthropic", user: "u", env: BOTH_KEYS, fetchImpl: http.fetchImpl });
  assert.deepEqual(failed.usage, zero);
  assert.equal(failed.status, 400);
  assert.match(failed.error, /^anthropic 400: /);
  assert.equal(classifyModelFailure(failed).temporary, false);

  const busy = recorder({ type: "error", error: { type: "overloaded_error" } }, { ok: false, status: 529 });
  const overloaded = await callModel({ provider: "anthropic", user: "u", env: BOTH_KEYS, fetchImpl: busy.fetchImpl });
  assert.equal(classifyModelFailure(overloaded).temporary, true);
});

test("anthropic: an unknown provider is refused, never routed somewhere else", async () => {
  let fetched = 0;
  const res = await callModel({
    provider: "openai", user: "u", env: BOTH_KEYS,
    fetchImpl: async () => { fetched += 1; throw new Error("must not fetch"); }
  });
  assert.equal(fetched, 0);
  assert.match(res.error, /^not sent: unknown provider "openai"/);
});

test("no provider: the old Anthropic-only request body is exactly what it was", async () => {
  const { calls, fetchImpl } = recorder({ content: [{ type: "text", text: "ok" }] });
  await callModel({ system: "sys", user: "hi", env: { ANTHROPIC_API_KEY: "test-key" }, fetchImpl });
  assert.equal(calls[0].init.body, JSON.stringify({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 600,
    system: "sys",
    messages: [{ role: "user", content: "hi" }]
  }));
  assert.deepEqual(calls[0].init.headers, {
    "content-type": "application/json",
    "x-api-key": "test-key",
    "anthropic-version": "2023-06-01"
  });
  assert.equal(calls[0].init.signal, undefined, "the old path has no timer");
});
