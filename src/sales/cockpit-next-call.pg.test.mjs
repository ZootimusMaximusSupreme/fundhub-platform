// "NEXT 11:00 AM", AGAINST REAL SQL.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE CLOCK THESE FIXTURES HANG OFF
//
// Every row below is booked at `date_trunc('second', now()) + N hours`, never
// at a named hour of the day, and the whole file runs inside one transaction —
// so `now()` is a single fixed instant (Postgres `now()` is the transaction's
// start time) that both the fixtures and the queries under test read. Call it T.
//
// That is the whole point. The first draft of this file seeded rows at
// `date_trunc('day', now()) + N hours` and then asserted on upcomingCalls(),
// which filters other people's rows by `due_at >= now()`. So the row counts
// moved with the wall clock: 6/6 passed at 00:35, 5/6 at 09:35, 4/6 at 14:35 —
// red for about fifteen hours out of every twenty-four, including the whole of
// CI's UTC working day. A test whose result depends on the hour it runs at is
// not a test. Anchor to T, never to midnight.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS PREVENTS
//
// The call screen prints one line beside the client's name: the time of this
// call, how long until it, and the time of the call after it. The last part was
// picked off the up_next[] array, and up_next cannot answer that question. Its
// ORDER BY is
//
//     ORDER BY CASE WHEN t.client_id = $3 THEN 0 ELSE 1 END, t.due_at ASC
//
// which forces every one of the OPEN client's tasks to the front of the list
// whatever the clock says, and then LIMIT 5 cuts it. Three ordinary days were
// measured against a real Postgres and each one printed something false:
//
//   A) Open client booked T+5h. Somebody else at T+1h.
//      Array order: T+5h, T+1h. The screen named the T+1h as "next" — four
//      hours BEFORE the call it was printed beside.
//
//   B) Open client has T+1h and T+6h. Somebody else at T+2h.
//      Array order: T+1h, T+6h, T+2h. The screen said "next" was T+6h. The
//      closer's real next appointment was never named. That reads as six hours
//      of runway when there is one.
//
//   C) Open client at T+5h, five other calls at T+1h, +2h, +3h, +4h and +6h.
//      LIMIT 5 keeps the open call and the four earlier ones and DROPS the
//      T+6h. Sorting the array by time — the obvious fix — still answers
//      "nothing after this", which is false. C is why this is a query and not
//      a loop: the honest answer is not in that array at any ordering.
//
//   F) Open client's call was at T-5h and was never logged. Somebody else's
//      T-4h was missed and never logged either. The real next call is T+2h.
//      "The first row after T-5h" is the T-4h — a call that finished hours
//      ago. That is the shape the second time bound exists for.
//
// These assertions cannot be made against a stub, because what is being tested
// IS the SQL: an ORDER BY, two time bounds and a LIMIT.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { pool, close } from "../db.mjs";
import { upcomingCalls, nextCallAfter } from "./cockpit.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const TAG = "next-call-pg-test";

let db = null;
let ORG = null;
let STAFF = null;
let OPEN = null;   // the client whose screen is open
let OTHER = null;  // somebody else on the same closer's day
let T0 = null;     // the pinned instant every fixture hangs off

/** A task N hours from T on this closer's list. N may be negative — a call that
    already happened and was never dispositioned is an ordinary day here.

    T is `date_trunc('second', now())`, not bare now(). Postgres keeps a
    timestamptz to the microsecond and a JavaScript Date only to the
    millisecond, so a due_at read out of one INSERT and handed back in as a
    query parameter comes back very slightly EARLIER than the stored row —
    enough for `due_at > $3` to match the row it was taken from. Whole seconds
    survive the round trip exactly. */
async function task(clientId, hours, title) {
  const r = await db.query(
    `INSERT INTO tasks (org_id, client_id, assignee_role, assignee_staff_id, title, body, due_at)
     VALUES ($1, $2, 'closer', $3, $4, $5, date_trunc('second', now()) + ($6 || ' hours')::interval)
     RETURNING id, due_at`,
    [ORG, clientId, STAFF, title, `${TAG}-${title}`, String(hours)]
  );
  return r.rows[0];
}

/* Rows are compared BY TASK ID, never by a clock string. Formatting a due_at in
   the runner's zone makes an assertion that passes in one place and fails in
   another, and says nothing about the ordering under test. */
const same = (row, task) => !!row && !!task && String(row.task_id || row.id) === String(task.id);

