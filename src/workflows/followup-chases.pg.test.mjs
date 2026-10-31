/* S-NOBOOK and AI-SET-03 against a real Postgres.
 *
 * WHY A DATABASE TEST AND NOT ONLY THE FAKE. The unit tests in
 * s-nobook-chase.test.mjs and ai-set-03-no-answer-cadence.test.mjs prove the
 * decisions: what is planned for 9 a.m., what stops a text, which words go out.
 * They run on a fake that answers the way its author expected. This file runs the
 * REAL queries and the REAL writers: the setter task as createTask writes it
 * (role, source, title, detail, key), the queued messages as sendTemplated writes
 * them, the "call ahead" and "rebooked since" reads, the saved score picking the
 * calendar link, and, on the setter desk, the setter.no_answer event the bus
 * keeps one of per lead per day and the credit_tier a score fix writes. Only the
 * clock and the workflow engine's sleeps are faked; nothing is dispatched, so no
 * text or email can leave.
 *
 * SKIPS unless DATABASE_URL is a loopback scratch or CI database (the same lock
 * as src/verification/scratch-guard.mjs). It does not pass quietly.
 */

import { test, before, after } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import {
  handle as runChase, SMS_NOBOOK_01, SMS_NOBOOK_02, SMS_NOBOOK_03,
  EMAIL_NOBOOK_01, EMAIL_NOBOOK_02, EMAIL_NOBOOK_03,
  SETTER_TASK_SOURCE, SETTER_TASK_TITLE, SETTER_TASK_DETAIL
} from "./s-nobook-chase.mjs";
import {
  handle as runCadence, upcomingCall, rebookedSince,
  MSG1_KEY, MSG2_KEY, MSG3_KEY, OPTIN1_KEY, OPTIN2_KEY, OPTIN3_KEY
} from "./ai-set-03-no-answer-cadence.mjs";
import { formatAppointmentStart } from "./messaging.mjs";
import { updateSetterHandoff } from "../setter/dashboard.mjs";
import { inDripWindow } from "../messaging/send-window.mjs";

const HAS_DB = isLocalScratchDatabaseUrl(process.env.DATABASE_URL);
const SLUG = "followup-chases-test";
const Q = "https://apply.fundhub.ai/funding-book-call?fh_tier=q";
const U = "https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u";

let orgId = null;
let seq = 0;

const NOBOOK_KEYS = [
  [SMS_NOBOOK_01, "sms"], [SMS_NOBOOK_02, "sms"], [SMS_NOBOOK_03, "sms"],
  [EMAIL_NOBOOK_01, "email"], [EMAIL_NOBOOK_02, "email"], [EMAIL_NOBOOK_03, "email"]
];

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,'Follow-up Chases Test')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [SLUG]
  )).rows[0].id;
  const rows = [
    ...NOBOOK_KEYS.map(([key, channel]) => [key, channel, channel === "email" ? `${key} <a href="{{custom_values.booking_link}}">Pick a time</a>` : `${key} {{custom_values.booking_link}}`]),
    [MSG1_KEY, "sms", `${MSG1_KEY} your call {{appointment.start_time}}`],
    [MSG2_KEY, "sms", `${MSG2_KEY} your call {{appointment.start_time}}`],
    [MSG3_KEY, "sms", `${MSG3_KEY} your call {{appointment.start_time}}`],
    [OPTIN1_KEY, "sms", `${OPTIN1_KEY} pick a time {{custom_values.booking_link}}`],
    [OPTIN2_KEY, "sms", `${OPTIN2_KEY} pick a time {{custom_values.booking_link}}`],
    [OPTIN3_KEY, "sms", `${OPTIN3_KEY} pick a time {{custom_values.booking_link}}`]
  ];
  for (const [key, channel, body] of rows) {
    await db.query(
      `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
       VALUES ($1,$2,$3,$4,$5,true)`,
      [orgId, key, channel, channel === "email" ? `${key} subject` : null, body]
    );
  }
});

after(async () => {
  if (!HAS_DB) return;
  for (const table of ["messages", "conversations", "tasks", "events", "bookings", "message_templates", "clients"]) {
    await db.query(`DELETE FROM ${table} WHERE org_id = $1`, [orgId]);
  }
  await db.query(`DELETE FROM orgs WHERE slug = $1`, [SLUG]);
  await close();
});

