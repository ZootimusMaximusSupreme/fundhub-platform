// Hand-off tripwires — the SQL itself, on a real Postgres. Read only.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run it:  DATABASE_URL=postgres://... node --test src/pulse/coverage/gap-handoff.pg.test.mjs
//
// WHY THIS FILE EXISTS. gap-handoff.test.mjs hands the lane a fake database that
// returns canned counts. That proves the wording, the placeholders and the
// status rules. It cannot prove the SQL, and the SQL is where all the logic
// lives. A check that is flipped, loosened or inverted there still passes the
// fake. These scenarios run the real SQL on a real Postgres and make it answer
// yes or no for made-up people.
//
// HOW IT STAYS HARMLESS. Each query runs inside BEGIN READ ONLY and is always
// rolled back. The real tables (events, messages, clients, opt_outs, tasks,
// payment_links, message_templates) are shadowed by a CTE that holds ONLY the
// made-up rows of that scenario, so no real row is ever read and the test works
// the same on an empty scratch database as on production. Nothing is written
// (the database would refuse it). Nothing is sent.
//
// Each scenario names a person, says what the customer saw, and says what the
// check must answer. RED means the check must count that person. GREEN means it
// must not.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { pool, close } from "../../db.mjs";
import * as M from "./gap-handoff.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG = crypto.randomUUID();
const NOW = new Date();
const ago = (min) => new Date(NOW.getTime() - min * 60000).toISOString();
const uuid = () => crypto.randomUUID();

const SHADOWS = {
  events: {
    cols: "id, org_id, name, client_id, payload, created_at, is_demo",
    rec: "id uuid, org_id uuid, name text, client_id uuid, payload jsonb, created_at timestamptz, is_demo boolean"
  },
  messages: {
    cols: "org_id, client_id, direction, template_key, created_at",
    rec: "org_id uuid, client_id uuid, direction text, template_key text, created_at timestamptz"
  },
  clients: {
    cols: "id, org_id, email, client_code, phone, custom_fields, is_demo, dnd_email, dnd_sms",
    rec: "id uuid, org_id uuid, email text, client_code text, phone text, custom_fields jsonb, is_demo boolean, dnd_email boolean, dnd_sms boolean"
  },
  opt_outs: {
    cols: "client_id, channel, opted_in_at",
    rec: "client_id uuid, channel text, opted_in_at timestamptz"
  },
  tasks: {
    cols: "org_id, client_id, created_at",
    rec: "org_id uuid, client_id uuid, created_at timestamptz"
  },
  payment_links: {
    cols: "org_id, client_id, purpose, status, paid_at, updated_at, is_demo, description, product_id",
    rec: "org_id uuid, client_id uuid, purpose text, status text, paid_at timestamptz, updated_at timestamptz, is_demo boolean, description text, product_id uuid"
  },
  message_templates: {
    cols: "id, org_id, template_key, compliance_passed, body, subject",
    rec: "id uuid, org_id uuid, template_key text, compliance_passed boolean, body text, subject text"
  }
};

let conn = null;

before(async () => {
  if (!HAS_DB) return;
  conn = await pool().connect();
  await conn.query("BEGIN READ ONLY");
  await conn.query("SET LOCAL statement_timeout = '20s'");
  await conn.query("SELECT set_config('fundhub.actor','staff',true)");
  const ro = await conn.query("SHOW transaction_read_only");
  assert.equal(ro.rows[0].transaction_read_only, "on", "the harness must be read only");
});

after(async () => {
  if (!HAS_DB) return;
  try { await conn.query("ROLLBACK"); } catch { /* the connection is gone; nothing to undo */ }
  conn.release();
  await close();
});

/** Put the made-up rows in front of the SQL as CTEs named like the real tables. */
function withShadows(sql, paramCount) {
  const ctes = Object.entries(SHADOWS).map(([table, def], i) =>
    `${table} AS (SELECT ${def.cols} FROM ${table} WHERE false UNION ALL SELECT ${def.cols} FROM jsonb_to_recordset($${paramCount + i + 1}::jsonb) AS x(${def.rec}))`
  ).join(",\n");
  const lead = /^\/\*[\s\S]*?\*\/\s*/.exec(sql)?.[0] || "";
  const rest = sql.slice(lead.length);
  if (/^with\b/i.test(rest)) return `${lead}WITH ${ctes},\n${rest.replace(/^with\b/i, "")}`;
  return `${lead}WITH ${ctes}\n${rest}`;
}

async function runRows(sql, params, fakes = {}) {
  const text = withShadows(sql, params.length);
  const extra = Object.keys(SHADOWS).map((t) => JSON.stringify(fakes[t] || []));
  const res = await conn.query(text, [...params, ...extra]);
  return res.rows;
}

async function run(sql, params, fakes = {}) {
  return (await runRows(sql, params, fakes))[0];
}

