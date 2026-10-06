// callModel({ provider: 'anthropic' }) with Anthropic's own server tools (web search,
// web fetch), a whole conversation, pause_turn and streaming. Unit X1 (design
// docs/specs/command-center-design-2026-10-05.md §6 "Slice 1 additions").
//
// Fake-fetch tests: they prove what goes on the wire and how a reply is read. They
// cannot prove Anthropic accepts the shape; the first real avatar run does that.

import test from "node:test";
import assert from "node:assert/strict";
import { callModel, messageFromEvents, MODEL_STILL_PAUSED, MODEL_NO_TOOL_CALL } from "./model.mjs";

const ENV = Object.freeze({ ANTHROPIC_API_KEY: "sk-ant-real", OPENAI_API_KEY: "sk-openai-real" });
const SEARCH = Object.freeze({ type: "web_search_20260318", name: "web_search", max_uses: 8, allowed_callers: ["direct"] });
const FETCH = Object.freeze({ type: "web_fetch_20260318", name: "web_fetch", max_uses: 3, allowed_callers: ["direct"] });

/** A fake fetch that answers each call with the next reply in the list. */
function script(replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body, text: async () => r.text, body: r.stream };
  };
  return { calls, fetchImpl };
}

const searchTurn = (stop, { searches = 1, text = "", extra = [] } = {}) => ({
  body: {
    model: "claude-sonnet-5-5",
    stop_reason: stop,
    content: [
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "broker forum" } },
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://example.com/a", title: "A", encrypted_content: "enc" }] },
      ...extra,
      ...(text ? [{ type: "text", text }] : [])
    ],
    usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: searches } },
    ...(stop === "pause_turn" ? { container: { id: "cntr_1" } } : {})
  }
});

test("server tools go out exactly as given; client tools stay strict; no tool call is required", async () => {
  const { calls, fetchImpl } = script([searchTurn("end_turn", { text: "{\"quotes\":[]}" })]);
  const res = await callModel({
    provider: "anthropic", model: "claude-sonnet-5-5", user: "find quotes", env: ENV, fetchImpl,
    tools: [SEARCH, FETCH], maxTokens: 4000
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.tools, [SEARCH, FETCH]);
  assert.deepEqual(calls[0].body.tool_choice, { type: "auto" });
  assert.equal(res.error, null, "a server-tool-only call never asks for a tool call back");
  assert.notEqual(res.error, MODEL_NO_TOOL_CALL);
  assert.equal(res.usage.web_search_requests, 1);
  assert.equal(res.content.length, 3);
  assert.equal(res.content[1].type, "web_search_tool_result");
});

test("structured output is refused next to web search or web fetch, before anything is sent", async () => {
  for (const tool of [SEARCH, FETCH]) {
    const { calls, fetchImpl } = script([searchTurn("end_turn")]);
    const res = await callModel({
      provider: "anthropic", user: "u", env: ENV, fetchImpl, tools: [tool],
      outputSchema: { type: "object", properties: {}, required: [], additionalProperties: false }
    });
    assert.equal(calls.length, 0);
    assert.match(res.error, /^not sent: outputSchema cannot be combined with web search or web fetch/);
  }
});

test("messages replace the single user message; a bad conversation is refused", async () => {
  const { calls, fetchImpl } = script([{ body: { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "ok" }], usage: {} } }]);
  const convo = [{ role: "user", content: "one" }, { role: "assistant", content: "two" }, { role: "user", content: "three" }];
  const res = await callModel({ provider: "anthropic", messages: convo, env: ENV, fetchImpl });
  assert.equal(res.error, null);
  assert.deepEqual(calls[0].body.messages, convo);

  for (const bad of [[], [{ role: "assistant", content: "x" }], [{ role: "robot", content: "x" }], [{ role: "user" }]]) {
    const s = script([]);
    const r = await callModel({ provider: "anthropic", messages: bad, env: ENV, fetchImpl: s.fetchImpl });
    assert.equal(s.calls.length, 0);
    assert.match(r.error, /^not sent: /);
  }
});

test("pause_turn: the paused turn goes back unchanged, with the container, and max_uses drops by the searches used", async () => {
  const { calls, fetchImpl } = script([
    searchTurn("pause_turn", { searches: 3 }),
    searchTurn("pause_turn", { searches: 2 }),
    searchTurn("end_turn", { searches: 1, text: "done" })
  ]);
  const res = await callModel({
    provider: "anthropic", model: "claude-sonnet-5-5", user: "research", env: ENV, fetchImpl,
    tools: [SEARCH], maxContinuations: 2
  });
  assert.equal(calls.length, 3);
  assert.equal(res.continuations, 2);
  assert.equal(res.error, null);
  assert.equal(res.text, "done");
  // Second call: the first turn's blocks as one assistant message, no extra "continue".
  const second = calls[1].body;
  assert.equal(second.messages.length, 2);
  assert.equal(second.messages[0].role, "user");
  assert.equal(second.messages[1].role, "assistant");
  assert.equal(second.messages[1].content.length, 2);
  assert.equal(second.container, "cntr_1");
  assert.equal(second.tools[0].max_uses, 5, "8 allowed, 3 used");
  assert.equal(calls[2].body.tools[0].max_uses, 3, "8 allowed, 5 used");
  assert.equal(calls[2].body.messages[1].content.length, 4, "every block so far, in order");
  assert.equal(res.usage.web_search_requests, 6);
  assert.equal(res.usage.input_tokens, 30, "usage is summed over every continuation");
  assert.equal(res.content.length, 7);
  // The caller's tool object was never changed.
  assert.equal(SEARCH.max_uses, 8);
});