async function makeClient({ phone = "(555) 222-0001", customFields = {} } = {}) {
  seq += 1;
  const r = await db.query(
    `INSERT INTO clients (org_id, email, phone, first_name, last_name, custom_fields)
     VALUES ($1,$2,$3,'Chase','Test',$4) RETURNING id`,
    [orgId, `chase-${seq}-${Date.now()}@followup.test`, phone, JSON.stringify(customFields)]
  );
  return r.rows[0].id;
}

async function insertEvent({ name, clientId, payload = {}, at }) {
  const r = await db.query(
    `INSERT INTO events (org_id, name, version, client_id, payload, created_at)
     VALUES ($1,$2,1,$3,$4,$5) RETURNING id`,
    [orgId, name, clientId, JSON.stringify(payload), at]
  );
  return r.rows[0].id;
}

/* The event the workflow engine hands a run: the events row's id, the person, the payload. */
async function trigger(name, clientId, at, payload = {}) {
  const id = await insertEvent({ name, clientId, payload, at });
  return { id, orgId, clientId, name, payload };
}

async function insertBooking(clientId, { status = "booked", startsAt }) {
  seq += 1;
  await db.query(
    `INSERT INTO bookings (org_id, client_id, source, provider_uid, starts_at, status)
     VALUES ($1,$2,'followup-test',$3,$4,$5)`,
    [orgId, clientId, `followup-${seq}-${Date.now()}`, startsAt, status]
  );
}

const queued = async (clientId) => (await db.query(
  `SELECT template_key, channel, status, direction, rendered_body
     FROM messages WHERE org_id = $1 AND client_id = $2 ORDER BY created_at, id`,
  [orgId, clientId]
)).rows;

const tasksOf = async (clientId) => (await db.query(
  `SELECT title, body, detail, due_at, source_workflow, assignee_role, assignee_staff_id, done
     FROM tasks WHERE org_id = $1 AND client_id = $2`,
  [orgId, clientId]
)).rows;

/* The workflow engine's step object with its sleeps made instant. It records every
   step in order, and wake(id) runs when the sleep named id ends so a test can
   put an event in the table "while the run slept". */
function recordingStep({ wake } = {}) {
  const calls = [];
  return {
    calls,
    run: async (id, fn) => { calls.push({ kind: "run", id }); return fn(); },
    sleep: async (id, length) => { calls.push({ kind: "sleep", id, length }); if (wake) await wake(id); },
    sleepUntil: async (id, when) => { calls.push({ kind: "sleepUntil", id, at: new Date(when).toISOString() }); if (wake) await wake(id); }
  };
}
const plannedTimes = (step) => Object.fromEntries(step.calls.filter((c) => c.kind === "sleepUntil").map((c) => [c.id, c.at]));

// Arizona is UTC-7 all year, so 4:00 p.m. there is 23:00Z.
const FINISHED_4PM = "2026-10-31T23:00:00Z";
const IN_15_MIN = () => new Date("2026-10-31T23:15:00Z");

/* ── AI-SET-03's two reads ─────────────────────────────────────────────────── */

test("upcomingCall: a booked or rescheduled call that has not started, the soonest one",
  { skip: !HAS_DB }, async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const later = new Date(Date.now() + 9 * 86_400_000).toISOString();
    const both = await makeClient();
    await insertBooking(both, { status: "rescheduled", startsAt: later });
    await insertBooking(both, { status: "booked", startsAt: soon });
    assert.equal(await upcomingCall(db, orgId, both), soon);
    const moved = await makeClient();
    await insertBooking(moved, { status: "rescheduled", startsAt: later });
    assert.equal(await upcomingCall(db, orgId, moved), later);
  });

test("upcomingCall: a call that has started, a cancelled call, nobody's call and somebody else's are not a call ahead",
  { skip: !HAS_DB }, async () => {
    const started = await makeClient();
    await insertBooking(started, { startsAt: new Date(Date.now() - 3_600_000).toISOString() });
    const cancelled = await makeClient();
    await insertBooking(cancelled, { status: "cancelled", startsAt: new Date(Date.now() + 86_400_000).toISOString() });
    const nothing = await makeClient();
    const mine = await makeClient();
    const theirs = await makeClient();
    await insertBooking(theirs, { startsAt: new Date(Date.now() + 86_400_000).toISOString() });
    for (const id of [started, cancelled, nothing, mine]) assert.equal(await upcomingCall(db, orgId, id), null);
  });

