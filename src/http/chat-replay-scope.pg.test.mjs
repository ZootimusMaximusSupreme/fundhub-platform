// Real Postgres proof for staff chat replay and mismatched tenant references.
// Run only with a disposable DATABASE_URL; all rows are synthetic.
import { randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/chat/messages.mjs";
import messagesHandler from "../../api/messages.mjs";
import { sendInternalMessage, pairKey } from "../chat/internal.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const suffix = randomUUID().slice(0, 8);
const orgs = [];
const staff = [];
const clients = [];
const conversations = [];
let sessionId;
let token;

const res = () => ({
  statusCode: null, body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

async function call(method, query = {}, body = {}) {
  const response = res();
  await handler({ method, query, body, headers: { authorization: `Bearer ${token}` } }, response);
  return response;
}

async function callMessageWrite(body) {
  const response = res();
  await messagesHandler({ method: "POST", body, headers: { authorization: `Bearer ${token}` } }, response);
  return response;
}

before(async () => {
  if (!HAS_DB) return;
  for (const label of ["home", "foreign"]) {
    orgs.push((await db.query(
      `INSERT INTO orgs (name, slug) VALUES ($1, $2) RETURNING id`,
      [`Chat scope ${label} ${suffix}`, `chat-scope-${label}-${suffix}`]
    )).rows[0].id);
  }
  for (const [org, label] of [[orgs[0], "owner"], [orgs[0], "peer"], [orgs[1], "foreign"]]) {
    staff.push((await db.query(
      `INSERT INTO staff (org_id, name, email, role, status)
       VALUES ($1, $2, $3, 'owner', 'active') RETURNING id`,
      [org, label, `chat-scope-${label}-${suffix}@example.test`]
    )).rows[0].id);
  }
  const session = await createSession(db, { orgId: orgs[0], staffId: staff[0] });
  token = session.token;
  sessionId = session.sessionId;
  for (const [org, label] of [[orgs[0], "mine"], [orgs[1], "foreign"]]) {
    clients.push((await db.query(
      `INSERT INTO clients (org_id, first_name, email)
       VALUES ($1, $2, $3) RETURNING id`,
      [org, label, `chat-scope-${label}-${suffix}@example.test`]
    )).rows[0].id);
  }
});

after(async () => {
  if (!HAS_DB) return;
  if (sessionId) await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
  if (orgs.length) await db.query(`DELETE FROM messages WHERE org_id = ANY($1)`, [orgs]);
  if (conversations.length) await db.query(`DELETE FROM conversations WHERE id = ANY($1)`, [conversations]);
  if (staff.length) await db.query(`DELETE FROM staff WHERE id = ANY($1)`, [staff]);
  if (clients.length) await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [clients]);
  if (orgs.length) await db.query(`DELETE FROM orgs WHERE id = ANY($1)`, [orgs]);
  await close();
});

test("staff thread list hides a mispointed foreign client and foreign message preview", { skip: !HAS_DB }, async () => {
  const wrongClient = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel)
     VALUES ($1, $2, 'sms') RETURNING id`,
    [orgs[0], clients[1]]
  )).rows[0].id;
  conversations.push(wrongClient);
  const ownThread = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel)
     VALUES ($1, $2, 'sms') RETURNING id`,
    [orgs[0], clients[0]]
  )).rows[0].id;
  conversations.push(ownThread);
  await db.query(
    `INSERT INTO messages (org_id, client_id, conversation_id, direction, channel, rendered_body, status)
     VALUES ($1, $2, $3, 'outbound', 'sms', 'Foreign private note', 'sent')`,
    [orgs[1], clients[1], ownThread]
  );
  const reply = await call("GET", { kind: "client" });
  assert.equal(reply.statusCode, 200, JSON.stringify(reply.body));
  assert.deepEqual(reply.body.threads.map((row) => row.id), [ownThread]);
  assert.equal(reply.body.threads[0].client_name, "mine");
  assert.equal(reply.body.threads[0].last_body, null);
  assert.doesNotMatch(JSON.stringify(reply.body), /foreign|private note/i);
});