/** One scenario: the check must count wantN people (and, for the confirm check, wantExtra). */
async function expectN(t, name, sql, params, fakes, wantN, wantExtra) {
  await t.test(name, async () => {
    const got = await run(sql, params, fakes);
    assert.equal(Number(got.n), wantN, `${name}: counted ${got.n}, wanted ${wantN}`);
    if (wantExtra) assert.equal(Number(got[wantExtra.key]), wantExtra.val, `${name}: ${wantExtra.key}`);
  });
}

/* ------------------------------------------------------------------ made-up people */

function client(over = {}) {
  const id = over.id || uuid();
  return {
    id,
    org_id: ORG,
    email: over.email || `maria.${id.slice(0, 6)}@gmail.com`,
    client_code: over.client_code || `FH-W${id.slice(0, 4)}`,
    phone: over.phone ?? "+15205550142",
    custom_fields: over.custom_fields || {},
    is_demo: over.is_demo ?? false,
    dnd_email: over.dnd_email ?? false,
    dnd_sms: over.dnd_sms ?? false
  };
}

function ev(name, minutesAgo, cl, payload = {}, over = {}) {
  return {
    id: uuid(),
    org_id: ORG,
    name,
    client_id: over.client_id === undefined ? (cl ? cl.id : null) : over.client_id,
    payload: { email: cl ? cl.email : undefined, ...payload },
    created_at: ago(minutesAgo),
    is_demo: over.is_demo ?? false
  };
}

function msg(key, minutesAgo, cl) {
  return { org_id: ORG, client_id: cl.id, direction: "outbound", template_key: key, created_at: ago(minutesAgo) };
}

const WIN = ago(7 * 24 * 60);
const first = (cut) => [ORG, ["entry.captured"], WIN, ago(cut)];
const survey = (cut) => [ORG, ["survey.submitted"], WIN, ago(cut)];

/* ------------------------------------------------------------------ the harness itself */

test("handoff SQL: the harness is read only, so a write is refused by the database", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    conn.query("CREATE TEMP TABLE handoff_pg_probe (x int)"),
    /read-only transaction/
  );
  await conn.query("ROLLBACK");
  await conn.query("BEGIN READ ONLY");
  await conn.query("SET LOCAL statement_timeout = '20s'");
  await conn.query("SELECT set_config('fundhub.actor','staff',true)");
});

/* ------------------------------------------------------------------ check 1: first touches */

test("handoff SQL: welcome email", { skip: !HAS_DB }, async (t) => {
  const x = client();
  const e = ev("entry.captured", 120, x);
  const W = M.WELCOME_SQL;
  await expectN(t, "RED: lead 2h old, no welcome", W, first(30), { clients: [x], events: [e] }, 1);
  await expectN(t, "GREEN: welcome row exists", W, first(30), { clients: [x], events: [e], messages: [msg(M.TEMPLATES.welcome, 119, x)] }, 0);
  await expectN(t, "GREEN: welcome sent EARLIER (once per client, any time)", W, first(30), { clients: [x], events: [e], messages: [msg(M.TEMPLATES.welcome, 60 * 24 * 3, x)] }, 0);
  await expectN(t, "GREEN: lead only 10 min old (in flight)", W, first(30), { clients: [x], events: [ev("entry.captured", 10, x)] }, 0);
  await expectN(t, "RED: a different template does not count", W, first(30), { clients: [x], events: [e], messages: [msg("SMS-S00-WELCOME", 119, x)] }, 1);
  const t1 = client({ email: "e2e+lead@gmail.com" });
  await expectN(t, "GREEN: test address left out", W, first(30), { clients: [t1], events: [ev("entry.captured", 120, t1)] }, 0);
  const t2 = client({ email: "someone+fhtest@gmail.com" });
  await expectN(t, "GREEN: +fhtest tag left out", W, first(30), { clients: [t2], events: [ev("entry.captured", 120, t2)] }, 0);
  const d = client({ is_demo: true });
  await expectN(t, "GREEN: demo client left out", W, first(30), { clients: [d], events: [ev("entry.captured", 120, d)] }, 0);
  await expectN(t, "GREEN: demo event left out", W, first(30), { clients: [x], events: [ev("entry.captured", 120, x, {}, { is_demo: true })] }, 0);
  const dnd = client({ dnd_email: true, dnd_sms: true });
  await expectN(t, "GREEN: do-not-contact on both left out", W, first(30), { clients: [dnd], events: [ev("entry.captured", 120, dnd)] }, 0);
  const only1 = client({ dnd_email: true, dnd_sms: false });
  await expectN(t, "RED: do-not-contact on ONE channel still counts", W, first(30), { clients: [only1], events: [ev("entry.captured", 120, only1)] }, 1);
  const ghost = { email: "ghost.lead@gmail.com" };
  await expectN(t, "RED: event with an email but no client row", W, first(30), {
    events: [{ id: uuid(), org_id: ORG, name: "entry.captured", client_id: null, payload: ghost, created_at: ago(120), is_demo: false }]
  }, 1);
  await expectN(t, "GREEN: client found by email, welcome exists", W, first(30), {
    clients: [x], events: [ev("entry.captured", 120, x, {}, { client_id: null })], messages: [msg(M.TEMPLATES.welcome, 119, x)]
  }, 0);
  await expectN(t, "GREEN: event older than 7 days is not read", W, first(30), { clients: [x], events: [ev("entry.captured", 60 * 24 * 9, x)] }, 0);
  await expectN(t, "GREEN: event of another company is not read", W, first(30), {
    clients: [x], events: [{ ...ev("entry.captured", 120, x), org_id: uuid() }]
  }, 0);
  await expectN(t, "RED: an inbound row with the welcome key is not a welcome", W, first(30), {
    clients: [x], events: [e], messages: [{ ...msg(M.TEMPLATES.welcome, 119, x), direction: "inbound" }]
  }, 1);
});

