/* S-05A's rebook line and S-NOBOOK's one chase across the trigger change, against a real Postgres.
 *
 * WHY A DATABASE TEST AND NOT ONLY THE FAKE. The unit tests prove the decisions with a stand-in for each
 * read. These two reads live in SQL: a LEAST over a payload time and a sub-select (S-05A), and a join from
 * a message's send key to the event it was keyed on, through split_part and a uuid cast (S-NOBOOK). A fake
 * that answers the way its author expected proves the author.
 *
 * Every row is built by the test and removed after: two made-up companies, made-up people with a made-up
 * ghl_contact_id (so the contact sync is never reached), six made-up templates. No provider is called: the
 * rows are queued, never dispatched, and the keys that could reach one are cleared for the run.
 *
 * SKIPS unless DATABASE_URL is a loopback scratch or CI database (the lock in
 * src/verification/scratch-guard.mjs). A skip is not a pass.
 */
import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { handle as runNoShow, rebookedSinceMiss } from "./s-05a-no-show-recovery.mjs";
import {
  handle as runChase, sentByOtherTrigger, CROSS_TRIGGER_WINDOW_MS,
  SMS_NOBOOK_01, SMS_NOBOOK_02, SMS_NOBOOK_03, EMAIL_NOBOOK_01, EMAIL_NOBOOK_02, EMAIL_NOBOOK_03
} from "./s-nobook-chase.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";

// Writes and deletes its own rows, so it runs only on a loopback scratch or CI database.
const HAS_DB = isLocalScratchDatabaseUrl(process.env.DATABASE_URL);
const SLUG = "followup-race-safety-test";
const OTHER_SLUG = "followup-race-safety-test-other";
const DOMAIN = "followup-race-safety.test";
const NOBOOK_KEYS = [SMS_NOBOOK_01, EMAIL_NOBOOK_01, SMS_NOBOOK_02, EMAIL_NOBOOK_02, SMS_NOBOOK_03, EMAIL_NOBOOK_03];
const MIN = 60 * 1000;

let orgId;
let otherOrgId;
const saved = {};
let seq = 0;

const iso = (ms) => new Date(ms).toISOString();

async function makeClient(org) {
  seq += 1;
  return (await db.query(
    `INSERT INTO clients (org_id, email, phone, first_name, last_name, ghl_contact_id, custom_fields)
     VALUES ($1,$2,$3,'Pat','Lee',$4,'{}') RETURNING id`,
    [org, `lead${seq}@${DOMAIN}`, `+1555020${String(1000 + seq).slice(-4)}`, `test-ghl-race-${seq}`]
  )).rows[0].id;
}
async function addEvent(org, clientId, name, at, payload = {}) {
  return (await db.query(
    `INSERT INTO events (org_id, name, version, client_id, payload, created_at)
     VALUES ($1,$2,1,$3,$4,$5) RETURNING id`,
    [org, name, clientId, JSON.stringify(payload), at]
  )).rows[0].id;
}
async function addMessage(org, clientId, { templateKey, providerRef, at }) {
  await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key, rendered_body, provider, provider_ref, status, compliance_check_passed, created_at)
     VALUES ($1,$2,'outbound','sms',$3,'x','internal',$4,'queued',true,$5)`,
    [org, clientId, templateKey, providerRef, at]
  );
}
const outbound = async (clientId) => (await db.query(
  `SELECT template_key, provider_ref FROM messages WHERE client_id = $1 AND direction = 'outbound' ORDER BY created_at, template_key`,
  [clientId])).rows;

/* A step that runs every step at once and skips every wait: these tests read the stops, not the clock. */
const instantStep = () => ({ run: async (_id, fn) => fn(), sleep: async () => {}, sleepUntil: async () => {} });

async function purge() {
  if (!HAS_DB) return;
  const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = ANY($1)`, [[SLUG, OTHER_SLUG]])).rows.map((r) => r.id);
  if (orgs.length) {
    await db.query(`UPDATE messages SET conversation_id = NULL WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM messages WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM conversations WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM tasks WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM events WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM clients WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM message_templates WHERE org_id = ANY($1)`, [orgs]);
  }
  await db.query(`DELETE FROM orgs WHERE slug = ANY($1)`, [[SLUG, OTHER_SLUG]]);
}