/** Wipe the day between scenarios. */
async function clearDay() {
  await db.query(`DELETE FROM tasks WHERE org_id = $1 AND body LIKE $2`, [ORG, `${TAG}-%`]);
}

before(async () => {
  if (!HAS_DB) return;
  db = await pool().connect();
  await db.query("BEGIN");
  T0 = (await db.query(`SELECT date_trunc('second', now()) AS t`)).rows[0].t;
  ORG = (await db.query(`SELECT id FROM orgs WHERE slug = 'fundhub'`)).rows[0].id;
  STAFF = (await db.query(
    `INSERT INTO staff (org_id, name, email, role, status)
     VALUES ($1, 'Next Call Closer', $2, 'closer', 'active') RETURNING id`,
    [ORG, `${TAG}-closer@example.com`])).rows[0].id;
  OPEN = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1, $2, 'Open', 'Client') RETURNING id`,
    [ORG, `${TAG}-open@example.com`])).rows[0].id;
  OTHER = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1, $2, 'Other', 'Client') RETURNING id`,
    [ORG, `${TAG}-other@example.com`])).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await db.query("ROLLBACK");
  db.release();
  await close();
});

// ---------------------------------------------------------------------------
test("the clock these fixtures hang off does not move while the file runs",
  { skip: !HAS_DB }, async () => {
    const t = (await db.query(`SELECT date_trunc('second', now()) AS t`)).rows[0].t;
    assert.equal(new Date(t).getTime(), new Date(T0).getTime(),
      "every fixture in this file is booked relative to now(), and now() holds still only " +
      "because the whole file runs inside one transaction. If that stops being true these " +
      "tests go back to passing or failing on the hour they happen to run at.");
  });

test("up_next really is out of time order — this is the trap, on the record",
  { skip: !HAS_DB }, async () => {
    await clearDay();
    const late = await task(OPEN, 5, "A-open-T+5h");
    const early = await task(OTHER, 1, "A-other-T+1h");

    const list = await upcomingCalls(db, { orgId: ORG, staffId: STAFF, includeClientId: OPEN });
    assert.equal(list.length, 2);
    assert.ok(same(list[0], late),
      "the open client's task is forced to the head of up_next whatever the clock says");
    assert.ok(same(list[1], early),
      "…so element [1] is EARLIER than element [0]. Anything that reads 'the next call' " +
      "off this array is reading a list that is not in time order.");
    assert.ok(new Date(list[1].due_at) < new Date(list[0].due_at),
      "measured, not assumed: the second row really is the earlier time");
  });

test("A) the call after a later call is not the earlier one sitting in front of it in the array",
  { skip: !HAS_DB }, async () => {
    await clearDay();
    const cur = await task(OPEN, 5, "A2-open-T+5h");
    await task(OTHER, 1, "A2-other-T+1h");

    const next = await nextCallAfter(db, { orgId: ORG, staffId: STAFF, after: cur.due_at });
    assert.equal(next, null,
      "there is genuinely nothing after T+5h. The old code named the T+1h — a time four " +
      "hours BEFORE the call it was printed beside.");
  });

test("B) the closer's real next appointment is named, not this client's later one",
  { skip: !HAS_DB }, async () => {
    await clearDay();
    const cur = await task(OPEN, 1, "B-open-T+1h");
    await task(OPEN, 6, "B-open-T+6h");
    const theirs = await task(OTHER, 2, "B-other-T+2h");

    const next = await nextCallAfter(db, { orgId: ORG, staffId: STAFF, after: cur.due_at });
    assert.ok(next, "there is a call after T+1h");
    assert.ok(same(next, theirs),
      "the old code named the T+6h because this client's own later call sorts ahead of " +
      "somebody else's T+2h in up_next. A closer reading T+6h believes they have six " +
      "hours of runway. They have one.");
  });

test("C) a later call the LIMIT 5 drops is still found — sorting the array cannot do this",
  { skip: !HAS_DB }, async () => {
    await clearDay();
    const cur = await task(OPEN, 5, "C-open-T+5h");
    for (const h of [1, 2, 3, 4]) await task(OTHER, h, `C-other-T+${h}h`);
    const latest = await task(OTHER, 6, "C-other-T+6h");

    const list = await upcomingCalls(db, { orgId: ORG, staffId: STAFF, includeClientId: OPEN });
    assert.equal(list.length, 5, "LIMIT 5");
    assert.ok(
      !list.some((r) => same(r, latest)),
      "the T+6h is cut off the array — so no amount of sorting it finds this call"
    );

    const next = await nextCallAfter(db, { orgId: ORG, staffId: STAFF, after: cur.due_at });
    assert.ok(next, '"nothing after this" would have been a lie here');
    assert.ok(same(next, latest));
  });

