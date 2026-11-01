// /api/chat/messages — the real handler, run with no Postgres and no network.
//
// The chat widget on every staff desk can text a client ("Message > Client").
// composeAndSend itself is tested elsewhere; this door never ran in a test.
// This runs it: who may read which thread, the clock-in gate in front of a
// client text, and that a text is queued for the compliance gate (never sent
// straight from here). The network is refused for the whole file.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/chat/messages.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID, STAFF_ID
} from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c9000000-0000-4000-8000-000000000009";
const CONVO = "cc000000-0000-4000-8000-000000000001";
const MSG = "ee000000-0000-4000-8000-000000000001";

const netCalls = [];
const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = async (u) => { netCalls.push(String(u)); throw new Error("network refused in this test"); }; });
after(() => { globalThis.fetch = realFetch; });

async function call(request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

const clientInOrg = [/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2/, (_s, p) => (p[0] === CLIENT && p[1] === ORG_ID ? [{ id: CLIENT }] : [])];
const clientPhone = [/AS address FROM clients/, [{ address: "+16025550100" }]];
const convoUpsert = [/INSERT INTO conversations/, [{ id: CONVO, org_id: ORG_ID, client_id: CLIENT, channel: "sms" }]];
const msgInsert = [/INSERT INTO messages/, [{ id: MSG, created_at: "2026-10-10T17:00:00Z" }]];
const openShift = [/FROM shifts/, [{ id: "5f000000-0000-4000-8000-000000000001", staff_id: STAFF_ID, started_at: "2026-10-10T15:00:00Z", ended_at: null }]];

describe("/api/chat/messages", () => {
  test("is routed", () => {
    assert.equal(ROUTES["chat/messages"], handler);
  });

  test("no session: 401", async () => {
    const { res } = await call(req("GET"), []);
    assert.equal(res.statusCode, 401);
  });

  test("GET client threads reads only this company's threads", async () => {
    const { res, fake } = await call(
      req("GET", { query: { kind: "client", limit: "500" } }),
      [staffSession(), [/FROM conversations c\s+JOIN clients cl/, [{ id: CONVO, client_name: "Dana Whitfield" }]]]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.threads.length, 1);
    const [q] = fake.find(/FROM conversations c\s+JOIN clients cl/);
    assert.match(q.sql, /WHERE c\.org_id = \$1 AND c\.kind = 'client'/);
    assert.deepEqual(q.params, [ORG_ID, 100]);
  });

  test("GET client threads hides a mismatched foreign-company client and last message", async () => {
    const foreign = { id: CONVO, client_name: "Foreign Client", client_email: "foreign@example.test", last_body: "Private note" };
    const { res, fake } = await call(
      req("GET", { query: { kind: "client" } }),
      [staffSession(), [/FROM conversations c\s+JOIN clients cl/, (sql) =>
        /JOIN clients cl ON cl\.id = c\.client_id AND cl\.org_id = c\.org_id/.test(sql) ? [] : [foreign]]]
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.threads, []);
    const [q] = fake.find(/FROM conversations c\s+JOIN clients cl/);
    assert.match(q.sql, /m\.org_id = c\.org_id/, "a foreign-company message must not be previewed");
  });

  test("GET a thread from another company: 404", async () => {
    const { res } = await call(req("GET", { query: { conversation_id: CONVO } }), [staffSession()]);
    assert.equal(res.statusCode, 404);
  });

  test("GET a staff-to-staff thread you are not in: 403", async () => {
    const { res } = await call(
      req("GET", { query: { conversation_id: CONVO } }),
      [staffSession(), [/SELECT id, kind, org_id FROM conversations/, [{ id: CONVO, kind: "internal", org_id: ORG_ID }]]]
    );
    assert.equal(res.statusCode, 403);
  });

  test("an unknown kind is refused", async () => {
    const { res } = await call(req("POST", { body: { kind: "fax", body: "hi" } }), [staffSession()]);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body.allowed, ["internal", "client"]);
  });

  test("a closer who is not clocked in cannot text a client: 403, no message row", async () => {
    const { res, fake } = await call(
      req("POST", { body: { kind: "client", client_id: CLIENT, body: "Hi Dana" } }),
      [staffSession({ role: "closer" })]
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "no_active_shift");
    assert.equal(fake.find(/INSERT INTO messages/).length, 0);
  });

  test("a clocked-in closer's text is QUEUED for the compliance gate, in this company, from this person; nothing goes on the wire here", async () => {
    netCalls.length = 0;
    const { res, fake } = await call(
      req("POST", { body: { kind: "client", client_id: CLIENT, channel: "sms", body: "  Hi Dana, your call is at 3.  " } }),
      [staffSession({ role: "closer" }), openShift, clientInOrg, clientPhone, convoUpsert, msgInsert]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.kind, "client");
    assert.equal(res.body.conversation_id, CONVO);
    const [ins] = fake.find(/INSERT INTO messages/);
    assert.match(ins.sql, /'queued',false/);
    // org, client, conversation, channel, text, provider_ref, to, subject, sender
    assert.deepEqual(ins.params.slice(0, 9), [ORG_ID, CLIENT, CONVO, "sms", "Hi Dana, your call is at 3.", null, "+16025550100", null, STAFF_ID]);
    assert.equal(netCalls.length, 0);
  });

  test("the owner does not clock in, and can still text a client", async () => {
    const { res, fake } = await call(
      req("POST", { body: { kind: "client", client_id: CLIENT, body: "Hello" } }),
      [staffSession({ role: "owner" }), clientInOrg, clientPhone, convoUpsert, msgInsert]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(fake.find(/FROM shifts/).length, 0);
    assert.equal(fake.find(/INSERT INTO messages/).length, 1);
  });

  test("a client from another company is never texted (refused, no message row)", async () => {
    const { res, fake } = await call(
      req("POST", { body: { kind: "client", client_id: OTHER_CLIENT, body: "Hello" } }),
      [staffSession(), clientInOrg, clientPhone, convoUpsert, msgInsert]
    );
    assert.equal(res.body.ok, false);
    assert.ok(res.statusCode >= 400);
    assert.equal(fake.find(/INSERT INTO messages/).length, 0);
  });

  test("an empty text is refused, no message row", async () => {
    const { res, fake } = await call(
      req("POST", { body: { kind: "client", client_id: CLIENT, body: "   " } }),
      [staffSession(), clientInOrg, clientPhone, convoUpsert, msgInsert]
    );
    assert.equal(res.body.ok, false);
    assert.equal(fake.find(/INSERT INTO messages/).length, 0);
  });
});

/* Routing guards (Set A item 28, 2026-10-20): a thread id left over from the
   last client or teammate must never carry a message to them. */
describe("/api/chat/messages routes to the picked person only", () => {
  const PEER = "5b000000-0000-4000-8000-0000000000b2";
  const OTHER_PEER = "5b000000-0000-4000-8000-0000000000b3";
  const pair = (a, b) => (String(a) < String(b) ? `${a}:${b}` : `${b}:${a}`);
  const convoRow = (row) => [/SELECT kind, (client_id|internal_pair_key) FROM conversations WHERE id = \$1 AND org_id = \$2/, [row]];

  test("client: a thread that belongs to another client is refused (409), nothing queued", async () => {
    const { res, fake } = await call(
      req("POST", { body: { kind: "client", client_id: CLIENT, conversation_id: CONVO, body: "Hi Dana" } }),
      [staffSession({ role: "owner" }), convoRow({ kind: "client", client_id: OTHER_CLIENT }), clientInOrg, clientPhone, convoUpsert, msgInsert]
    );
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "conversation_client_mismatch");
    assert.equal(fake.find(/INSERT INTO messages/).length, 0);
  });

  test("client: an internal thread, or a thread from another company, is refused too", async () => {
    for (const row of [{ kind: "internal", client_id: null }, null]) {
      const rules = [staffSession({ role: "owner" }), clientInOrg, clientPhone, convoUpsert, msgInsert];
      if (row) rules.splice(1, 0, convoRow(row));
      const { res, fake } = await call(req("POST", { body: { kind: "client", client_id: CLIENT, conversation_id: CONVO, body: "Hi" } }), rules);
      assert.equal(res.statusCode, 409, JSON.stringify(row));
      assert.equal(fake.find(/INSERT INTO messages/).length, 0);
    }
  });

  test("internal: a thread with another teammate is refused (409), nothing saved", async () => {
    const { res, fake } = await call(
      req("POST", { body: { kind: "internal", conversation_id: CONVO, peer_staff_id: PEER, body: "Are you on the 3pm?" } }),
      [staffSession(), convoRow({ kind: "internal", internal_pair_key: pair(STAFF_ID, OTHER_PEER) })]
    );
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "conversation_peer_mismatch");
    assert.equal(fake.find(/INSERT INTO messages/).length, 0);
  });

  test("internal: the thread between you and that teammate goes through to the participant check", async () => {
    const { res, fake } = await call(
      req("POST", { body: { kind: "internal", conversation_id: CONVO, peer_staff_id: PEER, body: "Are you on the 3pm?" } }),
      [staffSession(), convoRow({ kind: "internal", internal_pair_key: pair(STAFF_ID, PEER) })]
    );
    // The guard let it pass; the next gate (are you on this thread?) answers, here with no participant row.
    assert.notEqual(res.statusCode, 409);
    assert.equal(fake.find(/FROM conversation_participants/).length, 1);
  });
});