before(async () => {
  if (!HAS_DB) return;
  // Nothing in this file may reach a provider or the CRM, whatever the shell it runs in holds.
  for (const k of ["INNGEST_EVENT_KEY", "GHL_API_KEY", "DOCUMENT_URL_SECRET"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  await purge();
  orgId = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1,'Follow-up Race Safety Test') RETURNING id`, [SLUG])).rows[0].id;
  otherOrgId = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1,'Follow-up Race Safety Test Other') RETURNING id`, [OTHER_SLUG])).rows[0].id;
  for (const key of NOBOOK_KEYS) {
    await db.query(
      `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
       VALUES ($1,$2,$3,$4,$5,true)`,
      [orgId, key, key.startsWith("SMS") ? "sms" : "email", key.startsWith("EMAIL") ? `Subject ${key}` : null, `${key} pick a time`]
    );
  }
});

after(async () => {
  if (!HAS_DB) return;
  await purge();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await close();
});

// ── S-05A: did they book again after the missed call? ───────────────────────────────────────────────

const MISSED_AT = "2026-11-04T19:00:00.000Z"; // the call that was missed, noon Arizona
const NOSHOW_AT = "2026-11-04T19:35:00.000Z"; // DPC-02 saves the no-show 5 minutes after it ends

test("rebookedSinceMiss: a booking or a move saved after the missed call counts; one from before, another person's or another company's does not",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient(orgId);
    const noShowId = await addEvent(orgId, clientId, "booking.noshow", NOSHOW_AT, { startTime: MISSED_AT });
    const ask = (missedAt = MISSED_AT) => rebookedSinceMiss(db, { orgId, clientId, eventId: noShowId, missedAt });

    await addEvent(orgId, clientId, "booking.created", "2026-11-01T17:00:00.000Z");     // the missed call, booked days before
    await addEvent(orgId, clientId, "booking.rescheduled", "2026-11-04T18:59:59.000Z"); // moved to noon, a second before
    await addEvent(otherOrgId, clientId, "booking.created", "2026-11-04T20:00:00.000Z"); // another company
    await addEvent(orgId, await makeClient(orgId), "booking.created", "2026-11-04T20:00:00.000Z"); // another person
    assert.equal(await ask(), false);

    // Booked again 10 minutes into the missed call, before the no-show was saved.
    await addEvent(orgId, clientId, "booking.created", "2026-11-04T19:10:00.000Z");
    assert.equal(await ask(), true, "measured from the missed call's start");
    assert.equal(await ask(null), false, "with no start time, the line is the no-show's own saved time");
  });

test("rebookedSinceMiss: with no start time, a move saved after the no-show counts", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient(orgId);
  const noShowId = await addEvent(orgId, clientId, "booking.noshow", NOSHOW_AT, {});
  assert.equal(await rebookedSinceMiss(db, { orgId, clientId, eventId: noShowId, missedAt: null }), false);
  await addEvent(orgId, clientId, "booking.rescheduled", "2026-11-04T19:36:00.000Z");
  assert.equal(await rebookedSinceMiss(db, { orgId, clientId, eventId: noShowId, missedAt: null }), true);
});

/* The reviewer's case on real rows: the rebook is saved after the no-show and before the run's first step.
   The old run counted it into its starting number and sent all four touches. */
test("S-05A: a rebook saved before the run starts stops every touch; the closer's task is still made",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient(orgId);
    await addEvent(orgId, clientId, "booking.created", "2026-11-01T17:00:00.000Z");
    const payload = { bookingUid: `race-${seq}`, startTime: MISSED_AT };
    const noShowId = await addEvent(orgId, clientId, "booking.noshow", NOSHOW_AT, payload);
    await addEvent(orgId, clientId, "booking.created", "2026-11-04T19:36:00.000Z");

    const res = await runNoShow({
      event: { id: noShowId, orgId, clientId, payload }, db, step: instantStep(),
      now: () => Date.parse("2026-11-04T19:37:00.000Z")
    });
    assert.equal(res.stoppedAt, "before-touch-1");
    assert.deepEqual(await outbound(clientId), [], "nothing queued for a person who booked again");
    const tasks = (await db.query(`SELECT source_workflow FROM tasks WHERE client_id = $1`, [clientId])).rows;
    assert.deepEqual(tasks.map((t) => t.source_workflow), ["s-05a-no-show-recovery"]);
  });

