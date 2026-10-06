// The model call and the worker wake, with a fake fetch. Nothing leaves the laptop.
//
// askAnthropic runs the REAL src/agents/model.mjs callModel underneath; only the
// fetch is fake, and it answers with a recorded /v1/messages body. So these
// prove the production request shape and the production reply parsing.

import test from "node:test";
import assert from "node:assert/strict";
import { askAnthropic, wakeOfferWorker, anthropicKeyOf, OFFER_MODEL, WORKER_PATH } from "./offer-transport.mjs";
import { anthropicMessage } from "./fixtures/offer-replies.mjs";

const FAKE_KEY = "test-anthropic-key-not-real";

function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const { status = 200, json } = await respond(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  return { fn, calls };
}

test("only Anthropic is asked, even with an OpenAI key in the environment", async () => {
  const { fn, calls } = fakeFetch(() => ({ json: anthropicMessage('{"ok":true}', { input: 12, output: 3 }) }));
  const out = await askAnthropic({
    system: "S", user: "U", maxTokens: 16000, timeoutMs: 5000,
    env: { ANTHROPIC_API_KEY: FAKE_KEY, OPENAI_API_KEY: "sk-openai-would-win-in-callModel" },
    fetchImpl: fn
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.headers["x-api-key"], FAKE_KEY);
  assert.equal(calls[0].body.model, OFFER_MODEL);
  assert.equal(calls[0].body.max_tokens, 16000);
  assert.equal(calls[0].body.system, "S");
  assert.deepEqual(calls[0].body.messages, [{ role: "user", content: "U" }]);
  assert.ok(calls[0].init.signal, "the request carries an abort signal");
  // The empty thinking block the current Opus sends first is skipped.
  assert.equal(out.text, '{"ok":true}');
  assert.equal(out.stopReason, "end_turn");
  assert.deepEqual(out.usage, { input_tokens: 12, output_tokens: 3 });
  assert.equal(out.model, OFFER_MODEL);
  assert.equal(out.timedOut, false);
});

test("a missing or masked key never calls anyone", async () => {
  const { fn, calls } = fakeFetch(() => ({ json: {} }));
  for (const env of [{}, { ANTHROPIC_API_KEY: "****************abcd" }]) {
    const out = await askAnthropic({ system: "S", user: "U", env, fetchImpl: fn });
    assert.equal(out.mode, "shadow");
    assert.equal(out.text, null);
  }
  assert.equal(calls.length, 0);
  assert.equal(anthropicKeyOf({ ANTHROPIC_API_KEY: "****x" }), null);
  assert.equal(anthropicKeyOf({ ANTHROPIC_API_KEY: FAKE_KEY }), FAKE_KEY);
});

test("an Anthropic error comes back with its status, not as text", async () => {
  const { fn } = fakeFetch(() => ({ status: 529, json: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } }));
  const out = await askAnthropic({ system: "S", user: "U", env: { ANTHROPIC_API_KEY: FAKE_KEY }, fetchImpl: fn });
  assert.equal(out.text, null);
  assert.equal(out.status, 529);
  assert.match(out.error, /^anthropic 529/);
});

test("the timer aborts the request itself", async () => {
  const fn = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("aborted")));
  });
  const out = await askAnthropic({ system: "S", user: "U", env: { ANTHROPIC_API_KEY: FAKE_KEY }, fetchImpl: fn, timeoutMs: 1000 });
  assert.equal(out.timedOut, true);
  assert.equal(out.text, null);
});

test("the wake is one POST to our own deploy, with the owner's session and the job id", async () => {
  const { fn, calls } = fakeFetch(() => ({ status: 202, json: null }));
  const out = await wakeOfferWorker({ jobId: "job-1", token: "tok", env: { URL: "https://fundhub.ai/" }, fetchImpl: fn });
  assert.deepEqual(out, { ok: true, status: 202, reason: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://fundhub.ai${WORKER_PATH}`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Bearer tok");
  assert.deepEqual(calls[0].body, { job_id: "job-1" });
});

test("a wake that cannot happen says why and never throws", async () => {
  const none = fakeFetch(() => ({ status: 202 }));
  assert.equal((await wakeOfferWorker({ jobId: "j", token: "t", env: {}, fetchImpl: none.fn })).ok, false);
  assert.equal((await wakeOfferWorker({ jobId: "j", token: "", env: { URL: "https://x.test" }, fetchImpl: none.fn })).ok, false);
  assert.equal(none.calls.length, 0);
  const notFound = fakeFetch(() => ({ status: 404 }));
  assert.deepEqual(await wakeOfferWorker({ jobId: "j", token: "t", env: { URL: "https://x.test" }, fetchImpl: notFound.fn }),
    { ok: false, status: 404, reason: "the writer answered 404" });
  const down = await wakeOfferWorker({ jobId: "j", token: "t", env: { URL: "https://x.test" }, fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(down.ok, false);
  assert.match(down.reason, /could not be reached \(ECONNREFUSED\)/);
});