test("rebookedSince: a booking or a reschedule AFTER the run began counts; one from before does not",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient();
    const start = await insertEvent({ name: "setter.no_answer", clientId: id, at: "2026-10-31T16:00:00Z" });
    assert.equal(await rebookedSince(db, id, start), false);
    await insertEvent({ name: "booking.created", clientId: id, at: "2026-10-31T15:00:00Z" });
    assert.equal(await rebookedSince(db, id, start), false, "booked yesterday: the old check stopped on this");
    await insertEvent({ name: "booking.cancelled", clientId: id, at: "2026-10-31T16:30:00Z" });
    assert.equal(await rebookedSince(db, id, start), false, "a cancel is not a rebook");
    await insertEvent({ name: "booking.rescheduled", clientId: id, at: "2026-10-31T17:00:00Z" });
    assert.equal(await rebookedSince(db, id, start), true);
    const other = await makeClient();
    const otherStart = await insertEvent({ name: "setter.no_answer", clientId: other, at: "2026-10-31T16:00:00Z" });
    assert.equal(await rebookedSince(db, other, otherStart), false, "somebody else's booking is not mine");
    await insertEvent({ name: "booking.created", clientId: other, at: "2026-10-31T16:10:00Z" });
    assert.equal(await rebookedSince(db, other, otherStart), true);
    assert.equal(await rebookedSince(db, other, "00000000-0000-4000-8000-000000000000"), false, "unknown start: no rebook yet");
  });

/* ── S-NOBOOK end to end ───────────────────────────────────────────────────── */

test("S-NOBOOK, qualified: the setter task and all six messages are written, every link on the first calendar",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient({ customFields: { cf_svy_self_reported_fico_label: "760-850" } });
    const event = await trigger("survey.completed", clientId, FINISHED_4PM);
    const step = recordingStep();
    const res = await runChase({ event, db, step, now: IN_15_MIN });
    assert.equal(res.exitedAt, "completed");

    const [task, ...extra] = await tasksOf(clientId);
    assert.equal(extra.length, 0);
    assert.equal(task.assignee_role, "setter");
    assert.equal(task.assignee_staff_id, null, "open to any setter");
    assert.equal(task.source_workflow, SETTER_TASK_SOURCE);
    assert.equal(task.title, SETTER_TASK_TITLE);
    assert.equal(task.detail, SETTER_TASK_DETAIL);
    assert.equal(task.body, event.id);
    assert.equal(task.done, false);
    assert.equal(new Date(task.due_at).toISOString(), "2026-10-31T23:15:00.000Z");

    const rows = await queued(clientId);
    assert.deepEqual(rows.map((m) => m.template_key), [
      SMS_NOBOOK_01, EMAIL_NOBOOK_01, SMS_NOBOOK_02, EMAIL_NOBOOK_02, SMS_NOBOOK_03, EMAIL_NOBOOK_03
    ]);
    for (const m of rows) {
      assert.equal(m.status, "queued");
      assert.equal(m.direction, "outbound");
      assert.ok(m.rendered_body.includes(Q), m.rendered_body);
      assert.ok(!m.rendered_body.includes(U), m.rendered_body);
    }
    assert.deepEqual(plannedTimes(step), {
      "wait-until-msg1": "2026-11-01T16:00:00.000Z",
      "wait-until-msg2": "2026-11-02T16:00:00.000Z",
      "wait-until-msg3": "2026-11-05T16:00:00.000Z"
    });
  });

test("S-NOBOOK, not qualified: every link is on the second calendar, and a saved older answer still reads right",
  { skip: !HAS_DB }, async () => {
    for (const label of ["620-699", "500-619", "Not sure", "650-699"]) {
      const clientId = await makeClient({ customFields: { cf_svy_self_reported_fico_label: label } });
      const event = await trigger("survey.completed", clientId, FINISHED_4PM);
      await runChase({ event, db, step: recordingStep(), now: IN_15_MIN });
      const rows = await queued(clientId);
      assert.equal(rows.length, 6, label);
      for (const m of rows) assert.ok(m.rendered_body.includes(U) && !m.rendered_body.includes(Q), `${label}: ${m.rendered_body}`);
    }
    const old = await makeClient({ customFields: { cf_svy_self_reported_fico_label: "750+" } });
    await runChase({ event: await trigger("survey.completed", old, FINISHED_4PM), db, step: recordingStep(), now: IN_15_MIN });
    assert.ok((await queued(old)).every((m) => m.rendered_body.includes(Q)));
  });

