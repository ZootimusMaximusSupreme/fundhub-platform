/* Message tests against a real Postgres: which version sendTemplated queues, and the lookups that must
 * see both versions (the duplicate-text guard, the come-back sequence check).
 *
 * WHY A DATABASE TEST. experiments.test.mjs proves the coin flip and the key rules. What it cannot
 * prove is that the right template ROW is read, that the messages row keeps the key that was really
 * used, and that a replay can never send twice. A fake that answers the way its author expected proves
 * the author. This runs the real sendTemplated and the real SQL.
 *
 * Every row is made by the test, in a company of its own, and removed after. The B rows here are
 * made-up test words; the real version B words are not written by this file or this unit.
 * Nothing is sent: sendTemplated only queues a row.
 *
 * SKIPS unless DATABASE_URL is a loopback scratch or CI database (src/verification/scratch-guard.mjs).
 * A skip is not a pass.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { db, pool, close } from "../db.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";
import { sequenceInFlight } from "../workflows/s-02-incomplete-survey-nudge.mjs";
import { findRecentDuplicateSms } from "./sms-dedup.mjs";
import { armFor, variantKeyFor } from "./experiments.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";

const HAS_DB = isLocalScratchDatabaseUrl(process.env.DATABASE_URL);
const SLUG = "ab-split-pg-test";
const OTHER_SLUG = "ab-split-pg-test-other";
const NONCE = `${process.pid}-${Date.now()}`;

const NOBOOK_SMS = "SMS-NOBOOK-02";
const NOBOOK_EMAIL = "EMAIL-NOBOOK-02";
const RESUME_SMS = "SMS-S02-RESUME-2";
const RESUME_EMAIL = "EMAIL-S02-RESUME-2";

let orgId;
let otherOrgId;
let savedSecret;
let seq = 0;

/** A client id whose arm in `test` is `arm`. */
function idWithArm(test, arm) {
  for (;;) {
    const id = crypto.randomUUID();
    if (armFor(id, test) === arm) return id;
  }
}

async function makeClient(arm, test = "nobook-proof", over = {}) {
  const id = over.id ?? idWithArm(test, arm);
  seq += 1;
  await db.query(
    `INSERT INTO clients (id, org_id, email, phone, first_name, last_name)
     VALUES ($1,$2,$3,$4,'Dana','Sample')`,
    [id, over.org ?? orgId, `dana.${NONCE}.${seq}@sample-leads.com`, over.phone ?? `+1555${String(7000000 + seq)}`]
  );
  return id;
}

async function template(key, { body, org = orgId, passed = true, subject = undefined } = {}) {
  const channel = key.startsWith("SMS-") ? "sms" : "email";
  await db.query(
    `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (org_id, template_key) DO UPDATE
       SET body = EXCLUDED.body, subject = EXCLUDED.subject, compliance_passed = EXCLUDED.compliance_passed`,
    [org, key, channel, channel === "email" ? (subject ?? `Subject of ${key}`) : null, body ?? `Body of ${key} for {{contact.first_name}}`, passed]
  );
}

async function rowsFor(clientId) {
  return (await db.query(
    `SELECT template_key, channel, rendered_body, provider_ref, status FROM messages
      WHERE client_id = $1 ORDER BY created_at, template_key`, [clientId])).rows;
}

/* sendTemplated queues a row with status 'queued' and no hold time, and the dispatcher (dispatchDue with
   no company, as other messaging tests call it) claims queued rows from EVERY company. A row of ours left
   in that state could be picked up by a test running at the same moment in another file. So each send
   runs in one transaction that also pushes the new row's hold time a month out before anyone else can
   see it. The row is still the one sendTemplated wrote; it is just never due. */
async function hold(fn) {
  const conn = await pool().connect();
  try {
    await conn.query("BEGIN");
    const out = await fn(conn);
    await conn.query(
      `UPDATE messages SET scheduled_at = now() + interval '30 days'
        WHERE org_id = ANY($1) AND status = 'queued' AND scheduled_at IS NULL`, [[orgId, otherOrgId]]);
    await conn.query("COMMIT");
    return out;
  } catch (err) {
    await conn.query("ROLLBACK");
    throw err;
  } finally {
    conn.release();
  }
}

const send = (clientId, templateKey, eventId = `evt-${NONCE}-${++seq}`, channel) => hold((conn) => sendTemplated(conn, {
  orgId, clientId, channel: channel ?? (templateKey.startsWith("SMS-") ? "sms" : "email"), templateKey, eventId
}));