test("handoff SQL: finish-application nudge", { skip: !HAS_DB }, async (t) => {
  const x = client();
  const e = ev("entry.captured", 120, x);
  const N = M.NUDGE_SQL;
  await expectN(t, "RED: no survey, no nudge", N, first(25), { clients: [x], events: [e] }, 1);
  await expectN(t, "GREEN: survey 10 min after sign-up", N, first(25), { clients: [x], events: [e, ev("survey.submitted", 110, x)] }, 0);
  await expectN(t, "RED: survey 40 min after sign-up (past the 25 min slack) and no nudge", N, first(25), { clients: [x], events: [e, ev("survey.submitted", 80, x)] }, 1);
  await expectN(t, "GREEN: survey matched by email only (no client id on the survey)", N, first(25), {
    clients: [x], events: [e, ev("survey.submitted", 110, x, {}, { client_id: null })]
  }, 0);
  await expectN(t, "GREEN: nudge row exists", N, first(25), { clients: [x], events: [e], messages: [msg(M.TEMPLATES.nudge, 100, x)] }, 0);
  await expectN(t, "GREEN: lead only 10 min old", N, first(25), { clients: [x], events: [ev("entry.captured", 10, x)] }, 0);
  const e1 = ev("entry.captured", 300, x);
  const e2 = ev("entry.captured", 240, x);
  await expectN(t, "GREEN: second post inside 6h is a suppressed repeat (the first one has its nudge)", N, first(25), {
    clients: [x], events: [e1, e2], messages: [msg(M.TEMPLATES.nudge, 280, x)]
  }, 0);
  const e3 = ev("entry.captured", 60 * 8, x);
  const e4 = ev("entry.captured", 60 * 1.5, x);
  await expectN(t, "RED: second post 6.5h after the first is a NEW run and got no nudge", N, first(25), {
    clients: [x], events: [e3, e4], messages: [msg(M.TEMPLATES.nudge, 60 * 8 - 20, x)]
  }, 1);
  await expectN(t, "RED: the nudge must come AFTER the sign-up (an older nudge does not count)", N, first(25), {
    clients: [x], events: [e], messages: [msg(M.TEMPLATES.nudge, 60 * 24 * 2, x)]
  }, 1);
});

test("handoff SQL: never-booked chase", { skip: !HAS_DB }, async (t) => {
  const x = client();
  const s = ev("survey.submitted", 240, x);
  const B = M.NOBOOK_SQL;
  await expectN(t, "RED: survey 4h old, never booked, no chase", B, survey(150), { clients: [x], events: [s] }, 1);
  await expectN(t, "GREEN: survey 90 min old (chase not due)", B, survey(150), { clients: [x], events: [ev("survey.submitted", 90, x)] }, 0);
  await expectN(t, "GREEN: chase row exists", B, survey(150), { clients: [x], events: [s], messages: [msg(M.TEMPLATES.nobook, 120, x)] }, 0);
  await expectN(t, "GREEN: booked 30 min after the survey (client id)", B, survey(150), { clients: [x], events: [s, ev("booking.created", 210, x)] }, 0);
  await expectN(t, "GREEN: booked, event has no client id (email match)", B, survey(150), {
    clients: [x], events: [s, ev("booking.created", 210, x, {}, { client_id: null })]
  }, 0);
  const bphone = { id: uuid(), org_id: ORG, name: "booking.created", client_id: null, payload: { phone: "(520) 555-0142", email: "other@x.com" }, created_at: ago(210), is_demo: false };
  await expectN(t, "GREEN: booked, matched by the last 10 digits of the phone", B, survey(150), { clients: [x], events: [s, bphone] }, 0);
  const s2 = ev("survey.submitted", 600, x);
  await expectN(t, "RED: booked 8h AFTER the survey (past the 2h10m slack) and no chase row", B, survey(150), {
    clients: [x], events: [s2, ev("booking.created", 100, x)]
  }, 1);
});

