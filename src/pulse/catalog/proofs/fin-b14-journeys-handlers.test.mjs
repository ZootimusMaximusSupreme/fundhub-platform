// Practice test (the real api/ handlers, a stand-in database, fake data) for the server half of the
// Journeys editor controls in batch 14: Apply to code (GET and PUT /api/journeys), Make the change
// (POST /api/journeys/ask) and the page gate on all three doors plus Test against the code
// (POST /api/journeys/run).
//
// The stand-in database does not run the SQL: what is judged is which statement the handler sends, with
// which values, and who is let in. Nothing is sent to the AI company: fetch is a recorder here. The
// browser half is fin-b14-journeys.test.mjs. No database, no network.

import assert from "node:assert/strict";
import test from "node:test";

import journeysHandler from "../../../../api/journeys.mjs";
import askHandler from "../../../../api/journeys/ask.mjs";
import runHandler from "../../../../api/journeys/run.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID, STAFF_ID } from "../../../testing/handler-harness.mjs";
import { STAFF_ROLES, rolesLetIn } from "./s1-proof-kit.mjs";

async function call(handler, request, rules = [], role = "owner", over = {}) {
  const fake = fakeDb([staffSession({ role, ...over }), ...rules]);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

const GOOD_NODES = [
  { id: "n1", type: "sms", title: "Text them", cfg: { body: "Hi {{first_name}}. Reply STOP to opt out.", delay: "instant" } },
  { id: "n2", type: "wait", title: "Wait", cfg: { amount: "2", unit: "days" } },
];
const GOOD_PUT = { key: "client", name: "Client", start: "A form is filled", end: "A result is ready", desc: "What a client does.", nodes: GOOD_NODES };
const upsertRule = [/INSERT INTO journeys/, [{ key: "client", updated_at: "2026-10-14T12:00:00Z" }]];

// ── who gets in ──────────────────────────────────────────────────────────────────────────────────────

test("GET and PUT /api/journeys and POST /api/journeys/ask let in owner and admin and nobody else", async () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  globalThis.fetch = async () => { throw new Error("no network in this test"); };
  try {
    const get = await rolesLetIn(async (role) => (await call(journeysHandler, req("GET"), [], role)).res.statusCode, STAFF_ROLES);
    const put = await rolesLetIn(async (role) => (await call(journeysHandler, req("PUT", { body: GOOD_PUT }), [upsertRule], role)).res.statusCode, STAFF_ROLES);
    const ask = await rolesLetIn(async (role) => (await call(askHandler, req("POST", { body: { system: "s", user: "u" } }), [], role)).res.statusCode, STAFF_ROLES);
    assert.deepEqual(get, ["admin", "owner"]);
    assert.deepEqual(put, ["admin", "owner"]);
    assert.deepEqual(ask, ["admin", "owner"]);
    // Not signed in: refused before anything is read or written.
    const signedOut = makeRes();
    const fake = fakeDb([]);
    await runWithSharedDb(fake, () => journeysHandler({ method: "GET", body: {}, query: {}, headers: {} }, signedOut));
    assert.equal(signedOut.statusCode, 401);
    assert.equal(fake.find(/FROM journeys|INSERT INTO journeys/).length, 0);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = realKey;
  }
});

test("POST /api/journeys/run is wider than the row says: sales manager is let in as well", async () => {
  // The row says owner and admin only. The door gates on ROLE_SETS.FINANCE (owner, admin, sales_manager).
  // "unknown_journey" is the cheapest answer past the gate: no journey is walked.
  const run = await rolesLetIn(async (role) => (await call(runHandler, req("POST", { body: { journey: "nope" } }), [[/FROM journeys WHERE org_id = \$1/, []]], role)).res.statusCode, STAFF_ROLES);
  assert.deepEqual(run, ["admin", "owner", "sales_manager"]);
});

// ── Apply to code: GET and PUT ───────────────────────────────────────────────────────────────────────

test("PUT saves one journey into the caller's company, stamped with who saved it", async () => {
  const { res, fake } = await call(
    journeysHandler,
    req("PUT", { body: { ...GOOD_PUT, org_id: "0b000000-0000-4000-8000-000000000002", name: "  Client  " } }),
    [upsertRule],
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, key: "client", updatedAt: "2026-10-14T12:00:00Z" });
  const insert = fake.find(/INSERT INTO journeys/);
  assert.equal(insert.length, 1);
  assert.match(insert[0].sql, /ON CONFLICT \(org_id, key\) DO UPDATE SET/);
  assert.deepEqual(insert[0].params.slice(0, 6), [ORG_ID, "client", "Client", "A form is filled", "A result is ready", "What a client does."]);
  assert.deepEqual(JSON.parse(insert[0].params[6]), GOOD_NODES);
  assert.equal(insert[0].params[7], STAFF_ID);
  assert.equal(insert[0].params.includes("0b000000-0000-4000-8000-000000000002"), false, "a company named in the body is ignored");
});