test("staff message endpoint returns a safe 409 for a reused key with changed text", { skip: !HAS_DB }, async () => {
  const thread = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel)
     VALUES ($1, $2, 'email') RETURNING id`,
    [orgs[0], clients[0]]
  )).rows[0].id;
  conversations.push(thread);
  const key = randomUUID();
  const originalId = (await db.query(
    `INSERT INTO messages
     (org_id, client_id, conversation_id, direction, channel, rendered_body,
      provider_ref, status, to_address, sender_staff_id, sender_kind, attachments)
     VALUES ($1, $2, $3, 'outbound', 'email', 'Original note',
             $4, 'sent', $5, $6, 'staff', '[]'::jsonb) RETURNING id`,
    [orgs[0], clients[0], thread, `staff:${key}`,
      `chat-scope-mine-${suffix}@example.test`, staff[0]]
  )).rows[0].id;
  const reply = await callMessageWrite({
    conversation_id: thread,
    body: "Changed note",
    idempotency_key: key
  });
  assert.equal(reply.statusCode, 409, JSON.stringify(reply.body));
  assert.deepEqual(reply.body, { ok: false, error: "idempotency_key_reused" });
  const saved = (await db.query(
    `SELECT id, rendered_body FROM messages WHERE org_id = $1 AND provider_ref = $2`,
    [orgs[0], `staff:${key}`]
  )).rows;
  assert.deepEqual(saved.map(({ id, rendered_body }) => ({ id, rendered_body })), [
    { id: originalId, rendered_body: "Original note" }
  ]);
});

test("concurrent internal retries save one row; changed author, thread or body gets a safe conflict", { skip: !HAS_DB }, async () => {
  const thread = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, kind, internal_pair_key)
     VALUES ($1, NULL, 'internal', 'internal', $2) RETURNING id`,
    [orgs[0], pairKey(staff[0], staff[1])]
  )).rows[0].id;
  conversations.push(thread);
  await db.query(
    `INSERT INTO conversation_participants (conversation_id, staff_id) VALUES ($1, $2), ($1, $3)`,
    [thread, staff[0], staff[1]]
  );
  const body = "Please review the file";
  const key = randomUUID();
  const send = (overrides = {}) => sendInternalMessage(db, {
    orgId: orgs[0], staffId: staff[0], conversationId: thread, body, idempotencyKey: key,
    ...overrides
  });
  const [first, replay] = await Promise.all([send(), send()]);
  assert.equal(first.message.id, replay.message.id);
  assert.equal(Number(first.deduped) + Number(replay.deduped), 1);
  const count = await db.query(
    `SELECT count(*)::int AS n FROM messages WHERE org_id = $1 AND provider_ref = $2`,
    [orgs[0], `internal:${key}`]
  );
  assert.equal(count.rows[0].n, 1);
  for (const changed of [{ body: "Changed private note" }, { staffId: staff[1] }]) {
    await assert.rejects(send(changed), { code: "IDEMPOTENCY_CONFLICT" });
  }
  const otherThread = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, kind, internal_pair_key)
     VALUES ($1, NULL, 'internal', 'internal', $2) RETURNING id`,
    [orgs[0], `other:${key}`]
  )).rows[0].id;
  conversations.push(otherThread);
  await db.query(
    `INSERT INTO conversation_participants (conversation_id, staff_id) VALUES ($1, $2), ($1, $3)`,
    [otherThread, staff[0], staff[1]]
  );
  await assert.rejects(send({ conversationId: otherThread }), { code: "IDEMPOTENCY_CONFLICT" });
  const conflict = await call("POST", {}, {
    kind: "internal", conversation_id: thread, body: "Changed private note", idempotency_key: key
  });
  assert.equal(conflict.statusCode, 409);
  assert.deepEqual(conflict.body, { ok: false, error: "idempotency_key_reused" });

  await db.query(
    `INSERT INTO conversation_participants (conversation_id, staff_id) VALUES ($1, $2)`,
    [thread, staff[2]]
  );
  await db.query(
    `INSERT INTO messages
     (org_id, conversation_id, direction, channel, rendered_body, status,
      sender_staff_id, sender_kind, created_at)
     VALUES ($1, $2, 'outbound', 'internal', 'Foreign private note', 'delivered',
             $3, 'staff', now() + interval '1 day')`,
    [orgs[1], thread, staff[2]]
  );
  await db.query(
    `INSERT INTO messages
     (org_id, conversation_id, direction, channel, rendered_body, status,
      sender_staff_id, sender_kind)
     VALUES ($1, $2, 'outbound', 'internal', 'Unowned author note', 'delivered',
             $3, 'staff')`,
    [orgs[0], thread, staff[2]]
  );
  const listing = await call("GET", { kind: "internal" });
  assert.equal(listing.statusCode, 200, JSON.stringify(listing.body));
  const listed = listing.body.threads.find((row) => row.id === thread);
  assert.ok(listed);
  assert.equal(listed.participants.length, 2);
  assert.doesNotMatch(JSON.stringify(listed), /Foreign private note|foreign@example\.test/i);
  const history = await call("GET", { conversation_id: thread });
  assert.equal(history.statusCode, 200, JSON.stringify(history.body));
  assert.doesNotMatch(JSON.stringify(history.body), /Foreign private note/);
  assert.equal(history.body.messages.find((m) => m.rendered_body === "Unowned author note").sender_name, null);
});