/* ------------------------------------------------------------------ check 2: /roadmap contact */

test("handoff SQL: /roadmap first note", { skip: !HAS_DB }, async (t) => {
  const m1p = (cut) => [ORG, WIN, ago(cut)];
  const person = (minAgo, email, over = {}) => ({
    id: uuid(), org_id: ORG, name: "slo.contact_started", client_id: null,
    payload: { actor: "person", email, phone: "+15205550142", ...over }, created_at: ago(minAgo), is_demo: false
  });
  const email = "dennis.real@gmail.com";
  const c1 = client({ email });
  const M1 = M.CONTACT_M1_SQL;
  await expectN(t, "RED: person 2h ago, no client, no follow-up", M1, m1p(30), { events: [person(120, email)] }, 1);
  await expectN(t, "GREEN: GENUINE email exists", M1, m1p(30), { clients: [c1], events: [person(120, email)], messages: [msg("EMAIL-SLO-GENUINE-01", 105, c1)] }, 0);
  await expectN(t, "GREEN: GENUINE text only is enough", M1, m1p(30), { clients: [c1], events: [person(120, email)], messages: [msg("SMS-SLO-GENUINE-01", 105, c1)] }, 0);
  await expectN(t, "GREEN: only 10 min old", M1, m1p(30), { events: [person(10, email)] }, 0);
  await expectN(t, "GREEN: actor agent left out", M1, m1p(30), { events: [person(120, email, { actor: "agent" })] }, 0);
  await expectN(t, "GREEN: test address left out", M1, m1p(30), { events: [person(120, "e2e+roadmap@gmail.com")] }, 0);
  await expectN(t, "GREEN: company domain left out", M1, m1p(30), { events: [person(120, "chris@fundhub.ai")] }, 0);
  const paid = (minsAfter) => ({
    org_id: ORG, client_id: c1.id, purpose: "diagnostic", status: "paid",
    paid_at: ago(120 - minsAfter), updated_at: ago(120 - minsAfter), is_demo: false, description: "x", product_id: null
  });
  await expectN(t, "GREEN: paid 10 min after the contact (note correctly not sent)", M1, m1p(30), { clients: [c1], events: [person(120, email)], payment_links: [paid(10)] }, 0);
  await expectN(t, "RED: paid 90 min after the contact (note was due at 15 min)", M1, m1p(30), { clients: [c1], events: [person(120, email)], payment_links: [paid(90)] }, 1);
  await expectN(t, "GREEN: 9 days old is not read", M1, m1p(30), { events: [person(60 * 24 * 9, email)] }, 0);

  // One contact row per email per DAY; the first note goes ONCE. A later day gets no note and that is right.
  const d1 = person(60 * 24 * 5, email);
  const d2 = person(60 * 24 * 2, email);
  const firstNote = msg("EMAIL-SLO-GENUINE-01", 60 * 24 * 5 - 15, c1);
  await expectN(t, "GREEN: contacted two days in a row, first note went after day one only", M1, m1p(30), { clients: [c1], events: [d1, d2], messages: [firstNote] }, 0);
  await expectN(t, "GREEN: contact today, first note went 20 days ago (once per person)", M1, m1p(30), {
    clients: [c1], events: [person(120, email)], messages: [msg("EMAIL-SLO-GENUINE-01", 60 * 24 * 20, c1)]
  }, 0);
  await expectN(t, "RED: contacted two days, never got a note, counted once", M1, m1p(30), { clients: [c1], events: [d1, d2] }, 1);
  await expectN(t, "RED: contacted two days, no client row at all, counted once", M1, m1p(30), { events: [d1, d2] }, 1);
});

