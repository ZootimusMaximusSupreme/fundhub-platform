/* The reply check, against a real Postgres.
 *
 * WHY A DATABASE TEST AND NOT ONLY THE FAKE. The workflow tests prove the
 * decision ("a reply stops the chase"). They cannot prove the SQL, and the SQL is
 * where this lives: a JSON field read, a digit strip on a phone number, a
 * company scope and a time compare against another row. A fake that answers the
 * way its author expected proves the author, not the query. See
 * nobook-chase-historical.pg.test.mjs for the day that mistake shipped.
 *
 * The shapes that exist in production right now:
 *   1. an email reply, saved with the person on it
 *   2. a text reply, saved with NO person and the sender's number in payload.from
 *      (the Twilio adapter never sets client_id)
 *   3. a reply from before the run started, which must not count
 *   4. somebody else's reply, or another company's, which must not count
 *
 * SKIPS unless DATABASE_URL is a loopback scratch or CI database (the same lock
 * as src/verification/scratch-guard.mjs). It does not pass quietly.
 */

import { test, before, after } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { hasReplied } from "./stop-on-reply.mjs";

// Writes and deletes its own rows, so it runs only on a loopback scratch or CI database.
const HAS_DB = isLocalScratchDatabaseUrl(process.env.DATABASE_URL);
const SLUG = "stop-on-reply-test";
const OTHER_SLUG = "stop-on-reply-other";

let orgId = null;
let otherOrgId = null;

async function makeClient(org, { email, phone }) {
  const r = await db.query(
    `INSERT INTO clients (org_id, email, phone, first_name, last_name)
     VALUES ($1,$2,$3,'Reply','Check') RETURNING id`,
    [org, email, phone]
  );
  return r.rows[0].id;
}

/** The event that starts a run, created at a fixed moment. */
async function startEvent(org, clientId, at) {
  const r = await db.query(
    `INSERT INTO events (org_id, name, version, client_id, payload, created_at)
     VALUES ($1,'survey.completed',1,$2,'{}'::jsonb,$3) RETURNING id`,
    [org, clientId, at]
  );
  return r.rows[0].id;
}

/** An inbound event. clientId null is the text-message shape. */
async function inbound(org, { clientId = null, payload, at, name = "message.inbound" }) {
  await db.query(
    `INSERT INTO events (org_id, name, version, client_id, payload, created_at)
     VALUES ($1,$2,1,$3,$4,$5)`,
    [org, name, clientId, JSON.stringify(payload), at]
  );
}

const T0 = "2026-10-31T16:00:00Z";
const BEFORE = "2026-10-31T15:59:00Z";
const AFTER = "2026-10-31T16:30:00Z";

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,'Stop On Reply')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [SLUG]
  )).rows[0].id;
  otherOrgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,'Stop On Reply Other')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [OTHER_SLUG]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  for (const org of [orgId, otherOrgId]) {
    await db.query(`DELETE FROM events WHERE org_id = $1`, [org]);
    await db.query(`DELETE FROM clients WHERE org_id = $1`, [org]);
  }
  await db.query(`DELETE FROM orgs WHERE slug = ANY($1)`, [[SLUG, OTHER_SLUG]]);
  await close();
});

test("nobody has written back — the chase is right to keep going",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId, { email: "quiet@reply.test", phone: "+15551110001" });
    const start = await startEvent(orgId, id, T0);
    assert.equal(await hasReplied(db, { clientId: id, eventId: start }), false);
  });

test("an email reply with the person on it, after the run began, counts",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId, { email: "mail@reply.test", phone: "+15551110002" });
    const start = await startEvent(orgId, id, T0);
    await inbound(orgId, { clientId: id, at: AFTER, payload: { channel: "email", from: "mail@reply.test", body: "yes" } });
    assert.equal(await hasReplied(db, { clientId: id, eventId: start }), true);
  });

test("a reply from BEFORE the run began does not count",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId, { email: "early@reply.test", phone: "+15551110003" });
    const start = await startEvent(orgId, id, T0);
    await inbound(orgId, { clientId: id, at: BEFORE, payload: { channel: "email", body: "hello" } });
    await inbound(orgId, { clientId: null, at: BEFORE, payload: { channel: "sms", from: "+15551110003", body: "hi" } });
    assert.equal(await hasReplied(db, { clientId: id, eventId: start }), false);
  });