test("F) the call after a call that already happened is never another call that already happened",
  { skip: !HAS_DB }, async () => {
    await clearDay();
    // The open client's call was five hours ago and nobody logged it — that is
    // exactly why quietClients()/listUnloggedCalls() exist in the same file.
    const cur = await task(OPEN, -5, "F-open-T-5h");
    const missed = await task(OTHER, -4, "F-other-T-4h-missed");
    const real = await task(OTHER, 2, "F-other-T+2h");

    const next = await nextCallAfter(db, { orgId: ORG, staffId: STAFF, after: cur.due_at });
    assert.ok(next, "there is a call still to come");
    assert.ok(!same(next, missed),
      "the headline named an appointment that started four hours ago and finished, while the " +
      "Up next rail three inches away named the real one. Two halves of one screen disagreeing " +
      "about the closer's own day.");
    assert.ok(same(next, real), "the next call is the next call that has not happened yet");

    // …and the rail agrees, because both halves now read the same clock.
    const list = await upcomingCalls(db, { orgId: ORG, staffId: STAFF, includeClientId: OPEN });
    assert.ok(!list.some((r) => same(r, missed)),
      "up_next dropped the missed call already — it filters other people by due_at >= now()");
  });

test("a call already logged is not the next one", { skip: !HAS_DB }, async () => {
  await clearDay();
  const cur = await task(OPEN, 1, "D-open-T+1h");
  const done = await task(OTHER, 2, "D-other-T+2h-logged");
  const later = await task(OTHER, 3, "D-other-T+3h");
  await db.query(
    `INSERT INTO call_outcomes (org_id, client_id, staff_id, task_id, outcome)
     VALUES ($1, $2, $3, $4, 'no_show')`,
    [ORG, OTHER, STAFF, done.id]
  );

  const next = await nextCallAfter(db, { orgId: ORG, staffId: STAFF, after: cur.due_at });
  assert.ok(same(next, later),
    "an appointment that has already been dispositioned is not still coming up");
});

test("the current call cannot be its own next call", { skip: !HAS_DB }, async () => {
  await clearDay();
  const cur = await task(OPEN, 1, "E-open-T+1h");
  const next = await nextCallAfter(db, { orgId: ORG, staffId: STAFF, after: cur.due_at });
  assert.equal(next, null, "strictly after, so the open call never names itself");
});


// A booking may be dispositioned by provider UID without a task ID. Both
// closer readouts must exclude that outcome for its own buyer, not another.
test("same-buyer booking-ref outcomes hide only the completed appointment on the closer rail",
  { skip: !HAS_DB }, async () => {
    await clearDay();
    const done = await task(OPEN, 1, "G-open-booking-completed");
    const stillOpen = await task(OPEN, 2, "G-open-other-buyer-ref");
    const later = await task(OTHER, 3, "G-other-future");
    await db.query(
      `INSERT INTO call_outcomes (org_id, client_id, staff_id, booking_ref, outcome)
       VALUES ($1, $2, $3, $4, 'callback'), ($1, $5, $3, $6, 'callback')`,
      [ORG, OPEN, STAFF, `${TAG}-G-open-booking-completed`, OTHER,
        `${TAG}-G-open-other-buyer-ref`]
    );

    const rail = await upcomingCalls(db, { orgId: ORG, staffId: STAFF, includeClientId: OPEN });
    assert.deepEqual(rail.map(row => row.task_id), [stillOpen.id, later.id],
      "booking outcome closes its own buyer only; another buyer's matching UID cannot hide a task");
    const afterDone = await nextCallAfter(db, { orgId: ORG, staffId: STAFF, after: done.due_at });
    assert.ok(same(afterDone, stillOpen), "an unrelated buyer's outcome must not hide this live appointment");
    const afterOpen = await nextCallAfter(db, { orgId: ORG, staffId: STAFF, after: stillOpen.due_at });
    assert.ok(same(afterOpen, later), "next is the next unlogged appointment in chronological order");
  });