test("S-NOBOOK: a text reply that has no person on its event stops text 2 (matched by the sender's number)",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient({ phone: "(555) 333-0002" });
    const event = await trigger("survey.completed", clientId, FINISHED_4PM);
    const step = recordingStep({
      wake: async (id) => {
        if (id !== "wait-until-msg2") return;
        // Exactly the shape the Twilio adapter saves: no client_id, E.164 number in payload.from.
        await insertEvent({ name: "message.inbound", clientId: null, at: "2026-11-02T10:00:00Z",
          payload: { channel: "sms", from: "+15553330002", to: "+16616054248", body: "who is this", source: "twilio" } });
      }
    });
    const res = await runChase({ event, db, step, now: IN_15_MIN });
    assert.equal(res.exitedAt, "replied");
    assert.equal((await queued(clientId)).length, 2, "text 1 only");
    assert.equal((await tasksOf(clientId)).length, 1, "the setter task had already been made");
  });

test("S-NOBOOK: a booking made while text 1 waited for 9 a.m. stops it, and nothing is sent",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const event = await trigger("survey.completed", clientId, FINISHED_4PM);
    const step = recordingStep({
      wake: async (id) => {
        if (id === "wait-until-msg1") await insertEvent({ name: "booking.created", clientId, at: "2026-11-01T15:00:00Z", payload: {} });
      }
    });
    const res = await runChase({ event, db, step, now: IN_15_MIN });
    assert.equal(res.exitedAt, "after-wait-2h");
    assert.equal((await queued(clientId)).length, 0);
    assert.equal((await tasksOf(clientId)).length, 1);
  });

test("S-NOBOOK: replaying the same event writes one task and one set of messages",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const event = await trigger("survey.completed", clientId, FINISHED_4PM);
    await runChase({ event, db, step: recordingStep(), now: IN_15_MIN });
    await runChase({ event, db, step: recordingStep(), now: IN_15_MIN });
    assert.equal((await tasksOf(clientId)).length, 1);
    assert.equal((await queued(clientId)).length, 6);
  });

/* ── AI-SET-03 end to end ──────────────────────────────────────────────────── */

const PRESSED = { disposition: "no_answer", setter_staff_id: "11111111-1111-4111-8111-111111111111", call_attempts: 1 };
const AT_4_50_PM = "2026-10-31T23:50:00Z";

test("AI-SET-03, a call ahead: the call-booked texts carry the time of that call; 4:50 p.m. sends text 1 now and 2 and 3 the next morning",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await insertBooking(clientId, { startsAt });
    const event = await trigger("setter.no_answer", clientId, AT_4_50_PM, PRESSED);
    const step = recordingStep();
    const res = await runCadence({ event, db, step, now: () => new Date(AT_4_50_PM) });
    assert.equal(res.exitedAt, "completed");
    const rows = await queued(clientId);
    assert.deepEqual(rows.map((m) => m.template_key), [MSG1_KEY, MSG2_KEY, MSG3_KEY]);
    const when = formatAppointmentStart(startsAt, "America/Phoenix");
    for (const m of rows) assert.ok(m.rendered_body.includes(when), m.rendered_body);
    assert.deepEqual(plannedTimes(step), {
      "wait-until-msg1": "2026-10-31T23:50:00.000Z",
      "wait-until-msg2": "2026-11-01T16:00:00.000Z",
      "wait-until-msg3": "2026-11-01T18:00:00.000Z"
    });
  });

test("AI-SET-03, no call ahead: the opt-in texts carry the person's own calendar link",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient({ customFields: { cf_svy_self_reported_fico_label: "620-699" } });
    const event = await trigger("setter.no_answer", clientId, AT_4_50_PM, PRESSED);
    const res = await runCadence({ event, db, step: recordingStep(), now: () => new Date(AT_4_50_PM) });
    assert.equal(res.exitedAt, "completed");
    const rows = await queued(clientId);
    assert.deepEqual(rows.map((m) => m.template_key), [OPTIN1_KEY, OPTIN2_KEY, OPTIN3_KEY]);
    for (const m of rows) assert.ok(m.rendered_body.includes(U), m.rendered_body);
  });