test("handoff SQL: /roadmap $197 offer", { skip: !HAS_DB }, async (t) => {
  const m1p = (cut) => [ORG, WIN, ago(cut)];
  const person = (minAgo, email) => ({
    id: uuid(), org_id: ORG, name: "slo.contact_started", client_id: null,
    payload: { actor: "person", email, phone: "+15205550142" }, created_at: ago(minAgo), is_demo: false
  });
  const email = "dennis.real@gmail.com";
  const c1 = client({ email });
  const O = M.CONTACT_197_SQL;
  const m1msg = msg("EMAIL-SLO-GENUINE-01", 60 * 30 - 15, c1);
  await expectN(t, "RED: 30h old, got the first note, no 197, no reply", O, m1p(25 * 60), { clients: [c1], events: [person(60 * 30, email)], messages: [m1msg] }, 1);
  await expectN(t, "GREEN: 197 email exists", O, m1p(25 * 60), { clients: [c1], events: [person(60 * 30, email)], messages: [m1msg, msg("EMAIL-SLO-197", 60 * 6, c1)] }, 0);
  await expectN(t, "GREEN: 197 text exists", O, m1p(25 * 60), { clients: [c1], events: [person(60 * 30, email)], messages: [m1msg, msg("SMS-SLO-197", 60 * 6, c1)] }, 0);
  const replied = { ...c1, custom_fields: { slo_replied_at: "2026-10-01T00:00:00Z" } };
  await expectN(t, "GREEN: they replied (the workflow stops)", O, m1p(25 * 60), { clients: [replied], events: [person(60 * 30, email)], messages: [m1msg] }, 0);
  await expectN(t, "GREEN: replied (a COUPON text went) even with the flag cleared", O, m1p(25 * 60), {
    clients: [c1], events: [person(60 * 30, email)], messages: [m1msg, msg("SMS-SLO-COUPON-01", 60 * 29, c1)]
  }, 0);
  await expectN(t, "GREEN: 20h old (offer not due)", O, m1p(25 * 60), {
    clients: [c1], events: [person(60 * 20, email)], messages: [msg("EMAIL-SLO-GENUINE-01", 60 * 20 - 15, c1)]
  }, 0);
  await expectN(t, "GREEN: no first note either (that is the other branch)", O, m1p(25 * 60), { clients: [c1], events: [person(60 * 30, email)] }, 0);
  const paidLate = {
    org_id: ORG, client_id: c1.id, purpose: "diagnostic", status: "paid",
    paid_at: ago(60 * 30 - 120), updated_at: ago(60 * 30 - 120), is_demo: false, description: "x", product_id: null
  };
  await expectN(t, "GREEN: paid 2h after the contact (offer correctly not sent)", O, m1p(25 * 60), { clients: [c1], events: [person(60 * 30, email)], messages: [m1msg], payment_links: [paidLate] }, 0);

  // Two contact days. The offer belongs to the row that got the first note; a later day is not asked for its own offer.
  const d1 = person(60 * 24 * 5, email);
  const d2 = person(60 * 30, email);
  const note5 = msg("EMAIL-SLO-GENUINE-01", 60 * 24 * 5 - 15, c1);
  await expectN(t, "GREEN: two contact days, 197 went after day one", O, m1p(25 * 60), { clients: [c1], events: [d1, d2], messages: [note5, msg("EMAIL-SLO-197", 60 * 24 * 4, c1)] }, 0);
  await expectN(t, "RED: two contact days, 197 never went, counted once", O, m1p(25 * 60), { clients: [c1], events: [d1, d2], messages: [note5] }, 1);
});

/* ------------------------------------------------------------------ check 3: booking confirm */

test("handoff SQL: booking confirm email", { skip: !HAS_DB }, async (t) => {
  const x = client();
  const p = (cut) => [ORG, ["booking.created", "booking.rescheduled"], WIN, ago(cut)];
  const b = ev("booking.created", 60, x, { startTime: ago(-2000) });
  const C = M.CONFIRM_SQL;
  await expectN(t, "RED: booked 1h ago, no email, no text", C, p(20), { clients: [x], events: [b] }, 1, { key: "silent_n", val: 1 });
  await expectN(t, "RED: text sent, EMAIL missing (the portal link never went)", C, p(20), { clients: [x], events: [b], messages: [msg(M.TEMPLATES.confirmSms, 59, x)] }, 1, { key: "silent_n", val: 0 });
  await expectN(t, "GREEN: email exists", C, p(20), { clients: [x], events: [b], messages: [msg(M.TEMPLATES.confirmEmail, 59, x)] }, 0);
  await expectN(t, "GREEN: booked 5 min ago (in flight)", C, p(20), { clients: [x], events: [ev("booking.created", 5, x)] }, 0);
  await expectN(t, "RED: reschedule with no new confirm", C, p(20), {
    clients: [x], events: [ev("booking.rescheduled", 60, x)], messages: [msg(M.TEMPLATES.confirmEmail, 60 * 24 * 2, x)]
  }, 1);
  const sim = client({ email: "stanbridgejchris+sim-01@gmail.com" });
  await expectN(t, "GREEN: test address left out", C, p(20), { clients: [sim], events: [ev("booking.created", 60, sim)] }, 0);
  await expectN(t, "RED: booking by email only, no client row", C, p(20), {
    events: [{ id: uuid(), org_id: ORG, name: "booking.created", client_id: null, payload: { email: "newbie@gmail.com" }, created_at: ago(60), is_demo: false }]
  }, 1);
});

/* ------------------------------------------------------------------ check 4: reminders */

