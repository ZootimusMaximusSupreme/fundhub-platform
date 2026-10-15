// Batch 24, repair cycle 1: chat/messages, chat/ask and journeys/run.
//
// An independent checker found these stayed green when the product broke:
//   * chat/messages: the success bodies were never checked for ok:true (the widget
//     paints nothing without it), the pair thread was only judged in one
//     direction (so an unsorted pair key made a second thread), a client thread
//     was never in the data, and a company in the request was never tried.
//   * chat/ask: the request never carried a company or a role, so "the search is
//     scoped to the session, never the request" was untested; the answer's
//     "thin" flag was never true; the database handed to the search was not looked at.
//   * journeys/run: the safety fact the file's own comments call a requirement
//     (nothing is handed to the live job cloud) was not judged, because the old
//     test trapped the network but the job cloud is reached through its own
//     client. The journeys-from-the-database path (company, Demo Mode and editor
//     key filters) was never walked because the stand-in table was empty.
//
// The real api/ handlers. This is a PRACTICE TEST with fake data. It is not a live
// check. Nothing is sent and no model is asked.

import assert from "node:assert/strict";
import test, { after, afterEach, before } from "node:test";

import chatAsk from "../../../../api/chat/ask.mjs";
import chatMessages from "../../../../api/chat/messages.mjs";
import journeysRun from "../../../../api/journeys/run.mjs";
import { canQueryBrain } from "../../../company-brain/access.mjs";
import { db as sharedDb } from "../../../db.mjs";
import { SEED_JOURNEYS } from "../../../journeys/seed-journeys.mjs";
import { SYNTHETIC_FIELD } from "../../../messaging/live-fence.mjs";
import { headline } from "../../../journeys/runner/report.mjs";
import { inngest } from "../../../workflows/client.mjs";
import { ORG_ID, OTHER_ORG_ID, STAFF_ID, fakeDb, makeRes, req, runWithSharedDb, staffSession } from "../../../testing/handler-harness.mjs";
import { EVERY_ROLE, hit, sqlCalls } from "./s5-route-kit.mjs";
import { clause, shelf } from "./s1-proof-kit.mjs";

const realFetch = globalThis.fetch;
const wire = [];
before(() => {
  globalThis.fetch = async (url) => { wire.push(String(url)); throw new Error("the network is trapped in this test"); };
});
after(() => { globalThis.fetch = realFetch; });

const PEER_ID = "5a000000-0000-4000-8000-0000000000b2";
const CONVO = "c0000000-0000-4000-8000-000000000001";
const CLIENT_CONVO = "c0000000-0000-4000-8000-0000000000c1";
// A request that tries to name a company of its own.
const HOSTILE = { org_id: OTHER_ORG_ID };

/* ── chat/messages ───────────────────────────────────────────────────────── */

