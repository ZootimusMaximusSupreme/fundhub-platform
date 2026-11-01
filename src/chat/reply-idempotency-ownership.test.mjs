// Cross-role chat replay guard: actual service functions, fake SQL, NO provider calls.
// These are source/in-memory proofs only; production remains read-only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { composeAndSend } from "../messaging/compose.mjs";
import { sendInternalMessage } from "./internal.mjs";

const ORG = "aa000000-0000-4000-8000-000000000001";
const STAFF_A = "bb000000-0000-4000-8000-000000000001";
const STAFF_B = "bb000000-0000-4000-8000-000000000002";
const CLIENT_A = "cc000000-0000-4000-8000-000000000001";
const CLIENT_B = "cc000000-0000-4000-8000-000000000002";
const THREAD_A = "dd000000-0000-4000-8000-000000000001";
const THREAD_B = "dd000000-0000-4000-8000-000000000002";
const KEY = "873b06b2-61f9-444e-aa2c-92ddfcd9e111";
const TEXT = "Important client update";

function priorClient(overrides = {}) {
  return {
    id: "ee000000-0000-4000-8000-000000000001",
    org_id: ORG, client_id: CLIENT_A, conversation_id: THREAD_A,
    channel: "sms", rendered_body: TEXT, status: "sent",
    to_address: "+16025550101", subject: null, attachments: [],
    sender_staff_id: STAFF_A, direction: "outbound", sender_kind: "staff",
    provider_ref: "staff:" + KEY, ...overrides
  };
}
function composeWorld(prior) {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/FROM conversations cv/.test(sql)) {
        return { rows: [{
          id: params[0],
          client_id: params[0] === THREAD_A ? CLIENT_A : CLIENT_B,
          channel: "sms"
        }] };
      }
      if (/INSERT INTO messages/.test(sql)) {
        // Simulate the real Postgres unique key rejecting a duplicate.
        return { rows: [] };
      }
      if (/FROM messages WHERE org_id = \$1 AND provider_ref = \$2/.test(sql)) {
        assert.deepEqual(params, [ORG, "staff:" + KEY]);
        return { rows: prior ? [prior] : [] };
      }
      throw new Error("unexpected SQL in isolated dedupe proof: " + sql);
    }
  };
  const send = (overrides = {}) => composeAndSend(db, {
    orgId: ORG, staffId: STAFF_A, conversationId: THREAD_A,
    body: TEXT, idempotencyKey: KEY, toAddress: "+16025550101",
    ...overrides
  });
  return { send, queries };
}

test("staff to client: an identical request replay returns its original row without dispatch", async () => {
  const w = composeWorld(priorClient());
  const result = await w.send();
  assert.equal(result.deduped, true);
  assert.equal(result.message.client_id, CLIENT_A);
  assert.equal(result.conversationId, THREAD_A);
  assert.equal(w.queries.filter(({ sql }) => /INSERT INTO messages/.test(sql)).length, 1);
  assert.equal(w.queries.some(({ sql }) => /FROM messages WHERE org_id = \$1 AND provider_ref = \$2/.test(sql)), true);
  // Any query after the duplicate read would be a dispatcher/provider interaction.
  assert.equal(w.queries.length, 3);
});

test("staff to client: a reused key with another client, thread, author or words never exposes the original", async () => {
  const cases = [
    priorClient({ client_id: CLIENT_B }),
    priorClient({ conversation_id: THREAD_B }),
    priorClient({ sender_staff_id: STAFF_B }),
    priorClient({ rendered_body: "Private previous note" }),
    priorClient({ to_address: "+16025550102" }),
    priorClient({ subject: "Changed subject" }),
    priorClient({ attachments: [{ asset: "private-file" }] }),
    priorClient({ channel: "email" }),
    priorClient({ sender_kind: "agent" }),
    priorClient({ direction: "inbound" })
  ];
  for (const original of cases) {
    const w = composeWorld(original);
    await assert.rejects(w.send(), (error) => {
      assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
      assert.equal(error.message, "idempotency_key_reused");
      assert.doesNotMatch(String(error), /Private previous note/);
      return true;
    });
    assert.equal(w.queries.length, 3);
  }
});