test("pause_turn: still paused after the last allowed continuation is a plain error with what came back", async () => {
  const { calls, fetchImpl } = script([searchTurn("pause_turn", { searches: 1 })]);
  const res = await callModel({ provider: "anthropic", user: "r", env: ENV, fetchImpl, tools: [SEARCH], maxContinuations: 1 });
  assert.equal(calls.length, 2);
  assert.equal(res.error, MODEL_STILL_PAUSED);
  assert.equal(res.content.length, 4);
});

test("pause_turn: a search tool with no searches left is taken out rather than sent with max_uses 0", async () => {
  const { calls, fetchImpl } = script([searchTurn("pause_turn", { searches: 8 }), searchTurn("end_turn", { searches: 0, text: "ok" })]);
  await callModel({ provider: "anthropic", user: "r", env: ENV, fetchImpl, tools: [SEARCH, FETCH] });
  assert.deepEqual(calls[1].body.tools.map((t) => t.name), ["web_fetch"]);
});

const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");

test("stream: events are read back into the same message, citations and tool input included", async () => {
  const events = [
    { type: "message_start", message: { id: "msg_1", model: "claude-opus-5-5", usage: { input_tokens: 40, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_9", name: "web_search" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"query\":" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "\"brokers\"}" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "web_search_tool_result", tool_use_id: "srvtoolu_9", content: [{ type: "web_search_result", url: "https://ex.com/t", title: "T" }] } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Brokers say " } },
    { type: "content_block_delta", index: 2, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://ex.com/t", cited_text: "we got backdoored" } } },
    { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "they got backdoored." } },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 77, server_tool_use: { web_search_requests: 1 } } },
    { type: "message_stop" }
  ];
  const { message, error } = messageFromEvents(sse(events));
  assert.equal(error, null);
  assert.equal(message.stop_reason, "end_turn");
  assert.deepEqual(message.content[0].input, { query: "brokers" });
  assert.equal(message.content[2].text, "Brokers say they got backdoored.");
  assert.equal(message.content[2].citations[0].cited_text, "we got backdoored");
  assert.equal(message.usage.output_tokens, 77);

  // Through callModel: stream:true is sent and the reply is read from the event text.
  const { calls, fetchImpl } = script([{ text: sse(events) }]);
  const res = await callModel({ provider: "anthropic", user: "u", env: ENV, fetchImpl, stream: true, tools: [SEARCH] });
  assert.equal(calls[0].body.stream, true);
  assert.equal(res.error, null);
  assert.equal(res.text, "Brokers say they got backdoored.");
  assert.equal(res.usage.web_search_requests, 1);
  assert.equal(res.usage.input_tokens, 40);
  assert.equal(res.usage.output_tokens, 77);
});

test("stream: a body read chunk by chunk gives the same message", async () => {
  const text = sse([
    { type: "message_start", message: { model: "claude-opus-5-5", usage: { input_tokens: 2 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } }
  ]);
  const bytes = new TextEncoder().encode(text);
  const half = Math.floor(bytes.length / 2);
  const chunks = [bytes.slice(0, half), bytes.slice(half)];
  const body = { getReader: () => ({ read: async () => (chunks.length ? { value: chunks.shift(), done: false } : { value: undefined, done: true }) }) };
  const { fetchImpl } = script([{ stream: body }]);
  const res = await callModel({ provider: "anthropic", user: "u", env: ENV, fetchImpl, stream: true });
  assert.equal(res.error, null);
  assert.equal(res.text, "hello");
});

test("stream: an error event is a plain error, and an HTTP error is still read as JSON", async () => {
  const bad = messageFromEvents(sse([
    { type: "message_start", message: { model: "m" } },
    { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }
  ]));
  assert.match(bad.error, /overloaded_error/);

  const { fetchImpl } = script([{ ok: false, status: 529, body: { type: "error", error: { type: "overloaded_error" } } }]);
  const res = await callModel({ provider: "anthropic", user: "u", env: ENV, fetchImpl, stream: true });
  assert.equal(res.status, 529);
  assert.match(res.error, /^anthropic 529/);
});