test("AI-SET-03: moving the call while text 2 waited for 9 a.m. stops it; a booking from before the run does not",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    await insertBooking(clientId, { startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    await insertEvent({ name: "booking.created", clientId, at: "2026-10-30T12:00:00Z" });
    const event = await trigger("setter.no_answer", clientId, AT_4_50_PM, PRESSED);
    const step = recordingStep({
      wake: async (id) => {
        if (id === "wait-until-msg2") await insertEvent({ name: "booking.rescheduled", clientId, at: "2026-11-01T14:00:00Z" });
      }
    });
    const res = await runCadence({ event, db, step, now: () => new Date(AT_4_50_PM) });
    assert.equal(res.exitedAt, "after-msg1");
    assert.deepEqual((await queued(clientId)).map((m) => m.template_key), [MSG1_KEY]);
  });

/* ── The setter desk ───────────────────────────────────────────────────────── */

const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const desk = () => ({ id: OWNER_ID, org_id: orgId, role: "owner", name: "Desk Owner" });
const customFieldsOf = async (clientId) =>
  (await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId])).rows[0].custom_fields;

test("setter desk: saving No answer writes one setter.no_answer event per lead per Arizona day",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const events = async () => (await db.query(
      `SELECT payload, idempotency_key FROM events
        WHERE org_id = $1 AND client_id = $2 AND name = 'setter.no_answer' ORDER BY created_at`,
      [orgId, clientId]
    )).rows;
    const day1 = { now: () => new Date("2026-10-31T23:50:00Z") }; // 4:50 p.m. on the 31st in Arizona
    const first = await updateSetterHandoff(db, desk(), { client_id: clientId, action: "save",
      handoff: { disposition: "no_answer", call_attempts: 1 } }, day1);
    assert.equal(first.status, 200);
    const [saved, ...rest] = await events();
    assert.equal(rest.length, 0);
    assert.equal(saved.idempotency_key, `setter.no_answer:${clientId}:2026-10-31`);
    assert.deepEqual(saved.payload, { disposition: "no_answer", setter_staff_id: OWNER_ID, call_attempts: 1 });

    // The same screen saved again, and another dial the same day: still one.
    await updateSetterHandoff(db, desk(), { client_id: clientId, action: "save",
      handoff: { disposition: "no_answer", call_attempts: 1, goal: "Open a shop" } }, day1);
    await updateSetterHandoff(db, desk(), { client_id: clientId, action: "log_dial", handoff: { disposition: "no_answer" } }, day1);
    assert.equal((await events()).length, 1);

    // The next Arizona day, another dial with no answer: a new cadence.
    await updateSetterHandoff(db, desk(), { client_id: clientId, action: "log_dial", handoff: { disposition: "no_answer" } },
      { now: () => new Date("2026-11-01T17:00:00Z") });
    const all = await events();
    assert.equal(all.length, 2);
    assert.equal(all[1].idempotency_key, `setter.no_answer:${clientId}:2026-11-01`);
    assert.equal(all[1].payload.call_attempts, 3);
  });

test("setter desk: any other result writes no event",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    for (const disposition of ["reached", "reschedule", "booked_on_call"]) {
      const r = await updateSetterHandoff(db, desk(), { client_id: clientId, action: "save", handoff: { disposition, call_attempts: 1 } },
        { now: () => new Date("2026-10-31T19:00:00Z") });
      assert.equal(r.status, 200, disposition);
    }
    const n = (await db.query(`SELECT count(*)::int AS n FROM events WHERE org_id = $1 AND client_id = $2 AND name = 'setter.no_answer'`, [orgId, clientId])).rows[0].n;
    assert.equal(n, 0);
  });