test("staff to client: an index conflict with no readable prior fails closed", async () => {
  const w = composeWorld(null);
  await assert.rejects(w.send(), { code: "IDEMPOTENCY_CONFLICT" });
});

function internalWorld({ silentFirstRead = false } = {}) {
  const rows = [];
  let inserts = 0;
  let unreadable = silentFirstRead;
  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/FROM conversation_participants/.test(sql)) return { rows: [{ valid: 1 }] };
      if (/SELECT id, org_id, kind FROM conversations/.test(sql)) {
        return { rows: [{ id: params[0], org_id: params[1], kind: "internal" }] };
      }
      if (/SELECT \* FROM messages WHERE org_id = \$1 AND provider_ref = \$2/.test(sql)) {
        if (unreadable) { unreadable = false; return { rows: [] }; }
        return { rows: rows.filter((m) => m.org_id === params[0] && m.provider_ref === params[1]) };
      }
      if (/INSERT INTO messages/.test(sql)) {
        inserts += 1;
        assert.match(sql, /ON CONFLICT \(org_id, provider_ref\) WHERE provider_ref IS NOT NULL DO NOTHING/);
        if (rows.some((m) => m.org_id === params[0] && m.provider_ref === params[4])) {
          return { rows: [] };
        }
        const row = {
          id: "msg-" + (rows.length + 1), org_id: params[0], conversation_id: params[1],
          rendered_body: params[2], sender_staff_id: params[3], provider_ref: params[4],
          direction: "outbound", channel: "internal", sender_kind: "staff",
          status: "delivered"
        };
        rows.push(row);
        return { rows: [row] };
      }
      if (/UPDATE conversations SET last_pulse_at/.test(sql)) return { rows: [] };
      throw new Error("unexpected SQL in isolated internal proof: " + sql);
    }
  };
  const send = (overrides = {}) => sendInternalMessage(db, {
    orgId: ORG, staffId: STAFF_A, conversationId: THREAD_A,
    body: "Can you review the file?", idempotencyKey: KEY,
    ...overrides
  });
  return { send, rows, queries, get inserts() { return inserts; } };
}

test("internal: one message is saved; retry cannot produce a second private teammate message", async () => {
  const w = internalWorld();
  const first = await w.send();
  const again = await w.send();
  assert.equal(first.deduped, false);
  assert.equal(again.deduped, true);
  assert.equal(first.message.id, again.message.id);
  assert.equal(w.rows.length, 1);
  assert.equal(w.inserts, 1);
});

test("internal: unique-index race becomes one validated replay, not duplicate insert or 500", async () => {
  const w = internalWorld();
  await w.send();
  // A second request can miss the first read under concurrency; exercise the
  // INSERT...ON CONFLICT fallback explicitly using a new fake with one row.
  const existing = w.rows[0];
  const x = internalWorld({ silentFirstRead: true });
  x.rows.push(existing);
  const again = await x.send();
  assert.equal(again.deduped, true);
  assert.equal(x.rows.length, 1);
  assert.equal(x.inserts, 1);
});

test("internal: same key cannot name another teammate thread, author or modified body", async () => {
  const w = internalWorld();
  await w.send();
  for (const edit of [
    { conversationId: THREAD_B },
    { staffId: STAFF_B },
    { body: "A private different note" }
  ]) {
    await assert.rejects(w.send(edit), (error) => {
      assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
      assert.equal(error.message, "idempotency_key_reused");
      return true;
    });
  }
  assert.equal(w.rows.length, 1);
  assert.equal(w.inserts, 1);
});

test("HTTP handler advertises 409 for conflicting message retry keys", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const src = readFileSync(path.join(root, "api/chat/messages.mjs"), "utf8");
  assert.match(src, /code === "IDEMPOTENCY_CONFLICT"/);
  assert.match(src, /status\(409\)\.json\(\{ ok: false, error: "idempotency_key_reused" \}\)/);
});
