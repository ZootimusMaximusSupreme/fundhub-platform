/* The booked lane, proven on a scratch Postgres: every message a person gets
 * after they BOOK a call, driven through the real exported handle() functions,
 * the real ClickFunnels adapter and the real messages table.
 *
 * WHAT IS COVERED
 *   (a) booking.created   S-04 (card to Booked), S-04B (confirm text + email,
 *                         handed to the sender at once, 24-hour and 2-hour
 *                         reminders at the right moments), S-04C (staff alert),
 *                         the setter's booking task, AI-SET-04 (15-minute text)
 *   (b) booking.rescheduled  the old runs stop, a new S-04B run confirms again
 *                         and plans reminders from the NEW start time
 *   (c) booking.cancelled the reminders stop; what the person gets (nothing);
 *                         where the sales card goes (nowhere)
 *   (d) no-show           DPC-02 marks it and emits booking.noshow; S-05A sends
 *                         four touches, makes a closer task, stops on a rebook
 *   (e) call held         "the call happened" (callHappened in DPC-02) stops the
 *                         reminders, marks Showed, and S-05A never starts
 *   BS-01 is only observed (it starts on booking, stops when the call is held).
 *
 * HOW THE RUNS ARE DRIVEN. Inngest runs a function from the top, does the next
 * step it has not done, records the answer and starts again. replayDriver() does
 * the same, so "decided once at booking time" bugs (F47) show up here too. Sleeps
 * return at once and move a fake clock to the wake time; onWake() lets a test
 * change the database "while the person is asleep" (the call gets logged, the
 * person rebooks).
 *
 * THE cancelOn RULES are evaluated, not pattern-matched: each rule's `if`
 * expression runs against event rows the REAL adapter wrote (same shape bus.emit
 * sends to Inngest: { id, payload, orgId, clientId }).
 *
 * SAFETY. Runs only on a local scratch database (loopback host, name with
 * scratch, ci or test): anything else skips, and a skip is not a pass. No text
 * or email is sent: the sender (drainMessageNow) and the calendar read are
 * stubs, INNGEST_EVENT_KEY and GHL_API_KEY are removed for the run, and the
 * send fence is down by default. Every row carries NONCE in the email and is
 * removed afterwards.
 *
 *   DATABASE_URL=postgres://postgres@127.0.0.1:55432/fundhub_scratch_w4 \
 *     node --test src/workflows/booked-lane.pg.test.mjs
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { db, close } from "../db.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { handleClickFunnelsWebhook } from "../adapters/clickfunnels.mjs";
import { _resetOrgCache, defaultOrgId } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { ensureRegistered, _resetRegistered } from "../register-all.mjs";
import { logCallOutcome } from "../sales/call-outcomes.mjs";
import { createSetterTaskForEvent } from "../setter/tasks.mjs";
import { queueStaffBookedAlerts, STAFF_BOOKED_TEMPLATE } from "../staff/booked-call-alert.mjs";
import { moveCardToStage } from "./cards.mjs";
import { handle as handleS04, s04CallBooked } from "./s-04-call-booked.mjs";
import {
  handle as handleS04b, s04bBookingReminders,
  SMS_CONFIRM, EMAIL_CONFIRM, SMS_REMIND_24H, SMS_REMIND_2H
} from "./s-04b-booking-reminders.mjs";
import { handle as handleS04c, s04cStaffBookedAlert } from "./s-04c-staff-booked-alert.mjs";
import {
  handle as handleAiSet04, aiSet043WayHandoff, sendKeyFor,
  SMS_TEMPLATE_KEY as SMS_HANDOFF
} from "./ai-set-04-3way-handoff.mjs";
import { handle as handleDpc02, dpc02CallOutcomeEnforcement, callHeldFor } from "./dpc-02-call-outcome-enforcement.mjs";
import {
  handle as handleS05a, s05aNoShowRecovery,
  EMAIL_TEMPLATE_KEY as EMAIL_NOSHOW_01, SMS_TEMPLATE_KEY as SMS_NOSHOW_01,
  EMAIL_NOSHOW_02, SMS_NOSHOW_02, EMAIL_NOSHOW_03, SMS_NOSHOW_03,
  EMAIL_NOSHOW_04, SMS_NOSHOW_04, SOURCE_WORKFLOW as S05A_WORKFLOW
} from "./s-05a-no-show-recovery.mjs";
import { handle as handleBs01, bs01PrecallLauncher } from "./bs-01-precall-launcher.mjs";

const SKIP = isLocalScratchDatabaseUrl(process.env.DATABASE_URL)
  ? false
  : "needs DATABASE_URL on a local scratch database (127.0.0.1 or localhost, name with scratch, ci or test)";

const NONCE = `w4${process.pid}${Date.now().toString(36)}`;
const SECRET = `w4_secret_${NONCE}`;
const PHONE = "+16025550111"; // 555-01xx is the reserved fiction range
const MEET = "https://meet.google.com/abc-defg-hij";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
// The moment the people in this file "book": a whole minute, now.
const BASE = Math.floor(Date.now() / MIN) * MIN;
const iso = (ms) => new Date(ms).toISOString();

/* Fixed moments for the 9 a.m. to 5 p.m. Arizona send window, so what the
   run does never depends on the hour the test happens to run. */
const NOON_MST = Date.parse("2026-11-04T19:00:00Z");     // Wed 12:00 p.m. Arizona, inside the window
const SIX_PM_MST = Date.parse("2026-11-05T01:00:00Z");   // Wed  6:00 p.m. Arizona, after it
const NINE_AM_MST = Date.parse("2026-11-05T16:00:00Z");  // Thu  9:00 a.m. Arizona, when it opens

// The two funding calendars and the plain link (src/workflows/messaging.mjs).
const LINK_Q = "https://apply.fundhub.ai/funding-book-call?fh_tier=q";
const LINK_U = "https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u";
const LINK_PLAIN = "https://apply.fundhub.ai/funding-book-call";