test("setter desk: fixing the score on the call writes credit_tier on the person; clearing the fix puts it back",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient({ customFields: { cf_svy_self_reported_fico_label: "620-699", cf_svy_planned_use_label: "Open a shop" } });
    const up = await updateSetterHandoff(db, desk(), { client_id: clientId, action: "save_survey",
      survey_edits: { cf_svy_self_reported_fico: "700-759" } });
    assert.equal(up.status, 200);
    let cf = await customFieldsOf(clientId);
    assert.equal(cf.credit_tier, "qualified");
    assert.deepEqual(cf.setter_survey_edits, { cf_svy_self_reported_fico: "700-759" });
    assert.equal(cf.cf_svy_self_reported_fico_label, "620-699", "what the person typed is left alone");
    assert.equal(cf.cf_svy_planned_use_label, "Open a shop", "the rest of the file is kept");
    await updateSetterHandoff(db, desk(), { client_id: clientId, action: "save_survey", survey_edits: {} });
    cf = await customFieldsOf(clientId);
    assert.equal(cf.credit_tier, "unqualified");
  });

test("setter desk: with no readable score anywhere credit_tier is left exactly as it was",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient({ customFields: { cf_svy_planned_use_label: "Open a shop", credit_tier: "qualified" } });
    const result = await updateSetterHandoff(db, desk(), { client_id: clientId, action: "save_survey",
      survey_edits: { cf_svy_planned_use: "Equipment or buildout" } });
    assert.equal(result.status, 200);
    const cf = await customFieldsOf(clientId);
    assert.equal(cf.credit_tier, "qualified");
    assert.deepEqual(cf.setter_survey_edits, { cf_svy_planned_use: "Equipment or buildout" });
  });

/* ── Run the way the workflow engine runs them ─────────────────────────────────
 *
 * The engine does not run a function once from top to bottom. It runs it from the
 * top, does the first step it has not done, records that step's answer (as JSON),
 * and starts again from the top: everything OUTSIDE a step is worked out again,
 * against the later clock, on every wake. That is how the booking reminders were
 * once silently switched off (src/workflows/s-04b-booking-reminders.mjs explains).
 * So the planned moments here must come out of steps, and these two tests drive
 * both chases that way: a sleep ends the invocation, the clock moves to the wake
 * time, things the test scheduled "while they slept" happen, and the function
 * starts over from the top with its record.
 */
class Suspend extends Error {
  constructor(id, until) { super(`suspended at ${id}`); this.id = id; this.until = until; }
}
const lengthMs = (text) => [...String(text).matchAll(/(\d+)([hm])/g)]
  .reduce((sum, [, n, unit]) => sum + Number(n) * (unit === "h" ? 3_600_000 : 60_000), 0);

async function runLikeTheEngine({ startIso, fn, happenings = [] }) {
  const clock = { now: Date.parse(startIso) };
  const memo = new Map();
  const sent = [];       // { id, at }: when each send step really ran
  const slept = [];      // { id, until }
  const pending = [...happenings].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const step = {
    run: async (id, f) => {
      if (memo.has(id)) return memo.get(id);
      const out = await f();
      if (/^send-/.test(id)) sent.push({ id, at: new Date(clock.now).toISOString() });
      const recorded = out === undefined ? null : JSON.parse(JSON.stringify(out));
      memo.set(id, recorded);
      return recorded;
    },
    sleepUntil: async (id, when) => {
      if (memo.has(id)) return;
      throw new Suspend(id, new Date(when).getTime());
    }
  };
  step.sleep = (id, length) => step.sleepUntil(id, new Date(clock.now + lengthMs(length)));
  const now = () => new Date(clock.now);
  for (let guard = 0; guard < 200; guard += 1) {
    try {
      const result = await fn(step, now);
      return { result, sent, slept };
    } catch (err) {
      if (!(err instanceof Suspend)) throw err;
      slept.push({ id: err.id, until: new Date(err.until).toISOString() });
      memo.set(err.id, "slept");
      // Things that happen while the run sleeps, in time order, up to the wake time.
      while (pending.length && Date.parse(pending[0].at) <= err.until) await pending.shift().fn();
      clock.now = Math.max(clock.now, err.until);
    }
  }
  throw new Error("the run never finished");
}

