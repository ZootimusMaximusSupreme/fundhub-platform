// The staff reply path, end to end, against a real database.
//
// composeAndSend() is the only thing in this repository that turns typed words
// into an outbound message, and the claim that matters about it is NEGATIVE:
// that it cannot get a message past the compliance gate that a workflow's send
// could not get past. Those cases are the bulk of this file.
//
// WHY THESE ARE pg TESTS AND NOT STUBBED. The gate reads compliance_rules and
// opt_outs from the database, the dispatcher's claim is an UPDATE ... RETURNING
// whose whole point is atomicity, and the thread link is a join across two
// tables. A stub that answered for any of those would be asserting the shape of
// the fake, which is the failure mode AUDIT-FINDINGS warns about. Skipped
// without DATABASE_URL — that is honest, and the request-shape cases that need
// no database live in compose.test.mjs next door.
//
// THIS SUITE OWNS ITS OWN ORG. Channels route to the `memory` provider on THAT
// org only — never by UPDATE-ing the default org's message_channel_routing.
// See src/messaging/pg-test-fixture.mjs for why the shared-org pattern is
// permanently forbidden.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { composeAndSend, MAX_BODY_LENGTH } from "./compose.mjs";
import { OUTCOME } from "./dispatch.mjs";
import { recorded, reset as resetMemory } from "./providers/memory.mjs";
import { recordOptOut } from "../lib/opt-out.mjs";
import { createMemoryRoutedOrg, destroyMemoryRoutedOrg } from "./pg-test-fixture.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "compose_pg_test@example.com";
const ORG_SLUG = "compose-pg-test";
const OTHER_ORG_SLUG = "compose-pg-test-other";
const OTHER_ORG = "Compose Test Co Other";

let orgId = null;
let staffId = null;
let clientId = null;
let convoId = null;
let otherOrgId = null;
let otherClientId = null;

/* A clock fixed OUTSIDE quiet hours: 18:00 UTC is 11:00 in Arizona, the middle
   of the open window, and Arizona does not shift for daylight saving so it is
   11:00 on every date of the year. Injected rather than read, so this file's result
   does not depend on what time the suite runs — which is the whole reason the
   gate takes a clock as an argument. */
const OPEN = () => new Date("2026-03-10T18:00:00Z");
/* And one inside it: 05:00 UTC is 22:00 the previous evening in Arizona. */
const CLOSED = () => new Date("2026-03-10T05:00:00Z");

async function wipeClients() {
  await db.query(`DELETE FROM staff_events WHERE detail->>'client_id' IN (SELECT id::text FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM messages WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM conversations WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM opt_outs WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  // The gate raises one of these when it holds a message for restricted
  // wording, and tasks.client_id has no ON DELETE — so the client below cannot
  // be removed until the work it generated is.
  await db.query(`DELETE FROM tasks WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM clients WHERE email LIKE $1`, [`%${EMAIL}`]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipeClients();
  await destroyMemoryRoutedOrg(db, { slug: OTHER_ORG_SLUG });
  await destroyMemoryRoutedOrg(db, { slug: ORG_SLUG });

  ({ orgId, staffId } = await createMemoryRoutedOrg(db, {
    slug: ORG_SLUG,
    name: "Compose Pg Test",
    staffEmail: "compose_pg_owner@example.com",
    staffName: "Compose Owner",
    copyComplianceRules: true
  }));

  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone)
     VALUES ($1,$2,'Reply','Target','+15550000222') RETURNING id`,
    [orgId, `mine_${EMAIL}`])).rows[0].id;

  convoId = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel) VALUES ($1,$2,'sms') RETURNING id`,
    [orgId, clientId])).rows[0].id;

  otherOrgId = (await db.query(
    `INSERT INTO orgs (name, slug) VALUES ($1,$2) RETURNING id`,
    [OTHER_ORG, OTHER_ORG_SLUG])).rows[0].id;
  otherClientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone)
     VALUES ($1,$2,'Other','Company','+15550000333') RETURNING id`,
    [otherOrgId, `theirs_${EMAIL}`])).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipeClients();
  await destroyMemoryRoutedOrg(db, { orgId: otherOrgId, slug: OTHER_ORG_SLUG });
  await destroyMemoryRoutedOrg(db, { orgId, slug: ORG_SLUG });
  await close();
});

beforeEach(() => { if (HAS_DB) resetMemory(); });

const send = (input, options = {}) => composeAndSend(db, {
  orgId, staffId, body: "here is your update", ...input
}, { now: OPEN, ...options });

/* ─────────────────────────────── the happy path ─────────────────────────── */

test("compose: a reply on an open thread is sent and lands in that same thread",
  { skip: !HAS_DB }, async () => {
  const out = await send({ conversationId: convoId, body: "calling you at two" });

  assert.equal(out.outcome, OUTCOME.SENT);
  assert.equal(out.conversationId, convoId);
  assert.equal(out.message.status, "sent");
  assert.equal(out.message.direction, "outbound");
  assert.equal(out.message.conversation_id, convoId, "the reply is not on the thread it was written on");
  assert.equal(out.message.rendered_body, "calling you at two",
    "what was typed is not what was stored — there is no template here to render");

  // It really reached a provider, with the client's number resolved for it.
  const sentOut = recorded();
  assert.equal(sentOut.length, 1);
  assert.equal(sentOut[0].to, "+15550000222");
  assert.equal(sentOut[0].body, "calling you at two");
});