test("PUT refuses a journey that cannot work, in words, and writes nothing", async () => {
  const refusals = [
    [{ ...GOOD_PUT, key: "funding_advisor" }, "invalid_key"],
    [{ ...GOOD_PUT, name: "   " }, "name_required"],
    [{ ...GOOD_PUT, start: "" }, "start_and_end_required"],
    [{ ...GOOD_PUT, end: " " }, "start_and_end_required"],
    [{ ...GOOD_PUT, nodes: { not: "a list" } }, "nodes_must_be_an_array"],
    [{ ...GOOD_PUT, nodes: [{ id: "w", type: "wait", title: "Wait a bit", cfg: { amount: "0", unit: "weeks" } }] }, "steps_not_set_up"],
    [{ ...GOOD_PUT, nodes: [{ id: "s", type: "stage", title: "Move", cfg: { stage: "Booked", pipeline: "" } }] }, "steps_not_set_up"],
    [{ ...GOOD_PUT, nodes: [{ id: "q", type: "condition", title: "Ask", cfg: { field: "x", op: "is true" }, branches: [] }] }, "steps_not_set_up"],
    [{ ...GOOD_PUT, nodes: [{ id: "t", type: "teleport", title: "Zap", cfg: {} }] }, "steps_not_set_up"],
    [{ ...GOOD_PUT, nodes: [{ id: "s", type: "sms", title: "Text", cfg: { body: "Hi {first_name}", delay: "instant" } }] }, "single_brace_tags"],
  ];
  for (const [body, error] of refusals) {
    const { res, fake } = await call(journeysHandler, req("PUT", { body }), [upsertRule]);
    assert.equal(res.statusCode, 400, error);
    assert.equal(res.body.error, error);
    assert.equal(fake.find(/INSERT INTO journeys/).length, 0, `${error}: nothing is written`);
  }
  // A refused step is named, so the author can find it.
  const { res } = await call(journeysHandler, req("PUT", { body: { ...GOOD_PUT, nodes: [GOOD_NODES[0], { id: "w", type: "wait", title: "Wait a bit", cfg: { amount: "2", unit: "weeks" } }] } }), [upsertRule]);
  assert.equal(res.body.violations.length, 1);
  assert.equal(res.body.violations[0].title, "Wait a bit");
  assert.equal(res.body.violations[0].nodeId, "w");
  assert.match(res.body.violations[0].reason, /wait with no proper length/);
  assert.match(res.body.message, /1 step is missing something they need/);
});

test("GET gives back this company's saved journeys in the shape the page reads", async () => {
  const { res, fake } = await call(journeysHandler, req("GET"), [[/FROM journeys WHERE org_id = \$1/, [
    { key: "client", name: "Client", start_when: "A form", end_when: "A result", description: "About", nodes: GOOD_NODES, updated_at: "2026-10-01T00:00:00Z" },
  ]]]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.journeys.client, { name: "Client", start: "A form", end: "A result", desc: "About", nodes: GOOD_NODES, updatedAt: "2026-10-01T00:00:00Z" });
  const read = fake.find(/FROM journeys WHERE org_id = \$1/);
  assert.deepEqual(read[0].params, [ORG_ID]);
});

// ── Make the change: POST /api/journeys/ask ──────────────────────────────────────────────────────────

test("ask: needs words, needs the key, tells a down door from a bad answer, and hands the text back", async () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.ANTHROPIC_API_KEY;
  const seen = [];
  const fakeKey = ["not", "a", "real", "key"].join("-");
  let answer = null;
  globalThis.fetch = async (url, options) => {
    seen.push({ url: String(url), method: options?.method, body: JSON.parse(options?.body || "{}"), hasKey: Boolean(options?.headers?.["x-api-key"]) });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  try {
    delete process.env.ANTHROPIC_API_KEY;
    const get = await call(askHandler, req("GET"), []);
    assert.equal(get.res.statusCode, 405);
    const noWords = await call(askHandler, req("POST", { body: { system: "", user: "x" } }), []);
    assert.equal(noWords.res.statusCode, 400);
    assert.equal(noWords.res.body.error, "system_and_user_required");
    const noKey = await call(askHandler, req("POST", { body: { system: "s", user: "u" } }), []);
    assert.equal(noKey.res.statusCode, 503);
    assert.equal(noKey.res.body.error, "anthropic_api_key_not_configured");
    assert.equal(seen.length, 0, "nothing is asked of the AI company without a key");

    process.env.ANTHROPIC_API_KEY = fakeKey;
    answer = new Error("down");
    const unreachable = await call(askHandler, req("POST", { body: { system: "s", user: "u" } }), []);
    assert.equal(unreachable.res.statusCode, 502);
    assert.equal(unreachable.res.body.error, "anthropic_unreachable");
    answer = { ok: false, status: 500, json: async () => ({}) };
    const bad = await call(askHandler, req("POST", { body: { system: "s", user: "u" } }), []);
    assert.equal(bad.res.statusCode, 502);
    assert.equal(bad.res.body.error, "anthropic_http_500");

    answer = { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "{\"summary\":" }, { type: "tool_use" }, { type: "text", text: "\"done\"}" }] }) };
    seen.length = 0;
    const ok = await call(askHandler, req("POST", { body: { system: "You edit journeys.", user: "Change requested: add a wait", model: "other-model", max_tokens: 99999 } }), []);
    assert.equal(ok.res.statusCode, 200);
    assert.deepEqual(ok.res.body, { ok: true, text: '{"summary":"done"}' });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "https://api.anthropic.com/v1/messages");
    assert.equal(seen[0].method, "POST");
    assert.equal(seen[0].hasKey, true);
    assert.equal(seen[0].body.system, "You edit journeys.");
    assert.deepEqual(seen[0].body.messages, [{ role: "user", content: "Change requested: add a wait" }]);
    assert.equal(seen[0].body.max_tokens, 1000, "the caller cannot raise the size or pick another model");
    assert.notEqual(seen[0].body.model, "other-model");
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = realKey;
  }
});
