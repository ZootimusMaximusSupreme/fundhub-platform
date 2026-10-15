// POST /api/journeys/ask — the Journeys editor's proxy to Claude. A practice test: the REAL handler runs
// with a stand-in database for the sign-in, and a stand-in for api.anthropic.com. No key and no network.
//
// The catalog row says the proxy "accepts caller-supplied system and user prompts, so there is no fixed
// active prompt and judged runtime result". That is what the proxy IS: the owner or admin's editor text
// goes to the model and the model's words come back. What can be judged, and is here, is everything the
// server decides: who may call it, what is refused, what is sent upstream and with which key, what comes
// back, and what happens when the model is down.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import ask from "../../api/journeys/ask.mjs";
import { req, staffSession } from "../testing/handler-harness.mjs";
import { call, splitRoles } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const OWNER_ADMIN = ["owner", "admin"];
// A stand-in key, built from parts so no key-shaped string sits in the source.
const SERVER_KEY = ["key", "held", "by", "the", "server", "only"].join("-");
const UPSTREAM = "https://api.anthropic.com/v1/messages";
// The model the proxy names, pinned on purpose: moving to another model is a decision, so it changes here with it.
const MODEL = "claude-sonnet-4-5";

let realFetch;
let realKey;
let upstream = [];
let answerWith;

before(() => {
  realFetch = globalThis.fetch;
  realKey = process.env.ANTHROPIC_API_KEY;
  globalThis.fetch = async (url, init) => {
    upstream.push({ url: String(url), init });
    return answerWith(url, init);
  };
});
after(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = realKey;
});

function model(content, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, json: async () => ({ content }) });
}

function fresh({ key = SERVER_KEY, answer = model([{ type: "text", text: "Here is a draft step." }]) } = {}) {
  upstream = [];
  answerWith = answer;
  if (key === null) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
}

const post = (body, role = "owner") => call(ask, req("POST", { body }), [staffSession({ role })]);
const EDITOR = { system: "You write short customer texts.", user: "Write the day-2 nudge for a stalled client." };

describe("POST /api/journeys/ask", () => {
  test("the model's words come back, and the upstream call carries the editor's two texts and the server's key", async () => {
    fresh({ answer: model([
      { type: "text", text: "Hi {{contact.first_name}}, " },
      { type: "tool_use", text: "NOT THIS ONE" },
      { type: "text", text: "your next step is ready." },
    ]) });
    const { res } = await post(EDITOR);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, text: "Hi {{contact.first_name}}, your next step is ready." });

    assert.equal(upstream.length, 1);
    const [{ url, init }] = upstream;
    assert.equal(url, UPSTREAM);
    assert.equal(init.method, "POST");
    assert.equal(init.headers["x-api-key"], SERVER_KEY, "the server's own key goes upstream");
    assert.equal(init.headers["anthropic-version"], "2023-06-01");
    // The body is a JSON string, so without this header fetch would label it text/plain and the vendor refuses it.
    assert.equal(init.headers["Content-Type"], "application/json", "the body is JSON and says so");
    assert.equal(typeof init.body, "string");
    const sent = JSON.parse(init.body);
    assert.equal(sent.system, EDITOR.system);
    assert.deepEqual(sent.messages, [{ role: "user", content: EDITOR.user }]);
    assert.equal(sent.max_tokens, 1000);
    assert.equal(sent.model, MODEL, "the proxy names the model the editor was built for");
    // The key is the server's secret: it never travels back to the browser.
    assert.equal(JSON.stringify(res.body).includes(SERVER_KEY), false);
    // A browser-supplied key is never used.
    fresh();
    const tricky = await call(ask, req("POST", { body: { ...EDITOR, apiKey: "caller-key", api_key: "caller-key" }, headers: { "x-api-key": "caller-key" } }), [staffSession({ role: "owner" })]);
    assert.equal(tricky.res.statusCode, 200);
    assert.equal(upstream[0].init.headers["x-api-key"], SERVER_KEY);
    assert.equal(JSON.parse(upstream[0].init.body).apiKey, undefined);
  });

  test("only an owner or an admin may ask; every other staff role is refused and nothing goes upstream", async () => {
    const { admitted, refused } = splitRoles(OWNER_ADMIN);
    assert.deepEqual([...admitted].sort(), [...OWNER_ADMIN].sort());
    assert.equal(refused.length, 6, "all eight staff roles were tried");
    for (const role of admitted) {
      fresh();
      const { res } = await post(EDITOR, role);
      assert.equal(res.statusCode, 200, role);
      assert.equal(upstream.length, 1, role);
    }
    for (const role of refused) {
      fresh();
      const { res } = await post(EDITOR, role);
      assert.equal(res.statusCode, 403, role);
      assert.equal(upstream.length, 0, `${role}: nothing reached the model`);
    }
  });

  test("no login is a 401 and nothing goes upstream; a GET is a 405 that names POST", async () => {
    fresh();
    const nobody = await call(ask, req("POST", { body: EDITOR }), []);
    assert.equal(nobody.res.statusCode, 401);
    const get = await call(ask, req("GET"), [staffSession({ role: "owner" })]);
    assert.equal(get.res.statusCode, 405);
    assert.equal(get.res.headers.allow, "POST");
    assert.equal(get.res.body.error, "method_not_allowed");
    assert.equal(upstream.length, 0);
  });

  test("a missing system text or a missing user text is a 400 and nothing goes upstream", async () => {
    for (const body of [{ user: "x" }, { system: "x" }, { system: "", user: "x" }, { system: "x", user: "" }, {}]) {
      fresh();
      const { res } = await post(body);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(res.body.error, "system_and_user_required");
      assert.equal(upstream.length, 0);
    }
  });

  test("with no key on the server the answer is 503 and nothing goes upstream", async () => {
    fresh({ key: null });
    const { res } = await post(EDITOR);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, "anthropic_api_key_not_configured");
    assert.equal(upstream.length, 0);
  });

  test("a model that is down or unreachable is a 502 with the reason, never a blank success", async () => {
    fresh({ answer: model([], { ok: false, status: 529 }) });
    const down = await post(EDITOR);
    assert.equal(down.res.statusCode, 502);
    assert.deepEqual(down.res.body, { ok: false, error: "anthropic_http_529" });

    fresh({ answer: async () => { throw new Error("socket hang up"); } });
    const gone = await post(EDITOR);
    assert.equal(gone.res.statusCode, 502);
    assert.deepEqual(gone.res.body, { ok: false, error: "anthropic_unreachable" });
  });

  test("a reply with no text blocks comes back as ok with empty text, not as an error", async () => {
    fresh({ answer: model([{ type: "tool_use" }]) });
    const { res } = await post(EDITOR);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, text: "" });
  });
});