test("compose: the message records who sent it", { skip: !HAS_DB }, async () => {
  const out = await send({ conversationId: convoId });
  assert.equal(out.message.sender_staff_id, staffId);
});

test("compose: no conversation id starts one, and a second message reuses it",
  { skip: !HAS_DB }, async () => {
  const first = await send({ clientId, channel: "email", body: "first email", subject: "Your file" });
  const second = await send({ clientId, channel: "email", body: "second email" });

  assert.equal(first.outcome, OUTCOME.SENT);
  assert.equal(second.conversationId, first.conversationId,
    "a second email minted a second thread — the upsert's conflict target is not being used");

  const rows = await db.query(
    `SELECT count(*)::int AS n FROM conversations WHERE client_id = $1 AND channel = 'email'`, [clientId]);
  assert.equal(rows.rows[0].n, 1, "one thread per client per channel");
  assert.equal(first.message.subject, "Your file");
  assert.equal(second.message.subject, null, "an email with no subject must store NULL, not an empty string");
});

/* ───────────────────────── the gate, which is the point ─────────────────── */

test("compose: a client who asked us to stop does not get a staff reply either",
  { skip: !HAS_DB }, async () => {
  const stopped = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone)
     VALUES ($1,$2,'Opted','Out','+15550000444') RETURNING id`,
    [orgId, `stopped_${EMAIL}`])).rows[0].id;
  await recordOptOut(db, stopped, orgId, "sms", "inbound_keyword");

  const out = await send({ clientId: stopped, channel: "sms", body: "just checking in" });

  assert.equal(out.outcome, OUTCOME.BLOCKED);
  assert.equal(out.message.status, "blocked");
  assert.match(String(out.message.blocked_reason), /opted_out/);
  assert.equal(recorded().length, 0, "a blocked message reached a provider");
});

test("compose: an overnight text is held until the window opens, not failed",
  { skip: !HAS_DB }, async () => {
  const out = await send({ conversationId: convoId, body: "are you up" }, { now: CLOSED });

  assert.equal(out.outcome, OUTCOME.DEFERRED);
  // Still queued and still sendable — a deferral is not a block, and the row
  // must not carry a permanent blocked_reason for a window that opens by itself.
  assert.equal(out.message.status, "queued");
  assert.equal(out.message.blocked_reason, null);
  assert.ok(out.message.scheduled_at, "the deferred text has no time to wake up at");
  assert.equal(recorded().length, 0);
});

test("compose: quiet hours do not apply to email", { skip: !HAS_DB }, async () => {
  const out = await send({ clientId, channel: "email", body: "overnight email" }, { now: CLOSED });
  assert.equal(out.outcome, OUTCOME.SENT);
});

test("compose: restricted wording is blocked and raises a task for a human",
  { skip: !HAS_DB }, async () => {
  /* A real claim, not a synthetic token. This sentence is what the rules in
     047_compliance_rules.sql exist to stop an employee putting in front of a
     consumer — it trips `guaranteed-score-increase` and `guaranteed-timeline`
     — and it is written out in full here so the case still means something
     when somebody reads it in a year. The assertion is on WHICH rule fired, so
     a rule set that stops covering this sentence fails loudly rather than
     passing on some other block. */
  const out = await send({
    conversationId: convoId,
    body: "we guarantee a 100 point score increase in 30 days"
  });

  assert.equal(out.outcome, OUTCOME.BLOCKED,
    "a staff member typing a guaranteed-outcome claim by hand is still a guaranteed-outcome claim");
  assert.match(String(out.message.blocked_reason), /guaranteed-score-increase/);
  assert.equal(recorded().length, 0);

  const task = await db.query(
    `SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = 'messaging-gate' LIMIT 1`, [clientId]);
  assert.equal(task.rows.length, 1, "a held message with wrong copy left nobody any work to do");
});

/* ───────────────────────────── scope and shape ──────────────────────────── */

test("compose: another company's conversation cannot be replied to", { skip: !HAS_DB }, async () => {
  const theirConvo = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel) VALUES ($1,$2,'sms') RETURNING id`,
    [otherOrgId, otherClientId])).rows[0].id;

  await assert.rejects(
    () => send({ conversationId: theirConvo }),
    (err) => err.code === "BAD_REQUEST",
    "a conversation belonging to another company was writable"
  );
  assert.equal(recorded().length, 0);
});