const bookingLinksIn = (text) => String(text).match(/https:\/\/apply\.fundhub\.ai\/funding-book-call[^\s"<]*/g) || [];

/* The booked time as Arizona reads it, worked out here from the clock and not
   by calling the code under test. Arizona has no daylight saving, so the zone
   name is MST all year. */
const squash = (s) => String(s).replace(/\s+/g, " ");
const azClock = (ms) =>
  squash(new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", hour: "numeric", minute: "2-digit" }).format(new Date(ms)));
function assertArizonaTime(text, startMs, what) {
  const body = squash(text);
  assert.ok(body.includes(azClock(startMs)), `${what}: should show ${azClock(startMs)} Arizona time, got: ${body.slice(0, 240)}`);
  assert.ok(body.includes("MST"), `${what}: should name the zone (MST)`);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(body), `${what}: printed the raw ISO time`);
  assert.ok(!/\bUTC\b|\bGMT\b/.test(body), `${what}: printed a UTC time`);
}

/* ── the fake step that behaves like Inngest ───────────────────────────────── */

const SUSPEND = Symbol("inngest-suspend");

function durationMs(d) {
  if (typeof d === "number") return d;
  const m = /^(\d+)\s*(ms|s|m|h|d)$/.exec(String(d).trim());
  if (!m) throw new Error(`replayDriver: cannot read the duration ${d}`);
  return Number(m[1]) * { ms: 1, s: 1000, m: MIN, h: HOUR, d: 24 * HOUR }[m[2]];
}

/* One step per invocation, answers carried as JSON, everything outside a step
   re-run on every pass: the way Inngest runs a function. Sleeps move the fake
   clock to the wake time and note it in `wakes`; onWake({ id, at }) runs while
   the person is "asleep". */
function replayDriver({ startMs = BASE, onWake = null, maxInvocations = 400 } = {}) {
  const memo = new Map();
  const wakes = [];
  const ran = [];
  let t = startMs;
  const asleep = async (id, at) => {
    wakes.push({ id, at: new Date(at) });
    if (onWake) await onWake({ id, at: new Date(at) });
  };
  const step = {
    run: async (id, fn) => {
      if (memo.has(id)) return memo.get(id);
      const value = await fn();
      ran.push(id);
      memo.set(id, value === undefined ? null : JSON.parse(JSON.stringify(value)));
      throw SUSPEND;
    },
    sleep: async (id, dur) => {
      if (memo.has(id)) return;
      memo.set(id, null);
      t += durationMs(dur);
      await asleep(id, t);
      throw SUSPEND;
    },
    sleepUntil: async (id, when) => {
      if (memo.has(id)) return;
      memo.set(id, null);
      const target = new Date(when).getTime();
      if (Number.isFinite(target)) t = Math.max(t, target);
      await asleep(id, Number.isFinite(target) ? target : t);
      throw SUSPEND;
    }
  };
  return {
    step, wakes, ran,
    now: () => t,
    async drive(run) {
      for (let i = 0; i < maxInvocations; i += 1) {
        try { return await run(); } catch (err) { if (err !== SUSPEND) throw err; }
      }
      throw new Error("replayDriver: the workflow never finished");
    }
  };
}

/* No suspending: every step answers at once. For BS-01, which runs its two
   drips side by side with Promise.all. */
function inlineStep({ onWake = null } = {}) {
  const wakes = [];
  const wake = async (id, at) => { wakes.push({ id, at: new Date(at) }); if (onWake) await onWake({ id, at: new Date(at) }); };
  return {
    wakes,
    step: {
      run: async (_id, fn) => fn(),
      sleep: async (id, dur) => wake(id, Date.now() + durationMs(dur)),
      sleepUntil: async (id, when) => wake(id, new Date(when).getTime())
    }
  };
}

/* ── cancelOn, evaluated ───────────────────────────────────────────────────── */

/* The rules are written in CEL. These use only paths, == / !=, && and null, so
   a missing field reads as null (as it does in Inngest) and the rest is JS. */
function celGet(root, path) {
  let cur = root;
  for (const seg of path) {
    if (cur == null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, seg)) return null;
    cur = cur[seg];
  }
  return cur === undefined ? null : cur;
}

function evalCel(expr, scope) {
  const js = String(expr)
    .replace(/\b(event|async)((?:\.[A-Za-z_][A-Za-z0-9_]*)+)/g,
      (_m, root, path) => `get(${root === "event" ? "E" : "A"}, ${JSON.stringify(path.slice(1).split("."))})`)
    .replace(/!=|==/g, (m) => (m === "!=" ? "!==" : "==="));
  if (!/^[\sA-Za-z0-9_$.,"'[\]()!=&|]*$/.test(js)) throw new Error(`cancelOn expression is not plain paths and comparisons: ${expr}`);
  return Boolean(new Function("E", "A", "get", `"use strict"; return (${js});`)(scope.event, scope.async, celGet));
}

const asRunData = (row) => ({ id: row.id, payload: row.payload, orgId: row.org_id, clientId: row.client_id });
const asInngestEvent = (row) => ({ name: row.name, data: asRunData(row) });

/** True when `incoming` would cancel a run of `fn` that was started by `started`. */
function cancelsRun(fn, started, incoming) {
  return (fn.opts.cancelOn || []).some((rule) =>
    rule.event === incoming.name && evalCel(rule.if, { event: started, async: incoming }));
}

/* ── database helpers ──────────────────────────────────────────────────────── */

const created = { clientIds: [], staffIds: [] };
let orgId = null;
let callSeq = 0;
const nextCallId = () => 900000000 + (Date.now() % 90000000) + (callSeq += 1);

async function makePerson(label, { score = null, first = "Wendy" } = {}) {
  const email = `w4-booked-${label}+fhtest-${NONCE}@example.invalid`;
  const cf = {};
  if (score) {
    cf.cf_svy_self_reported_fico = score;
    cf.cf_svy_self_reported_fico_label = score;
    // Also saved on the person once the survey fix lands; the two always agree.
    cf.credit_tier = /^(700-749|750\+|700-759|760-850)$/.test(score) ? "qualified" : "unqualified";
  }
  const r = await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone, ghl_contact_id, is_demo, custom_fields)
     VALUES ($1,$2,$3,'Booked',$4,'w4-test',true,$5::jsonb) RETURNING id`,
    [orgId, email, first, PHONE, JSON.stringify(cf)]
  );
  created.clientIds.push(r.rows[0].id);
  return { id: r.rows[0].id, email, first, label };
}

async function purge() {
  const swept = (await db.query(
    `SELECT id FROM clients WHERE email LIKE 'w4-booked-%+fhtest-%@example.invalid'`)).rows.map((r) => r.id);
  const ids = [...new Set([...created.clientIds, ...swept])];
  if (ids.length) {
    await db.query(`DELETE FROM messages WHERE client_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM tasks WHERE client_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM events WHERE client_id = ANY($1::uuid[])`, [ids]);
  }
  await db.query(`DELETE FROM events WHERE payload->>'email' LIKE 'w4-booked-%+fhtest-%@example.invalid'`);
  await db.query(`DELETE FROM bookings WHERE attendee_email LIKE 'w4-booked-%+fhtest-%@example.invalid'`);
  await db.query(`DELETE FROM account_magic_links WHERE email LIKE 'w4-booked-%+fhtest-%@example.invalid'`);
  if (ids.length) await db.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [ids]);
  // The one staff row the staff-alert check makes (and any a crashed run left behind).
  const staffIds = [...new Set([...created.staffIds, ...(await db.query(
    `SELECT id FROM staff WHERE email LIKE 'w4-setter+fhtest-%@example.invalid'`)).rows.map((r) => r.id)])];
  if (staffIds.length) {
    await db.query(`DELETE FROM staff_apns_alerts WHERE staff_id = ANY($1::uuid[])`, [staffIds]);
    await db.query(`DELETE FROM staff WHERE id = ANY($1::uuid[])`, [staffIds]);
  }
}

function cfAppointment(kind, { person, callId, eventId, startOn, endOn }) {
  return JSON.stringify({
    data: {
      id: callId, public_id: "w4", workspace_id: 789,
      event_type: { name: "Funding Strategy Meeting" },
      start_on: startOn, end_on: endOn,
      status: kind === "canceled" ? "canceled" : "scheduled",
      primary_contact: {
        id: 1, email_address: person.email, first_name: person.first, last_name: "Booked", phone_number: PHONE
      },
      tzid: "America/Phoenix"
    },
    page: null, funnel: null, event_id: eventId, created_at: new Date().toISOString(),
    event_type: `appointments/scheduled_event.${kind}`, subject_id: callId, api_version: 2,
    subject_type: "Appointments::ScheduledEvent", workspace_id: 789
  });
}

/** The calendar page's own form post: it can arrive before the appointment. */
function cfFormPost({ person, eventId, startOn, endOn }) {
  return JSON.stringify({
    event_type: "form_submission.created",
    event_id: eventId,
    page: { id: 25062844, name: "Funding Book Call" },
    data: {
      id: 78217850, page_id: "25062844",
      data: {
        contact: { email: person.email },
        appointments_schedule_request: {
          name: `${person.first} Booked`, email: person.email, phone_number: PHONE,
          start_on: startOn, end_on: endOn, tzid: "America/Phoenix"
        }
      }
    }
  });
}

const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");

/** Deliver one ClickFunnels message through the real adapter, then read back
    the event it stored. Returns the row, the Inngest-shaped event and the
    run data a workflow's handle() receives. */
async function deliverRaw(raw) {
  const out = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(out.ok, true, `delivery refused: ${JSON.stringify(out).slice(0, 200)}`);
  const emitted = out.emitted[0];
  if (!emitted) return { out, row: null, data: null, inngest: null };
  const row = (await db.query(
    `SELECT id, name, org_id, client_id, payload FROM events WHERE id = $1`, [emitted.id])).rows[0];
  return { out, row, data: row ? asRunData(row) : null, inngest: row ? asInngestEvent(row) : null };
}

async function deliver(kind, o) {
  const d = await deliverRaw(cfAppointment(kind, o));
  assert.ok(d.row, `${kind} stored no event: ${JSON.stringify(d.out.emitted)}`);
  return d;
}

/** An event row with no side effects (no local handler runs) for the cases that
    need a booking event but not the whole door. */
async function storeEvent(name, payload, person) {
  const r = await db.query(
    `INSERT INTO events (org_id, name, version, client_id, payload)
     VALUES ($1,$2,1,$3,$4::jsonb) RETURNING id, name, org_id, client_id, payload`,
    [orgId, name, person.id, JSON.stringify(payload)]);
  const row = r.rows[0];
  return { row, data: asRunData(row), inngest: asInngestEvent(row) };
}

const bookingPayload = (person, { startMs, endMs = startMs + 30 * MIN, bookingUid = String(nextCallId()) }) => ({
  bookingUid, startTime: iso(startMs), endTime: iso(endMs), email: person.email,
  name: `${person.first} Booked`, phone: PHONE, meetingUrl: null, rescheduleUid: null,
  eventType: "Funding Strategy Meeting", calendarPageId: null, source: "clickfunnels"
});

async function messagesFor(clientId) {
  return (await db.query(
    `SELECT template_key, channel, status, subject, rendered_body AS body, to_address, provider_ref
       FROM messages WHERE client_id = $1 AND template_key IS NOT NULL
      ORDER BY created_at, id`, [clientId])).rows;
}
const only = (rows, key) => rows.filter((r) => r.template_key === key);

async function cardStage(clientId) {
  const r = await db.query(
    `SELECT ps.key FROM cards c
       JOIN pipelines p ON p.id = c.pipeline_id
       JOIN pipeline_stages ps ON ps.id = c.stage_id
      WHERE c.client_id = $1 AND p.key = 'sales'`, [clientId]);
  return r.rows[0]?.key ?? null;
}
const putCard = (clientId, stageKey) =>
  moveCardToStage(db, { orgId, clientId, pipelineKey: "sales", stageKey });

async function clientRow(clientId) {
  return (await db.query(`SELECT tags, custom_fields FROM clients WHERE id = $1`, [clientId])).rows[0];
}
async function tasksFor(clientId) {
  return (await db.query(
    `SELECT title, body, source_workflow, assignee_role, done, due_at, detail FROM tasks
      WHERE client_id = $1 ORDER BY created_at, id`, [clientId])).rows;
}
async function bookingRows(clientId) {
  return (await db.query(
    `SELECT provider_uid, status, starts_at, ends_at, meeting_url, raw FROM bookings
      WHERE client_id = $1 ORDER BY created_at`, [clientId])).rows;
}
async function eventsNamed(clientId, name) {
  return (await db.query(
    `SELECT id, payload FROM events WHERE client_id = $1 AND name = $2 ORDER BY created_at, id`,
    [clientId, name])).rows;
}

/** A closer saved a call (what the closer's screen does) — the real
    logCallOutcome, so the call.completed event is the one production writes. */
async function closerLogsCall(person, { outcome, bookingRef = null }) {
  const closer = (await db.query(
    `SELECT id FROM staff WHERE org_id = $1 AND role = 'closer' AND status = 'active' LIMIT 1`, [orgId])).rows[0];
  assert.ok(closer, "the scratch database needs an active closer");
  const task = (await db.query(
    `SELECT id FROM tasks WHERE client_id = $1 AND assignee_role = 'closer'
        AND ($2::text IS NULL OR body = $2) ORDER BY created_at LIMIT 1`,
    [person.id, bookingRef])).rows[0];
  return logCallOutcome(db, {
    orgId, clientId: person.id, staffId: closer.id, taskId: task?.id || null, bookingRef, outcome
  });
}

function drainSpy() {
  const calls = [];
  return {
    calls,
    impl: async (_db, messageId, opts = {}) => {
      calls.push({ messageId, orgId: opts.orgId });
      return { ran: true, reason: null, dispatched: 1, sent: 1, blocked: 0, results: [] };
    }
  };
}

/** The usual S-04B run: real sender stubbed, real magic link, fake clock. */
async function runS04b(data, { startMs = BASE, onWake = null, drain = drainSpy() } = {}) {
  const driver = replayDriver({ startMs, onWake });
  const result = await driver.drive(() => handleS04b({
    event: data, db, step: driver.step, now: driver.now, drainNowImpl: drain.impl
  }));
  return { result, driver, drain };
}

const fakeFindLink = async () => ({ ok: true, url: MEET, source: "test" });
const noCloserAlert = async () => ({ queued: 0, reason: "stubbed" });

async function runAiSet04(data, { startMs = BASE, onWake = null, findLink = fakeFindLink } = {}) {
  const driver = replayDriver({ startMs, onWake });
  const alerts = [];
  const result = await driver.drive(() => handleAiSet04({
    event: data, db, step: driver.step, now: driver.now, findLink,
    upcomingAlert: async (_db, args) => { alerts.push(args); return noCloserAlert(); }
  }));
  return { result, driver, alerts };
}

async function runDpc02(data, { onWake = null } = {}) {
  const driver = replayDriver({ onWake });
  const result = await driver.drive(() => handleDpc02({ event: data, db, step: driver.step }));
  return { result, driver };
}

async function runS05a(data, { startMs = NOON_MST, onWake = null } = {}) {
  const driver = replayDriver({ startMs, onWake });
  const result = await driver.drive(() => handleS05a({ event: data, db, step: driver.step, now: driver.now }));
  return { result, driver };
}

/* ═══════════════════════════════════════════════════════════════════════════ */

describe("booked lane", () => {
  const saved = {};

  // Each test is skipped (and counted as skipped) off a local scratch database.
  const check = (name, fn) => test(name, { skip: SKIP }, fn);

  before(async () => {
    if (SKIP) return;
    for (const k of ["INNGEST_EVENT_KEY", "GHL_API_KEY", "CF_CAPTURE_MODE"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    _resetOrgCache(); clearHandlers(); _resetRegistered(); ensureRegistered();
    orgId = await defaultOrgId(db);
    await purge();
    const need = [SMS_CONFIRM, EMAIL_CONFIRM, SMS_REMIND_24H, SMS_REMIND_2H, SMS_HANDOFF,
      EMAIL_NOSHOW_01, SMS_NOSHOW_01, EMAIL_NOSHOW_02, SMS_NOSHOW_02, EMAIL_NOSHOW_03, SMS_NOSHOW_03,
      EMAIL_NOSHOW_04, SMS_NOSHOW_04];
    const have = (await db.query(
      `SELECT template_key FROM message_templates WHERE org_id = $1 AND template_key = ANY($2) AND compliance_passed`,
      [orgId, need])).rows.map((r) => r.template_key);
    assert.deepEqual(need.filter((k) => !have.includes(k)), [],
      "the scratch database is missing seeded, approved booked-lane templates");
  });

  after(async () => {
    if (SKIP) return;
    try { await purge(); } finally {
      for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
      await close();
    }
  });

  /* ── (a) booking.created ─────────────────────────────────────────────────── */

  check("(a) a booking arrives through the real ClickFunnels door: the booking, tasks, tag and card are recorded and the event carries what the workflows read", async () => {
    const p = await makePerson("door", { score: "700-759" });
    await putCard(p.id, "survey_complete");
    const startMs = BASE + 72 * HOUR;
    const callId = nextCallId();
    const d = await deliver("created", {
      person: p, callId, eventId: `${NONCE}-door-c`, startOn: iso(startMs), endOn: iso(startMs + 30 * MIN)
    });

    // What every workflow and every cancelOn rule reads off the event.
    assert.equal(d.row.name, "booking.created");
    assert.equal(d.row.client_id, p.id, "the event carries the person");
    assert.equal(d.row.org_id, orgId);
    assert.equal(d.row.payload.email, p.email);
    assert.equal(d.row.payload.bookingUid, String(callId), "the booking id is the call's own id");
    assert.equal(iso(Date.parse(d.row.payload.startTime)), iso(startMs));
    assert.equal(d.row.payload.source, "clickfunnels");

    const bookings = await bookingRows(p.id);
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].status, "booked");
    assert.equal(iso(bookings[0].starts_at), iso(startMs));

    const tasks = await tasksFor(p.id);
    const closerTask = tasks.find((t) => /^Strategy session booked/.test(t.title));
    assert.ok(closerTask, "the closer gets a call task");
    assert.equal(closerTask.assignee_role, "closer");
    assert.equal(closerTask.done, false);
    const setterTask = tasks.find((t) => t.source_workflow === "setter-booking");
    assert.ok(setterTask, "the setter gets a booking task");
    assert.equal(setterTask.title, "Setter: confirm booked strategy call");
    assert.equal(setterTask.assignee_role, "setter");
    assert.equal(setterTask.done, false);
    assert.match(setterTask.detail, /Dial within 60 seconds, confirm and prepare handoff/);

    const c = await clientRow(p.id);
    assert.ok(c.tags.includes("call:booked"));
    assert.equal(c.custom_fields.call_outcome, "booked");
    assert.equal(c.custom_fields.call_confirmed, false);
    assert.equal(await cardStage(p.id), "booked", "the local handler moves the card at once");
  });

  check("(a) S-04: tags the person, sets the call outcome and moves the sales card to Booked, never backwards", async () => {
    const p = await makePerson("s04");
    await putCard(p.id, "survey_complete");
    const ev1 = await storeEvent("booking.created", bookingPayload(p, { startMs: BASE + 72 * HOUR }), p);
    const res = await handleS04({ event: ev1.data, db, step: immediateStep() });
    assert.equal(res.done, true);
    assert.equal(res.card.moved, true);
    assert.equal(await cardStage(p.id), "booked");
    const c = await clientRow(p.id);
    assert.ok(c.tags.includes("call:booked"));
    assert.equal(c.custom_fields.call_outcome, "booked");

    // A person already further along is not pulled back.
    await putCard(p.id, "showed");
    const again = await handleS04({ event: ev1.data, db, step: immediateStep() });
    assert.equal(again.card.moved, false);
    assert.equal(again.card.reason, "already_at_or_past");
    assert.equal(await cardStage(p.id), "showed");

    assert.deepEqual(s04CallBooked.opts.triggers.map((t) => t.event), ["booking.created"]);
  });

  check("(a) S-04B: confirm text and email at once, handed to the sender, reminders at 24 hours and 2 hours, in Arizona time, with the link for the person's credit tier", async () => {
    const people = [
      { label: "q", score: "700-759", link: LINK_Q },
      { label: "q-high", score: "760-850", link: LINK_Q },
      { label: "q-old-750", score: "750+", link: LINK_Q },
      { label: "q-old-700", score: "700-749", link: LINK_Q },
      { label: "u", score: "620-699", link: LINK_U },
      { label: "u-low", score: "500-619", link: LINK_U },
      { label: "u-unsure", score: "Not sure", link: LINK_U },
      { label: "none", score: null, link: LINK_PLAIN }
    ];
    for (const spec of people) {
      const p = await makePerson(`s04b-${spec.label}`, { score: spec.score });
      const startMs = BASE + 100 * HOUR;
      const d = await storeEvent("booking.created", bookingPayload(p, { startMs }), p);
      const { result, driver, drain } = await runS04b(d.data);
      const tag = `${spec.label} (${spec.score ?? "no answer"})`;

      const msgs = await messagesFor(p.id);
      assert.deepEqual(msgs.map((m) => m.template_key),
        [SMS_CONFIRM, EMAIL_CONFIRM, SMS_REMIND_24H, SMS_REMIND_2H], `${tag}: what the person is sent, in order`);

      const sms = only(msgs, SMS_CONFIRM)[0];
      assert.equal(sms.channel, "sms");
      assert.equal(sms.to_address, PHONE);
      assert.equal(sms.status, "queued", "the stub sender left it queued; nothing was sent");
      assert.match(sms.body, /You're booked, Wendy\./);
      assertArizonaTime(sms.body, startMs, `${tag} confirm text`);
      assert.ok(sms.body.includes("Set up your Fundhub portal account and confirm your call here: https://fundhub.ai/portal-login.html?mode=claim"), `${tag}: lasting portal claim link`);
      assert.ok(sms.body.includes(`Need to move it? ${spec.link} `), `${tag}: reschedule link, got ${sms.body}`);

      const email = only(msgs, EMAIL_CONFIRM)[0];
      assert.equal(email.channel, "email");
      assert.equal(email.to_address, p.email);
      assertArizonaTime(email.subject, startMs, `${tag} confirm email subject`);
      assertArizonaTime(email.body, startMs, `${tag} confirm email`);
      assert.ok(email.body.includes(`href="${spec.link}"`), `${tag}: the Reschedule here link`);
      assert.match(email.body, /portal-login\.html\?mode=claim/, "Confirm my call opens the lasting portal claim page");
      assert.match(email.body, /portal-login\.html#download/, "the app download link");
      assert.ok(!/\{\{/.test(email.body) && !/href=""/.test(email.body), "no empty or unrendered tag");

      // Both confirmations were handed to the sender by id, text first.
      assert.deepEqual(drain.calls.map((c) => c.messageId), await idsOf(p.id, [SMS_CONFIRM, EMAIL_CONFIRM]));
      assert.ok(drain.calls.every((c) => c.orgId === orgId));

      // The two reminders, at exactly 24 hours and 2 hours before the call.
      assert.deepEqual(driver.wakes.map((w) => [w.id, iso(w.at.getTime())]), [
        ["wait-t-minus-24h", iso(startMs - 24 * HOUR)],
        ["wait-t-minus-2h", iso(startMs - 2 * HOUR)]
      ], `${tag}: reminder moments`);
      const r24 = only(msgs, SMS_REMIND_24H)[0];
      assert.match(r24.body, /your Fundhub call is tomorrow/);
      assertArizonaTime(r24.body, startMs, `${tag} 24-hour reminder`);
      assert.ok(r24.body.includes(`move it: ${spec.link} `), `${tag}: 24-hour link`);
      const r2 = only(msgs, SMS_REMIND_2H)[0];
      assert.match(r2.body, /your Fundhub call is in about two hours/);
      assertArizonaTime(r2.body, startMs, `${tag} 2-hour reminder`);
      assert.ok(r2.body.includes(`move it: ${spec.link} `), `${tag}: 2-hour link`);
      assert.equal(result.skipped24h, undefined);
      assert.equal(result.skipped2h, undefined);
    }
  });

  check("(a) S-04B: a reminder whose moment is already gone is not sent late; a bad or missing start time sends the confirmation only", async () => {
    const cases = [
      { label: "inside-24h", startMs: BASE + 20 * HOUR, key24: "booked_inside_24h", wakes: ["wait-t-minus-2h"], sent: [SMS_CONFIRM, EMAIL_CONFIRM, SMS_REMIND_2H] },
      { label: "inside-2h", startMs: BASE + 90 * MIN, key24: "booked_inside_24h", key2: "booked_inside_2h", wakes: [], sent: [SMS_CONFIRM, EMAIL_CONFIRM] },
      { label: "started", startMs: BASE - 3 * HOUR, skipped: "appointment_already_started", wakes: [], sent: [SMS_CONFIRM, EMAIL_CONFIRM] },
      { label: "garbled", startText: "next tuesday", skipped: "unreadable_start_time", wakes: [], sent: [SMS_CONFIRM, EMAIL_CONFIRM] },
      { label: "no-time", startText: null, skipped: "no_start_time", wakes: [], sent: [SMS_CONFIRM, EMAIL_CONFIRM] }
    ];
    for (const c of cases) {
      const p = await makePerson(`gone-${c.label}`, { score: "700-759" });
      const payload = bookingPayload(p, { startMs: BASE });
      payload.startTime = c.startText !== undefined ? c.startText : iso(c.startMs);
      const d = await storeEvent("booking.created", payload, p);
      const { result, driver } = await runS04b(d.data);
      assert.deepEqual((await messagesFor(p.id)).map((m) => m.template_key), c.sent, `${c.label}: what was sent`);
      assert.deepEqual(driver.wakes.map((w) => w.id), c.wakes, `${c.label}: reminders planned`);
      if (c.skipped) assert.equal(result.skippedReminders, c.skipped, c.label);
      if (c.key24) assert.equal(result.skipped24h, c.key24, c.label);
      if (c.key2) assert.equal(result.skipped2h, c.key2, c.label);
    }
  });

  check("(a) S-04C: the staff alert is one text per owner or setter with a phone, shows the booked time in Arizona time, and a replay texts nobody twice", async (t) => {
    // First the real handle(): the scratch staff have no phones, so it can only
    // record that nobody was texted.
    const p = await makePerson("s04c", { score: "700-759" });
    const startMs = BASE + 30 * HOUR;
    const d = await storeEvent("booking.created", bookingPayload(p, { startMs }), p);
    const phoned = (await db.query(
      `SELECT count(*)::int AS n FROM staff WHERE org_id = $1 AND status = 'active'
          AND lower(role) IN ('owner','setter') AND coalesce(phone,'') <> ''`, [orgId])).rows[0].n;
    if (phoned === 0) {
      const idle = await handleS04c({ event: d.data, db, step: immediateStep() });
      assert.equal(idle.done, true);
      assert.equal(idle.queued, 0);
      assert.equal((await messagesFor(p.id)).length, 0);
    } else {
      t.diagnostic(`S-04C real handle() not run: ${phoned} owner/setter staff here have a phone, and it would drain for real`);
    }

    // Then the queue with the sender and the push stubbed, and one setter with a phone.
    const staff = await db.query(
      `INSERT INTO staff (org_id, name, role, status, phone, email)
       VALUES ($1,'W4 Setter','setter','active','+16025550142',$2) RETURNING id`,
      [orgId, `w4-setter+fhtest-${NONCE}@example.invalid`]);
    created.staffIds.push(staff.rows[0].id);
    const drain = drainSpy();
    const pushes = [];
    const args = {
      orgId, clientId: p.id, eventId: d.row.id, payload: d.row.payload,
      drainNowImpl: drain.impl, pushImpl: async (_db, a) => { pushes.push(a.staffId); return { sent: 0 }; }
    };
    const first = await queueStaffBookedAlerts(db, args);
    assert.equal(first.queued, 1);
    assert.equal(first.sent, 1);
    const row = (await db.query(
      `SELECT template_key, channel, to_address, rendered_body, provider_ref FROM messages
        WHERE client_id = $1 AND template_key = $2`, [p.id, STAFF_BOOKED_TEMPLATE])).rows;
    assert.equal(row.length, 1);
    assert.equal(row[0].channel, "sms");
    assert.equal(row[0].to_address, "+16025550142");
    assert.equal(row[0].provider_ref, `workflow:${STAFF_BOOKED_TEMPLATE}:${d.row.id}:${staff.rows[0].id}`);
    assert.match(row[0].rendered_body, /Booked call: Wendy/);
    assertArizonaTime(row[0].rendered_body, startMs, "staff alert");
    assert.ok(pushes.includes(staff.rows[0].id), "the setter also gets the app alert");

    const replay = await queueStaffBookedAlerts(db, args);
    assert.equal(replay.queued, 0, "a replay of the same booking texts nobody again");
    assert.equal(drain.calls.length, 1);
    assert.deepEqual(triggersOf(s04cStaffBookedAlert), ["booking.created", "booking.rescheduled"]);
  });

  check("(a) the setter's booking task: one open task per person, a new one only after the first is done", async () => {
    const p = await makePerson("setter");
    const e1 = await storeEvent("booking.created", bookingPayload(p, { startMs: BASE + 48 * HOUR }), p);
    const first = await createSetterTaskForEvent({ ...e1.data, name: "booking.created" }, db);
    assert.equal(first.created, true);
    const e2 = await storeEvent("booking.created", bookingPayload(p, { startMs: BASE + 60 * HOUR }), p);
    const second = await createSetterTaskForEvent({ ...e2.data, name: "booking.created" }, db);
    assert.equal(second.created, false);
    assert.equal(second.reason, "open_task");
    let tasks = (await tasksFor(p.id)).filter((t) => t.source_workflow === "setter-booking");
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, "Setter: confirm booked strategy call");
    assert.equal(tasks[0].assignee_role, "setter");

    await db.query(`UPDATE tasks SET done = true WHERE client_id = $1 AND source_workflow = 'setter-booking'`, [p.id]);
    const e3 = await storeEvent("booking.created", bookingPayload(p, { startMs: BASE + 80 * HOUR }), p);
    const third = await createSetterTaskForEvent({ ...e3.data, name: "booking.created" }, db);
    assert.equal(third.created, true);
    tasks = (await tasksFor(p.id)).filter((t) => t.source_workflow === "setter-booking");
    assert.equal(tasks.length, 2);
  });

  check("(a) AI-SET-04: the 15-minute text goes at exactly 15 minutes before, once per call time, with the Meet link; refused when the call is too close, over, moved, cancelled or missed", async () => {
    const p = await makePerson("ai04", { score: "700-759" });
    const startMs = BASE + 5 * HOUR;
    const callId = nextCallId();
    const d = await deliver("created", {
      person: p, callId, eventId: `${NONCE}-ai04-c`, startOn: iso(startMs), endOn: iso(startMs + 30 * MIN)
    });

    const run = await runAiSet04(d.data);
    assert.deepEqual(run.driver.wakes.map((w) => [w.id, iso(w.at.getTime())]), [
      ["wait-for-host-calendar", iso(BASE + 2 * MIN)],
      ["wait-until-t-minus-15", iso(startMs - 15 * MIN)]
    ]);
    assert.equal(run.result.done, true);
    assert.equal((await bookingRows(p.id))[0].meeting_url, MEET, "the Meet link is kept on the booking soon after it is made");
    const sms = only(await messagesFor(p.id), SMS_HANDOFF);
    assert.equal(sms.length, 1);
    assert.equal(sms[0].channel, "sms");
    assert.equal(sms[0].to_address, PHONE);
    assert.match(sms[0].body, /Your call starts in 15 minutes/);
    assert.ok(sms[0].body.includes(MEET), "the real join link, not a blank");
    assert.equal(sms[0].provider_ref, `workflow:${SMS_HANDOFF}:${sendKeyFor(p.id, iso(startMs))}`);
    const advisor = (await tasksFor(p.id)).filter((t) => t.source_workflow === "ai-set-04-3way-handoff");
    assert.equal(advisor.length, 1);
    assert.equal(advisor[0].assignee_role, "closer");
    assert.equal(run.alerts.length, 1, "the closer's own heads-up is asked for once");

    // Run it again (a retry, or a move to the same time): still one text, one task.
    await runAiSet04(d.data);
    assert.equal(only(await messagesFor(p.id), SMS_HANDOFF).length, 1);
    assert.equal((await tasksFor(p.id)).filter((t) => t.source_workflow === "ai-set-04-3way-handoff").length, 1);

    // Too close, already over, no time: no text.
    const refusals = [
      { label: "inside-15m", startMs: BASE + 10 * MIN, reason: "booked_inside_15m" },
      { label: "over", startMs: BASE - 2 * HOUR, reason: "appointment_already_started" }
    ];
    for (const r of refusals) {
      const q = await makePerson(`ai04-${r.label}`);
      const e = await storeEvent("booking.created", bookingPayload(q, { startMs: r.startMs }), q);
      const out = await runAiSet04(e.data);
      assert.equal(out.result.done, false, r.label);
      assert.equal(out.result.reason, r.reason, r.label);
      assert.equal(only(await messagesFor(q.id), SMS_HANDOFF).length, 0, r.label);
    }
    const q = await makePerson("ai04-notime");
    const noTime = bookingPayload(q, { startMs: BASE });
    delete noTime.startTime;
    const out = await runAiSet04((await storeEvent("booking.created", noTime, q)).data);
    assert.equal(out.result.reason, "no_start_time");

    // The saved booking is asked again on waking: moved, cancelled and missed
    // calls get no text and no advisor task.
    const states = [
      { label: "moved", reason: "call_moved", change: (pp) => db.query(
        `UPDATE bookings SET starts_at = starts_at + interval '1 day',
                raw = jsonb_set(coalesce(raw,'{}'::jsonb), '{__history}', jsonb_build_array(jsonb_build_object('starts_at', $2::text)))
          WHERE client_id = $1`, [pp.id, iso(BASE + 6 * HOUR)]) },
      { label: "cancelled", reason: "call_cancelled", change: (pp) => db.query(`UPDATE bookings SET status = 'cancelled' WHERE client_id = $1`, [pp.id]) },
      { label: "noshow", reason: "call_noshow", change: (pp) => db.query(`UPDATE bookings SET status = 'noshow' WHERE client_id = $1`, [pp.id]) }
    ];
    for (const s of states) {
      const pp = await makePerson(`ai04-${s.label}`);
      const at = BASE + 6 * HOUR;
      const dd = await deliver("created", {
        person: pp, callId: nextCallId(), eventId: `${NONCE}-ai04-${s.label}`, startOn: iso(at), endOn: iso(at + 30 * MIN)
      });
      await s.change(pp);
      const res = await runAiSet04(dd.data);
      assert.equal(res.result.done, false, s.label);
      assert.equal(res.result.reason, s.reason, s.label);
      assert.equal(only(await messagesFor(pp.id), SMS_HANDOFF).length, 0, s.label);
      assert.equal((await tasksFor(pp.id)).filter((t) => t.source_workflow === "ai-set-04-3way-handoff").length, 0, s.label);
    }
  });

  /* ── (b) booking.rescheduled ─────────────────────────────────────────────── */

  check("(b) a move: the old runs are cancelled by the cancelOn rules the adapter's real payloads satisfy, and a new S-04B run confirms again with reminders from the NEW time", async (t) => {
    const p = await makePerson("move", { score: "620-699" });
    const callId = nextCallId();
    const t1 = BASE + 72 * HOUR;
    const t2 = BASE + 120 * HOUR;
    const created1 = await deliver("created", {
      person: p, callId, eventId: `${NONCE}-move-c`, startOn: iso(t1), endOn: iso(t1 + 30 * MIN)
    });
    const moved = await deliver("rescheduled", {
      person: p, callId, eventId: `${NONCE}-move-m`, startOn: iso(t2), endOn: iso(t2 + 30 * MIN)
    });
    assert.equal(moved.row.name, "booking.rescheduled");
    assert.equal(moved.row.payload.bookingUid, String(callId), "a move names the same call");
    assert.equal(moved.row.payload.email, p.email);
    assert.equal(iso(Date.parse(moved.row.payload.startTime)), iso(t2));

    // The saved booking and the closer task moved, once.
    const bookings = await bookingRows(p.id);
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].status, "rescheduled");
    assert.equal(iso(bookings[0].starts_at), iso(t2));
    const closerTasks = (await tasksFor(p.id)).filter((t) => /^Strategy session/.test(t.title));
    assert.equal(closerTasks.length, 1);
    assert.equal(closerTasks[0].title, "Strategy session rescheduled");
    assert.equal((await clientRow(p.id)).custom_fields.call_confirmed, false, "the confirmation is cleared for the new time");

    // cancelOn, evaluated: the run for the OLD time stops in all four.
    const fns = {
      "S-04B": s04bBookingReminders, "AI-SET-04": aiSet043WayHandoff,
      "DPC-02": dpc02CallOutcomeEnforcement, "BS-01": bs01PrecallLauncher
    };
    for (const [name, fn] of Object.entries(fns)) {
      assert.equal(cancelsRun(fn, created1.inngest, moved.inngest), true, `${name}: the move stops the run for the old time`);
    }
    // The run the move itself starts must not be stopped by that same move
    // (AI-SET-04 and DPC-02 guard it with the start-time check).
    assert.equal(cancelsRun(aiSet043WayHandoff, moved.inngest, moved.inngest), false, "AI-SET-04: a move does not cancel its own run");
    assert.equal(cancelsRun(dpc02CallOutcomeEnforcement, moved.inngest, moved.inngest), false, "DPC-02: a move does not cancel its own run");

    // Not asserted either way: S-04B and BS-01 have no start-time check on a move,
    // so their rule is also true for the event that started their own new run.
    // Whether Inngest ever tests a run against its own trigger event is not
    // something a database can settle (its docs only say the cancel listener is
    // created when the run is triggered). AI-SET-04 and DPC-02 guard it.
    t.diagnostic(`a move vs the run it started: S-04B=${cancelsRun(s04bBookingReminders, moved.inngest, moved.inngest)} ` +
      `BS-01=${cancelsRun(bs01PrecallLauncher, moved.inngest, moved.inngest)} ` +
      `AI-SET-04=${cancelsRun(aiSet043WayHandoff, moved.inngest, moved.inngest)} DPC-02=${cancelsRun(dpc02CallOutcomeEnforcement, moved.inngest, moved.inngest)}`);

    // Another person, another company: untouched.
    const other = await makePerson("move-other");
    const otherBooking = await storeEvent("booking.created", bookingPayload(other, { startMs: t1 }), other);
    for (const [name, fn] of Object.entries(fns)) {
      assert.equal(cancelsRun(fn, otherBooking.inngest, moved.inngest), false, `${name}: someone else's run is untouched`);
    }
    const foreignOrg = { name: "booking.rescheduled", data: { ...moved.inngest.data, orgId: crypto.randomUUID() } };
    for (const name of ["S-04B", "AI-SET-04", "DPC-02"]) {
      assert.equal(cancelsRun(fns[name], created1.inngest, foreignOrg), false, `${name}: another company's move does not stop this run`);
    }
    t.diagnostic(`another company's move vs BS-01 (its rules carry no company check): ${cancelsRun(bs01PrecallLauncher, created1.inngest, foreignOrg)}`);

    // The new run: a new confirmation (new rows, not the old ones), the new
    // time on every message, reminders planned from the new start.
    const first = await runS04b(created1.data, { startMs: BASE });
    const second = await runS04b(moved.data, { startMs: BASE + 10 * MIN });
    const msgs = await messagesFor(p.id);
    assert.equal(only(msgs, SMS_CONFIRM).length, 2, "one confirmation per booking message");
    assert.equal(only(msgs, EMAIL_CONFIRM).length, 2);
    const newConfirm = only(msgs, SMS_CONFIRM).find((m) => m.provider_ref.includes(moved.row.id));
    assert.ok(newConfirm, "the move's confirmation is its own row");
    assertArizonaTime(newConfirm.body, t2, "confirmation after the move");
    assert.ok(newConfirm.body.includes(LINK_U), "the move link follows the person's tier");
    const newEmail = only(msgs, EMAIL_CONFIRM).find((m) => m.provider_ref.includes(moved.row.id));
    assertArizonaTime(newEmail.subject, t2, "confirmation email after the move");
    assert.deepEqual(second.driver.wakes.map((w) => [w.id, iso(w.at.getTime())]), [
      ["wait-t-minus-24h", iso(t2 - 24 * HOUR)],
      ["wait-t-minus-2h", iso(t2 - 2 * HOUR)]
    ], "reminders are planned from the new start time");
    assert.deepEqual(first.driver.wakes.map((w) => iso(w.at.getTime())), [iso(t1 - 24 * HOUR), iso(t1 - 2 * HOUR)]);
    const reminders = msgs.filter((m) => m.template_key === SMS_REMIND_24H && m.provider_ref.includes(moved.row.id));
    assert.equal(reminders.length, 1);
    assertArizonaTime(reminders[0].body, t2, "24-hour reminder after the move");

    // The text and the no-show check stay safe even if a stop were missed.
    const stale = await runAiSet04(created1.data);
    assert.equal(stale.result.reason, "call_moved", "AI-SET-04: no text at the old time");
    const staleCheck = await runDpc02(created1.data);
    assert.equal(staleCheck.result.reason, "call_moved", "DPC-02: no outcome at the old time");
    assert.equal((await eventsNamed(p.id, "booking.noshow")).length, 0);
    // ...and the move gets its own text and its own check at the new time.
    const fresh = await runAiSet04(moved.data);
    assert.equal(fresh.result.done, true);
    assert.deepEqual(fresh.driver.wakes.map((w) => iso(w.at.getTime())).slice(-1), [iso(t2 - 15 * MIN)]);
    const freshCheck = await runDpc02(moved.data);
    assert.deepEqual(freshCheck.driver.wakes.map((w) => iso(w.at.getTime())), [iso(t2 + 30 * MIN + 5 * MIN)],
      "the no-show check moves to 5 minutes after the NEW end");
    assert.equal(freshCheck.result.outcome, "no_show", "a moved call that is missed is its own no-show");
    const missed = await eventsNamed(p.id, "booking.noshow");
    assert.equal(missed.length, 1);
    assert.equal(iso(Date.parse(missed[0].payload.startTime)), iso(t2), "the no-show names the new time");

    for (const fn of [s04bBookingReminders, aiSet043WayHandoff, dpc02CallOutcomeEnforcement, bs01PrecallLauncher]) {
      assert.deepEqual(triggersOf(fn), ["booking.created", "booking.rescheduled"], `${fn.opts.id} starts on both`);
    }
  });

  check("(b) booked from the calendar form first: the form's id is not the call's id, so only the email rule matches a later move or cancel, and it does", async () => {
    const p = await makePerson("formfirst", { score: "700-759" });
    const t1 = BASE + 72 * HOUR;
    const t2 = BASE + 96 * HOUR;
    const callId = nextCallId();
    const form = await deliverRaw(cfFormPost({
      person: p, eventId: `${NONCE}-form-1`, startOn: iso(t1), endOn: iso(t1 + 30 * MIN)
    }));
    assert.equal(form.row.name, "booking.created");
    assert.equal(form.row.payload.bookingUid, `${NONCE}-form-1`, "the form post names the booking by the message id");
    // The appointment message for the same slot adds no second event.
    const appt = await deliverRaw(cfAppointment("created", {
      person: p, callId, eventId: `${NONCE}-form-2`, startOn: iso(t1), endOn: iso(t1 + 30 * MIN)
    }));
    assert.equal(appt.out.emitted[0].deduped, true);
    assert.equal(appt.out.emitted[0].startedRun, false);
    assert.equal((await eventsNamed(p.id, "booking.created")).length, 1, "one booking event for one call");
    assert.equal((await bookingRows(p.id))[0].provider_uid, String(callId), "the saved booking is re-keyed to the call id");

    const moved = await deliver("rescheduled", {
      person: p, callId, eventId: `${NONCE}-form-m`, startOn: iso(t2), endOn: iso(t2 + 30 * MIN)
    });
    const cancelled = await deliver("canceled", {
      person: p, callId, eventId: `${NONCE}-form-x`, startOn: iso(t2), endOn: iso(t2 + 30 * MIN)
    });
    for (const [name, fn] of Object.entries({
      "S-04B": s04bBookingReminders, "AI-SET-04": aiSet043WayHandoff,
      "DPC-02": dpc02CallOutcomeEnforcement, "BS-01": bs01PrecallLauncher
    })) {
      const idRule = (fn.opts.cancelOn || []).filter((r) => /bookingUid/.test(r.if));
      assert.ok(idRule.length > 0, `${name} also has an id rule`);
      assert.equal(evalCel(idRule.find((r) => r.event === "booking.cancelled").if, { event: form.inngest, async: cancelled.inngest }),
        false, `${name}: the id rule alone cannot match a form-first booking`);
      assert.equal(cancelsRun(fn, form.inngest, moved.inngest), true, `${name}: a move still stops it (email rule)`);
      assert.equal(cancelsRun(fn, form.inngest, cancelled.inngest), true, `${name}: a cancel still stops it (email rule)`);
    }
  });

  /* ── (c) booking.cancelled ───────────────────────────────────────────────── */

  check("(c) a cancel: every waiting run is stopped, the booking and the closer task are closed, the person is sent nothing, and the sales card stays on Booked", async (t) => {
    const p = await makePerson("cancel", { score: "700-759" });
    const startMs = BASE + 72 * HOUR;
    const callId = nextCallId();
    const booked = await deliver("created", {
      person: p, callId, eventId: `${NONCE}-cx-c`, startOn: iso(startMs), endOn: iso(startMs + 30 * MIN)
    });
    await runS04b(booked.data); // confirmation + reminders exist for this booking
    const sentBefore = (await messagesFor(p.id)).length;
    assert.equal(await cardStage(p.id), "booked");

    const cancelled = await deliver("canceled", {
      person: p, callId, eventId: `${NONCE}-cx-x`, startOn: iso(startMs), endOn: iso(startMs + 30 * MIN)
    });
    assert.equal(cancelled.row.name, "booking.cancelled");
    assert.equal(cancelled.row.payload.bookingUid, String(callId));

    // Every waiting run for this booking stops.
    for (const [name, fn] of Object.entries({
      "S-04B": s04bBookingReminders, "AI-SET-04": aiSet043WayHandoff,
      "DPC-02": dpc02CallOutcomeEnforcement, "BS-01": bs01PrecallLauncher
    })) {
      assert.equal(cancelsRun(fn, booked.inngest, cancelled.inngest), true, `${name}: the cancel stops it`);
      const stranger = await makePerson(`cancel-other-${name.toLowerCase()}`);
      const theirs = await storeEvent("booking.created", bookingPayload(stranger, { startMs }), stranger);
      assert.equal(cancelsRun(fn, theirs.inngest, cancelled.inngest), false, `${name}: someone else's run is untouched`);
    }

    // What the system records.
    const b = (await bookingRows(p.id))[0];
    assert.equal(b.status, "cancelled");
    const tasks = await tasksFor(p.id);
    assert.equal(tasks.find((t) => /^Strategy session/.test(t.title)).done, true, "the closer's call task is closed");
    const c = await clientRow(p.id);
    assert.equal(c.custom_fields.call_outcome, "cancelled");
    assert.ok(c.tags.includes("call:cancelled"));

    t.diagnostic(`after a cancel the setter's booking task is ${tasks.find((x) => x.source_workflow === "setter-booking").done ? "closed" : "still open"}`);

    // What the person gets: nothing. No workflow starts on booking.cancelled.
    assert.equal((await messagesFor(p.id)).length, sentBefore, "no message follows a cancel");
    // Where the card goes: nowhere. It stays on Booked.
    assert.equal(await cardStage(p.id), "booked");

    // If the stop were missed, the text and the no-show check still do nothing.
    const staleText = await runAiSet04(booked.data);
    assert.equal(staleText.result.reason, "call_cancelled");
    const staleCheck = await runDpc02(booked.data);
    assert.equal(staleCheck.result.reason, "call_cancelled");
    assert.equal((await eventsNamed(p.id, "booking.noshow")).length, 0, "a cancelled call is never a no-show");
    assert.equal(await cardStage(p.id), "booked");
    assert.ok(!(await clientRow(p.id)).tags.includes("call:no_show"));
  });

  /* ── (d) no-show ─────────────────────────────────────────────────────────── */

  check("(d) a missed call: DPC-02 marks the no-show once and emits booking.noshow; S-05A sends four touches with the booked time and the person's calendar, makes a closer task, and stops when the person books again", async () => {
    const p = await makePerson("noshow", { score: "620-699" });
    const startMs = BASE + 48 * HOUR;
    const endMs = startMs + 30 * MIN;
    const callId = nextCallId();
    const booked = await deliver("created", {
      person: p, callId, eventId: `${NONCE}-ns-c`, startOn: iso(startMs), endOn: iso(endMs)
    });

    const dpc = await runDpc02(booked.data);
    assert.deepEqual(dpc.driver.wakes.map((w) => [w.id, iso(w.at.getTime())]),
      [["wait-until-5-min-after-end", iso(endMs + 5 * MIN)]], "the check wakes 5 minutes after the end");
    assert.equal(dpc.result.outcome, "no_show");
    assert.equal(await cardStage(p.id), "lost");
    let c = await clientRow(p.id);
    assert.equal(c.custom_fields.call_outcome, "no_show");
    assert.ok(c.tags.includes("call:no_show"));
    const noshows = await eventsNamed(p.id, "booking.noshow");
    assert.equal(noshows.length, 1);
    assert.equal(noshows[0].payload.email, p.email, "the event S-05A starts on carries the email its cancelOn reads");
    assert.equal(noshows[0].payload.startTime, booked.row.payload.startTime);
    assert.equal((await bookingRows(p.id))[0].status, "noshow");

    // Run again: nothing is marked twice.
    await runDpc02(booked.data);
    assert.equal((await eventsNamed(p.id, "booking.noshow")).length, 1);

    // S-05A: four touches, email then text each time. A no-show seen at noon
    // Arizona is inside the 9 to 5 window, so they go at 0, 24, 72 and 168 hours.
    const noshowRow = (await db.query(
      `SELECT id, name, org_id, client_id, payload FROM events WHERE id = $1`, [noshows[0].id])).rows[0];
    const s05a = await runS05a(asRunData(noshowRow), { startMs: NOON_MST });
    assert.deepEqual(s05a.driver.wakes.map((w) => [w.id, w.at.getTime()]), [
      ["wait-touch-1", NOON_MST], ["wait-touch-2", NOON_MST + 24 * HOUR],
      ["wait-touch-3", NOON_MST + 72 * HOUR], ["wait-touch-4", NOON_MST + 168 * HOUR]
    ]);
    assert.equal(s05a.result.done, true);
    assert.equal(s05a.result.stoppedAt, undefined);
    const msgs = (await messagesFor(p.id)).filter((m) => /S05A/.test(m.template_key));
    assert.deepEqual(msgs.map((m) => [m.template_key, m.channel]), [
      [EMAIL_NOSHOW_01, "email"], [SMS_NOSHOW_01, "sms"],
      [EMAIL_NOSHOW_02, "email"], [SMS_NOSHOW_02, "sms"],
      [EMAIL_NOSHOW_03, "email"], [SMS_NOSHOW_03, "sms"],
      [EMAIL_NOSHOW_04, "email"], [SMS_NOSHOW_04, "sms"]
    ]);
    for (const m of msgs) {
      assert.ok(!/\{\{/.test(m.body), `${m.template_key}: unrendered tag`);
      const links = bookingLinksIn(m.body);
      assert.ok(links.length >= 1, `${m.template_key}: carries a calendar link`);
      assert.ok(links.every((l) => l === LINK_U), `${m.template_key}: only this person's own calendar, got ${links.join(" ")}`);
    }
    // The first email tells the person which call was missed.
    const first = msgs.find((m) => m.template_key === EMAIL_NOSHOW_01);
    assertArizonaTime(first.body, startMs, "no-show email 1");
    assert.match(first.body, /We had you down for [A-Z][a-z]{2}, /, "the sentence names the missed time");

    const task = (await tasksFor(p.id)).find((t) => t.source_workflow === S05A_WORKFLOW);
    assert.equal(task.title, "No-show recovery — rebook");
    assert.equal(task.assignee_role, "closer");
    assert.equal(task.done, false);

    // cancelOn, evaluated: a new booking or a move by the same person stops it.
    const rebookEvent = await storeEvent("booking.created", bookingPayload(p, { startMs: BASE + 200 * HOUR }), p);
    const moveEvent = await storeEvent("booking.rescheduled", bookingPayload(p, { startMs: BASE + 210 * HOUR }), p);
    assert.equal(cancelsRun(s05aNoShowRecovery, asInngestEvent(noshowRow), rebookEvent.inngest), true);
    assert.equal(cancelsRun(s05aNoShowRecovery, asInngestEvent(noshowRow), moveEvent.inngest), true);
    const stranger = await makePerson("noshow-other");
    const strangerBooking = await storeEvent("booking.created", bookingPayload(stranger, { startMs: BASE + 200 * HOUR }), stranger);
    assert.equal(cancelsRun(s05aNoShowRecovery, asInngestEvent(noshowRow), strangerBooking.inngest), false);
    const foreign = { name: "booking.created", data: { ...rebookEvent.inngest.data, orgId: crypto.randomUUID() } };
    assert.equal(cancelsRun(s05aNoShowRecovery, asInngestEvent(noshowRow), foreign), false);
    assert.deepEqual(s05aNoShowRecovery.opts.triggers.map((t) => t.event), ["booking.noshow"]);

    c = await clientRow(p.id);
    assert.equal(c.custom_fields.call_outcome, "no_show");
  });

  check("(d) a person who books again while a touch is waiting for the window gets that touch and every later one withheld (checked on every wake, touch 1 too)", async () => {
    for (const touch of [1, 2, 3, 4]) {
      const p = await makePerson(`rebook-${touch}`, { score: "700-759" });
      const startMs = BASE + 48 * HOUR;
      const booked = await deliver("created", {
        person: p, callId: nextCallId(), eventId: `${NONCE}-rb-${touch}`, startOn: iso(startMs), endOn: iso(startMs + 30 * MIN)
      });
      await runDpc02(booked.data);
      const noshow = (await eventsNamed(p.id, "booking.noshow"))[0];
      const row = (await db.query(`SELECT id, name, org_id, client_id, payload FROM events WHERE id = $1`, [noshow.id])).rows[0];
      const result = await runS05a(asRunData(row), {
        onWake: async ({ id }) => {
          if (id === `wait-touch-${touch}`) await storeEvent("booking.created", bookingPayload(p, { startMs: BASE + 300 * HOUR }), p);
        }
      });
      assert.equal(result.result.stoppedAt, `before-touch-${touch}`, `rebooked while touch ${touch} waited`);
      const sentKeys = (await messagesFor(p.id)).filter((m) => /S05A/.test(m.template_key));
      assert.equal(sentKeys.length, (touch - 1) * 2, `touch ${touch} on: ${touch - 1} touch(es) went, then it stopped`);
      assert.equal((await tasksFor(p.id)).filter((t) => t.source_workflow === S05A_WORKFLOW).length, 1, "the closer task is made either way");
    }
  });

  check("(d) no-show at 6 p.m. Arizona, booked again at 8 a.m. the next day: the first touch waits for 9 a.m., sees the new booking and is never sent", async (t) => {
    const p = await makePerson("sixpm", { score: "700-759" });
    const startMs = BASE + 48 * HOUR;
    const booked = await deliver("created", {
      person: p, callId: nextCallId(), eventId: `${NONCE}-sixpm-c`, startOn: iso(startMs), endOn: iso(startMs + 30 * MIN)
    });
    await runDpc02(booked.data);
    const noshow = (await eventsNamed(p.id, "booking.noshow"))[0];
    const noshowRow = (await db.query(`SELECT id, name, org_id, client_id, payload FROM events WHERE id = $1`, [noshow.id])).rows[0];

    let rebook = null;
    const run = await runS05a(asRunData(noshowRow), {
      startMs: SIX_PM_MST,
      onWake: async ({ id }) => {
        // 8 a.m. Thursday, an hour before the window opens: a real booking comes in.
        if (id === "wait-touch-1") {
          const at = BASE + 200 * HOUR;
          rebook = await deliver("created", {
            person: p, callId: nextCallId(), eventId: `${NONCE}-sixpm-rebook`, startOn: iso(at), endOn: iso(at + 30 * MIN)
          });
        }
      }
    });
    assert.deepEqual(run.driver.wakes.map((w) => [w.id, w.at.getTime()]), [["wait-touch-1", NINE_AM_MST]],
      "touch 1 waits for 9 a.m. Arizona");
    assert.ok(rebook, "the booking arrived while it waited");
    assert.equal(run.result.stoppedAt, "before-touch-1");
    assert.equal((await messagesFor(p.id)).filter((m) => /S05A/.test(m.template_key)).length, 0,
      "nothing was written to the queue, so the sender has nothing to hold until 9 a.m.");
    assert.equal((await tasksFor(p.id)).filter((x) => x.source_workflow === S05A_WORKFLOW).length, 1, "the closer task was made at once");
    // The same booking would also have stopped the sleeping run through cancelOn.
    assert.equal(cancelsRun(s05aNoShowRecovery, asInngestEvent(noshowRow), rebook.inngest), true);

    // What the sales card does for a person who missed a call and then booked again.
    await handleS04({ event: rebook.data, db, step: immediateStep() });
    t.diagnostic(`sales card after a no-show and a new booking (S-04 run): ${await cardStage(p.id)}`);
  });

  /* ── (e) call held ───────────────────────────────────────────────────────── */

  check("(e) a held call: the closer saves the call, the reminders stop, DPC-02 marks Showed, no booking.noshow is emitted, so S-05A never starts", async () => {
    const p = await makePerson("held", { score: "700-759" });
    const startMs = BASE + 72 * HOUR;
    const callId = nextCallId();
    const booked = await deliver("created", {
      person: p, callId, eventId: `${NONCE}-held-c`, startOn: iso(startMs), endOn: iso(startMs + 30 * MIN)
    });

    // The closer logs a real call while the 24-hour reminder is still asleep.
    const s04bRun = await runS04b(booked.data, {
      onWake: async ({ id }) => {
        if (id === "wait-t-minus-24h") await closerLogsCall(p, { outcome: "callback", bookingRef: String(callId) });
      }
    });
    assert.equal(s04bRun.result.stoppedAt, "before-24h");
    assert.equal(s04bRun.result.stoppedBecause, "call_held");
    assert.deepEqual((await messagesFor(p.id)).map((m) => m.template_key), [SMS_CONFIRM, EMAIL_CONFIRM],
      "only the confirmation was sent; no reminder after the call was held");

    const held = (await eventsNamed(p.id, "call.completed"))[0];
    assert.equal(held.payload.disposition, "closer", "the event the closer's save writes");

    const dpc = await runDpc02(booked.data);
    assert.equal(dpc.result.outcome, "showed");
    assert.equal(await cardStage(p.id), "showed");
    const c = await clientRow(p.id);
    assert.equal(c.custom_fields.call_outcome, "showed");
    assert.equal(c.custom_fields.last_progress_action, "call_held");
    assert.ok(!c.tags.includes("call:no_show"));
    assert.equal((await eventsNamed(p.id, "booking.noshow")).length, 0, "no booking.noshow, so S-05A has nothing to start on");
    assert.equal((await messagesFor(p.id)).filter((m) => /S05A/.test(m.template_key)).length, 0);
  });

  check("(e) the 2-hour reminder stops too when the call is logged between the two reminders", async () => {
    const p = await makePerson("held-2h", { score: "700-759" });
    const startMs = BASE + 72 * HOUR;
    const booked = await storeEvent("booking.created", bookingPayload(p, { startMs }), p);
    const out = await runS04b(booked.data, {
      onWake: async ({ id }) => {
        if (id === "wait-t-minus-2h") {
          await db.query(`INSERT INTO events (org_id, name, version, client_id, payload) VALUES ($1,'call.completed',1,$2,$3::jsonb)`,
            [orgId, p.id, JSON.stringify({ disposition: "closer", outcome: "deposit" })]);
        }
      }
    });
    assert.equal(out.result.stoppedAt, "before-2h");
    assert.equal(out.result.stoppedBecause, "call_held");
    assert.deepEqual((await messagesFor(p.id)).map((m) => m.template_key), [SMS_CONFIRM, EMAIL_CONFIRM, SMS_REMIND_24H]);
  });

  check("(e) a closer's saved No show is not a held call: DPC-02 still marks the no-show, emits booking.noshow, and the recovery messages start", async () => {
    const p = await makePerson("held-noshow", { score: "700-759" });
    const startMs = BASE + 72 * HOUR;
    const callId = nextCallId();
    const booked = await deliver("created", {
      person: p, callId, eventId: `${NONCE}-hns-c`, startOn: iso(startMs), endOn: iso(startMs + 30 * MIN)
    });
    // The closer waits a few minutes, then saves "No show" -- before DPC-02's
    // check at 5 minutes after the end. That save writes a call.completed.
    await closerLogsCall(p, { outcome: "no_show", bookingRef: String(callId) });
    assert.equal((await eventsNamed(p.id, "call.completed"))[0].payload.outcome, "no_show");

    const dpc = await runDpc02(booked.data);
    assert.equal(dpc.result.outcome, "no_show", "a saved No show is not a call that happened");
    assert.equal(await cardStage(p.id), "lost");
    assert.equal((await clientRow(p.id)).custom_fields.call_outcome, "no_show");
    const noshows = await eventsNamed(p.id, "booking.noshow");
    assert.equal(noshows.length, 1, "booking.noshow is emitted, so S-05A can start");

    const row = (await db.query(`SELECT id, name, org_id, client_id, payload FROM events WHERE id = $1`, [noshows[0].id])).rows[0];
    const s05a = await runS05a(asRunData(row));
    assert.equal(s05a.result.done, true);
    assert.equal((await messagesFor(p.id)).filter((m) => /S05A/.test(m.template_key)).length, 8);
  });

  check("(e) a second booking after a held call gets its own reminders and its own no-show check; a call saved after the second booking still counts as held", async () => {
    // Held first call (the closer's "callback" means a second call is coming).
    const b = await makePerson("held-second", { score: "700-759" });
    const first = await deliver("created", {
      person: b, callId: nextCallId(), eventId: `${NONCE}-h2-b1`, startOn: iso(BASE - 20 * HOUR), endOn: iso(BASE - 19.5 * HOUR)
    });
    await closerLogsCall(b, { outcome: "callback", bookingRef: first.row.payload.bookingUid });

    const t2 = BASE + 96 * HOUR;
    const secondCall = nextCallId();
    const second = await deliver("created", {
      person: b, callId: secondCall, eventId: `${NONCE}-h2-b2`, startOn: iso(t2), endOn: iso(t2 + 30 * MIN)
    });
    const run = await runS04b(second.data);
    assert.equal(run.result.stoppedAt, undefined, "the earlier call does not stop the second call's reminders");
    assert.deepEqual((await messagesFor(b.id)).map((m) => m.template_key),
      [SMS_CONFIRM, EMAIL_CONFIRM, SMS_REMIND_24H, SMS_REMIND_2H]);

    // Nobody has saved the second call: the check at its end is a no-show, not "Showed".
    const dpc = await runDpc02(second.data);
    assert.equal(dpc.result.outcome, "no_show", "the first call's save is not the second call's");
    assert.equal((await eventsNamed(b.id, "booking.noshow")).length, 1);

    // The same person, a third booking, and this time the closer saves the call
    // after the booking was made: that one is held, in both workflows.
    const c = await makePerson("held-third", { score: "700-759" });
    const t3 = BASE + 96 * HOUR;
    const callId3 = nextCallId();
    const third = await deliver("created", {
      person: c, callId: callId3, eventId: `${NONCE}-h2-c`, startOn: iso(t3), endOn: iso(t3 + 30 * MIN)
    });
    const stopped = await runS04b(third.data, {
      onWake: async ({ id }) => {
        if (id === "wait-t-minus-24h") await closerLogsCall(c, { outcome: "deposit", bookingRef: String(callId3) });
      }
    });
    assert.equal(stopped.result.stoppedBecause, "call_held");
    const showed = await runDpc02(third.data);
    assert.equal(showed.result.outcome, "showed");
    assert.equal((await eventsNamed(c.id, "booking.noshow")).length, 0);
  });

  check("(e) callHeldFor: a call saved a moment BEFORE the booking never counts for it (compared to the microsecond), one saved after does, and an unknown booking event falls back to the old answer", async () => {
    const p = await makePerson("held-precision");
    const callSaved = (person, outcome) => db.query(
      `INSERT INTO events (org_id, name, version, client_id, payload) VALUES ($1,'call.completed',1,$2,$3::jsonb)`,
      [orgId, person.id, JSON.stringify({ disposition: "closer", outcome })]);
    let last;
    for (let i = 0; i < 40; i += 1) {
      await callSaved(p, "callback");
      last = await storeEvent("booking.created", bookingPayload(p, { startMs: BASE + (100 + i) * HOUR }), p);
      assert.equal(await callHeldFor(db, p.id, last.row.id), false, `pair ${i}: a call saved just before the booking is not this booking's call`);
    }
    await callSaved(p, "deposit");
    assert.equal(await callHeldFor(db, p.id, last.row.id), true, "a call saved after the booking is");

    // No booking event to measure from: the old answer (any call.completed at all), never a guess.
    for (const unknown of [crypto.randomUUID(), "not-an-event-id", null]) {
      assert.equal(await callHeldFor(db, p.id, unknown), true, `unknown booking event ${unknown}`);
    }
    const q = await makePerson("held-precision-noshow");
    const qb = await storeEvent("booking.created", bookingPayload(q, { startMs: BASE + 100 * HOUR }), q);
    await callSaved(q, "no_show");
    assert.equal(await callHeldFor(db, q.id, qb.row.id), false, "a saved No show alone is not a held call");
    assert.equal(await callHeldFor(db, q.id, null), true, "(the old answer, for BS-01's blunt gate, still counts it)");
  });

  /* ── BS-01, observed only ────────────────────────────────────────────────── */

  check("BS-01 (unchanged, observed): starts on booking.created and booking.rescheduled, sends its one pre-call text 48 hours before, and stops when the call is held", async () => {
    assert.deepEqual(bs01PrecallLauncher.opts.triggers.map((t) => t.event), ["booking.created", "booking.rescheduled"]);

    const real = Date.now();
    const p = await makePerson("bs01", { score: "700-759" });
    const startMs = real + 72 * HOUR;
    const e = await storeEvent("booking.created", bookingPayload(p, { startMs }), p);
    const inline = inlineStep();
    const out = await handleBs01({ event: e.data, db, step: inline.step });
    assert.equal(out.done, true);
    const precall = inline.wakes.find((w) => w.id === "wait-sms-precall");
    assert.ok(precall && Math.abs(precall.at.getTime() - (startMs - 48 * HOUR)) < 1000, "the pre-call text is due 48 hours before the call");
    assert.equal(out.sms.stoppedBecause, null);
    const sent = only(await messagesFor(p.id), "SMS-BS01-02-PRECALL");
    assert.equal(sent.length, 1);

    const q = await makePerson("bs01-held", { score: "700-759" });
    const eq = await storeEvent("booking.created", bookingPayload(q, { startMs }), q);
    await db.query(`INSERT INTO events (org_id, name, version, client_id, payload) VALUES ($1,'call.completed',1,$2,$3::jsonb)`,
      [orgId, q.id, JSON.stringify({ disposition: "closer", outcome: "deposit" })]);
    const held = await handleBs01({ event: eq.data, db, step: inlineStep().step });
    assert.equal(held.sms.stoppedBecause, "call_held");
    assert.equal(only(await messagesFor(q.id), "SMS-BS01-02-PRECALL").length, 0);
  });
});

/* ── small helpers used above ──────────────────────────────────────────────── */

/** A step that just answers, for the workflows that do not wait. */
function immediateStep() {
  return { run: async (_id, fn) => fn(), sleep: async () => {}, sleepUntil: async () => {} };
}

async function idsOf(clientId, keys) {
  const r = await db.query(
    `SELECT id, template_key FROM messages WHERE client_id = $1 AND template_key = ANY($2::text[])`, [clientId, keys]);
  return keys.map((k) => r.rows.find((x) => x.template_key === k).id);
}

const triggersOf = (fn) => fn.opts.triggers.map((t) => t.event).sort();
