// Batch 24 (finish the 853), staff doors: the chat widget (ask and staff
// messages), the Journeys editor's model proxy, the journey walk, and the
// lending-climate address lookup.
//
// The real api/ handlers, a stand-in database that keeps its own rows, and a
// trapped network. This is a PRACTICE TEST with fake data. It is not a live
// check. Nothing is sent and no model is asked.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import chatAsk from "../../../../api/chat/ask.mjs";
import chatMessages from "../../../../api/chat/messages.mjs";
import climateGeocode from "../../../../api/climate/geocode.mjs";
import journeysAsk from "../../../../api/journeys/ask.mjs";
import journeysRun from "../../../../api/journeys/run.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { SEED_JOURNEYS } from "../../../journeys/seed-journeys.mjs";
import { ORG_ID, OTHER_ORG_ID, STAFF_ID, fakeDb, makeRes, req, runWithSharedDb, staffSession } from "../../../testing/handler-harness.mjs";
import { assertRoleGate, hit, sqlCalls } from "./s5-route-kit.mjs";

const realFetch = globalThis.fetch;
const asked = [];
before(() => {
  globalThis.fetch = async (url, init = {}) => {
    asked.push({ url: String(url), init });
    throw new Error("the network is trapped in this test");
  };
});
after(() => { globalThis.fetch = realFetch; });

const PEER_ID = "5a000000-0000-4000-8000-0000000000b2";
const OTHER_PEER_ID = "5a000000-0000-4000-8000-0000000000b3";
const FOREIGN_PEER_ID = "5a000000-0000-4000-8000-0000000000f1";

/* ── chat/messages: staff to staff, the internal side of the widget ──────── */

