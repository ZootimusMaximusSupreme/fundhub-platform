// POST /api/social/generate — which writer answers (callWriter).
//
// F3 of the 2026-09-17 marketing fixes: "Write 3 posts for me" wrote 0 drafts on
// fundhub.ai. The OpenAI key production holds is on an empty account (measured
// live 2026-09-18: `openai 429 … insufficient_quota`), and callModel only turns to
// Anthropic when no OpenAI key is set at all. callWriter asks Anthropic once when
// OpenAI says "no credit" — the same backup the ID reader uses.
//
// No database: callWriter runs before any write. NO REAL REQUEST LEAVES THIS FILE:
// globalThis.fetch is replaced in every test and restored after it. The keys
// below are fake strings.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert";
import { callWriter } from "../../api/social/generate.mjs";

const OPENAI_NO_CREDIT = {
  error: {
    message: "You have no credits remaining. Add credits to continue using the API.",
    type: "insufficient_quota", param: null, code: "insufficient_quota"
  }
};
const ANTHROPIC_OK = {
  content: [{ type: "text", text: '["Post one.","Post two.","Post three."]' }],
  usage: { input_tokens: 90, output_tokens: 40 }
};
const OPENAI_OK = {
  choices: [{ message: { content: '["A.","B.","C."]' } }],
  usage: { prompt_tokens: 80, completion_tokens: 20 }
};

const ENV = { OPENAI_API_KEY: "sk-fake-openai", ANTHROPIC_API_KEY: "sk-ant-fake" };
const ARGS = (env = ENV) => ({
  system: "s", user: "u", env, model: "claude-sonnet-4-5-20250929", maxTokens: 800
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Stub fetch: answers by host, records every call. */
function stubFetch(answers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {}, body: init.body });
    const host = String(url).includes("anthropic") ? "anthropic" : "openai";
    const a = answers[host];
    if (!a) throw new Error(`unexpected call to ${host}`);
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  return calls;
}

describe("callWriter", () => {
  test("OpenAI has no credit → Anthropic writes the posts, without the OpenAI key", async () => {
    const calls = stubFetch({
      openai: { status: 429, body: OPENAI_NO_CREDIT },
      anthropic: { status: 200, body: ANTHROPIC_OK }
    });
    const out = await callWriter(ARGS());
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /api\.openai\.com/);
    assert.match(calls[1].url, /api\.anthropic\.com/);
    assert.equal(calls[1].headers["x-api-key"], "sk-ant-fake");
    assert.ok(!JSON.stringify(calls[1]).includes("sk-fake-openai"), "OpenAI key must not travel to the backup");
    assert.equal(out.error, null);
    assert.equal(out.mode, "live");
    assert.equal(out.backupReader, true);
    assert.equal(out.request.provider, "anthropic");
    assert.equal(out.request.model, "claude-sonnet-4-5-20250929");
    assert.equal(out.text, '["Post one.","Post two.","Post three."]');
    assert.equal(out.usage.output_tokens, 40);
  });

  test("the stored env is not changed by the backup", async () => {
    stubFetch({
      openai: { status: 429, body: OPENAI_NO_CREDIT },
      anthropic: { status: 200, body: ANTHROPIC_OK }
    });
    const env = { ...ENV };
    await callWriter(ARGS(env));
    assert.deepEqual(env, ENV);
  });

  test("OpenAI answers → one call, no backup", async () => {
    const calls = stubFetch({ openai: { status: 200, body: OPENAI_OK } });
    const out = await callWriter(ARGS());
    assert.equal(calls.length, 1);
    assert.equal(out.request.provider, "openai");
    assert.equal(out.text, '["A.","B.","C."]');
    assert.equal(out.backupReader, undefined);
  });

  test("no Anthropic key → the OpenAI failure stands", async () => {
    const calls = stubFetch({ openai: { status: 429, body: OPENAI_NO_CREDIT } });
    const out = await callWriter(ARGS({ OPENAI_API_KEY: "sk-fake-openai" }));
    assert.equal(calls.length, 1);
    assert.equal(out.text, null);
    assert.match(out.error, /^openai 429/);
  });

  test("a failure that is not 'no credit' is not retried (same rule as the ID reader)", async () => {
    const calls = stubFetch({
      openai: { status: 401, body: { error: { message: "Incorrect API key provided" } } },
      anthropic: { status: 200, body: ANTHROPIC_OK }
    });
    const out = await callWriter(ARGS());
    assert.equal(calls.length, 1);
    assert.match(out.error, /^openai 401/);
  });

  test("backup fails too → the first result stands", async () => {
    stubFetch({
      openai: { status: 429, body: OPENAI_NO_CREDIT },
      anthropic: { status: 500, body: { error: { message: "overloaded" } } }
    });
    const out = await callWriter(ARGS());
    assert.equal(out.text, null);
    assert.match(out.error, /^openai 429/);
    assert.equal(out.request.provider, "openai");
  });

  test("a first call that timed out gets no second call", async () => {
    let n = 0;
    const bounded = async () => { n += 1; return { mode: "live", text: null, error: "aborted", timedOut: true, request: { provider: "openai" } }; };
    const out = await callWriter(ARGS(), { bounded });
    assert.equal(n, 1);
    assert.equal(out.timedOut, true);
  });

  test("the backup gets only what is left of the time bound", async () => {
    const bounds = [];
    let clock = 0;
    const bounded = async (a, ms) => {
      bounds.push(ms);
      if (bounds.length === 1) {
        clock += 3000;
        return {
          mode: "live", text: null, status: 429,
          error: `openai 429: ${JSON.stringify(OPENAI_NO_CREDIT)}`,
          request: { provider: "openai" }, timedOut: false
        };
      }
      return { mode: "live", text: "[\"x\"]", error: null, request: { provider: "anthropic" }, timedOut: false };
    };
    const out = await callWriter(ARGS(), { ms: 8500, bounded, now: () => clock });
    assert.deepEqual(bounds, [8500, 5500]);
    assert.equal(out.text, "[\"x\"]");
  });
});
