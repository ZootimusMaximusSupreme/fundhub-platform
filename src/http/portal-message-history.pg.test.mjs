// Real Postgres proof of the signed-in portal's unified message history.
// Run only against a disposable DATABASE_URL; this test writes synthetic rows.
import { randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createAccountSession } from "../auth/account-session.mjs";
import portalMessage from "../../api/chat/portal-message.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const suffix = randomUUID().slice(0, 8);
const orgs = [];
const clients = [];
let accountId;
let sessionId;
let token;
let orgId;
let clientId;
let smsId;
let emailId;
let foreignStaffId;

const response = () => ({
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

async function read(clientToken = token, query = {}) {
  const res = response();
  await portalMessage({
    method: "GET", query, headers: { authorization: `Bearer ${clientToken}` }
  }, res);
  return res;
}

before(async () => {
  if (!HAS_DB) return;
  for (const label of ["home", "other"]) {
    const row = (await db.query(
      `INSERT INTO orgs (name, slug) VALUES ($1, $2) RETURNING id`,
      [`Portal history ${label} ${suffix}`, `portal-history-${label}-${suffix}`]
    )).rows[0];
    orgs.push(row.id);
  }
  orgId = orgs[0];
  for (const [org, label] of [[orgs[0], "mine"], [orgs[0], "sibling"], [orgs[1], "other"]]) {
    const row = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1, $2, 'Portal', 'History') RETURNING id`,
      [org, `portal-history-${label}-${suffix}@example.test`]
    )).rows[0];
    clients.push(row.id);
  }
  clientId = clients[0];
  foreignStaffId = (await db.query(
    `INSERT INTO staff (org_id, name, email, role, status)
     VALUES ($1, 'Foreign Staff Secret', $2, 'owner', 'active') RETURNING id`,
    [orgs[1], `portal-history-foreign-staff-${suffix}@example.test`]
  )).rows[0].id;
  accountId = (await db.query(
    `INSERT INTO accounts (org_id, kind, email, name, status, client_id, password_hash)
     VALUES ($1, 'client', $2, 'Portal History', 'active', $3, 'scrypt$placeholder')
     RETURNING id`,
    [orgId, `portal-history-account-${suffix}@example.test`, clientId]
  )).rows[0].id;
  const session = await createAccountSession(db, { accountId, orgId });
  token = session.token;
  sessionId = session.sessionId;

  smsId = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, last_pulse_at)
     VALUES ($1, $2, 'sms', '2026-10-28T12:00:00Z') RETURNING id`,
    [orgId, clientId]
  )).rows[0].id;
  emailId = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, last_pulse_at)
     VALUES ($1, $2, 'email', '2026-10-30T12:00:00Z') RETURNING id`,
    [orgId, clientId]
  )).rows[0].id;
  for (const [org, client, convo, channel, body, at] of [
    [orgId, clientId, smsId, "sms", "Older client text", "2026-10-28T12:00:00Z"],
    [orgId, clientId, emailId, "email", "Newer staff email", "2026-10-30T12:00:00Z"],
    [orgId, clientId, null, "email", "Unthreaded client email", "2026-10-31T12:00:00Z"],
    [orgId, clientId, null, "voice", "Internal call detail", "2026-10-31T12:30:00Z"],
    [orgId, clients[1], null, "sms", "Sibling private message", "2026-10-31T13:00:00Z"],
    [orgs[1], clients[2], null, "email", "Other org private email", "2026-10-31T14:00:00Z"]
  ]) {
    await db.query(
      `INSERT INTO messages
       (org_id, client_id, conversation_id, direction, channel, rendered_body, status, created_at)
       VALUES ($1, $2, $3, 'outbound', $4, $5, 'sent', $6)`,
      [org, client, convo, channel, body, at]
    );
  }
  for (const [ref, template, body] of [
    [`staff-alert:lead:${suffix}:staff`, null, "Private lead alert"],
    [`setter:${suffix}:closer:staff`, null, "Private closer handoff"],
    [`workflow:SMS-S04C-STAFF-BOOKED:${suffix}:staff`, "SMS-S04C-STAFF-BOOKED", "Private booking alert"],
    [`workflow:SMS-DEAL-CLOSE-WIN:${suffix}:staff`, "SMS-DEAL-CLOSE-WIN", "Private deal alert"]
  ]) {
    await db.query(
      `INSERT INTO messages
       (org_id, client_id, direction, channel, rendered_body, status, created_at,
        provider_ref, template_key, to_address)
       VALUES ($1, $2, 'outbound', 'sms', $3, 'sent', '2026-10-31T15:00:00Z',
               $4, $5, '+15550000888')`,
      [orgId, clientId, body, ref, template]
    );
  }
});

after(async () => {
  if (!HAS_DB) return;
  if (sessionId) await db.query(`DELETE FROM account_sessions WHERE id = $1`, [sessionId]);
  if (clients.length) await db.query(`DELETE FROM messages WHERE client_id = ANY($1)`, [clients]);
  if (clients.length) await db.query(`DELETE FROM conversations WHERE client_id = ANY($1)`, [clients]);
  if (accountId) await db.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
  if (foreignStaffId) await db.query(`DELETE FROM staff WHERE id = $1`, [foreignStaffId]);
  if (clients.length) await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [clients]);
  if (orgs.length) await db.query(`DELETE FROM orgs WHERE id = ANY($1)`, [orgs]);
  await close();
});

test("portal history mixes saved SMS and email across threads in time order", { skip: !HAS_DB }, async () => {
  const res = await read();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.conversation_id, smsId, "legacy SMS conversation id stays stable");
  assert.deepEqual(res.body.messages.map((m) => m.rendered_body), [
    "Older client text", "Newer staff email", "Unthreaded client email"
  ]);
  assert.deepEqual(res.body.messages.map((m) => m.channel), ["sms", "email", "email"]);
});

test("portal history limits the newest messages across channels and never leaks another client or org", { skip: !HAS_DB }, async () => {
  const res = await read(token, { limit: "2" });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.messages.map((m) => m.rendered_body), [
    "Newer staff email", "Unthreaded client email"
  ]);
});

test("portal history does not expose a foreign company's staff name from a mispointed sender", { skip: !HAS_DB }, async () => {
  const id = (await db.query(
    `INSERT INTO messages
     (org_id, client_id, conversation_id, direction, channel, rendered_body,
      status, sender_staff_id, sender_kind)
     VALUES ($1, $2, $3, 'outbound', 'email', 'Staff attribution check',
             'sent', $4, 'staff') RETURNING id`,
    [orgId, clientId, emailId, foreignStaffId]
  )).rows[0].id;
  try {
    const reply = await read();
    assert.equal(reply.statusCode, 200, JSON.stringify(reply.body));
    const message = reply.body.messages.find((row) => row.id === id);
    assert.ok(message, "the home-company message remains visible");
    assert.equal(message.sender_name, null);
    assert.doesNotMatch(JSON.stringify(reply.body), /Foreign Staff Secret/);
  } finally {
    await db.query(`DELETE FROM messages WHERE id = $1`, [id]);
  }
});