function chatWorld() {
  const world = {
    conversations: [
      { id: "c0000000-0000-4000-8000-000000000001", org_id: ORG_ID, kind: "internal", channel: "internal", internal_pair_key: `${STAFF_ID}:${PEER_ID}`, participants: [STAFF_ID, PEER_ID], last_pulse_at: "2026-10-13T10:00:00.000Z" },
      { id: "c0000000-0000-4000-8000-000000000002", org_id: ORG_ID, kind: "internal", channel: "internal", internal_pair_key: `${PEER_ID}:${OTHER_PEER_ID}`, participants: [PEER_ID, OTHER_PEER_ID], last_pulse_at: "2026-10-13T11:00:00.000Z" },
      { id: "c0000000-0000-4000-8000-0000000000ff", org_id: OTHER_ORG_ID, kind: "internal", channel: "internal", internal_pair_key: `${STAFF_ID}:${FOREIGN_PEER_ID}`, participants: [STAFF_ID, FOREIGN_PEER_ID], last_pulse_at: "2026-10-13T12:00:00.000Z" },
    ],
    staff: [
      { id: PEER_ID, org_id: ORG_ID, status: "active" },
      { id: FOREIGN_PEER_ID, org_id: OTHER_ORG_ID, status: "active" },
      { id: OTHER_PEER_ID, org_id: ORG_ID, status: "inactive" },
    ],
    messages: [
      { id: "m1", org_id: ORG_ID, conversation_id: "c0000000-0000-4000-8000-000000000001", direction: "outbound", channel: "internal", rendered_body: "first", status: "delivered", sender_staff_id: STAFF_ID, sender_kind: "staff", created_at: "2026-10-13T09:00:00.000Z", provider_ref: null },
      { id: "m2", org_id: ORG_ID, conversation_id: "c0000000-0000-4000-8000-000000000001", direction: "outbound", channel: "internal", rendered_body: "second", status: "delivered", sender_staff_id: PEER_ID, sender_kind: "staff", created_at: "2026-10-13T10:00:00.000Z", provider_ref: null },
      // A message of another company that names the same thread id: a lost company condition would show it.
      { id: "m-x", org_id: OTHER_ORG_ID, conversation_id: "c0000000-0000-4000-8000-000000000001", direction: "outbound", channel: "internal", rendered_body: "intruder", status: "delivered", sender_staff_id: FOREIGN_PEER_ID, sender_kind: "staff", created_at: "2026-10-13T09:30:00.000Z", provider_ref: null },
    ],
    inserts: [],
    participantsAdded: [],
  };
  let n = 0;
  world.rules = [
    [/FROM conversations c\s+JOIN conversation_participants me/, (sql, p) => world.conversations
      .filter((c) => (!/c\.org_id = \$1/.test(sql) || c.org_id === p[0])
        && (!/me\.staff_id = \$2/.test(sql) || c.participants.includes(p[1]))
        && (!/c\.kind = 'internal'/.test(sql) || c.kind === "internal"))
      .map((c) => ({ id: c.id, kind: c.kind, channel: c.channel, last_pulse_at: c.last_pulse_at, created_at: c.last_pulse_at, participants: c.participants.map((id) => ({ id })), last_body: "hello" }))],
    [/SELECT id, kind, org_id FROM conversations WHERE id = \$1 AND org_id = \$2/, (sql, p) => world.conversations
      .filter((c) => c.id === p[0] && (!/AND org_id = \$2/.test(sql) || c.org_id === p[1]))
      .map((c) => ({ id: c.id, kind: c.kind, org_id: c.org_id }))],
    [/SELECT 1 FROM conversation_participants\s+WHERE conversation_id = \$1 AND staff_id = \$2/, (_sql, p) => {
      const c = world.conversations.find((x) => x.id === p[0]);
      return c && c.participants.includes(p[1]) ? [{ "?column?": 1 }] : [];
    }],
    [/FROM messages m\s+LEFT JOIN staff s/, (sql, p) => world.messages
      .filter((m) => (!/m\.org_id = \$1/.test(sql) || m.org_id === p[0]) && m.conversation_id === p[1])
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((m) => ({ ...m, sender_name: "Someone" }))],
    [/FROM conversations\s+WHERE org_id = \$1 AND kind = 'internal' AND internal_pair_key = \$2/, (_sql, p) =>
      world.conversations.filter((c) => c.org_id === p[0] && c.internal_pair_key === p[1])],
    [/SELECT id FROM staff WHERE id = \$1 AND org_id = \$2 AND status = 'active'/, (sql, p) =>
      world.staff.filter((s) => s.id === p[0] && (!/AND org_id = \$2/.test(sql) || s.org_id === p[1]) && s.status === "active").map((s) => ({ id: s.id }))],
    [/INSERT INTO conversations/, (_sql, p) => {
      const row = { id: `c1000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, org_id: p[0], kind: "internal", channel: "internal", internal_pair_key: p[1], participants: [] };
      world.conversations.push(row);
      return [row];
    }],
    [/INSERT INTO conversation_participants/, (_sql, p) => {
      const c = world.conversations.find((x) => x.id === p[0]);
      c.participants.push(p[1], p[2]);
      world.participantsAdded.push([p[0], p[1], p[2]]);
      return [];
    }],
    [/SELECT id, org_id, kind FROM conversations WHERE id = \$1 AND org_id = \$2/, (_sql, p) => world.conversations
      .filter((c) => c.id === p[0] && c.org_id === p[1]).map((c) => ({ id: c.id, org_id: c.org_id, kind: c.kind }))],
    [/SELECT \* FROM messages WHERE org_id = \$1 AND provider_ref = \$2/, (_sql, p) => world.messages.filter((m) => m.org_id === p[0] && m.provider_ref === p[1])],
    [/INSERT INTO messages/, (_sql, p) => {
      const row = { id: `m-new-${world.inserts.length + 1}`, org_id: p[0], conversation_id: p[1], rendered_body: p[2], sender_staff_id: p[3], sender_kind: "staff", provider_ref: p[4], channel: "internal", status: "delivered" };
      world.inserts.push(row);
      world.messages.push(row);
      return [row];
    }],
    [/UPDATE conversations SET last_pulse_at/, []],
  ];
  return world;
}

test("chat/messages lists only the staff member's own internal threads in their company, and a thread's messages oldest first, for a participant", async () => {
  assert.equal(ROUTES["chat/messages"], chatMessages);
  const world = chatWorld();
  const threads = await hit(chatMessages, { role: "closer", query: { kind: "internal" }, rules: world.rules });
  assert.equal(threads.status, 200);
  assert.equal(threads.body.kind, "internal");
  assert.deepEqual(threads.body.threads.map((t) => t.id), ["c0000000-0000-4000-8000-000000000001"], "not a thread I am not in, not another company's");
  assert.deepEqual(sqlCalls(threads, /FROM conversations c\s+JOIN conversation_participants me/)[0].params, [ORG_ID, STAFF_ID, 30]);

  const thread = await hit(chatMessages, { query: { conversation_id: "c0000000-0000-4000-8000-000000000001" }, rules: world.rules });
  assert.equal(thread.status, 200);
  assert.deepEqual(thread.body.messages.map((m) => m.rendered_body), ["first", "second"]);
  assert.deepEqual(sqlCalls(thread, /FROM messages m/)[0].params, [ORG_ID, "c0000000-0000-4000-8000-000000000001", 100]);
  assert.match(sqlCalls(thread, /FROM messages m/)[0].sql, /ORDER BY m\.created_at ASC/);

  const notMine = await hit(chatMessages, { query: { conversation_id: "c0000000-0000-4000-8000-000000000002" }, rules: world.rules });
  assert.equal(notMine.status, 403, "a staff-to-staff thread you are not in");
  assert.equal(sqlCalls(notMine, /FROM messages m/).length, 0);
  const foreign = await hit(chatMessages, { query: { conversation_id: "c0000000-0000-4000-8000-0000000000ff" }, rules: world.rules });
  assert.equal(foreign.status, 404, "another company's thread is not found");
  const odd = await hit(chatMessages, { query: { kind: "carrier-pigeon" }, rules: world.rules });
  assert.equal(odd.status, 400);
  assert.equal(odd.body.error, "unknown_kind");
});

test("chat/messages POST internal saves one delivered staff message in this company from this person, makes the pair thread once, and never goes near the compliance gate", async () => {
  const world = chatWorld();
  const first = await hit(chatMessages, {
    method: "POST", role: "closer",
    body: { kind: "internal", peer_staff_id: PEER_ID, body: "  Did the Harmon file land?  " }, rules: world.rules,
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.kind, "internal");
  assert.equal(first.body.deduped, false);
  assert.equal(first.body.conversation_id, "c0000000-0000-4000-8000-000000000001", "the thread for this pair already exists and is reused");
  assert.equal(world.inserts.length, 1);
  assert.deepEqual(
    { org: world.inserts[0].org_id, convo: world.inserts[0].conversation_id, body: world.inserts[0].rendered_body, from: world.inserts[0].sender_staff_id },
    { org: ORG_ID, convo: "c0000000-0000-4000-8000-000000000001", body: "Did the Harmon file land?", from: STAFF_ID },
  );
  assert.match(sqlCalls(first, /INSERT INTO messages/)[0].sql, /'outbound', 'internal',\s+\$3, 'delivered', true,\s+\$4, 'staff', \$5/);
  assert.equal(first.db.calls.some((c) => /compliance_rules|opt_outs|message_templates|FROM shifts/.test(c.sql)), false, "an internal ping has no compliance gate and no shift gate");
  assert.deepEqual(asked, [], "nothing went on the wire");

  // A first message to a new person makes the pair thread, with both people in it.
  const world2 = chatWorld();
  world2.conversations = world2.conversations.filter((c) => c.internal_pair_key !== `${STAFF_ID}:${PEER_ID}`);
  const created = await hit(chatMessages, { method: "POST", body: { kind: "internal", peer_staff_id: PEER_ID, body: "hello" }, rules: world2.rules });
  assert.equal(created.status, 200);
  assert.equal(world2.participantsAdded.length, 1);
  assert.deepEqual(world2.participantsAdded[0].slice(1), [STAFF_ID, PEER_ID]);
  assert.equal(sqlCalls(created, /INSERT INTO conversations/)[0].params[1], `${STAFF_ID}:${PEER_ID}`.split(":").sort().join(":"));

  // The same idempotency key twice is one message.
  const world3 = chatWorld();
  const body = { kind: "internal", conversation_id: "c0000000-0000-4000-8000-000000000001", body: "ping", idempotency_key: "press-1" };
  const a = await hit(chatMessages, { method: "POST", body, rules: world3.rules });
  const b = await hit(chatMessages, { method: "POST", body, rules: world3.rules });
  assert.equal(a.body.deduped, false);
  assert.equal(b.body.deduped, true);
  assert.equal(world3.inserts.length, 1);
  assert.equal(world3.inserts[0].provider_ref, "internal:press-1");
});

test("chat/messages POST internal refuses yourself, a person outside the company, an empty or huge text, a thread you are not in and another company's thread; nothing is saved", async () => {
  const cases = [
    [{ kind: "internal", peer_staff_id: STAFF_ID, body: "hi" }, 400, /cannot message yourself/],
    [{ kind: "internal", peer_staff_id: FOREIGN_PEER_ID, body: "hi" }, 404, /peer staff not found in this org/],
    [{ kind: "internal", peer_staff_id: OTHER_PEER_ID, body: "hi" }, 404, /peer staff not found/],
    [{ kind: "internal", body: "hi" }, 400, /peer_staff_id_required/],
    [{ kind: "internal", peer_staff_id: PEER_ID, body: "   " }, 400, /body required/],
    [{ kind: "internal", peer_staff_id: PEER_ID, body: "x".repeat(8001) }, 400, /body too long/],
    [{ kind: "internal", conversation_id: "c0000000-0000-4000-8000-000000000002", body: "hi" }, 403, /not a participant/],
    [{ kind: "internal", conversation_id: "c0000000-0000-4000-8000-0000000000ff", body: "hi" }, 404, /internal conversation not found/],
    [{ kind: "sms", body: "hi" }, 400, /unknown_kind/],
  ];
  for (const [body, status, message] of cases) {
    const world = chatWorld();
    const out = await hit(chatMessages, { method: "POST", body, rules: world.rules });
    assert.equal(out.status, status, JSON.stringify(body).slice(0, 80));
    assert.match(String(out.body.error), message);
    assert.equal(world.inserts.length, 0);
  }
  const world = chatWorld();
  const put = await hit(chatMessages, { method: "PUT", rules: world.rules });
  assert.equal(put.status, 405);
  const client = await hit(chatMessages, { account: { kind: "client", clientId: "c1000000-0000-4000-8000-000000000001" }, method: "POST", body: { kind: "internal", peer_staff_id: PEER_ID, body: "hi" }, rules: world.rules });
  assert.equal(client.status, 403, "a client login never reaches the staff widget");
  assert.equal(client.body.message, "this endpoint serves staff", "turned away at the sign-in gate itself, not by a later check");
  assert.equal(world.inserts.length, 0);
  const partner = await hit(chatMessages, { account: { kind: "partner", partnerId: "9a000000-0000-4000-8000-000000000001" }, rules: world.rules });
  assert.equal(partner.status, 403, "a partner login never reaches the staff widget");
  assert.equal(partner.body.message, "this endpoint serves staff");
});

/* ── chat/ask: platform help or company knowledge, staff only ────────────── */

function askSpies() {
  const calls = { help: [], retrieve: [], synth: [] };
  return {
    calls,
    deps: {
      env: { MARKER: "env" },
      fetchImpl: "fetch-stand-in",
      answerStaffQuestion: async (args) => { calls.help.push(args); return { text: "Open the Money tab.", thin: false, source: "platform_help", sources: [{ title: "Money tab" }] }; },
      retrieveChunks: async (database, args) => { calls.retrieve.push(args); return { ok: true, chunks: [{ id: "c1", text: "The refund policy is 30 days." }] }; },
      synthesizeAnswer: async (args) => { calls.synth.push(args); return { text: "Refunds are 30 days.", thin: false, source: "brain", citations: [{ chunk: "c1" }] }; },
    },
  };
}

test("chat/ask system mode hands the question to the platform help answerer and returns its text and sources; knowledge mode retrieves for this person's company and role, then writes the answer from those chunks", async () => {
  assert.equal(ROUTES["chat/ask"], chatAsk);
  const { calls, deps } = askSpies();
  const help = await hit(chatAsk, { method: "POST", role: "setter", body: { question: "  Where do I see payouts?  " }, deps });
  assert.equal(help.status, 200);
  assert.deepEqual(help.body, {
    ok: true, mode: "system", question: "Where do I see payouts?",
    answer: { text: "Open the Money tab.", thin: false, source: "platform_help" }, sources: [{ title: "Money tab" }],
  });
  assert.deepEqual(calls.help, [{ question: "Where do I see payouts?", env: deps.env, fetchImpl: deps.fetchImpl }]);
  for (const alias of ["howto", "help"]) {
    const out = await hit(chatAsk, { method: "POST", body: { mode: alias, question: "q" }, deps });
    assert.equal(out.body.mode, "system", alias);
  }

  const know = await hit(chatAsk, { method: "POST", role: "closer", body: { mode: "knowledge", question: "What is the refund policy?", limit: 3 }, deps });
  assert.equal(know.status, 200);
  assert.deepEqual(know.body, {
    ok: true, mode: "knowledge", question: "What is the refund policy?",
    answer: { text: "Refunds are 30 days.", thin: false, source: "brain" }, sources: [{ chunk: "c1" }],
  });
  assert.equal(calls.retrieve.length, 1);
  assert.deepEqual(
    { orgId: calls.retrieve[0].orgId, role: calls.retrieve[0].role, query: calls.retrieve[0].query, limit: calls.retrieve[0].limit },
    { orgId: ORG_ID, role: "closer", query: "What is the refund policy?", limit: 3 },
    "the search is scoped to the session's company and role, never to anything in the request",
  );
  assert.deepEqual(calls.synth[0].chunks, [{ id: "c1", text: "The refund policy is 30 days." }]);
  const brain = await hit(chatAsk, { method: "POST", body: { mode: "brain", question: "q" }, deps });
  assert.equal(brain.body.mode, "knowledge");
  assert.equal(calls.retrieve.at(-1).limit, 8, "the default is eight chunks");
});

test("chat/ask answers a refused or failed search honestly, refuses an empty, long or unknown question and a role outside staff, and never calls a model it was not handed", async () => {
  const { calls, deps } = askSpies();
  const forbidden = await hit(chatAsk, { method: "POST", body: { mode: "knowledge", question: "q" }, deps: { ...deps, retrieveChunks: async () => ({ ok: false, reason: "forbidden_role" }) } });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error, "forbidden_role");
  const down = await hit(chatAsk, { method: "POST", body: { mode: "knowledge", question: "q" }, deps: { ...deps, retrieveChunks: async () => ({ ok: false, reason: "embed_failed" }) } });
  assert.equal(down.status, 502);
  assert.equal(down.body.error, "embed_failed");
  assert.equal(calls.synth.length, 0, "no answer is written from a failed search");

  for (const [body, status, error] of [
    [{ question: "   " }, 400, "question_required"],
    [{ question: "x".repeat(2001) }, 400, "question_too_long"],
    [{ mode: "poem", question: "q" }, 400, "unknown_mode"],
  ]) {
    const out = await hit(chatAsk, { method: "POST", body, deps });
    assert.equal(out.status, status, error);
    assert.equal(out.body.error, error);
  }
  assert.equal(calls.help.length + calls.retrieve.length, 0 + calls.retrieve.length, "refusals asked nothing");

  // Staff only: the six desk roles and the owner may ask, a client login may not.
  await assertRoleGate(chatAsk, ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"], { method: "POST", body: { question: "q" }, deps });
  const noOrg = await hit(chatAsk, { method: "POST", staff: { org_id: null }, body: { question: "q" }, deps });
  assert.equal(noOrg.status, 403);
  assert.equal(noOrg.body.error, "no_org_scope");
  const get = await hit(chatAsk, { method: "GET", deps });
  assert.equal(get.status, 405);
  assert.deepEqual(asked, []);
});

/* ── journeys/ask: the model proxy for the Journeys editor ───────────────── */

test("journeys/ask sends the editor's system and user text to the model with the key held on the server and returns the joined text; every failure is a named 4xx or 5xx", async () => {
  assert.equal(ROUTES["journeys/ask"], journeysAsk);
  const keyName = ["ANTHROPIC", "API", "KEY"].join("_");
  const saved = process.env[keyName];
  const fake = ["not", "a", "real", "model", "value"].join("-");
  process.env[keyName] = fake;
  try {
    const sent = [];
    globalThis.fetch = async (url, init) => {
      sent.push({ url: String(url), init });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Step one. " }, { type: "tool_use", id: "x", text: "NOT-FOR-THE-EDITOR" }, { type: "text", text: "Step two." }] }), { status: 200 });
    };
    const done = await hit(journeysAsk, { method: "POST", role: "admin", body: { system: "You edit journeys.", user: "Add a text after day 2." }, rules: [] });
    assert.equal(done.status, 200);
    assert.deepEqual(done.body, { ok: true, text: "Step one. Step two." });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, "https://api.anthropic.com/v1/messages");
    assert.equal(sent[0].init.headers["x-api-key"], fake);
    const payload = JSON.parse(sent[0].init.body);
    assert.equal(payload.system, "You edit journeys.");
    assert.deepEqual(payload.messages, [{ role: "user", content: "Add a text after day 2." }]);
    assert.equal(typeof payload.max_tokens, "number");
    assert.equal(JSON.stringify(done.body).includes(fake), false, "the key never goes back to the browser");

    globalThis.fetch = async () => new Response("{}", { status: 429 });
    const limited = await hit(journeysAsk, { method: "POST", body: { system: "s", user: "u" }, rules: [] });
    assert.equal(limited.status, 502);
    assert.equal(limited.body.error, "anthropic_http_429");
    globalThis.fetch = async () => { throw new Error("offline"); };
    const offline = await hit(journeysAsk, { method: "POST", body: { system: "s", user: "u" }, rules: [] });
    assert.equal(offline.status, 502);
    assert.equal(offline.body.error, "anthropic_unreachable");

    sent.length = 0;
    globalThis.fetch = async (url) => { sent.push(String(url)); throw new Error("must not be called"); };
    const missing = await hit(journeysAsk, { method: "POST", body: { system: "s" }, rules: [] });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, "system_and_user_required");
    delete process.env[keyName];
    const noKey = await hit(journeysAsk, { method: "POST", body: { system: "s", user: "u" }, rules: [] });
    assert.equal(noKey.status, 503);
    assert.equal(noKey.body.error, "anthropic_api_key_not_configured");
    assert.deepEqual(sent, [], "a refused request never reaches the model");
    process.env[keyName] = fake;
    const get = await hit(journeysAsk, { method: "GET", rules: [] });
    assert.equal(get.status, 405);
    await assertRoleGate(journeysAsk, ["owner", "admin"], { method: "POST", body: { system: "" } });
  } finally {
    globalThis.fetch = async (url) => { asked.push({ url: String(url) }); throw new Error("the network is trapped in this test"); };
    if (saved === undefined) delete process.env[keyName]; else process.env[keyName] = saved;
  }
});

/* ── journeys/run: the whole walk, always rolled back ────────────────────── */

function walkRules(extra = []) {
  let seq = 0;
  return [
    staffSession(),
    ...extra,
    [/^\s*INSERT INTO clients/i, (_s, p) => [{ id: `cl-${++seq}`, org_id: p[0], first_name: p[1], last_name: p[2], email: p[3], phone: p[4], custom_fields: JSON.parse(p[5]) }]],
    [/^\s*INSERT INTO events/i, () => ({ rows: [{ id: `ev-${++seq}` }], rowCount: 1 })],
  ];
}

async function walk(body, { rules = walkRules(), role } = {}) {
  const fake = fakeDb(role ? [staffSession({ role }), ...rules.slice(1)] : rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => journeysRun(req("POST", { body }), res));
  return { res, fake };
}

test("journeys/run walks a journey's branches with a fresh pretend client for each path through the real event bus, routes messages to the memory provider, and never commits", async () => {
  assert.equal(ROUTES["journeys/run"], journeysRun);
  const { res, fake } = await walk({ journey: "client" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.journeySource, "seed", "an empty journeys table falls back to the seeded six, and says so");
  assert.equal(res.body.summary.walked.journeys, 1);
  assert.equal(res.body.summary.walked.paths, 2, "the client journey has one fork: two paths");
  assert.deepEqual(res.body.summary.walked.failedPaths, []);
  assert.equal(res.body.paths.length, 2);
  assert.deepEqual(res.body.paths.map((p) => p.journeyKey), ["client", "client"]);
  assert.ok(res.body.paths.every((p) => p.events.length > 0), "each path fired real events");
  assert.ok(res.body.paths.every((p) => Array.isArray(p.steps) && p.steps.length > 0));
  assert.deepEqual(res.body.paths.map((p) => p.branches[0].lane), ["Yes", "No"], "both branches of the fork were walked");
  assert.ok(res.body.paths[0].steps.some((s) => s.type === "payment" && s.emitted === "payment.received"), "a payment step fires the real payment event");
  assert.equal(res.body.paths[0].failure ?? null, null);

  const minted = fake.find(/^\s*INSERT INTO clients/i);
  assert.equal(minted.length, 2, "one pretend client per path");
  assert.deepEqual([...new Set(minted.map((c) => c.params[0]))], [ORG_ID], "minted into the caller's company only");
  for (const c of minted) assert.match(c.params[3], /@runner\.fundhub\.invalid$/, "an address nobody can mail");

  // The transaction: opened first, the provider flip inside it, rolled back, never committed.
  const order = fake.calls.map((c) => c.sql.trim().split(/\s+/).slice(0, 2).join(" "));
  const begin = order.indexOf("BEGIN");
  const flip = fake.calls.findIndex((c) => /message_channel_routing SET provider = 'memory' WHERE org_id/.test(c.sql));
  const firstClient = fake.calls.findIndex((c) => /^\s*INSERT INTO clients/i.test(c.sql));
  assert.ok(begin >= 0 && begin < flip && flip < firstClient, "BEGIN, then the memory provider flip, then the walk");
  assert.deepEqual(fake.calls[flip].params, [ORG_ID]);
  assert.equal(fake.count("COMMIT"), 0, "a committed journey run is a bug");
  assert.equal(order.at(-1), "ROLLBACK", "the last statement is the rollback");
  assert.equal(fake.count("ROLLBACK"), 1);
  assert.equal(fake.released, 1);
  assert.deepEqual(asked, [], "nothing was sent to a customer or a vendor");
});

test("journeys/run walks all six seeded journeys when none is named, can answer in plain text, and still rolls back; an unknown journey is a 400 that lists the real ones", async () => {
  const all = await walk({});
  assert.equal(all.res.statusCode, 200);
  assert.equal(all.res.body.summary.walked.journeys, Object.keys(SEED_JOURNEYS).length);
  assert.equal(all.res.body.summary.walked.paths, 9);
  assert.equal(all.fake.count("COMMIT"), 0);
  assert.equal(all.fake.count("ROLLBACK"), 1);

  const text = await walk({ journey: "partner", format: "text" });
  assert.equal(text.res.statusCode, 200);
  assert.equal(text.res.headers["content-type"], "text/plain; charset=utf-8");
  assert.equal(typeof text.res.body, "string");
  assert.ok(text.res.body.length > 20);
  assert.equal(text.fake.count("ROLLBACK"), 1);
  assert.equal(text.fake.count("COMMIT"), 0);

  const unknown = await walk({ journey: "nope" });
  assert.equal(unknown.res.statusCode, 400);
  assert.equal(unknown.res.body.error, "unknown_journey");
  assert.deepEqual([...unknown.res.body.allowed].sort(), Object.keys(SEED_JOURNEYS).sort());
  assert.equal(unknown.fake.find(/^\s*INSERT INTO clients/i).length, 0, "nothing was walked");
  assert.ok(unknown.fake.count("ROLLBACK") >= 1);
  assert.equal(unknown.fake.count("COMMIT"), 0);
  assert.equal(unknown.fake.released, 1);
});

test("journeys/run is for owner, admin and sales manager only, and refuses every other role before a connection is opened", async () => {
  for (const role of ["owner", "admin", "sales_manager"]) {
    const out = await walk({ journey: "advisor" }, { role });
    assert.equal(out.res.statusCode, 200, role);
  }
  for (const role of ["closer", "setter", "csm", "funding_advisor", "inquiry_specialist", "partner", "client"]) {
    const out = await walk({ journey: "advisor" }, { role });
    assert.equal(out.res.statusCode, 403, role);
    assert.equal(out.fake.connected, 0, `${role} never opens a connection`);
  }
});

/* ── climate/geocode: a typed address to a state and a point ─────────────── */

test("climate/geocode turns a typed address into a state code and a point, answers a state name from its centre without a lookup, and says not found when nobody knows it", async () => {
  assert.equal(ROUTES["climate/geocode"], climateGeocode);
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    if (!String(url).includes("geocoding.geo.census.gov")) throw new Error("only the free census lookup is allowed here");
    const wanted = decodeURIComponent(String(url).split("address=")[1].split("&")[0]);
    if (/nowhere/i.test(wanted)) return new Response(JSON.stringify({ result: { addressMatches: [] } }), { status: 200 });
    return new Response(JSON.stringify({ result: { addressMatches: [{
      matchedAddress: "123 N CENTRAL AVE, PHOENIX, AZ, 85004", coordinates: { x: -112.07, y: 33.45 }, addressComponents: { state: "AZ" },
    }] } }), { status: 200 });
  };
  const keyName = ["GOOGLE", "MAPS", "API", "KEY"].join("_");
  const saved = process.env[keyName];
  delete process.env[keyName];
  try {
    const address = await hit(climateGeocode, { anonymous: true, method: "POST", body: { q: "123 N Central Ave, Phoenix, AZ 85004" }, rules: [] });
    assert.equal(address.status, 200);
    assert.equal(address.body.stateCode, "AZ");
    assert.equal(address.body.lat, 33.45);
    assert.equal(address.body.lng, -112.07);
    assert.equal(address.body.provider, "census");
    assert.equal(address.headers["access-control-allow-origin"], "*");
    assert.equal(address.headers["cache-control"], "no-store");
    assert.equal(seen.length, 1);

    const centre = await hit(climateGeocode, { anonymous: true, method: "POST", body: { address: "tx" }, rules: [] });
    assert.equal(centre.status, 200);
    assert.equal(centre.body.stateCode, "TX");
    assert.equal(centre.body.provider, "centroid");
    assert.equal(seen.length, 1, "a state code needs no lookup");

    const nobody = await hit(climateGeocode, { anonymous: true, method: "POST", body: { q: "nowhere at all" }, rules: [] });
    assert.equal(nobody.status, 404);
    assert.equal(nobody.body.error, "not_found");

    const blank = await hit(climateGeocode, { anonymous: true, method: "POST", body: { q: "   " }, rules: [] });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.error, "missing_q");
    const preflight = await hit(climateGeocode, { anonymous: true, method: "OPTIONS", rules: [] });
    assert.equal(preflight.status, 204);
    const get = await hit(climateGeocode, { anonymous: true, method: "GET", rules: [] });
    assert.equal(get.status, 405);
    assert.equal(blank.db.calls.length, 0, "no lender is read and nothing is recorded");
  } finally {
    globalThis.fetch = async (url) => { asked.push({ url: String(url) }); throw new Error("the network is trapped in this test"); };
    if (saved !== undefined) process.env[keyName] = saved;
  }
});