test("handoff SQL: reminder texts", { skip: !HAS_DB }, async (t) => {
  const x = client();
  const pr = (key) => [ORG, ago(30 * 24 * 60), NOW.toISOString(), key];
  const bk = (bookedMinAgo, startInMin, cl = x, extra = {}) =>
    ev("booking.created", bookedMinAgo, cl, {
      startTime: new Date(NOW.getTime() + startInMin * 60000).toISOString(),
      bookingUid: extra.uid || `uid-${uuid()}`
    }, extra.over || {});
  const R24 = M.REMIND_24H_SQL;
  const R2 = M.REMIND_2H_SQL;
  const k24 = M.TEMPLATES.remind24h;
  const k2 = M.TEMPLATES.remind2h;

  await expectN(t, "24h RED: call in 10h, booked 3 days ago, no reminder", R24, pr(k24), { clients: [x], events: [bk(60 * 72, 600)] }, 1);
  await expectN(t, "24h GREEN: reminder row exists", R24, pr(k24), { clients: [x], events: [bk(60 * 72, 600)], messages: [msg(k24, 60 * 14, x)] }, 0);
  await expectN(t, "24h GREEN: call in 30h (reminder not due yet)", R24, pr(k24), { clients: [x], events: [bk(60 * 72, 60 * 30)] }, 0);
  await expectN(t, "24h GREEN: booked 10h before the call (no 24h reminder exists)", R24, pr(k24), { clients: [x], events: [bk(60 * 2, 60 * 10 - 120)] }, 0);
  await expectN(t, "24h RED: call started 5h ago and no reminder ever went", R24, pr(k24), { clients: [x], events: [bk(60 * 80, -300)] }, 1);
  await expectN(t, "24h GREEN: call started 80h ago (outside the 72h look-back)", R24, pr(k24), { clients: [x], events: [bk(60 * 200, -60 * 80)] }, 0);
  const e0 = bk(60 * 72, 600, x, { uid: "U1" });
  const cancelled = { id: uuid(), org_id: ORG, name: "booking.cancelled", client_id: null, payload: { email: x.email, bookingUid: "U1" }, created_at: ago(60 * 20), is_demo: false };
  await expectN(t, "24h GREEN: booking cancelled afterwards", R24, pr(k24), { clients: [x], events: [e0, cancelled] }, 0);
  const moved = {
    id: uuid(), org_id: ORG, name: "booking.rescheduled", client_id: null,
    payload: { email: x.email, bookingUid: "U1", startTime: new Date(NOW.getTime() + 60 * 60000 * 40).toISOString() },
    created_at: ago(60 * 20), is_demo: false
  };
  await expectN(t, "24h GREEN: moved to 40h out (new event not due, old one stopped)", R24, pr(k24), { clients: [x], events: [e0, moved] }, 0);
  await expectN(t, "24h GREEN: opted out of text", R24, pr(k24), {
    clients: [x], events: [bk(60 * 72, 600)], opt_outs: [{ client_id: x.id, channel: "sms", opted_in_at: null }]
  }, 0);
  await expectN(t, "24h RED: opted out, then opted back in", R24, pr(k24), {
    clients: [x], events: [bk(60 * 72, 600)], opt_outs: [{ client_id: x.id, channel: "sms", opted_in_at: ago(100) }]
  }, 1);
  await expectN(t, "24h GREEN: no start time (the workflow sends none)", R24, pr(k24), { clients: [x], events: [ev("booking.created", 60 * 72, x, {})] }, 0);
  await expectN(t, "24h GREEN: unreadable start time does not crash", R24, pr(k24), {
    clients: [x], events: [ev("booking.created", 60 * 72, x, { startTime: "2026-13-45Tgarbage" })]
  }, 0);
  await expectN(t, "24h GREEN: demo event", R24, pr(k24), { clients: [x], events: [bk(60 * 72, 600, x, { over: { is_demo: true } })] }, 0);

  await expectN(t, "2h RED: call in 60 min, booked yesterday, no 2h reminder", R2, pr(k2), { clients: [x], events: [bk(60 * 24, 60)] }, 1);
  await expectN(t, "2h GREEN: reminder row exists", R2, pr(k2), { clients: [x], events: [bk(60 * 24, 60)], messages: [msg(k2, 55, x)] }, 0);
  await expectN(t, "2h GREEN: call in 3h (not due)", R2, pr(k2), { clients: [x], events: [bk(60 * 24, 180)] }, 0);
  await expectN(t, "2h GREEN: booked 1h before the call (no 2h reminder exists)", R2, pr(k2), { clients: [x], events: [bk(60, 60)] }, 0);
  await expectN(t, "2h RED: the 24h text does not satisfy the 2h check (wrong key)", R2, pr(k2), {
    clients: [x], events: [bk(60 * 24, 60)], messages: [msg(k24, 55, x)]
  }, 1);
});

/* ------------------------------------------------------------------ check 5: after the call */