function chatWorld({ withPair = true } = {}) {
  const world = {
    conversations: [
      ...(withPair ? [{ id: CONVO, org_id: ORG_ID, kind: "internal", channel: "internal", internal_pair_key: [STAFF_ID, PEER_ID].sort().join(":"), participants: [STAFF_ID, PEER_ID], last_pulse_at: "2026-10-13T10:00:00.000Z" }] : []),
      // A customer thread this staff member is in: it must never be in the internal list.
      { id: CLIENT_CONVO, org_id: ORG_ID, kind: "client", channel: "sms", internal_pair_key: null, participants: [STAFF_ID], last_pulse_at: "2026-10-13T12:00:00.000Z" },
    ],
    staff: [
      { id: PEER_ID, org_id: ORG_ID, status: "active" },
      { id: STAFF_ID, org_id: ORG_ID, status: "active" },
    ],
    messages: [
      { id: "m1", org_id: ORG_ID, conversation_id: CONVO, direction: "outbound", channel: "internal", rendered_body: "first", status: "delivered", sender_staff_id: STAFF_ID, sender_kind: "staff", created_at: "2026-10-13T09:00:00.000Z", provider_ref: null },
      { id: "m2", org_id: ORG_ID, conversation_id: CONVO, direction: "outbound", channel: "internal", rendered_body: "second", status: "delivered", sender_staff_id: PEER_ID, sender_kind: "staff", created_at: "2026-10-13T10:00:00.000Z", provider_ref: null },
    ],
    inserts: [],
    created: [],
  };
  let n = 0;
  world.rules = [
    [/FROM conversations c\s+JOIN conversation_participants me/, (sql, p) => shelf(world.conversations, [
      clause(/c\.org_id = \$1/, (c, params) => c.org_id === params[0]),
      clause(/me\.staff_id = \$2/, (c, params) => c.participants.includes(params[1])),
      clause(/c\.kind = 'internal'/, (c) => c.kind === "internal"),
    ])(sql, p).map((c) => ({ id: c.id, kind: c.kind, channel: c.channel, last_pulse_at: c.last_pulse_at, created_at: c.last_pulse_at, participants: c.participants.map((id) => ({ id })), last_body: "hello" }))],
    [/SELECT id, kind, org_id FROM conversations WHERE id = \$1 AND org_id = \$2/, (_sql, p) => world.conversations
      .filter((c) => c.id === p[0] && c.org_id === p[1]).map((c) => ({ id: c.id, kind: c.kind, org_id: c.org_id }))],
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
    [/SELECT id FROM staff WHERE id = \$1 AND org_id = \$2 AND status = 'active'/, (_sql, p) =>
      world.staff.filter((s) => s.id === p[0] && s.org_id === p[1] && s.status === "active").map((s) => ({ id: s.id }))],
    [/INSERT INTO conversations/, (_sql, p) => {
      const row = { id: `c1000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, org_id: p[0], kind: "internal", channel: "internal", internal_pair_key: p[1], participants: [] };
      world.conversations.push(row);
      world.created.push(row);
      return [row];
    }],
    [/INSERT INTO conversation_participants/, (_sql, p) => {
      const c = world.conversations.find((x) => x.id === p[0]);
      c.participants.push(p[1], p[2]);
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

test("chat/messages answers ok:true with the staff member's own internal threads and a thread's messages, never a customer thread, and the company is the sign-in's", async () => {
  const world = chatWorld();
  const threads = await hit(chatMessages, { role: "closer", query: { kind: "internal", ...HOSTILE }, rules: world.rules });
  assert.equal(threads.status, 200);
  assert.equal(threads.body.ok, true, "the widget paints nothing without ok:true");
  assert.deepEqual(threads.body.threads.map((t) => t.id), [CONVO], "the staff-to-staff thread only: not the customer thread this person is also in");
  assert.deepEqual(sqlCalls(threads, /FROM conversations c\s+JOIN conversation_participants me/)[0].params, [ORG_ID, STAFF_ID, 30]);

  const thread = await hit(chatMessages, { query: { conversation_id: CONVO, ...HOSTILE }, rules: world.rules });
  assert.equal(thread.status, 200);
  assert.equal(thread.body.ok, true);
  assert.deepEqual(thread.body.messages.map((m) => m.rendered_body), ["first", "second"]);
  assert.deepEqual(sqlCalls(thread, /SELECT id, kind, org_id FROM conversations/)[0].params, [CONVO, ORG_ID]);
  assert.deepEqual(sqlCalls(thread, /FROM messages m/)[0].params, [ORG_ID, CONVO, 100]);
});

test("chat/messages sends one delivered message and answers ok:true, in either direction of the pair, with one thread for the pair and the company from the sign-in", async () => {
  // The first person writes: the pair's existing thread is used.
  const forward = chatWorld();
  const sent = await hit(chatMessages, { method: "POST", role: "closer", body: { kind: "internal", peer_staff_id: PEER_ID, body: "ping", ...HOSTILE }, rules: forward.rules });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.ok, true);
  assert.equal(sent.body.conversation_id, CONVO);
  assert.equal(forward.inserts.length, 1);
  assert.equal(forward.inserts[0].org_id, ORG_ID, "saved for the sign-in's company, not the request's");
  assert.equal(forward.created.length, 0);

  // The OTHER person answers the same pair: the same thread, not a second one.
  const backward = chatWorld();
  const answered = await hit(chatMessages, {
    method: "POST", staff: { staff_id: PEER_ID }, body: { kind: "internal", peer_staff_id: STAFF_ID, body: "pong", ...HOSTILE }, rules: backward.rules,
  });
  assert.equal(answered.status, 200);
  assert.equal(answered.body.ok, true);
  assert.equal(answered.body.conversation_id, CONVO, "the same pair is one thread whoever writes first");
  assert.equal(backward.created.length, 0, "no second thread was made for the same two people");
  assert.equal(backward.inserts[0].sender_staff_id, PEER_ID);
  assert.equal(backward.inserts[0].org_id, ORG_ID);

  // A first message between two people with no thread yet makes it once, keyed the same either way round.
  const fresh = chatWorld({ withPair: false });
  const first = await hit(chatMessages, {
    method: "POST", staff: { staff_id: PEER_ID }, body: { kind: "internal", peer_staff_id: STAFF_ID, body: "hello" }, rules: fresh.rules,
  });
  assert.equal(first.status, 200);
  assert.equal(fresh.created.length, 1);
  assert.equal(fresh.created[0].internal_pair_key, [STAFF_ID, PEER_ID].sort().join(":"), "the lower id first, whichever of the two wrote");
  assert.equal(fresh.created[0].org_id, ORG_ID);
});

/* ── chat/ask ────────────────────────────────────────────────────────────── */

function spies({ thin = false } = {}) {
  const seen = { help: [], retrieve: [], synth: [] };
  return {
    seen,
    deps: {
      env: { MARKER: "env" },
      fetchImpl: "fetch-stand-in",
      answerStaffQuestion: async (args) => { seen.help.push(args); return { text: "Open the Money tab.", thin, source: "platform_help", sources: [] }; },
      retrieveChunks: async (database, args) => { seen.retrieve.push({ database, ...args }); return { ok: true, chunks: [{ id: "c1", text: "The refund policy is 30 days." }] }; },
      synthesizeAnswer: async (args) => { seen.synth.push(args); return { text: "Refunds are 30 days.", thin, source: "brain", citations: [] }; },
    },
  };
}

test("chat/ask searches for the signed-in person's company and role whatever the request says, and hands the search the handler's own database", async () => {
  const { seen, deps } = spies();
  const out = await hit(chatAsk, {
    method: "POST", role: "closer",
    body: { mode: "knowledge", question: "What is the refund policy?", role: "owner", org_id: OTHER_ORG_ID, orgId: OTHER_ORG_ID, limit: 3 }, deps,
  });
  assert.equal(out.status, 200);
  assert.equal(seen.retrieve.length, 1);
  assert.equal(seen.retrieve[0].orgId, ORG_ID, "the company comes from the session, not the request");
  assert.equal(seen.retrieve[0].role, "closer", "a closer asking for the owner tier still searches as a closer");
  assert.equal(seen.retrieve[0].database, sharedDb, "the search reads through the handler's own database");
  assert.equal(seen.retrieve[0].query, "What is the refund policy?");
});

test("chat/ask tells the screen when it is thin on evidence, in both modes, and says not thin when it is not", async () => {
  for (const [thin, mode] of [[true, "system"], [true, "knowledge"], [false, "system"], [false, "knowledge"]]) {
    const { deps } = spies({ thin });
    const out = await hit(chatAsk, { method: "POST", body: { mode, question: "q" }, deps });
    assert.equal(out.status, 200);
    assert.equal(out.body.answer.thin, thin, `${mode}, thin ${thin}`);
  }
});

test("chat/ask lets knowledge mode through for exactly the roles the Company Brain admits, and refuses every other login before any search", async () => {
  // canQueryBrain is the same set the staff gate admits today, so the line inside the door
  // that repeats it cannot be seen on its own: what is judged is the behaviour, role by role.
  for (const role of EVERY_ROLE) {
    const { seen, deps } = spies();
    const out = await hit(chatAsk, { method: "POST", role, body: { mode: "knowledge", question: "q" }, deps });
    if (canQueryBrain(role)) {
      assert.equal(out.status, 200, role);
      assert.equal(seen.retrieve.length, 1, role);
    } else {
      assert.equal(out.status, 403, role);
      assert.equal(seen.retrieve.length + seen.synth.length, 0, `${role} is refused before any search`);
    }
  }
});

/* ── journeys/run ────────────────────────────────────────────────────────── */

function walkRules(extra = []) {
  let seq = 0;
  return [
    staffSession(),
    ...extra,
    [/^\s*INSERT INTO clients/i, (_s, p) => [{ id: `cl-${++seq}`, org_id: p[0], first_name: p[1], last_name: p[2], email: p[3], phone: p[4], custom_fields: JSON.parse(p[5]) }]],
    [/^\s*INSERT INTO events/i, () => ({ rows: [{ id: `ev-${++seq}` }], rowCount: 1 })],
  ];
}

async function walk(body, { extra = [] } = {}) {
  const fake = fakeDb(walkRules(extra));
  const res = makeRes();
  await runWithSharedDb(fake, () => journeysRun(req("POST", { body }), res));
  return { res, fake };
}

const TABLE_ROW = (key, over = {}) => ({
  org_id: ORG_ID, key, name: SEED_JOURNEYS[key]?.name ?? key, start_when: "start", end_when: "end", description: "d",
  nodes: SEED_JOURNEYS.client.nodes, is_demo: false, ...over,
});

const realSend = inngest.send;
const savedKey = process.env.INNGEST_EVENT_KEY;
afterEach(() => {
  inngest.send = realSend;
  if (savedKey === undefined) delete process.env.INNGEST_EVENT_KEY; else process.env.INNGEST_EVENT_KEY = savedKey;
});

test("journeys/run hands nothing to the live job cloud, even with its key set, and every event it fires goes through the real event bus", async () => {
  // The branch that sends is only reachable when the key is set. Turn it on with a value that is not
  // a credential, and stand a counter in front of the job cloud's own client: that is where a send goes.
  process.env.INNGEST_EVENT_KEY = ["not", "a", "real", "key", "this", "test", "only"].join("-");
  const sent = [];
  inngest.send = async (...args) => { sent.push(args); return args; };
  const { res, fake } = await walk({ journey: "client" });
  assert.equal(res.statusCode, 200);
  const fired = res.body.paths.flatMap((p) => p.events.map((e) => e.name));
  assert.ok(fired.length > 0, "the run really fired events, so a zero below means something");
  assert.deepEqual(sent, [], "a rollback cannot recall a packet that already left the machine");
  assert.equal(fake.count("COMMIT"), 0);

  // Every event is a row saved by the real bus, in the transaction that is rolled back.
  const rows = fake.find(/^\s*INSERT INTO events/i).map((c) => c.params[1]);
  for (const name of new Set(fired)) assert.ok(rows.includes(name), `${name} was written by the event bus`);
  assert.ok(rows.length >= fired.length);
});

test("journeys/run's report names what the walk did: a headline for its own numbers, the journeys it left out and why, the journeys nothing can start, and a mark on every pretend client", async () => {
  const table = shelf([
    TABLE_ROW("client"),
    TABLE_ROW("setter"),
    TABLE_ROW("advisor", { is_demo: true }),
    TABLE_ROW("demo-platform-nurture", { is_demo: true }),
    TABLE_ROW("mystery"),
    TABLE_ROW("closer", { org_id: OTHER_ORG_ID }),
  // Anchored to the end of the statement: a condition added after it (OR true) is not the company's.
  ], [clause(/WHERE org_id = \$1\s*$/, (row, p) => row.org_id === p[0])]);
  const { res, fake } = await walk({}, { extra: [[/FROM journeys WHERE org_id = \$1/, (sql, p) => table(sql, p)]] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.journeySource, "database", "journeys saved in the editor are walked, not the seeded six");
  assert.deepEqual([...new Set(res.body.paths.map((p) => p.journeyKey))].sort(), ["client", "setter"], "this company's real journeys only");
  assert.equal(res.body.summary.walked.journeys, 2);
  assert.deepEqual(res.body.journeysSkipped.map((s) => s.key).sort(), ["advisor", "demo-platform-nurture", "mystery"], "left out in the open, not dropped quietly");
  assert.match(res.body.journeysSkipped.find((s) => s.key === "advisor").reason, /Demo Mode/);
  assert.match(res.body.journeysSkipped.find((s) => s.key === "mystery").reason, /editor does not own/);
  assert.deepEqual(sqlCalls({ db: fake }, /FROM journeys WHERE org_id = \$1/)[0].params, [ORG_ID]);

  assert.equal(typeof res.body.headline, "string");
  assert.ok(res.body.headline.length > 20, "a headline is written");
  assert.equal(res.body.headline, headline(res.body.summary), "the headline is the summary's own words");

  // Every pretend client carries the mark that says it is not a person.
  const minted = fake.find(/^\s*INSERT INTO clients/i);
  assert.ok(minted.length >= 2);
  for (const c of minted) {
    const marks = JSON.parse(c.params[5]);
    assert.equal(marks[SYNTHETIC_FIELD], true);
    assert.ok(marks.synthetic_run_id && marks.synthetic_journey, "run and journey are on it");
  }
  assert.deepEqual(wire, []);

  // A journey with no opening event is named in the report, with its reason.
  const partner = await walk({ journey: "partner" });
  assert.equal(partner.res.statusCode, 200);
  assert.equal(partner.res.body.startEventFindings.length, 1);
  assert.equal(partner.res.body.startEventFindings[0].journey, "partner");
  assert.equal(partner.res.body.startEventFindings[0].status, "no-canonical-event");
  assert.deepEqual(partner.res.body.journeysSkipped, [], "the seeded fallback leaves nothing out");
});
