// The Creative Factory copy writer — which writer answers.
//
// The production OpenAI account has no credit (measured live 2026-09-18:
// `openai 429 … insufficient_quota`). callModel asks OpenAI first whenever an
// OpenAI key is set, so every copy job died on that 429 and the working
// Anthropic key was never asked. copy.mjs now uses the same backup as Social
// Studio's callWriter and the ID reader (readWithBackupReader): on "no credit",
// ask Anthropic once, without the OpenAI key.
//
// NO REAL REQUEST LEAVES THIS FILE. Every model call goes through the fake
// fetch passed as ctx.fetch, and globalThis.fetch is swapped for one that throws
// for the length of each test, so a call that slipped past ctx.fetch would fail
// loudly instead of reaching a vendor. The keys below are fake strings.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { generate } from "./copy.mjs";

const OPENAI_NO_CREDIT = {
  error: {
    message: "You have no credits remaining. Add credits to continue using the API.",
    type: "insufficient_quota", param: null, code: "insufficient_quota"
  }
};
const ANTHROPIC_OK = {
  content: [{ type: "text", text: "Hook one. Body one.\n---\nHook two. Body two." }],
  usage: { input_tokens: 120, output_tokens: 60 }
};
const OPENAI_OK = {
  choices: [{ message: { content: "OpenAI wrote this." } }],
  usage: { prompt_tokens: 80, completion_tokens: 20 }
};

const OPENAI_KEY = "sk-fake-openai";
const ANT_KEY = "sk-ant-fake";
const ENV = () => ({ OPENAI_API_KEY: OPENAI_KEY, ANTHROPIC_API_KEY: ANT_KEY });
const SPEC = { prompt: "funding for a new LLC", offerType: "funding", variants: 2 };

/* fakeFetch — answers by host, records every call. An unplanned host throws. */
function fakeFetch(answers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {}, body: init.body });
    const host = String(url).includes("anthropic") ? "anthropic" : "openai";
    const a = answers[host];
    if (!a) throw new Error(`unexpected call to ${host}`);
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  return { fetch, calls };
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("a real network call was attempted"); };
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("copy writer: the Anthropic backup", () => {
  test("OpenAI has no credit → Anthropic writes the copy, once, without the OpenAI key", async () => {
    const { fetch, calls } = fakeFetch({
      openai: { status: 429, body: OPENAI_NO_CREDIT },
      anthropic: { status: 200, body: ANTHROPIC_OK }
    });
    const out = await generate(SPEC, { env: ENV(), fetch });

    assert.equal(calls.length, 2, "one OpenAI call, then exactly one Anthropic call");
    assert.match(calls[0].url, /api\.openai\.com/);
    assert.match(calls[1].url, /api\.anthropic\.com/);
    assert.equal(calls[1].headers["x-api-key"], ANT_KEY);
    assert.ok(!JSON.stringify(calls[1]).includes(OPENAI_KEY), "the OpenAI key must not travel to the backup");

    assert.equal(out.assets.length, 2);
    assert.deepEqual(out.assets.map((a) => a.text), ["Hook one. Body one.", "Hook two. Body two."]);
    assert.ok(out.assets.every((a) => a.kind === "copy" && a.provider === "copy"));
  });

  test("the stored env is not changed by the backup — no key is removed or rewritten", async () => {
    const { fetch } = fakeFetch({
      openai: { status: 429, body: OPENAI_NO_CREDIT },
      anthropic: { status: 200, body: ANTHROPIC_OK }
    });
    const env = ENV();
    await generate(SPEC, { env, fetch });
    assert.deepEqual(env, ENV());
  });

  test("OpenAI answers → one call, no backup", async () => {
    const { fetch, calls } = fakeFetch({ openai: { status: 200, body: OPENAI_OK } });
    const out = await generate({ ...SPEC, variants: 1 }, { env: ENV(), fetch });
    assert.equal(calls.length, 1);
    assert.equal(out.assets[0].text, "OpenAI wrote this.");
  });

  test("a failure that is not 'no credit' is not retried on Anthropic, and the job sees the error", async () => {
    const { fetch, calls } = fakeFetch({
      openai: { status: 401, body: { error: { message: "Incorrect API key provided" } } },
      anthropic: { status: 200, body: ANTHROPIC_OK }
    });
    await assert.rejects(() => generate(SPEC, { env: ENV(), fetch }), /^Error: openai 401/);
    assert.equal(calls.length, 1);
  });

  test("the backup fails too → the first (OpenAI) error stands", async () => {
    const { fetch, calls } = fakeFetch({
      openai: { status: 429, body: OPENAI_NO_CREDIT },
      anthropic: { status: 500, body: { error: { message: "overloaded" } } }
    });
    await assert.rejects(() => generate(SPEC, { env: ENV(), fetch }), /openai 429/);
    assert.equal(calls.length, 2);
  });

  test("no Anthropic key → refused before any call (the existing key check is unchanged)", async () => {
    const { fetch, calls } = fakeFetch({ openai: { status: 429, body: OPENAI_NO_CREDIT } });
    await assert.rejects(() => generate(SPEC, { env: { OPENAI_API_KEY: OPENAI_KEY }, fetch }),
      /ANTHROPIC_API_KEY is not set/);
    assert.equal(calls.length, 0);
  });

  test("the usage row records what the backup spent, under the model that wrote it", async () => {
    const { fetch } = fakeFetch({
      openai: { status: 429, body: OPENAI_NO_CREDIT },
      anthropic: { status: 200, body: ANTHROPIC_OK }
    });
    const writes = [];
    const tx = {
      query: async (sql, params) => {
        const s = String(sql);
        if (s.includes("FROM partner_module_settings")) {
          return { rows: [{ marketing_suite_enabled: true, ai_token_cap_monthly: 250000, org_id: "org-1" }] };
        }
        if (s.includes("FROM partner_ai_usage")) return { rows: [{ used: 0 }] };
        if (s.includes("SELECT org_id FROM partners")) return { rows: [{ org_id: "org-1" }] };
        if (s.includes("INSERT INTO partner_ai_usage")) {
          writes.push(params);
          return { rows: [{ id: "u1", input_tokens: params[4], output_tokens: params[5], created_at: new Date() }] };
        }
        throw new Error("unexpected query " + s.slice(0, 60));
      }
    };
    await generate(SPEC, { env: ENV(), fetch, tx, partnerId: "p-1" });
    assert.equal(writes.length, 1);
    // (org_id, partner_id, purpose, source_id, input_tokens, output_tokens, model)
    assert.deepEqual(writes[0], ["org-1", "p-1", "creative", null, 120, 60, "claude-sonnet-4-5-20250929"]);
  });
});