test("handoff SQL: no-show recovery email", { skip: !HAS_DB }, async (t) => {
  const x = client();
  const ns = (cut) => [ORG, ["booking.noshow"], WIN, ago(cut)];
  const S = M.NOSHOW_SQL;
  await expectN(t, "RED: 1h ago, no recovery email", S, ns(20), { clients: [x], events: [ev("booking.noshow", 60, x)] }, 1);
  await expectN(t, "GREEN: recovery email exists", S, ns(20), { clients: [x], events: [ev("booking.noshow", 60, x)], messages: [msg(M.TEMPLATES.noshow, 58, x)] }, 0);
  await expectN(t, "GREEN: 5 min ago", S, ns(20), { clients: [x], events: [ev("booking.noshow", 5, x)] }, 0);
});

test("handoff SQL: offer email after a closer call", { skip: !HAS_DB }, async (t) => {
  const x = client();
  const cp = (cut) => [ORG, WIN, ago(cut)];
  const call = (minAgo, payload) => ev("call.completed", minAgo, x, { disposition: "closer", ...payload });
  const O = M.OFFER_SQL;
  await expectN(t, "RED: closer call SOFT_PULL 2h ago, no offer email", O, cp(30), { clients: [x], events: [call(120, { offerKey: "SOFT_PULL", outcome: "downsell" })] }, 1);
  await expectN(t, "GREEN: offer email exists", O, cp(30), {
    clients: [x], events: [call(120, { offerKey: "SOFT_PULL", outcome: "downsell" })], messages: [msg("EMAIL-OFFER-SOFT-PULL", 118, x)]
  }, 0);
  await expectN(t, "GREEN: earlier offer email (once-per-client lock)", O, cp(30), {
    clients: [x], events: [call(120, { offerKey: "FUNDING_DFY", outcome: "deposit" })], messages: [msg("EMAIL-OFFER-FUNDING-DFY", 60 * 24 * 3, x)]
  }, 0);
  await expectN(t, "GREEN: no offer key (a declined call gets no offer email by design)", O, cp(30), { clients: [x], events: [call(120, { offerKey: null, outcome: "declined" })] }, 0);
  await expectN(t, "RED: not_a_fit with no key still gets EMAIL-OFFER-NONE", O, cp(30), { clients: [x], events: [call(120, { offerKey: null, outcome: "not_a_fit" })] }, 1);
  await expectN(t, "GREEN: unknown offer key (the workflow sends nothing)", O, cp(30), { clients: [x], events: [call(120, { offerKey: "MYSTERY", outcome: "deposit" })] }, 0);
  await expectN(t, "GREEN: FUNDING_MASTERY unpaid (the workflow waits)", O, cp(30), { clients: [x], events: [call(120, { offerKey: "FUNDING_MASTERY", outcome: "downsell" })] }, 0);
  const mp = { org_id: ORG, client_id: x.id, purpose: "custom", status: "paid", paid_at: ago(150), updated_at: ago(150), is_demo: false, description: "Funding Mastery", product_id: null };
  await expectN(t, "RED: FUNDING_MASTERY paid, no email", O, cp(30), {
    clients: [x], events: [call(120, { offerKey: "FUNDING_MASTERY", outcome: "downsell" })], payment_links: [mp]
  }, 1);
  await expectN(t, "GREEN: not a closer disposition", O, cp(30), { clients: [x], events: [ev("call.completed", 120, x, { disposition: "human", offerKey: "SOFT_PULL" })] }, 0);
  await expectN(t, "GREEN: 10 min ago (in flight)", O, cp(30), { clients: [x], events: [call(10, { offerKey: "SOFT_PULL", outcome: "downsell" })] }, 0);
  const viaPayload = {
    id: uuid(), org_id: ORG, name: "call.completed", client_id: null,
    payload: { clientId: x.id, disposition: "closer", offerKey: "REPAIR_DFY", outcome: "downsell" }, created_at: ago(120), is_demo: false
  };
  await expectN(t, "RED: client found from payload.clientId", O, cp(30), { clients: [x], events: [viaPayload] }, 1);
  // The Bland AI call that ends declined is not a closer call and has no offer.
  const bland = { id: uuid(), org_id: ORG, name: "call.completed", client_id: x.id, payload: { callId: "c1", status: "completed", disposition: "declined", outcome: "declined", source: "bland" }, created_at: ago(120), is_demo: false };
  await expectN(t, "GREEN: the offer check does not read the Bland declined call", O, cp(30), { clients: [x], events: [bland] }, 0);
});