test("S-NOBOOK under the engine's replays: every text leaves at its planned moment inside 9 to 5 Arizona, and the setter task is made once",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient({ customFields: { cf_svy_self_reported_fico_label: "760-850" } });
    const event = await trigger("survey.completed", clientId, FINISHED_4PM);
    const { result, sent, slept } = await runLikeTheEngine({
      startIso: FINISHED_4PM,
      fn: (step, now) => runChase({ event, db, step, now })
    });
    assert.equal(result.exitedAt, "completed");
    assert.equal((await tasksOf(clientId)).length, 1);
    assert.equal(new Date((await tasksOf(clientId))[0].due_at).toISOString(), "2026-10-31T23:15:00.000Z", "due when the 15 minutes were up, not at a later replay");
    assert.deepEqual(slept.map((s) => [s.id, s.until]), [
      ["wait-15m", "2026-10-31T23:15:00.000Z"],
      ["wait-until-msg1", "2026-11-01T16:00:00.000Z"],
      ["wait-until-msg2", "2026-11-02T16:00:00.000Z"],
      ["wait-until-msg3", "2026-11-05T16:00:00.000Z"]
    ]);
    assert.deepEqual(sent.map((s) => [s.id, s.at]), [
      ["send-nobook-1", "2026-11-01T16:00:00.000Z"],
      ["send-nobook-2", "2026-11-02T16:00:00.000Z"],
      ["send-nobook-3", "2026-11-05T16:00:00.000Z"]
    ], "each send ran at the moment it was planned for");
    assert.ok(sent.every((s) => inDripWindow(new Date(s.at))));
    assert.equal((await queued(clientId)).length, 6);
  });

test("S-NOBOOK under the engine's replays: a booking at 8 a.m. while text 1 waits for 9 a.m. stops it",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const event = await trigger("survey.completed", clientId, FINISHED_4PM);
    const { result, sent } = await runLikeTheEngine({
      startIso: FINISHED_4PM,
      fn: (step, now) => runChase({ event, db, step, now }),
      happenings: [{ at: "2026-11-01T15:00:00Z", fn: () => insertEvent({ name: "booking.created", clientId, at: "2026-11-01T15:00:00Z" }) }]
    });
    assert.equal(result.exitedAt, "after-wait-2h");
    assert.deepEqual(sent, []);
    assert.equal((await queued(clientId)).length, 0);
    assert.equal((await tasksOf(clientId)).length, 1);
  });

test("AI-SET-03 under the engine's replays: No answer at 4:50 p.m. sends text 1 at once and texts 2 and 3 the next morning at 9:00 and 11:00",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const event = await trigger("setter.no_answer", clientId, AT_4_50_PM, PRESSED);
    const { result, sent, slept } = await runLikeTheEngine({
      startIso: AT_4_50_PM,
      fn: (step, now) => runCadence({ event, db, step, now })
    });
    assert.equal(result.exitedAt, "completed");
    assert.deepEqual(slept.map((s) => [s.id, s.until]), [
      ["wait-until-msg1", "2026-10-31T23:50:00.000Z"],
      ["wait-until-msg2", "2026-11-01T16:00:00.000Z"],
      ["wait-until-msg3", "2026-11-01T18:00:00.000Z"]
    ]);
    assert.deepEqual(sent.map((s) => [s.id, s.at]), [
      ["send-msg1", "2026-10-31T23:50:00.000Z"],
      ["send-msg2", "2026-11-01T16:00:00.000Z"],
      ["send-msg3", "2026-11-01T18:00:00.000Z"]
    ]);
    assert.ok(sent.every((s) => inDripWindow(new Date(s.at))));
    assert.equal((await queued(clientId)).length, 3);
  });

test("AI-SET-03 under the engine's replays: a reply at 8 a.m. stops the text held for 9 a.m.",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient({ phone: "(555) 444-0003" });
    const event = await trigger("setter.no_answer", clientId, AT_4_50_PM, PRESSED);
    const { result, sent } = await runLikeTheEngine({
      startIso: AT_4_50_PM,
      fn: (step, now) => runCadence({ event, db, step, now }),
      happenings: [{ at: "2026-11-01T15:00:00Z", fn: () => insertEvent({
        name: "message.inbound", clientId: null, at: "2026-11-01T15:00:00Z",
        payload: { channel: "sms", from: "+15554440003", body: "can you call me back", source: "twilio" }
      }) }]
    });
    assert.equal(result.exitedAt, "replied");
    assert.deepEqual(sent.map((s) => s.id), ["send-msg1"], "text 1 went at 4:50 p.m.; text 2 never left");
    assert.equal((await queued(clientId)).length, 1);
  });