test("compose: a same-org thread pointing to a foreign client is not replyable",
  { skip: !HAS_DB }, async () => {
  // A conversation has a client FK, but the schema does not enforce a matching
  // client org. This intentionally malformed scratch row must not be sendable.
  const misbound = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel) VALUES ($1,$2,'sms') RETURNING id`,
    [orgId, otherClientId])).rows[0].id;

  await assert.rejects(
    () => send({ conversationId: misbound, body: "private funding update" }),
    (err) => err.code === "BAD_REQUEST" && /no such conversation/.test(err.message),
    "a foreign customer's thread must not be treated as a valid own-org thread"
  );
  assert.equal(recorded().length, 0, "the foreign customer received a message");
  const stored = await db.query(
    `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1`,
    [misbound]);
  assert.equal(stored.rows[0].n, 0, "a rejected reply still wrote a message row");
});

test("compose: another company's client cannot be messaged", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => send({ clientId: otherClientId, channel: "sms" }),
    (err) => err.code === "BAD_REQUEST"
  );
  assert.equal(recorded().length, 0);
});

test("compose: a voice thread cannot be replied to by typing", { skip: !HAS_DB }, async () => {
  const voice = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel) VALUES ($1,$2,'voice') RETURNING id`,
    [orgId, clientId])).rows[0].id;
  await assert.rejects(() => send({ conversationId: voice }), (err) => err.code === "BAD_REQUEST");
});

test("compose: an empty or over-long body is refused and nothing is queued",
  { skip: !HAS_DB }, async () => {
  const before = (await db.query(`SELECT count(*)::int AS n FROM messages WHERE client_id = $1`, [clientId])).rows[0].n;
  for (const body of ["", "   ", "x".repeat(MAX_BODY_LENGTH + 1)]) {
    await assert.rejects(() => send({ conversationId: convoId, body }), (err) => err.code === "BAD_REQUEST");
  }
  const after_ = (await db.query(`SELECT count(*)::int AS n FROM messages WHERE client_id = $1`, [clientId])).rows[0].n;
  assert.equal(after_, before, "a refused compose still wrote a row");
});

/* ───────────────────────────── idempotency ─────────────────────────────── */

test("compose: the same idempotency key sends once and returns the first message",
  { skip: !HAS_DB }, async () => {
  const key = `compose-test-${convoId}`;
  const first = await send({ conversationId: convoId, body: "double click", idempotencyKey: key });
  const second = await send({ conversationId: convoId, body: "double click", idempotencyKey: key });

  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(second.message.id, first.message.id);
  assert.equal(recorded().length, 1, "the same key sent twice");
});

test("compose: without a key, two identical replies are two real messages",
  { skip: !HAS_DB }, async () => {
  const a = await send({ conversationId: convoId, body: "ok" });
  const b = await send({ conversationId: convoId, body: "ok" });
  assert.notEqual(a.message.id, b.message.id,
    "two 'ok' replies were collapsed into one — a client waiting on the second never got it");
  assert.equal(recorded().length, 2);
});

/* ───────────────────────────── telemetry ───────────────────────────────── */

test("compose: a sent text files the staff_events row the seam was built for",
  { skip: !HAS_DB }, async () => {
  const out = await send({ conversationId: convoId, body: "telemetry check" });
  assert.equal(out.outcome, OUTCOME.SENT);

  const row = await db.query(
    `SELECT kind, staff_id, detail FROM staff_events
      WHERE detail->>'message_id' = $1 LIMIT 1`, [out.message.id]);
  assert.equal(row.rows.length, 1, "a text a person sent left no record that they sent it");
  assert.equal(row.rows[0].kind, "text_sent");
  assert.equal(row.rows[0].staff_id, staffId);
  // Client-facing copy is not copied into a work index. Same rule as sendTemplated.
  assert.equal(row.rows[0].detail.body, undefined);
});

test("compose: a blocked text files no telemetry — it is not a text anyone sent",
  { skip: !HAS_DB }, async () => {
  const stopped = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone)
     VALUES ($1,$2,'No','Telemetry','+15550000555') RETURNING id`,
    [orgId, `notel_${EMAIL}`])).rows[0].id;
  await recordOptOut(db, stopped, orgId, "sms", "inbound_keyword");

  const out = await send({ clientId: stopped, channel: "sms", body: "blocked" });
  assert.equal(out.outcome, OUTCOME.BLOCKED);

  const row = await db.query(
    `SELECT 1 FROM staff_events WHERE detail->>'message_id' = $1`, [out.message.id]);
  assert.equal(row.rows.length, 0, "a message the client never received was counted as work done");
});

test("compose: an email files no staff_events row, because there is no kind for one",
  { skip: !HAS_DB }, async () => {
  // Not a gap being papered over — src/shifts/telemetry.mjs's vocabulary is five
  // frozen names and `text_sent` is not one an email may borrow. Recorded in
  // docs/REPLY-INBOX-SPEC.md rather than invented here.
  const out = await send({ clientId, channel: "email", body: "emailed" });
  assert.equal(out.outcome, OUTCOME.SENT);
  const row = await db.query(
    `SELECT 1 FROM staff_events WHERE detail->>'message_id' = $1`, [out.message.id]);
  assert.equal(row.rows.length, 0);
});
