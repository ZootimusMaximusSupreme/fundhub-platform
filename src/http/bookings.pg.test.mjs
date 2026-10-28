// Postgres-backed tests for /api/bookings, the bookings store, and the four
// booking handlers in src/handlers/comms.mjs.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**/*.test.mjs" and "scripts/**/*.test.mjs"; a test placed in api/
// is never collected and passes forever by never running (CLAUDE.md §12). The
// handler is imported from here instead.
//
// WHAT THESE ASSERT AGAINST. The claims that matter here are claims about
// STORED ROWS, not about JSON shapes, so almost every assertion reads the
// `bookings` table back. "The true source was recorded" is a fact about a
// column; a response body is only the endpoint's account of it.
//
// Skipped without DATABASE_URL like every other *.pg.test.mjs. The handler is
// imported inside before() rather than at module scope so the skip is a real
// skip — a top-level import runs even when the suite does not.
//
// Run it against the scratch database:
//   DATABASE_URL="postgres://…/fundhub_t7_scratch" node --test src/http/bookings.pg.test.mjs

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import {
  upsertBooking, listBookings, setStatusByProviderUid, findByProviderUid, fillMeetingUrl,
  normalizeProviderUid, UNKNOWN_SOURCE, BookingError
} from "../bookings/store.mjs";
import {
  onBookingCreated, onBookingRescheduled, onBookingCancelled, onBookingNoshow
} from "../handlers/comms.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const SLUG_A = "bookings-pgtest-a";
const SLUG_B = "bookings-pgtest-b";
const EMAIL_LIKE = "bookings_pg_test%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/bookings + bookings store", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let handler, orgA, orgB, staffA, staffB, tokenA, tokenB, clientA;

  const call = async (query = {}, tok = tokenA, method = "GET") => {
    const r = res();
    await handler({ method, query, headers: tok ? { authorization: "Bearer " + tok } : {} }, r);
    return r;
  };

  const rowsFor = async (orgId) => (await db.query(
    `SELECT * FROM bookings WHERE org_id = $1 ORDER BY created_at ASC`, [orgId])).rows;

  const wipeBookings = async () => {
    await db.query(`DELETE FROM bookings WHERE org_id = ANY($1)`, [[orgA, orgB].filter(Boolean)]);
  };

  const wipeTasks = async () => {
    await db.query(`DELETE FROM tasks WHERE org_id = ANY($1)`, [[orgA, orgB].filter(Boolean)]);
  };

  async function purge() {
    // Order matters: bookings and tasks reference clients, clients reference
    // orgs, staff cascade their sessions.
    const orgs = (await db.query(
      `SELECT id FROM orgs WHERE slug = ANY($1)`, [[SLUG_A, SLUG_B]])).rows.map((r) => r.id);
    if (!orgs.length) return;
    await db.query(`DELETE FROM bookings WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM tasks    WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM events   WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM clients  WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM staff    WHERE email LIKE $1`, [EMAIL_LIKE]);
  }

  before(async () => {
    ({ default: handler } = await import("../../api/bookings.mjs"));
    await purge();

    const mkOrg = async (slug, name) => (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,$2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [slug, name])).rows[0].id;
    orgA = await mkOrg(SLUG_A, "Bookings Pgtest A");
    orgB = await mkOrg(SLUG_B, "Bookings Pgtest B");

    const mkStaff = async (org, name, email) => (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,$2,'closer',$3,'active') RETURNING id`, [org, name, email])).rows[0].id;
    staffA = await mkStaff(orgA, "Bookings A", "bookings_pg_test_a@example.com");
    staffB = await mkStaff(orgB, "Bookings B", "bookings_pg_test_b@example.com");

    tokenA = (await createSession(db, { staffId: staffA, orgId: orgA })).token;
    tokenB = (await createSession(db, { staffId: staffB, orgId: orgB })).token;

    clientA = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Booked','Lead','bookings_pg_test_client@example.com') RETURNING id`,
      [orgA])).rows[0].id;
  });

  after(async () => { await purge(); await close(); });

  // ── T7-05: the true source is stored, never 'calcom' ──────────────────────

  test("a booking is stored with its TRUE source, taken off the payload", async () => {
    await wipeBookings();
    await wipeTasks();
    await onBookingCreated({
      id: "evt-true-source", orgId: orgA, clientId: clientA, name: "booking.created",
      payload: {
        email: "bookings_pg_test_client@example.com",
        bookingUid: "uid-clickfunnels-1",
        startTime: "2026-09-01T15:00:00Z",
        endTime: "2026-09-01T15:30:00Z",
        source: "clickfunnels"
      }
    }, db);

    const rows = await rowsFor(orgA);
    assert.equal(rows.length, 1, "the booking was not stored as a booking");
    assert.equal(rows[0].source, "clickfunnels",
      "the booking was filed under a vendor the payload never named");
    assert.notEqual(rows[0].source, "calcom");
    assert.equal(rows[0].provider_uid, "uid-clickfunnels-1");
    assert.equal(rows[0].status, "booked");

    // And the tasks row carries the same truth, which is the T7-05 repair.
    const t = (await db.query(
      `SELECT source_workflow, title FROM tasks WHERE org_id=$1 AND body=$2`,
      [orgA, "uid-clickfunnels-1"])).rows[0];
    assert.ok(t, "no booking task was created");
    assert.equal(t.source_workflow, "clickfunnels",
      "the task is still stamped with a hardcoded vendor");
  });

  test("a payload that names no source is recorded as unknown, NOT as calcom", async () => {
    await wipeBookings();
    await wipeTasks();
    await onBookingCreated({
      id: "evt-no-source", orgId: orgA, clientId: clientA, name: "booking.created",
      payload: {
        email: "bookings_pg_test_client@example.com",
        bookingUid: "uid-no-source",
        startTime: "2026-09-02T15:00:00Z"
      }
    }, db);
    const rows = await rowsFor(orgA);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, UNKNOWN_SOURCE,
      "an unnamed source was filled in with a guess");
    assert.notEqual(rows[0].source, "calcom");
  });

  // ── NULL means unknown and must survive ───────────────────────────────────

  test("a booking with no start time keeps starts_at NULL — not epoch, not now()", async () => {
    await wipeBookings();
    const row = await upsertBooking(db, {
      orgId: orgA, source: "clickfunnels", providerUid: "uid-no-time", status: "booked"
    });
    assert.strictEqual(row.starts_at, null, "an unknown start time was invented");
    assert.strictEqual(row.ends_at, null);

    // Read it straight back out of the table, not out of the returned object.
    const stored = (await db.query(
      `SELECT starts_at, ends_at FROM bookings WHERE id = $1`, [row.id])).rows[0];
    assert.strictEqual(stored.starts_at, null);
    assert.strictEqual(stored.ends_at, null);
  });

  test("the handler does not backfill a missing start time from the event", async () => {
    await wipeBookings();
    await wipeTasks();
    await onBookingCreated({
      id: "evt-null-start", orgId: orgA, clientId: clientA, name: "booking.created",
      payload: {
        email: "bookings_pg_test_client@example.com",
        bookingUid: "uid-null-start",
        source: "clickfunnels"
      }
    }, db);
    const rows = await rowsFor(orgA);
    assert.equal(rows.length, 1);
    assert.strictEqual(rows[0].starts_at, null,
      "a booking with no start time was given one");
  });

  test("an unparseable start time is a fault, not a silent NULL", async () => {
    await assert.rejects(
      () => upsertBooking(db, { orgId: orgA, source: "x", providerUid: "uid-bad", startsAt: "not-a-time" }),
      (e) => e instanceof BookingError
    );
  });

  // ── the unique index actually dedupes ─────────────────────────────────────

  test("the unique index dedupes a repeated provider_uid instead of adding a row", async () => {
    await wipeBookings();
    const spec = {
      orgId: orgA, source: "clickfunnels", providerUid: "uid-dedupe",
      startsAt: "2026-09-03T15:00:00Z", status: "booked"
    };
    const first = await upsertBooking(db, spec);
    const second = await upsertBooking(db, spec);
    assert.equal(first.id, second.id, "a redelivered webhook created a second booking");
    assert.equal((await rowsFor(orgA)).length, 1);
  });

  test("a NULL provider_uid is not treated as equal to another NULL", async () => {
    await wipeBookings();
    // No uid AND no eventId: nothing identifies either row, so neither may be
    // claimed as a repeat of the other.
    await upsertBooking(db, { orgId: orgA, source: "clickfunnels", providerUid: null });
    await upsertBooking(db, { orgId: orgA, source: "clickfunnels", providerUid: null });
    assert.equal((await rowsFor(orgA)).length, 2,
      "two bookings we cannot tell apart were silently merged into one");
  });

  // ── a uid-less booking still has an identity: the event that created it ───
  //
  // Without one it sits outside every unique index, so each redelivered webhook
  // and each pass of replay() added another copy of the same call, unbounded.

  test("the same uid-less booking, stored twice under one event id, stays one row", async () => {
    await wipeBookings();
    const spec = {
      orgId: orgA, source: "clickfunnels", providerUid: null,
      eventId: "evt-uidless-1", startsAt: "2026-09-20T15:00:00Z", status: "booked", raw: { seat: "x" }
    };
    const first = await upsertBooking(db, spec);
    const second = await upsertBooking(db, spec);
    assert.equal(first.id, second.id, "a redelivery multiplied a booking with no provider id");
    assert.equal((await rowsFor(orgA)).length, 1);
  });

  test("two DIFFERENT uid-less bookings stay two rows", async () => {
    await wipeBookings();
    await upsertBooking(db, { orgId: orgA, source: "clickfunnels", eventId: "evt-uidless-a", startsAt: "2026-09-21T15:00:00Z" });
    await upsertBooking(db, { orgId: orgA, source: "clickfunnels", eventId: "evt-uidless-b", startsAt: "2026-09-22T15:00:00Z" });
    assert.equal((await rowsFor(orgA)).length, 2,
      "two genuinely different bookings were collapsed into one");
  });

  test("replaying every stored booking event four times adds nothing", async () => {
    await wipeBookings();
    await wipeTasks();
    await db.query(`DELETE FROM events WHERE org_id = $1`, [orgA]);
    const { replay } = await import("../events/bus.mjs");
    const { register } = await import("../handlers/comms.mjs");
    register();

    // One booking WITH a provider id and one WITHOUT — the shape the live
    // ClickFunnels feed actually produces.
    await db.query(
      `INSERT INTO events (org_id, name, client_id, payload)
       VALUES ($1,'booking.created',$2,$3::jsonb), ($1,'booking.created',$2,$4::jsonb)`,
      [orgA, clientA,
        JSON.stringify({ source: "clickfunnels", bookingUid: "RP-1",
          email: "bookings_pg_test_client@example.com", startTime: "2026-09-23T15:00:00Z" }),
        JSON.stringify({ source: "clickfunnels",
          email: "bookings_pg_test_client@example.com", startTime: "2026-09-24T15:00:00Z" })]
    );

    for (let i = 0; i < 4; i++) await replay(db, { orgId: orgA, name: "booking.created" });

    assert.equal((await rowsFor(orgA)).length, 2,
      "replay multiplied the bookings (the tasks layer survives this; bookings must too)");
    const tasks = (await db.query(`SELECT id FROM tasks WHERE org_id = $1`, [orgA])).rows;
    assert.equal(tasks.length, 2, "replay double-created the booking tasks");
    await db.query(`DELETE FROM events WHERE org_id = $1`, [orgA]);
  });

  // ── one appointment is one row, whatever label rides on the event ─────────

  test("a later event for the same uid with NO source is the same booking, not a second", async () => {
    await wipeBookings();
    await wipeTasks();
    await onBookingCreated({
      id: "evt-label-1", orgId: orgA, clientId: clientA, name: "booking.created",
      payload: {
        email: "bookings_pg_test_client@example.com", bookingUid: "UID-D",
        startTime: "2026-09-25T15:00:00Z", source: "clickfunnels"
      }
    }, db);
    // No `source` key at all — it falls back to UNKNOWN_SOURCE, which under the
    // old (org, source, uid) key found no conflict and inserted a second row.
    await onBookingRescheduled({
      id: "evt-label-2", orgId: orgA, clientId: clientA, name: "booking.rescheduled",
      payload: {
        email: "bookings_pg_test_client@example.com", bookingUid: "UID-D",
        startTime: "2026-09-26T15:00:00Z"
      }
    }, db);

    const rows = await rowsFor(orgA);
    assert.equal(rows.length, 1, "one appointment was stored as two bookings");
    assert.equal(new Date(rows[0].starts_at).toISOString(), "2026-09-26T15:00:00.000Z");
    const tasks = (await db.query(`SELECT id FROM tasks WHERE org_id=$1`, [orgA])).rows;
    assert.equal(tasks.length, 1);
  });

  // ── a cancellation is not a booking ──────────────────────────────────────

  test("a cancellation matching no booking does NOT invent one", async () => {
    await wipeBookings();
    await wipeTasks();
    await onBookingCreated({
      id: "evt-ph-1", orgId: orgA, clientId: clientA, name: "booking.created",
      payload: {
        email: "bookings_pg_test_client@example.com", bookingUid: "UID-G1",
        startTime: "2026-09-27T15:00:00Z", source: "clickfunnels"
      }
    }, db);
    // src/adapters/clickfunnels.mjs derives the uid from the WEBHOOK EVENT id,
    // so a cancellation for this very call arrives under a uid nothing created.
    await onBookingCancelled({
      id: "evt-ph-2", orgId: orgA, clientId: clientA, name: "booking.cancelled",
      payload: { email: "bookings_pg_test_client@example.com", bookingUid: "UID-G2", source: "clickfunnels" }
    }, db);

    const rows = await rowsFor(orgA);
    assert.equal(rows.length, 1, "an unmatched cancellation created a phantom second booking");
    assert.equal(rows[0].provider_uid, "UID-G1");
    assert.equal(rows[0].status, "booked", "an unrelated event closed a live booking");
  });

  test("an unmatched no-show does NOT invent a booking either", async () => {
    await wipeBookings();
    await wipeTasks();
    await onBookingNoshow({
      id: "evt-ph-3", orgId: orgA, clientId: clientA, name: "booking.noshow",
      payload: { email: "bookings_pg_test_client@example.com", bookingUid: "UID-NEVER", source: "clickfunnels" }
    }, db);
    assert.equal((await rowsFor(orgA)).length, 0, "a no-show for nothing created a booking");
  });

  // ── one booking id, tidied one way ───────────────────────────────────────

  test("a booking id with stray spaces is one booking and one task", async () => {
    await wipeBookings();
    await wipeTasks();
    for (const [id, uid] of [["evt-sp-1", "AbC-1"], ["evt-sp-2", " AbC-1 "]]) {
      await onBookingCreated({
        id, orgId: orgA, clientId: clientA, name: "booking.created",
        payload: {
          email: "bookings_pg_test_client@example.com", bookingUid: uid,
          startTime: "2026-09-28T15:00:00Z", source: "clickfunnels"
        }
      }, db);
    }
    assert.equal((await rowsFor(orgA)).length, 1);
    const tasks = (await db.query(`SELECT body FROM tasks WHERE org_id=$1`, [orgA])).rows;
    assert.equal(tasks.length, 1, "the same booking id produced two closer follow-ups");
    assert.equal(tasks[0].body, "AbC-1", "the task stored an untrimmed booking id");
    assert.equal(normalizeProviderUid("  AbC-1  "), "AbC-1");
    assert.equal(normalizeProviderUid("   "), null);
  });

  test("replaying booking.created through the handler does not double-book", async () => {
    await wipeBookings();
    await wipeTasks();
    const e = {
      id: "evt-replay", orgId: orgA, clientId: clientA, name: "booking.created",
      payload: {
        email: "bookings_pg_test_client@example.com",
        bookingUid: "uid-replay", startTime: "2026-09-04T15:00:00Z", source: "clickfunnels"
      }
    };
    await onBookingCreated(e, db);
    await onBookingCreated(e, db);
    assert.equal((await rowsFor(orgA)).length, 1);
    const tasks = (await db.query(
      `SELECT id FROM tasks WHERE org_id=$1 AND body=$2`, [orgA, "uid-replay"])).rows;
    assert.equal(tasks.length, 1, "replay double-created the booking task");
  });

  // ── the reschedule trap: a relabelled row must still be found ─────────────

  test("a reschedule finds a task still labelled 'calcom' and does NOT create a second one", async () => {
    await wipeBookings();
    await wipeTasks();
    // A legacy row exactly as it sits in the live database before migration 225
    // relabels it: the wrong vendor, the right booking uid.
    await db.query(
      `INSERT INTO tasks (org_id, client_id, title, body, due_at, source_workflow, assignee_role)
       VALUES ($1,$2,'Strategy session booked',$3,'2026-09-05T15:00:00Z','calcom','closer')`,
      [orgA, clientA, "uid-legacy"]
    );
    await onBookingRescheduled({
      id: "evt-resched", orgId: orgA, clientId: clientA, name: "booking.rescheduled",
      payload: {
        email: "bookings_pg_test_client@example.com",
        bookingUid: "uid-legacy", startTime: "2026-09-06T15:00:00Z", source: "clickfunnels"
      }
    }, db);

    const tasks = (await db.query(
      `SELECT title, due_at FROM tasks WHERE org_id=$1 AND body=$2`, [orgA, "uid-legacy"])).rows;
    assert.equal(tasks.length, 1,
      "the reschedule missed the legacy task and created a duplicate booking");
    assert.equal(tasks[0].title, "Strategy session rescheduled");
    assert.equal(new Date(tasks[0].due_at).toISOString(), "2026-09-06T15:00:00.000Z");
  });

  test("a reschedule keeps the original booked time in the booking's history", async () => {
    await wipeBookings();
    await wipeTasks();
    const base = {
      orgId: orgA, clientId: clientA, name: "booking.created",
      payload: {
        email: "bookings_pg_test_client@example.com",
        bookingUid: "uid-history", startTime: "2026-09-07T15:00:00Z", source: "clickfunnels"
      }
    };
    await onBookingCreated({ id: "evt-h1", ...base }, db);
    await onBookingRescheduled({
      id: "evt-h2", orgId: orgA, clientId: clientA, name: "booking.rescheduled",
      payload: { ...base.payload, startTime: "2026-09-09T18:00:00Z" }
    }, db);

    const rows = await rowsFor(orgA);
    assert.equal(rows.length, 1, "the reschedule created a second booking row");
    assert.equal(new Date(rows[0].starts_at).toISOString(), "2026-09-09T18:00:00.000Z");
    const history = (rows[0].raw && rows[0].raw.__history) || [];
    assert.equal(history.length, 1, "the original booked time was destroyed");
    assert.equal(new Date(history[0].starts_at).toISOString(), "2026-09-07T15:00:00.000Z");
  });

  test("moving a booked call with no new Meet URL drops the old room until the new calendar link is saved", async () => {
    await wipeBookings();
    await wipeTasks();
    const uid = "uid-new-meet-slot";
    const firstTime = "2026-09-14T15:00:00Z";
    const movedTime = "2026-09-16T18:00:00Z";
    const firstLink = "https://meet.google.com/first-call-room";
    const newLink = "https://meet.google.com/second-call-room";
    const payload = {
      email: "bookings_pg_test_client@example.com",
      bookingUid: uid, startTime: firstTime,
      source: "clickfunnels", meetingUrl: firstLink
    };
    await onBookingCreated({
      id: "evt-meet-slot-1", orgId: orgA, clientId: clientA,
      name: "booking.created", payload
    }, db);
    const booking = () => findByProviderUid(db, { orgId: orgA, providerUid: uid });
    const tasks = async () => (await db.query(
      `SELECT meeting_url, due_at FROM tasks WHERE org_id=$1 AND client_id=$2 AND body=$3`,
      [orgA, clientA, uid]
    )).rows;

    assert.equal((await booking()).meeting_url, firstLink);
    assert.equal((await tasks())[0].meeting_url, firstLink);

    const movedEvent = {
      id: "evt-meet-slot-2", orgId: orgA, clientId: clientA,
      name: "booking.rescheduled",
      payload: { ...payload, startTime: movedTime, meetingUrl: null }
    };
    await onBookingRescheduled(movedEvent, db);
    assert.equal((await booking()).meeting_url, null,
      "booking kept an invalid old-room Meet URL after its scheduled time changed");
    assert.equal((await tasks())[0].meeting_url, null,
      "closer Join kept the previous slot's Meet URL after rescheduling");
    assert.equal(new Date((await tasks())[0].due_at).toISOString(), "2026-09-16T18:00:00.000Z");

    // A slow 2-minute lookup launched BEFORE the move may finish afterward.
    // The old provider UID still matches, but its old slot must not repaint
    // either the booking or closer task with the previous Meet room.
    const stale = await fillMeetingUrl(db, {
      orgId: orgA, clientId: clientA, providerUid: uid, startsAt: firstTime, url: firstLink
    });
    assert.deepEqual(stale, { bookings: 0, tasks: 0 },
      "old-slot calendar lookup wrote a stale room onto the rescheduled call");
    assert.equal((await booking()).meeting_url, null);
    assert.equal((await tasks())[0].meeting_url, null);

    const filled = await fillMeetingUrl(db, {
      orgId: orgA, clientId: clientA, providerUid: uid, startsAt: movedTime, url: newLink
    });
    assert.deepEqual(filled, { bookings: 1, tasks: 1 },
      "fresh Google Calendar Meet should reach the saved booking and closer task");
    assert.equal((await booking()).meeting_url, newLink);
    assert.equal((await tasks())[0].meeting_url, newLink);

    await onBookingRescheduled(movedEvent, db);
    assert.equal((await booking()).meeting_url, newLink,
      "same-slot replay erased the correct new room");
    assert.equal((await tasks())[0].meeting_url, newLink,
      "same-slot replay erased the correct closer Join link");
    assert.equal((await rowsFor(orgA)).length, 1, "replay added a duplicate booking");
    assert.equal((await tasks()).length, 1, "replay added a duplicate task");
  });

  test("cancel and no-show close the booking by uid, whatever label it carries", async () => {
    await wipeBookings();
    await wipeTasks();
    // Stored under one label; the cancellation arrives naming a different one.
    await upsertBooking(db, {
      orgId: orgA, clientId: clientA, source: "clickfunnels",
      providerUid: "uid-cancel", startsAt: "2026-09-10T15:00:00Z", status: "booked"
    });
    await onBookingCancelled({
      id: "evt-cancel", orgId: orgA, clientId: clientA, name: "booking.cancelled",
      payload: { email: "bookings_pg_test_client@example.com", bookingUid: "uid-cancel", source: "clickfunnels" }
    }, db);
    const cancelled = await findByProviderUid(db, { orgId: orgA, providerUid: "uid-cancel" });
    assert.equal(cancelled.status, "cancelled");
    assert.equal((await rowsFor(orgA)).length, 1, "the cancellation created a second row");

    await onBookingNoshow({
      id: "evt-noshow", orgId: orgA, clientId: clientA, name: "booking.noshow",
      payload: { email: "bookings_pg_test_client@example.com", bookingUid: "uid-cancel", source: "clickfunnels" }
    }, db);
    const noshow = await findByProviderUid(db, { orgId: orgA, providerUid: "uid-cancel" });
    assert.equal(noshow.status, "noshow");
  });

  // ── multi-tenancy ─────────────────────────────────────────────────────────

  test("one company cannot read another company's bookings", async () => {
    await wipeBookings();
    await upsertBooking(db, {
      orgId: orgA, source: "clickfunnels", providerUid: "uid-secret",
      startsAt: "2026-09-11T15:00:00Z", attendeeEmail: "lead-of-a@example.com", status: "booked"
    });

    const mine = await call({}, tokenA);
    assert.equal(mine.code, 200, JSON.stringify(mine.body));
    assert.equal(mine.body.bookings.length, 1);

    const theirs = await call({}, tokenB);
    assert.equal(theirs.code, 200, JSON.stringify(theirs.body));
    assert.equal(theirs.body.bookings.length, 0,
      "company B was served company A's bookings");
    assert.ok(
      !JSON.stringify(theirs.body).includes("lead-of-a@example.com"),
      "another company's attendee email leaked"
    );

    // And the store itself refuses to run unscoped rather than widening.
    await assert.rejects(() => listBookings(db, {}), (e) => e instanceof BookingError);
    await assert.rejects(
      () => setStatusByProviderUid(db, { providerUid: "uid-secret", status: "cancelled" }),
      (e) => e instanceof BookingError
    );
  });

  test("the same provider uid in two companies stays two separate bookings", async () => {
    await wipeBookings();
    await upsertBooking(db, { orgId: orgA, source: "clickfunnels", providerUid: "uid-shared" });
    await upsertBooking(db, { orgId: orgB, source: "clickfunnels", providerUid: "uid-shared" });
    assert.equal((await rowsFor(orgA)).length, 1);
    assert.equal((await rowsFor(orgB)).length, 1);
    const a = await findByProviderUid(db, { orgId: orgA, providerUid: "uid-shared" });
    const b = await findByProviderUid(db, { orgId: orgB, providerUid: "uid-shared" });
    assert.notEqual(a.id, b.id);
  });

  // ── the endpoint ──────────────────────────────────────────────────────────

  test("no session is 401, not an empty list", async () => {
    const r = await call({}, null);
    assert.equal(r.code, 401);
  });

  test("POST is refused with an allow header, not silently ignored", async () => {
    const r = await call({}, tokenA, "POST");
    assert.equal(r.code, 405);
    assert.equal(r.headers.allow, "GET");
  });

  test("?from and ?to bound the range by start time", async () => {
    await wipeBookings();
    for (const [uid, at] of [
      ["uid-early", "2026-09-01T15:00:00Z"],
      ["uid-mid",   "2026-09-15T15:00:00Z"],
      ["uid-late",  "2026-09-30T15:00:00Z"]
    ]) {
      await upsertBooking(db, { orgId: orgA, source: "clickfunnels", providerUid: uid, startsAt: at, status: "booked" });
    }
    const r = await call({ from: "2026-09-10T00:00:00Z", to: "2026-09-20T00:00:00Z" }, tokenA);
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.bookings.map((b) => b.provider_uid), ["uid-mid"]);
  });

  test("a booking with an unknown start time is listed unbounded and excluded from a range", async () => {
    await wipeBookings();
    await upsertBooking(db, { orgId: orgA, source: "clickfunnels", providerUid: "uid-timed", startsAt: "2026-09-15T15:00:00Z" });
    await upsertBooking(db, { orgId: orgA, source: "clickfunnels", providerUid: "uid-untimed" });

    const all = await call({}, tokenA);
    assert.equal(all.body.bookings.length, 2, "the booking with an unknown time was dropped from the list");
    assert.equal(all.body.bookings[all.body.bookings.length - 1].provider_uid, "uid-untimed",
      "an unknown time was sorted to the front of the calendar");

    const ranged = await call({ from: "2026-09-01T00:00:00Z", to: "2026-09-30T00:00:00Z" }, tokenA);
    assert.deepEqual(ranged.body.bookings.map((b) => b.provider_uid), ["uid-timed"]);
  });

  test("an unreadable ?from is a 400, not a 500", async () => {
    const r = await call({ from: "yesterday-ish" }, tokenA);
    assert.equal(r.code, 400);
  });

  test("?limit is clamped rather than trusted", async () => {
    await wipeBookings();
    for (let i = 0; i < 3; i++) {
      await upsertBooking(db, {
        orgId: orgA, source: "clickfunnels", providerUid: `uid-limit-${i}`,
        startsAt: `2026-09-0${i + 1}T15:00:00Z`
      });
    }
    const r = await call({ limit: "1" }, tokenA);
    assert.equal(r.body.bookings.length, 1);
    const huge = await call({ limit: "9999999" }, tokenA);
    assert.equal(huge.body.bookings.length, 3);
  });

  test("the endpoint never serves the raw provider payload", async () => {
    /* raw carries the attendee's PHONE NUMBER on a real ClickFunnels booking,
       and it outlives an erasure: src/privacy/erasure.mjs de-identifies the
       clients row instead of deleting it, so this table's ON DELETE CASCADE
       never fires and the attendee's details survive (scrubbing them there is
       a T16 board item).

       listBookings() gets this right TODAY by naming its own columns rather
       than reusing the COLUMNS constant, which does include raw and is what
       findByProviderUid / setStatusByProviderUid / getBooking select. That is
       a one-word edit away from leaking: swapping the list query to
       `SELECT ${COLUMNS}` would put the whole provider payload on the wire and
       nothing else would complain. This test is the thing that complains.

       The COLUMN keeps raw, deliberately — two keys in it are load-bearing.
       raw->>'__event_id' backs the bookings_event_id_uq index that stops a
       replay double-booking an appointment that arrived with no provider id,
       and raw->'__history' holds the times a booking was moved from. Both are
       server-side machinery; neither is anybody's business over HTTP. */
    await wipeBookings();
    await upsertBooking(db, {
      orgId: orgA, clientId: clientA, source: "clickfunnels",
      providerUid: "uid-rawleak", startsAt: "2026-09-09T17:00:00Z",
      status: "booked", attendeeEmail: "bookings_pg_test_leak@example.com",
      attendeeName: "Leak Probe",
      raw: { phone: "+15550001111", secret: "must-not-ship" }
    });

    const r = await call({}, tokenA);
    assert.equal(r.code, 200);

    const row = r.body.bookings.find((b) => b.provider_uid === "uid-rawleak");
    assert.ok(row, "the booking itself is still returned");
    assert.equal(row.attendee_name, "Leak Probe");
    assert.ok(!("raw" in row), "raw must not be a key in the response");

    const wire = JSON.stringify(r.body);
    assert.ok(!wire.includes("+15550001111"), "the attendee phone must not reach the wire");
    assert.ok(!wire.includes("must-not-ship"), "no key of the provider payload may leak");

    // ...and it is still in the column, because the machinery needs it.
    const stored = (await rowsFor(orgA)).find((b) => b.provider_uid === "uid-rawleak");
    assert.equal(stored.raw.phone, "+15550001111");
  });
});