// ── S-NOBOOK: one chase across the trigger change ───────────────────────────────────────────────────

test("sentByOtherTrigger: the same text, keyed on the other trigger's event, newer than the window, for this person in this company",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient(orgId);
    const now = Date.now();
    const firstAnswer = await addEvent(orgId, clientId, "survey.submitted", iso(now - 10 * 60 * MIN));
    const finished = await addEvent(orgId, clientId, "survey.completed", iso(now - 60 * MIN));
    await addMessage(orgId, clientId, { templateKey: SMS_NOBOOK_01, providerRef: `workflow:${SMS_NOBOOK_01}:${firstAnswer}:1`, at: iso(now - 8 * 60 * MIN) });
    await addMessage(orgId, clientId, { templateKey: SMS_NOBOOK_02, providerRef: `workflow:${SMS_NOBOOK_02}:${finished}:2`, at: iso(now - 30 * MIN) });
    const since = iso(now - 60 * MIN - CROSS_TRIGGER_WINDOW_MS);
    const ask = (templateKey, otherTrigger, over = {}) =>
      sentByOtherTrigger(db, { orgId, clientId, templateKey, otherTrigger, since, ...over });

    assert.equal(await ask(SMS_NOBOOK_01, "survey.submitted"), true, "the first-answer run sent text 1");
    assert.equal(await ask(SMS_NOBOOK_01, "survey.completed"), false, "not sent by a finished-survey run");
    assert.equal(await ask(SMS_NOBOOK_02, "survey.completed"), true, "the finished-survey run sent text 2");
    assert.equal(await ask(SMS_NOBOOK_02, "survey.submitted"), false);
    assert.equal(await ask(SMS_NOBOOK_03, "survey.submitted"), false, "a text nobody sent");
    assert.equal(await ask(SMS_NOBOOK_01, "survey.submitted", { since: iso(now - 7 * 60 * MIN) }), false, "older than the window");
    assert.equal(await ask(SMS_NOBOOK_01, "survey.submitted", { clientId: await makeClient(orgId) }), false, "another person");
    assert.equal(await ask(SMS_NOBOOK_01, "survey.submitted", { orgId: otherOrgId }), false, "another company");
  });

test("S-NOBOOK: a first-answer chase, then the finish: six real messages, not twelve, and one setter task",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient(orgId);
    const now = Date.now();
    const firstAnswer = await addEvent(orgId, clientId, "survey.submitted", iso(now - 10 * 60 * MIN));
    const finished = await addEvent(orgId, clientId, "survey.completed", iso(now - 2 * 60 * MIN));

    const old = await runChase({ event: { id: firstAnswer, orgId, clientId, name: "survey.submitted", payload: {} }, db, step: instantStep() });
    const fresh = await runChase({ event: { id: finished, orgId, clientId, name: "survey.completed", payload: {} }, db, step: instantStep() });
    assert.equal(old.exitedAt, "completed");
    assert.equal(fresh.exitedAt, "completed");
    assert.equal(fresh.msg1.sms.skipped, "sent_by_other_trigger");

    const rows = await outbound(clientId);
    assert.deepEqual(rows.map((r) => r.template_key).sort(), [...NOBOOK_KEYS].sort(), "each text and email once");
    assert.ok(rows.every((r) => r.provider_ref.includes(`:${firstAnswer}:`)), "all from the first-answer run");
    const tasks = (await db.query(`SELECT source_workflow FROM tasks WHERE client_id = $1`, [clientId])).rows;
    assert.deepEqual(tasks.map((t) => t.source_workflow), ["setter-survey-done"]);
  });