test("THE POINT: a text reply with NO person on the event is matched by the sender's number",
  { skip: !HAS_DB }, async () => {
    // Every inbound text in production looks exactly like this: client_id NULL,
    // E.164 number in payload.from. The person is stored however the form wrote it.
    const id = await makeClient(orgId, { email: "text@reply.test", phone: "(555) 111-0004" });
    const start = await startEvent(orgId, id, T0);
    await inbound(orgId, { clientId: null, at: AFTER, payload: { channel: "sms", from: "+15551110004", to: "+16616054248", body: "who is this" } });
    assert.equal(await hasReplied(db, { clientId: id, eventId: start }), true);
  });

test("a text from a different number does not count",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId, { email: "other@reply.test", phone: "+15551110005" });
    const start = await startEvent(orgId, id, T0);
    await inbound(orgId, { clientId: null, at: AFTER, payload: { channel: "sms", from: "+15551119999", body: "hi" } });
    assert.equal(await hasReplied(db, { clientId: id, eventId: start }), false);
  });

test("a short or missing phone number never matches by accident",
  { skip: !HAS_DB }, async () => {
    const short = await makeClient(orgId, { email: "short@reply.test", phone: "1234" });
    const none = await makeClient(orgId, { email: "none@reply.test", phone: null });
    const startShort = await startEvent(orgId, short, T0);
    const startNone = await startEvent(orgId, none, T0);
    await inbound(orgId, { clientId: null, at: AFTER, payload: { channel: "sms", from: "999-1234", body: "hi" } });
    await inbound(orgId, { clientId: null, at: AFTER, payload: { channel: "sms", body: "no number at all" } });
    assert.equal(await hasReplied(db, { clientId: short, eventId: startShort }), false);
    assert.equal(await hasReplied(db, { clientId: none, eventId: startNone }), false);
  });

test("another company's text from the same number does not count",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId, { email: "shared@reply.test", phone: "+15551110006" });
    const start = await startEvent(orgId, id, T0);
    await inbound(otherOrgId, { clientId: null, at: AFTER, payload: { channel: "sms", from: "+15551110006", body: "hi" } });
    assert.equal(await hasReplied(db, { clientId: id, eventId: start }), false);
  });

test("somebody else's reply on a shared number does not stop this person's chase",
  { skip: !HAS_DB }, async () => {
    // Two people on one phone (a husband and wife). The reply is stamped with the
    // other person and carries the shared number; the number fallback is only for
    // events that have nobody on them, so it is not this person's reply.
    const mine = await makeClient(orgId, { email: "sharer-a@reply.test", phone: "+15551110007" });
    const theirs = await makeClient(orgId, { email: "sharer-b@reply.test", phone: "+15551110007" });
    const start = await startEvent(orgId, mine, T0);
    await inbound(orgId, { clientId: theirs, at: AFTER, payload: { channel: "sms", from: "+15551110007", body: "hi" } });
    assert.equal(await hasReplied(db, { clientId: mine, eventId: start }), false);
    // ...and it still stops theirs.
    const theirStart = await startEvent(orgId, theirs, T0);
    assert.equal(await hasReplied(db, { clientId: theirs, eventId: theirStart }), true);
  });

test("an email event with nobody on it never matches by digits",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId, { email: "digits@reply.test", phone: "+15551110008" });
    const start = await startEvent(orgId, id, T0);
    await inbound(orgId, { clientId: null, at: AFTER, payload: { channel: "email", from: "5551110008@elsewhere.test", body: "hi" } });
    assert.equal(await hasReplied(db, { clientId: id, eventId: start }), false);
  });

test("only inbound messages count, not other events for the person",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId, { email: "other-events@reply.test", phone: "+15551110009" });
    const start = await startEvent(orgId, id, T0);
    await inbound(orgId, { clientId: id, at: AFTER, name: "message.queued", payload: { channel: "sms" } });
    await inbound(orgId, { clientId: id, at: AFTER, name: "booking.created", payload: {} });
    assert.equal(await hasReplied(db, { clientId: id, eventId: start }), false);
  });

test("an unknown start event means no reply yet, never a crash",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId, { email: "nostart@reply.test", phone: "+15551110010" });
    await inbound(orgId, { clientId: id, at: AFTER, payload: { channel: "email", body: "hi" } });
    assert.equal(await hasReplied(db, { clientId: id, eventId: "00000000-0000-4000-8000-000000000000" }), false);
    assert.equal(await hasReplied(db, { clientId: id, eventId: null }), false);
    assert.equal(await hasReplied(db, { clientId: null, eventId: "00000000-0000-4000-8000-000000000000" }), false);
  });