async function purge() {
  if (!HAS_DB) return;
  const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = ANY($1)`, [[SLUG, OTHER_SLUG]])).rows.map((r) => r.id);
  if (orgs.length) {
    await db.query(`DELETE FROM messages WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM conversations WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM events WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM message_templates WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM opt_outs WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM clients WHERE org_id = ANY($1)`, [orgs]);
  }
  await db.query(`DELETE FROM orgs WHERE slug = ANY($1)`, [[SLUG, OTHER_SLUG]]);
}

before(async () => {
  if (!HAS_DB) return;
  savedSecret = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  process.env.UNSUBSCRIBE_TOKEN_SECRET = "pg-test-ab-secret-0123456789abcdef0123456789";
  await purge();
  orgId = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1,'AB Split Test') RETURNING id`, [SLUG])).rows[0].id;
  otherOrgId = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1,'AB Split Test Other') RETURNING id`, [OTHER_SLUG])).rows[0].id;
  for (const key of [NOBOOK_SMS, NOBOOK_EMAIL, RESUME_SMS, RESUME_EMAIL, "SMS-NOBOOK-03"]) await template(key);
});

after(async () => {
  if (!HAS_DB) return;
  if (savedSecret === undefined) delete process.env.UNSUBSCRIBE_TOKEN_SECRET; else process.env.UNSUBSCRIBE_TOKEN_SECRET = savedSecret;
  await purge();
  await close();
});

test("an arm-B person gets version B when B exists, is not a draft and passed compliance", { skip: !HAS_DB }, async () => {
  await template("SMS-NOBOOK-02-B", { body: "B text for {{contact.first_name}}" });
  const who = await makeClient("B");
  const res = await send(who, NOBOOK_SMS, "evt-b-1");
  assert.equal(res.sent, true);
  assert.equal(res.templateKey, "SMS-NOBOOK-02-B");
  assert.equal(res.arm, "B");
  const [row, ...rest] = await rowsFor(who);
  assert.equal(rest.length, 0);
  assert.equal(row.template_key, "SMS-NOBOOK-02-B", "the messages row keeps the key that was used");
  assert.equal(row.rendered_body, "B text for Dana", "the words are B's words, merged");
  assert.equal(row.provider_ref, "workflow:SMS-NOBOOK-02:evt-b-1", "the dedupe key stays on the key that was asked for");
  assert.equal(row.status, "queued");
});

test("an arm-A person gets version A even when B is ready", { skip: !HAS_DB }, async () => {
  await template("SMS-NOBOOK-02-B");
  const who = await makeClient("A");
  const res = await send(who, NOBOOK_SMS);
  assert.equal(res.sent, true);
  assert.equal(res.templateKey, NOBOOK_SMS);
  assert.equal(res.arm, "A");
  assert.equal((await rowsFor(who))[0].template_key, NOBOOK_SMS);
});

test("the text and the email of one person match: both B, or both A", { skip: !HAS_DB }, async () => {
  await template("SMS-NOBOOK-02-B");
  await template("EMAIL-NOBOOK-02-B");
  const inB = await makeClient("B");
  const inA = await makeClient("A");
  for (const [who, want] of [[inB, "-B"], [inA, ""]]) {
    await send(who, NOBOOK_SMS);
    await send(who, NOBOOK_EMAIL);
    const keys = (await rowsFor(who)).map((r) => r.template_key).sort();
    assert.deepEqual(keys, [`EMAIL-NOBOOK-02${want}`, `SMS-NOBOOK-02${want}`]);
  }
});

test("the come-back test is its own coin flip and works the same way", { skip: !HAS_DB }, async () => {
  await template("SMS-S02-RESUME-2-B");
  await template("EMAIL-S02-RESUME-2-B");
  const inB = await makeClient("B", "resume-proof");
  const inA = await makeClient("A", "resume-proof");
  assert.equal((await send(inB, RESUME_SMS)).templateKey, "SMS-S02-RESUME-2-B");
  assert.equal((await send(inB, RESUME_EMAIL)).templateKey, "EMAIL-S02-RESUME-2-B");
  assert.equal((await send(inA, RESUME_SMS)).templateKey, RESUME_SMS);
  assert.equal((await send(inA, RESUME_EMAIL)).templateKey, RESUME_EMAIL);
});

test("version B is not ready, so an arm-B person gets A: missing, draft copy, or not passed", { skip: !HAS_DB }, async () => {
  const cases = {
    "no B row": async () => { await db.query(`DELETE FROM message_templates WHERE org_id = $1 AND template_key = 'SMS-NOBOOK-02-B'`, [orgId]); },
    "B is draft copy": async () => template("SMS-NOBOOK-02-B", { body: "[DRAFT — no source copy] B text" }),
    "B has not passed compliance": async () => template("SMS-NOBOOK-02-B", { passed: false })
  };
  for (const [what, setUp] of Object.entries(cases)) {
    await setUp();
    const who = await makeClient("B");
    const res = await send(who, NOBOOK_SMS);
    assert.equal(res.sent, true, what);
    assert.equal(res.templateKey, NOBOOK_SMS, what);
    assert.equal(res.arm, "A", `${what}: the result says A went`);
    const rows = await rowsFor(who);
    assert.equal(rows.length, 1, what);
    assert.equal(rows[0].template_key, NOBOOK_SMS, `${what}: nothing blank, nothing skipped`);
    assert.equal(rows[0].rendered_body, "Body of SMS-NOBOOK-02 for Dana", what);
  }
});

test("a B row in another company is never used", { skip: !HAS_DB }, async () => {
  await db.query(`DELETE FROM message_templates WHERE org_id = $1 AND template_key = 'SMS-NOBOOK-02-B'`, [orgId]);
  await template("SMS-NOBOOK-02-B", { org: otherOrgId });
  const who = await makeClient("B");
  assert.equal((await send(who, NOBOOK_SMS)).templateKey, NOBOOK_SMS);
});

test("when A itself is not usable the old answers are unchanged, and a ready B still goes", { skip: !HAS_DB }, async () => {
  await db.query(`DELETE FROM message_templates WHERE org_id = $1 AND template_key = ANY($2)`, [orgId, [NOBOOK_SMS, "SMS-NOBOOK-02-B"]]);
  const inA = await makeClient("A");
  assert.deepEqual(await send(inA, NOBOOK_SMS), { sent: false, reason: "template_pending" });
  await template(NOBOOK_SMS, { body: "[DRAFT] A" });
  assert.deepEqual(await send(inA, NOBOOK_SMS), { sent: false, reason: "draft_template" });
  await template(NOBOOK_SMS, { passed: false });
  assert.deepEqual(await send(inA, NOBOOK_SMS), { sent: false, reason: "template_pending" });
  assert.equal((await rowsFor(inA)).length, 0, "no row was written for any refusal");

  // A ready B row does not need A to exist: it is a template like any other.
  await template("SMS-NOBOOK-02-B");
  const inB = await makeClient("B");
  assert.equal((await send(inB, NOBOOK_SMS)).templateKey, "SMS-NOBOOK-02-B");
  await template(NOBOOK_SMS);
});

test("a replay never sends twice, whichever way B's readiness moved in between", { skip: !HAS_DB }, async () => {
  // B was used, then B stops being ready: the replay finds the first row and says so.
  await template("SMS-NOBOOK-02-B");
  const first = await makeClient("B");
  const one = await send(first, NOBOOK_SMS, "evt-replay-1");
  assert.equal(one.templateKey, "SMS-NOBOOK-02-B");
  await template("SMS-NOBOOK-02-B", { passed: false });
  const again = await send(first, NOBOOK_SMS, "evt-replay-1");
  assert.equal(again.sent, true);
  assert.equal(again.messageId, one.messageId, "the same message, not a new one");
  assert.equal(again.templateKey, "SMS-NOBOOK-02-B", "it reports the row that exists, not the one it would pick now");
  assert.equal(again.arm, "B");
  assert.equal((await rowsFor(first)).length, 1);

  // A was used because B was not ready, then B becomes ready: still one row, still A.
  const second = await makeClient("B");
  const a = await send(second, NOBOOK_SMS, "evt-replay-2");
  assert.equal(a.templateKey, NOBOOK_SMS);
  await template("SMS-NOBOOK-02-B");
  const b = await send(second, NOBOOK_SMS, "evt-replay-2");
  assert.equal(b.messageId, a.messageId);
  assert.equal(b.templateKey, NOBOOK_SMS);
  assert.equal(b.arm, "A");
  assert.equal((await rowsFor(second)).length, 1);
});

test("a key that is not tested is untouched, with exactly the old answer", { skip: !HAS_DB }, async () => {
  await template("SMS-NOBOOK-02-B");
  const who = await makeClient("B");
  const res = await send(who, "SMS-NOBOOK-03");
  assert.deepEqual(Object.keys(res).sort(), ["messageId", "sent"]);
  assert.equal((await rowsFor(who))[0].template_key, "SMS-NOBOOK-03");
});

test("asking for the B key by name sends that row and splits nothing", { skip: !HAS_DB }, async () => {
  await template("SMS-NOBOOK-02-B");
  const who = await makeClient("A");
  const res = await send(who, "SMS-NOBOOK-02-B");
  assert.deepEqual(Object.keys(res).sort(), ["messageId", "sent"]);
  assert.equal((await rowsFor(who))[0].template_key, "SMS-NOBOOK-02-B");
});

test("with no person attached there is no split: the key asked for goes, as before", { skip: !HAS_DB }, async () => {
  await template("SMS-NOBOOK-02-B");
  const res = await hold((conn) => sendTemplated(conn, { orgId, clientId: null, channel: "sms", templateKey: NOBOOK_SMS, eventId: "evt-nobody" }));
  assert.equal(res.sent, true);
  assert.deepEqual(Object.keys(res).sort(), ["messageId", "sent"]);
  const row = (await db.query(`SELECT template_key FROM messages WHERE org_id = $1 AND provider_ref = 'workflow:SMS-NOBOOK-02:evt-nobody'`, [orgId])).rows[0];
  assert.equal(row.template_key, NOBOOK_SMS);
});

test("an opted-out person still gets nothing, whichever version they would have had", { skip: !HAS_DB }, async () => {
  await template("SMS-NOBOOK-02-B");
  const who = await makeClient("B");
  await db.query(`INSERT INTO opt_outs (org_id, client_id, channel) VALUES ($1,$2,'sms')`, [orgId, who]);
  assert.deepEqual(await send(who, NOBOOK_SMS), { sent: false, reason: "opted_out" });
  assert.equal((await rowsFor(who)).length, 0);
});

/* The lookups that must see both versions. */

test("the duplicate-text guard treats A and B as one step, and a different step as another", { skip: !HAS_DB }, async () => {
  const phone = "+15557001234";
  const prior = await makeClient("A", "nobook-proof", { phone });
  const someone = await makeClient("B", "nobook-proof", { phone });
  const insert = (clientId, key, ref) => db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key, rendered_body, provider, provider_ref, status, to_address)
     VALUES ($1,$2,'outbound','sms',$3,'words','internal',$4,'sent',$5) RETURNING id`, [orgId, clientId, key, ref, phone]).then((r) => r.rows[0].id);
  const sentA = await insert(prior, NOBOOK_SMS, `dup-a-${NONCE}`);
  const probe = (key, body = "words") => findRecentDuplicateSms(db, {
    id: crypto.randomUUID(), org_id: orgId, client_id: someone, channel: "sms", template_key: key, rendered_body: body, to_address: phone
  }, phone, { env: { SMS_DEDUP_WINDOW_MINUTES: "30" } });

  assert.equal((await probe(NOBOOK_SMS)).duplicate, true, "the same key still dedupes");
  const b = await probe("SMS-NOBOOK-02-B");
  assert.equal(b.duplicate, true, "B after A to the same phone is the same step");
  assert.equal(b.priorId, sentA);
  assert.equal((await probe("SMS-NOBOOK-03")).duplicate, false, "a different step is not a duplicate");
  assert.equal((await probe(null, "words")).duplicate, false, "a freeform text needs a freeform match, and there is none");

  await db.query(`DELETE FROM messages WHERE id = $1`, [sentA]);
  const sentB = await insert(prior, "SMS-NOBOOK-02-B", `dup-b-${NONCE}`);
  assert.equal((await probe(NOBOOK_SMS)).duplicate, true, "A after B to the same phone is the same step");
  assert.equal((await probe(NOBOOK_SMS)).priorId, sentB);

  // The freeform branch still works on a real database.
  await db.query(`DELETE FROM messages WHERE id = $1`, [sentB]);
  const freeform = await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key, rendered_body, provider, provider_ref, status, to_address)
     VALUES ($1,$2,'outbound','sms',NULL,'a freeform note','internal',$3,'sent',$4) RETURNING id`, [orgId, prior, `dup-f-${NONCE}`, phone]);
  assert.equal((await probe(null, "a freeform note")).duplicate, true);
  assert.equal((await probe(null, "another note")).duplicate, false);
  await db.query(`DELETE FROM messages WHERE id = $1`, [freeform.rows[0].id]);
});

test("the come-back sequence check sees a sent version B of touch 2 like a sent version A", { skip: !HAS_DB }, async () => {
  const who = await makeClient("A", "resume-proof");
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const ask = () => sequenceInFlight(db, { orgId, clientId: who, cohortId: "this-run", since });
  assert.equal(await ask(), false, "nothing sent yet");

  const insert = (key, ref) => db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key, rendered_body, provider, provider_ref, status, to_address)
     VALUES ($1,$2,'outbound','sms',$3,'words','internal',$4,'sent','+15557009999')`, [orgId, who, key, ref]);

  await insert("SMS-S02-RESUME-2-B", "workflow:SMS-S02-RESUME-2:other-run");
  assert.equal(await ask(), true, "a version B of touch 2 from another opt-in is a sequence in flight");

  await db.query(`DELETE FROM messages WHERE client_id = $1`, [who]);
  await insert("SMS-S02-RESUME-2-B", "workflow:SMS-S02-RESUME-2:this-run");
  assert.equal(await ask(), false, "this run's own message does not count against it");

  await db.query(`DELETE FROM messages WHERE client_id = $1`, [who]);
  await insert("SMS-S02-RESUME-2", "workflow:SMS-S02-RESUME-2:other-run");
  assert.equal(await ask(), true, "and version A still does");
});
