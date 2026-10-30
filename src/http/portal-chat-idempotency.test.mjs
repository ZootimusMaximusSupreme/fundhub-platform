// Front-house client portal retry proof. Real handler, mocked SQL, no provider calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import portalMessage from "../../api/chat/portal-message.mjs";
import {
  accountSession, fakeDb, makeRes, req, runWithSharedDb, ORG_ID
} from "../testing/handler-harness.mjs";

const A = "c1000000-0000-4000-8000-000000000001";
const B = "c2000000-0000-4000-8000-000000000002";
const KEY = "87d0a0c3-e15a-4f00-8bad-9c1e7b73f222";

function world() {
  let activeClient = A;
  const stored = [];
  const [sessionRule, accountRule] = accountSession({ kind: "client", clientId: A });
  const fake = fakeDb([
    sessionRule,
    [accountRule[0], () => accountRule[1]().map((row) => ({ ...row, client_id: activeClient }))],
    [/INSERT INTO conversations \(org_id, client_id, channel/, (_sql, args) =>
      [{ id: args[1] === A ? "conv-A" : "conv-B", org_id: args[0], client_id: args[1] }]],
    [/INSERT INTO messages \(/, (_sql, args) => {
      const [org_id, client_id, conversation_id, channel, rendered_body, provider_ref] = args;
      if (provider_ref && stored.some((m) => m.org_id === org_id && m.provider_ref === provider_ref)) return [];
      const row = { id: "saved-" + (stored.length + 1), org_id, client_id,
        conversation_id, channel, rendered_body, provider_ref,
        direction: "inbound", sender_kind: "client", status: "received" };
      stored.push(row);
      return [row];
    }],
    [/FROM messages\s+WHERE org_id = \$1 AND client_id = \$2 AND provider_ref = \$3/, (_sql, args) =>
      stored.filter((m) => m.org_id === args[0] && m.client_id === args[1] && m.provider_ref === args[2])],
    [/UPDATE messages m\s+SET conversation_id/, (_sql, args) => [{ id: args[0] }]],
    // Simulate the optional assistant context query failing before an AI call.
    // The client note must still save and the test must never contact a model.
    [/SELECT first_name, custom_fields FROM clients/, new Error("assistant unavailable in this test")]
  ]);
  async function post(body) {
    const res = makeRes();
    await portalMessage(req("POST", { body }), res);
    return res;
  }
  return { fake, stored, post, as(client) { activeClient = client; } };
}

test("lost response replay returns one saved client note, never a second insertion", async () => {
  const w = world();
  await runWithSharedDb(w.fake, async () => {
    const body = { body: "Can my advisor call?", channel: "sms", idempotency_key: KEY };
    const first = await w.post(body);
    const again = await w.post(body);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.deduped, undefined);
    assert.equal(again.statusCode, 200);
    assert.equal(again.body.deduped, true);
    assert.equal(first.body.message.id, again.body.message.id);
    assert.equal(w.stored.length, 1, "one durable note");
    assert.equal(w.stored[0].provider_ref, "portal:" + A + ":" + KEY);
    const inserts = w.fake.find(/INSERT INTO messages \(/);
    assert.equal(inserts.length, 2, "second SQL insert safely hits the unique index");
    assert.match(inserts[0].sql, /ON CONFLICT \(org_id, provider_ref\) WHERE provider_ref IS NOT NULL DO NOTHING/);
    const read = w.fake.find(/FROM messages\s+WHERE org_id = \$1 AND client_id = \$2 AND provider_ref = \$3/)[0];
    assert.deepEqual(read.params, [ORG_ID, A, "portal:" + A + ":" + KEY]);
  });
});

test("same key with changed body is a conflict, not a false saved acknowledgement", async () => {
  const w = world();
  await runWithSharedDb(w.fake, async () => {
    await w.post({ body: "First note", idempotency_key: KEY });
    const altered = await w.post({ body: "Different note", idempotency_key: KEY });
    assert.equal(altered.statusCode, 409);
    assert.equal(altered.body.error, "idempotency_key_reused");
    assert.equal(w.stored.length, 1);
  });
});

test("two distinct clients with the same random key get independent messages", async () => {
  const w = world();
  await runWithSharedDb(w.fake, async () => {
    const a = await w.post({ body: "Client A note", idempotency_key: KEY });
    w.as(B);
    const b = await w.post({ body: "Client B note", idempotency_key: KEY });
    assert.equal(a.statusCode, 200);
    assert.equal(b.statusCode, 200);
    assert.equal(w.stored.length, 2);
    assert.equal(w.stored[0].client_id, A);
    assert.equal(w.stored[1].client_id, B);
    assert.notEqual(w.stored[0].provider_ref, w.stored[1].provider_ref);
  });
});

test("malformed key refuses before a message write; older clients without a key still work", async () => {
  const w = world();
  await runWithSharedDb(w.fake, async () => {
    const invalid = await w.post({ body: "Bad key", idempotency_key: "!wrong!" });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.error, "invalid_idempotency_key");
    assert.equal(w.fake.find(/INSERT INTO messages \(/).length, 0);
    const old = await w.post({ body: "Older portal note", channel: "sms" });
    assert.equal(old.statusCode, 200);
    assert.equal(w.stored.length, 1);
    assert.equal(w.stored[0].provider_ref, null);
  });
});


test("portal GET returns the latest 100 own-client messages, not the first 100 or another buyer's", async () => {
  const own = Array.from({ length: 125 }, (_, i) => ({
    id: "note-" + String(i + 1).padStart(3, "0"),
    org_id: ORG_ID, client_id: A, conversation_id: "conv-A",
    direction: "inbound", channel: "sms", sender_kind: "client",
    rendered_body: "Note " + (i + 1),
    created_at: new Date(Date.UTC(2026, 9, 29, 12, i + 1)).toISOString()
  }));
  const foreign = { ...own[own.length - 1], client_id: B,
    rendered_body: "Other person's private reply" };
  const fake = fakeDb([
    ...accountSession({ kind: "client", clientId: A }),
    [/SELECT id FROM conversations/, (_sql, params) => {
      assert.deepEqual(params, [ORG_ID, A]);
      return [{ id: "conv-A" }];
    }],
    [/SELECT \* FROM \(\s*SELECT m\.id/, (sql, params) => {
      assert.deepEqual(params, [ORG_ID, A, "conv-A", 100]);
      assert.match(sql, /m\.org_id = \$1 AND m\.client_id = \$2 AND m\.conversation_id = \$3/);
      assert.match(sql, /ORDER BY m\.created_at DESC, m\.id DESC\s+LIMIT \$4/);
      assert.match(sql, /ORDER BY recent\.created_at ASC, recent\.id ASC/);
      return [...own, foreign]
        .filter((m) => m.org_id === params[0] && m.client_id === params[1] && m.conversation_id === params[2])
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, params[3])
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    }]
  ]);
  await runWithSharedDb(fake, async () => {
    const res = makeRes();
    await portalMessage(req("GET", { query: { limit: "100" } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.messages.length, 100);
    assert.equal(res.body.messages[0].rendered_body, "Note 26");
    assert.equal(res.body.messages[99].rendered_body, "Note 125");
    assert.equal(res.body.messages.some((row) => row.rendered_body.includes("private reply")), false);
  });
});