test("handoff SQL: follow-up task after a declined call", { skip: !HAS_DB }, async (t) => {
  const x = client();
  const cp = (cut) => [ORG, WIN, ago(cut)];
  const D = M.DECLINED_SQL;
  const closerCall = (minAgo, payload) => ev("call.completed", minAgo, x, { disposition: "closer", ...payload });
  // The shape that really exists: the Bland AI call (src/adapters/bland.mjs). The client sits on the event row, not in the payload.
  const blandCall = (minAgo, over = {}, payload = {}) => ({
    id: uuid(), org_id: ORG, name: "call.completed", client_id: x.id,
    payload: { callId: "c1", status: "completed", disposition: "declined", outcome: "declined", source: "bland", ...payload },
    created_at: ago(minAgo), is_demo: false, ...over
  });
  const task = (minAgo) => ({ org_id: ORG, client_id: x.id, created_at: ago(minAgo) });

  // The Bland shape (disposition and outcome both "declined")
  await expectN(t, "Bland RED: declined call 2h ago, no task", D, cp(30), { clients: [x], events: [blandCall(120)] }, 1);
  await expectN(t, "Bland GREEN: task made after the call", D, cp(30), { clients: [x], events: [blandCall(120)], tasks: [task(119)] }, 0);
  await expectN(t, "Bland RED: only an OLD task exists", D, cp(30), { clients: [x], events: [blandCall(120)], tasks: [task(60 * 24 * 5)] }, 1);
  await expectN(t, "Bland GREEN: 10 min ago (in flight)", D, cp(30), { clients: [x], events: [blandCall(10)] }, 0);
  await expectN(t, "Bland GREEN: demo event left out", D, cp(30), { clients: [x], events: [blandCall(120, { is_demo: true })] }, 0);
  await expectN(t, "Bland GREEN: a call that ended no_answer is not declined", D, cp(30), {
    clients: [x], events: [blandCall(120, {}, { disposition: "no_answer", outcome: "no_answer" })]
  }, 0);
  await expectN(t, "Bland GREEN: a call that was transferred is not declined", D, cp(30), {
    clients: [x], events: [blandCall(120, {}, { disposition: "human", outcome: "transferred" })]
  }, 0);
  await expectN(t, "Bland GREEN: no client anywhere (s-08 stops with no_client, nobody to follow up)", D, cp(30), {
    clients: [x], events: [blandCall(120, { client_id: null })]
  }, 0);
  await expectN(t, "Bland GREEN: demo client left out", D, cp(30), { clients: [{ ...x, is_demo: true }], events: [blandCall(120)] }, 0);
  await expectN(t, "Bland RED: client found by the email in the payload", D, cp(30), {
    clients: [x], events: [blandCall(120, { client_id: null }, { email: x.email })]
  }, 1);

  // Any disposition: s-08 gates on the outcome alone.
  await expectN(t, "RED: outcome declined on a closer-labelled call, no task", D, cp(30), { clients: [x], events: [closerCall(120, { outcome: "declined" })] }, 1);
  await expectN(t, "GREEN: closer call, task made after", D, cp(30), { clients: [x], events: [closerCall(120, { outcome: "declined" })], tasks: [task(119)] }, 0);
  await expectN(t, "GREEN: closer call that was not declined", D, cp(30), { clients: [x], events: [closerCall(120, { outcome: "deposit", offerKey: "FUNDING_DFY" })] }, 0);
  await expectN(t, "GREEN: closer call with no outcome", D, cp(30), { clients: [x], events: [closerCall(120, {})] }, 0);
});

/* ------------------------------------------------------------------ the cause: templates */

test("handoff SQL: template lookup names a missing, unapproved or draft template", { skip: !HAS_DB }, async () => {
  const k = M.TEMPLATES;
  const tpl = (key, over = {}) => ({ id: uuid(), org_id: ORG, template_key: key, compliance_passed: true, body: "Hi there", subject: "Hello", ...over });
  const keys = [k.welcome, k.nudge, k.nobook, k.confirmEmail, k.noshow];
  const rows = await runRows(M.TEMPLATE_STATE_SQL, [ORG, keys], {
    message_templates: [
      tpl(k.welcome),
      tpl(k.nudge, { compliance_passed: false }),
      tpl(k.nobook, { subject: "[DRAFT] Hello" }),
      tpl(k.noshow, { body: "this is a draft of nothing, no brackets" }),
      { ...tpl(k.welcome), org_id: uuid(), compliance_passed: false }
    ]
  });
  const by = Object.fromEntries(rows.map((r) => [r.template_key, r]));
  assert.equal(rows.length, keys.length, "one row per key, and another company's template is not joined in");
  assert.deepEqual([by[k.welcome].missing, by[k.welcome].approved, by[k.welcome].draft], [false, true, false]);
  assert.deepEqual([by[k.nudge].missing, by[k.nudge].approved, by[k.nudge].draft], [false, false, false]);
  assert.deepEqual([by[k.nobook].missing, by[k.nobook].approved, by[k.nobook].draft], [false, true, true]);
  assert.deepEqual([by[k.confirmEmail].missing, by[k.confirmEmail].approved, by[k.confirmEmail].draft], [true, false, false]);
  assert.deepEqual([by[k.noshow].missing, by[k.noshow].approved, by[k.noshow].draft], [false, true, false], "the word draft without [DRAFT] is not draft copy");
});
