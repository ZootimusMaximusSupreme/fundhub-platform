// The eight proofs. Every one of these is a thing that has to be WATCHED
// happening against a real Postgres, because seven of the eight are enforced by
// a unique index or a CHECK and a mock database would assert nothing at all.
//
// The bar these are written to: on 2026-09-03 a chase loop in this product sent
// 51 identical texts to one phone in two hours. A loop that sends nothing is a
// success. A loop that sends twice is a failure.
//
// THIS SUITE OWNS ITS OWN ORG and every client in it, so a concurrent suite's
// rows cannot inflate a count and nothing here touches the default org.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { planNudges, deliverNudge, runNudges, idempotencyKeyFor, STAFF_TASK_ROLE } from "./run.mjs";
import { blockersFor, scanForEscalation, hasEscalation } from "./exits.mjs";
import { expireStaleCheckouts } from "../paid-services/expire.mjs";
import { recordOptOut } from "../lib/opt-out.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG_SLUG = "waypoint-nudge-pg-test";
const EMAIL_TAG = "@waypoint-nudge-pg-test.example.com";

/* 18:00 UTC is 11:00 in Phoenix — the middle of the open window, so nothing
   here is accidentally a quiet-hours test. Fixed, so a suite run at 2am does
   not quietly change what is being asserted. */
const NOON = new Date("2026-09-10T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const overdueBy = (days) => new Date(NOON.getTime() - days * DAY);

let orgId = null;

/* The three template keys the ladder can use, inserted for THIS org. The seed
   (db/seed/025) writes them for every org that existed when it ran; this org is
   created afterwards, so it needs its own copies. */
const TEMPLATES = [
  ["SMS-WAYPOINT-DUE", "sms", null, "Due today: {{waypoint.title}}. Reply STOP to opt out."],
  ["EMAIL-WAYPOINT-NUDGE-1", "email", "Still open", "Still open: {{waypoint.title}}."],
  ["SMS-WAYPOINT-NUDGE-2", "sms", null, "Still open: {{waypoint.title}}. Reply STOP to opt out."]
];

async function wipe() {
  if (!orgId) return;
  const ids = `(SELECT id FROM clients WHERE org_id = '${orgId}')`;
  await db.query(`DELETE FROM waypoint_nudges WHERE org_id = $1`, [orgId]);
  /* Explicit rather than left to the cascade off `clients`, because this is the
     durable half of the escalation stop (368) and a leftover row would silently
     block the next test's client. Run this file twice against one database and
     a missed cleanup here is what fails on the second run. */
  await db.query(`DELETE FROM client_escalations WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM regulator_complaints WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM paid_service_requests WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM client_waypoints WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM repair_programs WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM tasks WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM messages WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM conversations WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM opt_outs WHERE client_id IN ${ids}`);
  await db.query(`DELETE FROM accounts WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM events WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM clients WHERE org_id = $1`, [orgId]);
}

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,'Waypoint Nudge Pg Test')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [ORG_SLUG]
  )).rows[0].id;
  await wipe();
  for (const [key, channel, subject, body] of TEMPLATES) {
    await db.query(
      `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (org_id, template_key) DO UPDATE
         SET body = EXCLUDED.body, compliance_passed = true`,
      [orgId, key, channel, subject, body]
    );
  }
});

beforeEach(async () => { if (HAS_DB) await wipe(); });

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await db.query(`DELETE FROM message_templates WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
  await close();
});

/* ── fixtures ─────────────────────────────────────────────────────────────── */

let seq = 0;
/* A DISTINCT PHONE PER CLIENT, and the reason is a finding rather than tidiness.
   This fixture used to hand every client the same number, '+15555550123'. From
   2026-09-06 the daily cap is keyed on the destination as well as on the client
   record (db/migrations/369), because a person with two client rows on one phone
   was getting two texts a day. With a shared fixture number every client in this
   suite IS that person, so the quiet-hours proof below — two clients, two
   timezones, one instant — silently became a test of the new cap instead. The
   numbers are now unique, which is what the scenario always meant.
   The one place a shared number is the POINT has its own explicit phone: see
   "two client rows on one phone number" further down. */
async function makeClient({ phone = undefined, email = null, tz = "America/Phoenix" } = {}) {
  seq += 1;
  if (phone === undefined) phone = `+1555555${String(1000 + seq).slice(-4)}`;
  const addr = email === null ? `nudge${seq}${EMAIL_TAG}` : email;
  return (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, phone, custom_fields)
     VALUES ($1,'Nudge','Test',$2,$3,$4) RETURNING id`,
    [orgId, addr, phone, JSON.stringify(tz ? { timezone: tz } : {})]
  )).rows[0].id;
}

async function makeWaypoint(clientId, {
  key = null, title = "Upload your ID", ownerKind = "client",
  state = "not_started", dueDaysAgo = 0
} = {}) {
  seq += 1;
  return (await db.query(
    `INSERT INTO client_waypoints (org_id, client_id, key, title, owner_kind, state, due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [orgId, clientId, key || `step_${seq}`, title, ownerKind, state, overdueBy(dueDaysAgo).toISOString()]
  )).rows[0].id;
}

/* paid_service_requests_requester_ck (331) wants a real account behind a
   client-made request: "exactly one requester, and it must be the kind the row
   claims". So the fixture makes one rather than weakening the constraint. */
async function makeClientAccount(clientId) {
  seq += 1;
  return (await db.query(
    `INSERT INTO accounts (org_id, kind, email, name, client_id, status)
     VALUES ($1,'client',$2,'Nudge Test',$3,'invited')
     ON CONFLICT (client_id) WHERE client_id IS NOT NULL DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [orgId, `acct${seq}${EMAIL_TAG}`, clientId]
  )).rows[0].id;
}

/* A paid_service_requests row for one waypoint.
   `expiresInDays` is measured from NOON and is only meaningful for
   'awaiting_payment' — db/migrations/370 REFUSES a row at that status with no
   checkout_expires_at, which is the point of the column: an invitation to pay
   cannot exist without a deadline. Pass null to prove the fallback path in
   paymentHoldIsLive() (that only works for a status the CHECK does not cover). */
async function paidRequest(clientId, waypointId, {
  status = "awaiting_payment", expiresInDays = 7, requestedDaysAgo = 0, paid = false
} = {}) {
  const accountId = await makeClientAccount(clientId);
  const expiresAt = expiresInDays == null
    ? null
    : new Date(NOON.getTime() + expiresInDays * DAY).toISOString();
  const requestedAt = new Date(NOON.getTime() - requestedDaysAgo * DAY).toISOString();
  /* 331's paid_service_requests_resolved_ck: a finished request has an end
     time and an open one does not. The fixture obeys the constraint rather
     than the test disabling it. */
  const finished = ["fulfilled", "failed", "cancelled", "refunded"].includes(status);
  return (await db.query(
    `INSERT INTO paid_service_requests
       (org_id, client_id, waypoint_id, service_kind, requested_by_kind,
        requested_by_account_id, status, price_components, price_total_cents,
        checkout_expires_at, requested_at, amount_paid_cents, paid_at, resolved_at)
     VALUES ($1,$2,$3,'dispute_round','client',$4,$5,
             '[{"code":"round_base","label":"Dispute round","quantity":1,"unit_cents":10000,"amount_cents":10000}]'::jsonb,
             10000, $6::timestamptz, $7::timestamptz,
             CASE WHEN $8::boolean THEN 10000 ELSE NULL END,
             CASE WHEN $8::boolean THEN $7::timestamptz ELSE NULL END,
             CASE WHEN $9::boolean THEN $7::timestamptz ELSE NULL END)
     RETURNING id`,
    [orgId, clientId, waypointId, accountId, status, expiresAt, requestedAt, paid, finished]
  )).rows[0].id;
}

/* One inbound row, dated. `at` matters for the escalation proofs: the defect
   was a 200-row horizon, so the whole point is putting the threat far enough
   back that ordinary later traffic buries it. */
async function inboundMessage(clientId, body, at = NOON) {
  await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, status, created_at)
     VALUES ($1,$2,'inbound','sms',$3,'received',$4::timestamptz)`,
    [orgId, clientId, body, (at instanceof Date ? at : new Date(at)).toISOString()]
  );
}

const countMessages = async (clientId) =>
  Number((await db.query(
    `SELECT count(*)::int AS n FROM messages WHERE client_id = $1 AND direction = 'outbound'`,
    [clientId]
  )).rows[0].n);

const nudgeRows = async (waypointId) =>
  (await db.query(
    `SELECT step, kind, channel, outcome, client_local_date, message_id, task_id, detail
       FROM waypoint_nudges WHERE waypoint_id = $1 ORDER BY step`,
    [waypointId]
  )).rows;

/* ── PROOF 1 ──────────────────────────────────────────────────────────────── */

test("a waypoint completed between scheduling and sending: NOTHING SENDS",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);

    // Phase 1: the plan is made while the waypoint is genuinely overdue.
    const plan = await planNudges(db, { orgId, now: NOON });
    assert.equal(plan.length, 1, "the overdue waypoint is a candidate");
    assert.equal(plan[0].step, 1);

    // The client finishes it in the gap.
    await db.query(
      `UPDATE client_waypoints SET state = 'done', completed_at = now() WHERE id = $1`,
      [waypointId]
    );

    // Phase 2 re-decides against the live row.
    const res = await deliverNudge(db, plan[0], { now: NOON });
    assert.equal(res.action, "skipped");
    assert.ok(res.reasons.includes("waypoint_complete"), JSON.stringify(res.reasons));
    assert.equal(await countMessages(clientId), 0, "no message row was written");
    assert.deepEqual(await nudgeRows(waypointId), [], "no rung was spent");
  });

/* ── PROOF 2 ──────────────────────────────────────────────────────────────── */

test("sixteen duplicate triggers for one step: ONE message row",
  { skip: !HAS_DB }, async () => {
    // Sixteen is not an arbitrary number. The provider fired roughly sixteen
    // duplicate webhooks per survey on 2026-09-03, and each one started its own
    // run.
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);
    const [candidate] = await planNudges(db, { orgId, now: NOON });

    const results = [];
    for (let i = 0; i < 16; i += 1) {
      results.push(await deliverNudge(db, candidate, { now: NOON }));
    }

    assert.equal(await countMessages(clientId), 1, "exactly one message row");
    const rows = await nudgeRows(waypointId);
    assert.equal(rows.length, 1, "exactly one ladder row");
    assert.equal(rows[0].outcome, "queued");
    assert.equal(results.filter((r) => r.action === "queued").length, 1);
    assert.equal(results.filter((r) => r.action === "skipped").length, 15);

    // The event log carries the same one key, once.
    const events = (await db.query(
      `SELECT count(*)::int AS n FROM events WHERE org_id = $1 AND idempotency_key = $2`,
      [orgId, idempotencyKeyFor(waypointId, 1)]
    )).rows[0].n;
    assert.equal(Number(events), 1, "one event, not sixteen");
  });

test("sixteen triggers fired CONCURRENTLY still produce one message row",
  { skip: !HAS_DB }, async () => {
    // The sequential version above would pass even with a check-then-write
    // guard. This one would not: it is the shape that proves the database is
    // the thing deciding, not the code.
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);
    const [candidate] = await planNudges(db, { orgId, now: NOON });

    const settled = await Promise.allSettled(
      Array.from({ length: 16 }, () => deliverNudge(db, candidate, { now: NOON }))
    );
    const queued = settled.filter((s) => s.status === "fulfilled" && s.value.action === "queued");

    assert.equal(await countMessages(clientId), 1, "exactly one message row");
    assert.equal((await nudgeRows(waypointId)).length, 1, "exactly one ladder row");
    assert.equal(queued.length, 1, "exactly one caller believes it queued");
  });

/* ── PROOF 3 ──────────────────────────────────────────────────────────────── */

test("three overdue waypoints, one client, one day: ONE message",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const a = await makeWaypoint(clientId, { key: "upload_id", title: "Upload your ID" });
    const b = await makeWaypoint(clientId, { key: "sign_agreement", title: "Sign the agreement" });
    const c = await makeWaypoint(clientId, { key: "link_bank", title: "Link your bank" });

    const tally = await runNudges(db, { orgId, now: NOON });

    /* ONE CANDIDATE, NOT THREE — CHANGED 2026-09-06, ROUND FOUR, AND IT IS A
       FIX RATHER THAN A RELAXATION. This used to assert `considered === 3` and
       two `daily_cap` refusals, which is exactly the waste a reviewer measured:
       the two rows that could not possibly send today each spent a slot out of
       a budget shared by the whole platform, and being the oldest rows they did
       it again on every hourly pass. 25 clients with 8 rows each filled all 200
       slots and queued 25 messages. The plan now takes at most one waypoint per
       client (DISTINCT ON in planNudges), so the other two are simply not
       considered — and the outcome the client sees is identical. */
    assert.equal(tally.considered, 1, "one candidate per client per pass");
    assert.equal(tally.queued, 1, "one message, not three");
    assert.equal(await countMessages(clientId), 1);

    const spent = [a, b, c].map(async (id) => (await nudgeRows(id)).length);
    assert.equal((await Promise.all(spent)).reduce((x, y) => x + y, 0), 1,
      "the other two rungs are NOT spent — they are chased on a later day");

    /* THE CAP ITSELF IS UNCHANGED AND STILL BITES. A second pass on the SAME
       day picks the client's next overdue row — the first one's rung is spent —
       and the database refuses it. One message a day, still enforced by
       365's unique index and not by this loop. */
    const again = await runNudges(db, { orgId, now: new Date(NOON.getTime() + 60 * 60 * 1000) });
    assert.equal(again.considered, 1, "still one candidate for this client");
    assert.equal(again.queued, 0, "and the day is already spoken for");
    assert.ok(again.results.flatMap((r) => r.reasons || []).includes("daily_cap"),
      "the refusal names the cap");
    assert.equal(await countMessages(clientId), 1, "still one message today");
  });

test("the daily cap no longer burns the budget: 25 clients, 8 rows each, one live client",
  { skip: !HAS_DB }, async () => {
    /* THE REVIEWER'S MEASUREMENT, at the size they used. Before this fix, on a
       scratch Postgres 16.14 in this worktree on 2026-09-06:
         day 0: candidates 200, queued 25, 175 refused daily_cap,
                the live client NOT in the plan, 0 messages to them
         day 1: identical. The live client waited two days.
       Twenty-five clients a day out of a budget of two hundred. */
    /* One day overdue, so every backlogged row is rung 1 — a client message,
       which is what the daily cap is about — and every one of them still sorts
       ahead of the live client. */
    for (let i = 0; i < 25; i += 1) {
      const c = await makeClient();
      for (let j = 0; j < 8; j += 1) {
        await makeWaypoint(c, { dueDaysAgo: 1, title: `Backlog ${i}-${j}` });
      }
    }
    const live = await makeClient();
    const liveWp = await makeWaypoint(live, { dueDaysAgo: 0, title: "Link your business bank account" });

    const plan = await planNudges(db, { orgId: null, now: NOON });
    assert.equal(plan.length, 26, "25 backlogged clients + the live one, one row each");
    assert.ok(plan.some((c) => c.waypointId === liveWp), "the live client is in the plan");

    const tally = await runNudges(db, { orgId: null, now: NOON });
    assert.equal(tally.budget_exhausted, false, "26 candidates is nowhere near the budget");
    assert.equal(tally.queued, 26, "every one of them gets today's message");
    assert.equal(await countMessages(live), 1, "including the live client, on day 0");
  });

test("the daily cap is the client's own calendar day, and it releases the next day",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    await makeWaypoint(clientId, { key: "upload_id" });
    await makeWaypoint(clientId, { key: "sign_agreement" });

    const day1 = await runNudges(db, { orgId, now: NOON });
    assert.equal(day1.queued, 1);
    const day2 = await runNudges(db, { orgId, now: new Date(NOON.getTime() + DAY) });
    assert.equal(day2.queued, 1, "the second waypoint is chased the next day");
    assert.equal(await countMessages(clientId), 2);
  });

/* ── PROOF 4 ──────────────────────────────────────────────────────────────── */

test("the paid alternative bought: the chase stops",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);
    const accountId = await makeClientAccount(clientId);
    await db.query(
      `INSERT INTO paid_service_requests
         (org_id, client_id, waypoint_id, service_kind, requested_by_kind,
          requested_by_account_id, status,
          price_components, price_total_cents, amount_paid_cents, paid_at)
       VALUES ($1,$2,$3,'dispute_round','client',$4,'paid',
               '[{"code":"round_base","label":"Dispute round","quantity":1,"unit_cents":10000,"amount_cents":10000}]'::jsonb,
               10000, 10000, now())`,
      [orgId, clientId, waypointId, accountId]
    );

    const tally = await runNudges(db, { orgId, now: NOON });
    assert.equal(tally.queued, 0);
    assert.equal(await countMessages(clientId), 0,
      "never chase somebody to do the thing they just paid us to do");

    /* The reason is asserted against the GATE, not against the runner's tally.
       From round three "they paid the alternative" is a PERMANENT stop and is
       excluded in SQL before the LIMIT, so the row is not a candidate at all and
       produces no tally entry — which is the whole point: an unchaseable row
       must not hold a slot. Both halves are checked, and together they are
       stricter than reading the tally was. */
    assert.equal(tally.considered, 0, "and it must not even occupy a slot in the pass");
    const reasons = await blockersFor(db, { waypointId, now: NOON });
    assert.ok(reasons.includes("paid_alternative_bought"), JSON.stringify(reasons));
  });

test("a quote nobody paid does NOT silence the ladder forever",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);
    const accountId = await makeClientAccount(clientId);
    await db.query(
      `INSERT INTO paid_service_requests
         (org_id, client_id, waypoint_id, service_kind, requested_by_kind,
          requested_by_account_id, status,
          price_components, price_total_cents)
       VALUES ($1,$2,$3,'dispute_round','client',$4,'quoted',
               '[{"code":"round_base","label":"Dispute round","quantity":1,"unit_cents":10000,"amount_cents":10000}]'::jsonb,
               10000)`,
      [orgId, clientId, waypointId, accountId]
    );
    const tally = await runNudges(db, { orgId, now: NOON });
    assert.equal(tally.queued, 1, "a quote is not a purchase");
  });

/* ── PROOF 5 ──────────────────────────────────────────────────────────────── */

test("STOP received: the chase stops and STAYS stopped",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);

    // The existing suppression path — the same table src/handlers/comms.mjs
    // writes on a STOP keyword, through the same helper. No second store.
    await recordOptOut(db, clientId, orgId, "sms", "inbound_keyword");

    for (const days of [0, 2, 5, 9, 30]) {
      const at = new Date(NOON.getTime() + days * DAY);
      const tally = await runNudges(db, { orgId, now: at });
      assert.equal(tally.queued, 0, `nothing queued on day ${days}`);
      assert.equal(tally.staff_tasks, 0, `no task either on day ${days}`);
    }
    assert.equal(await countMessages(clientId), 0);
    assert.deepEqual(await nudgeRows(waypointId), []);
  });

test("STOP on SMS also stops the email rung — the word means stop, not stop-by-text",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    await makeWaypoint(clientId, { dueDaysAgo: 3 }); // rung 2 is email
    await recordOptOut(db, clientId, orgId, "sms", "inbound_keyword");
    const tally = await runNudges(db, { orgId, now: NOON });
    assert.equal(tally.queued, 0);
    assert.equal(await countMessages(clientId), 0);
  });

/* ── PROOF 6 ──────────────────────────────────────────────────────────────── */

test("step 4 reached: a staff task, and no fifth client message EVER",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId, { dueDaysAgo: 9, title: "Upload your ID" });

    const tally = await runNudges(db, { orgId, now: NOON });
    assert.equal(tally.staff_tasks, 1);
    assert.equal(tally.queued, 0);
    assert.equal(await countMessages(clientId), 0, "step 4 sends the client nothing");

    const task = (await db.query(
      `SELECT title, assignee_role, source_workflow FROM tasks WHERE client_id = $1`,
      [clientId]
    )).rows;
    assert.equal(task.length, 1);
    assert.match(task[0].title, /Upload your ID/);
    assert.equal(task[0].assignee_role, STAFF_TASK_ROLE);

    // Now keep running, for a month. Nothing more may ever happen.
    for (const days of [0, 1, 5, 12, 30]) {
      await runNudges(db, { orgId, now: new Date(NOON.getTime() + days * DAY) });
    }
    assert.equal(await countMessages(clientId), 0, "still no client message");
    const rows = await nudgeRows(waypointId);
    assert.equal(rows.length, 1, "one rung spent, and it is the last one");
    assert.equal(rows[0].step, 4);
    assert.equal(rows[0].kind, "staff_task");
    assert.equal(
      Number((await db.query(`SELECT count(*)::int AS n FROM tasks WHERE client_id = $1`, [clientId])).rows[0].n),
      1, "one task, not one per pass"
    );
  });

test("the database itself refuses a fifth rung", { skip: !HAS_DB }, async () => {
  // The cap is stored, not remembered. Even raw SQL cannot write step 5.
  const clientId = await makeClient();
  const waypointId = await makeWaypoint(clientId);
  await assert.rejects(
    db.query(
      `INSERT INTO waypoint_nudges (org_id, client_id, waypoint_id, step, kind, channel, idempotency_key)
       VALUES ($1,$2,$3,5,'client_message','sms','forced')`,
      [orgId, clientId, waypointId]
    ),
    /waypoint_nudges_(step|shape)_ck/
  );
  await assert.rejects(
    db.query(
      `INSERT INTO waypoint_nudges (org_id, client_id, waypoint_id, step, kind, idempotency_key)
       VALUES ($1,$2,$3,5,'staff_task','forced-2')`,
      [orgId, clientId, waypointId]
    ),
    /waypoint_nudges_(step|shape)_ck/
  );
  // And a second row on a rung that is already spent cannot exist either.
  await db.query(
    `INSERT INTO waypoint_nudges (org_id, client_id, waypoint_id, step, kind, channel, idempotency_key)
     VALUES ($1,$2,$3,1,'client_message','sms','first')`,
    [orgId, clientId, waypointId]
  );
  await assert.rejects(
    db.query(
      `INSERT INTO waypoint_nudges (org_id, client_id, waypoint_id, step, kind, channel, idempotency_key)
       VALUES ($1,$2,$3,1,'client_message','sms','second')`,
      [orgId, clientId, waypointId]
    ),
    /waypoint_nudges_waypoint_step_uq/
  );
});

test("a whole ladder walked end to end is four rows and three messages",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);
    // One pass per rung day. The one-per-day cap means one message per pass.
    for (const days of [0, 2, 5, 9, 11, 20]) {
      await runNudges(db, { orgId, now: new Date(NOON.getTime() + days * DAY) });
    }
    const rows = await nudgeRows(waypointId);
    assert.deepEqual(rows.map((r) => r.step), [1, 2, 3, 4]);
    assert.deepEqual(rows.map((r) => r.kind),
      ["client_message", "client_message", "client_message", "staff_task"]);
    assert.deepEqual(rows.map((r) => r.channel), ["sms", "email", "sms", null]);
    assert.equal(await countMessages(clientId), 3, "three client messages, ever");
  });

/* ── PROOF 7 ──────────────────────────────────────────────────────────────── */

test("a client with no phone: the SMS step is SKIPPED, not retried forever",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient({ phone: null });
    const waypointId = await makeWaypoint(clientId);

    const first = await runNudges(db, { orgId, now: NOON });
    assert.equal(first.no_contact, 1);
    assert.equal(await countMessages(clientId), 0);

    let rows = await nudgeRows(waypointId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, "no_contact");
    assert.equal(rows[0].client_local_date, null,
      "a skipped rung costs the client nothing from their one message a day");

    // Ten more passes on the same day: the rung stays spent, nothing retries.
    for (let i = 0; i < 10; i += 1) await runNudges(db, { orgId, now: NOON });
    rows = await nudgeRows(waypointId);
    assert.equal(rows.length, 1, "still one row after ten more passes");

    // And the ladder ADVANCES — the email rung is reachable two days later.
    await runNudges(db, { orgId, now: new Date(NOON.getTime() + 2 * DAY) });
    rows = await nudgeRows(waypointId);
    assert.deepEqual(rows.map((r) => r.step), [1, 2]);
    assert.equal(rows[1].outcome, "queued");
    assert.equal(await countMessages(clientId), 1, "the email went, the text could not");
  });

/* ── PROOF 8 ──────────────────────────────────────────────────────────────── */

test("a message due outside the client's daytime is NOT QUEUED",
  { skip: !HAS_DB }, async () => {
    // Same instant, two clients. 15:00 UTC is 08:00 in Phoenix and 05:00 in
    // Honolulu, so one is inside the window and the other is asleep.
    const morning = new Date("2026-09-10T15:00:00.000Z");
    const phoenix = await makeClient({ tz: "America/Phoenix" });
    const honolulu = await makeClient({ tz: "Pacific/Honolulu" });
    // Overdue by a day, so `morning` is genuinely past due_at for both.
    const wpPhoenix = await makeWaypoint(phoenix, { dueDaysAgo: 1 });
    const wpHonolulu = await makeWaypoint(honolulu, { dueDaysAgo: 1 });

    const tally = await runNudges(db, { orgId, now: morning });

    assert.equal(await countMessages(phoenix), 1, "08:00 where they are: queued");
    assert.equal(await countMessages(honolulu), 0, "05:00 where they are: not queued");
    assert.deepEqual(await nudgeRows(wpHonolulu), [],
      "and the rung is NOT spent — it is chased when their morning comes");
    assert.equal((await nudgeRows(wpPhoenix)).length, 1);
    assert.ok(
      tally.results.some((r) => (r.reasons || []).includes("quiet_hours")),
      JSON.stringify(tally.results.map((r) => r.reasons))
    );

    // Their morning comes.
    const later = new Date("2026-09-10T20:00:00.000Z"); // 10:00 Honolulu
    await runNudges(db, { orgId, now: later });
    assert.equal(await countMessages(honolulu), 1, "queued once their day started");
  });

/* ── the exits that are not on the eight-proof list but are still blockers ── */

test("a waypoint FundHub owes is never chased", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  await makeWaypoint(clientId, { ownerKind: "fundhub", dueDaysAgo: 30 });
  const tally = await runNudges(db, { orgId, now: NOON });
  assert.equal(tally.considered, 0, "it is not even a candidate");
  assert.equal(await countMessages(clientId), 0);
});

test("a waypoint with no due date is never chased", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  await db.query(
    `INSERT INTO client_waypoints (org_id, client_id, key, title, owner_kind, state, due_at)
     VALUES ($1,$2,'no_deadline','Someday','client','not_started',NULL)`,
    [orgId, clientId]
  );
  const tally = await runNudges(db, { orgId, now: NOON });
  assert.equal(tally.considered, 0);
  assert.equal(await countMessages(clientId), 0);
});

test("the owner changing to us mid-ladder stops it", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  const waypointId = await makeWaypoint(clientId);
  const [candidate] = await planNudges(db, { orgId, now: NOON });
  await db.query(`UPDATE client_waypoints SET owner_kind = 'fundhub' WHERE id = $1`, [waypointId]);
  const res = await deliverNudge(db, candidate, { now: NOON });
  assert.equal(res.action, "skipped");
  assert.ok(res.reasons.includes("owner_is_fundhub"));
  assert.equal(await countMessages(clientId), 0);
});

test("a deleted waypoint stops it", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  const waypointId = await makeWaypoint(clientId);
  const [candidate] = await planNudges(db, { orgId, now: NOON });
  await db.query(`DELETE FROM client_waypoints WHERE id = $1`, [waypointId]);
  const res = await deliverNudge(db, candidate, { now: NOON });
  assert.equal(res.action, "skipped");
  assert.deepEqual(res.reasons, ["waypoint_missing"]);
  assert.equal(await countMessages(clientId), 0);
});

test("the client replying stops the ladder — a human takes it", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  const waypointId = await makeWaypoint(clientId);
  await runNudges(db, { orgId, now: NOON });
  assert.equal(await countMessages(clientId), 1);

  await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, status)
     VALUES ($1,$2,'inbound','sms','doing it now',
             'received')`,
    [orgId, clientId]
  );

  for (const days of [2, 5, 9, 20]) {
    await runNudges(db, { orgId, now: new Date(NOON.getTime() + days * DAY) });
  }
  assert.equal(await countMessages(clientId), 1, "no rung after the reply");
  assert.equal((await nudgeRows(waypointId)).length, 1);
});

test("a lawyer stops every ladder that client has", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  await makeWaypoint(clientId, { key: "upload_id" });
  await makeWaypoint(clientId, { key: "sign_agreement" });
  await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, status)
     VALUES ($1,$2,'inbound','sms','my attorney will be in touch','received')`,
    [orgId, clientId]
  );
  const tally = await runNudges(db, { orgId, now: NOON });
  assert.equal(tally.queued, 0);
  assert.equal(await countMessages(clientId), 0);
  assert.ok(tally.results.flatMap((r) => r.reasons || []).includes("escalation"));
});

test("a cancelled program stops the ladder", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  const waypointId = await makeWaypoint(clientId);
  await db.query(
    `INSERT INTO repair_programs (org_id, client_id, program, rounds_cap, price_total, status)
     VALUES ($1,$2,'full',6,1997.00,'cancelled')`,
    [orgId, clientId]
  );
  const tally = await runNudges(db, { orgId, now: NOON });
  assert.equal(tally.queued, 0);
  assert.equal(await countMessages(clientId), 0);

  /* As above: a cancelled program is a PERMANENT stop from round three, so the
     row is excluded in SQL and never reaches the tally. The gate is asked
     directly instead, and the pass is asserted to hold no slot for it. */
  assert.equal(tally.considered, 0, "a cancelled program must not occupy a slot");
  const reasons = await blockersFor(db, { waypointId, now: NOON });
  assert.ok(reasons.includes("program_cancelled"), JSON.stringify(reasons));
});

test("a blocked waypoint is not chased", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  await makeWaypoint(clientId, { state: "blocked" });
  const tally = await runNudges(db, { orgId, now: NOON });
  assert.equal(tally.considered, 0);
  assert.equal(await countMessages(clientId), 0);
});

test("a missing template spends the rung but gives the client's day back",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const other = await makeWaypoint(clientId, { key: "sign_agreement" });
    const waypointId = await makeWaypoint(clientId, { key: "upload_id" });
    await db.query(
      `DELETE FROM message_templates WHERE org_id = $1 AND template_key = 'SMS-WAYPOINT-DUE'`,
      [orgId]
    );
    try {
      /* TWO PASSES, NOT ONE, AND THAT IS THE PROOF NOW. The plan takes at most
         one waypoint per client per pass (round four), so the two rungs are
         spent on two passes of the same day. The property being asserted is
         unchanged and is actually stronger this way: the second pass can only
         happen at all because the first one gave the client's day BACK. If
         client_local_date had been left set, 365's unique index would refuse
         the second claim and this would fail. */
      const first = await runNudges(db, { orgId, now: NOON });
      const second = await runNudges(db, { orgId, now: new Date(NOON.getTime() + 60 * 60 * 1000) });
      assert.equal(first.queued, 0);
      assert.equal(second.queued, 0);
      assert.equal(first.template_pending + second.template_pending, 2, "both rungs are spent");
      for (const id of [waypointId, other]) {
        const rows = await nudgeRows(id);
        assert.equal(rows[0].outcome, "template_pending");
        assert.equal(rows[0].client_local_date, null,
          "a message that never went out must not eat the client's one slot");
      }
      assert.equal(await countMessages(clientId), 0);
    } finally {
      await db.query(
        `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
         VALUES ($1,'SMS-WAYPOINT-DUE','sms',NULL,'Due today: {{waypoint.title}}. Reply STOP to opt out.',true)
         ON CONFLICT (org_id, template_key) DO UPDATE SET body = EXCLUDED.body`,
        [orgId]
      );
    }
  });

test("the queued message names the actual waypoint, not a generic reminder",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    await makeWaypoint(clientId, { title: "Link your business bank account" });
    await runNudges(db, { orgId, now: NOON });
    const body = (await db.query(
      `SELECT rendered_body, status, channel FROM messages WHERE client_id = $1`,
      [clientId]
    )).rows[0];
    assert.match(body.rendered_body, /Link your business bank account/);
    assert.equal(body.status, "queued", "queued — this lane never sends");
    assert.equal(body.channel, "sms");
  });

/* ── the copy itself, pinned character for character ──────────────────────── */

test("the queued body is EXACTLY the template, rendered — no silent extra text",
  { skip: !HAS_DB }, async () => {
    /* A regex match on the waypoint title was all this suite asserted, so the
       rest of the message was unpinned: a footer, a link, a second sentence or
       a changed opt-out line could all have been added or removed without a
       single test noticing. On a consumer-finance file the whole string is the
       thing under review, not the part that names the task.

       The body below is the TEST FIXTURE template at the top of this file, not
       the shipped copy. The shipped copy is pinned by the next test. */
    const clientId = await makeClient();
    await makeWaypoint(clientId, { title: "Link your business bank account" });
    await runNudges(db, { orgId, now: NOON });
    const row = (await db.query(
      `SELECT rendered_body, subject, channel, status, direction
         FROM messages WHERE client_id = $1`,
      [clientId]
    )).rows[0];

    assert.equal(
      row.rendered_body,
      "Due today: Link your business bank account. Reply STOP to opt out."
    );
    assert.equal(row.subject, null, "an SMS carries no subject");
    assert.equal(row.channel, "sms");
    assert.equal(row.direction, "outbound");
    assert.equal(row.status, "queued", "queued — this lane never sends");
  });

test("the SHIPPED copy from db/seed/025 renders with no placeholder left behind",
  { skip: !HAS_DB }, async () => {
    /* What a real client on a seeded org actually receives. Pinned here because
       the fixture above is a placeholder and pinning only the placeholder
       proves nothing about the words that go out.

       Three things this asserts and one it does not. It asserts: the merge
       fields all resolve, the opt-out line survives, and nothing in the body
       claims an outcome. It does NOT assert Chris's final wording — he edits
       these in the template editor without touching code, which is the whole
       point of the template keys being the contract. If he changes the copy,
       this test is expected to be updated with it. */
    const clientId = await makeClient();
    await makeWaypoint(clientId, { title: "Link your business bank account" });
    const fixture = (await db.query(
      `SELECT body FROM message_templates WHERE org_id = $1 AND template_key = 'SMS-WAYPOINT-DUE'`,
      [orgId]
    )).rows[0].body;
    const shipped = "Hi {{contact.first_name}}, it's Fundhub. This is due today on your file: "
      + "{{waypoint.title}}. You can take care of it in your portal. Reply here if you are "
      + "stuck. Reply STOP to opt out.";
    try {
      await db.query(
        `UPDATE message_templates SET body = $2
          WHERE org_id = $1 AND template_key = 'SMS-WAYPOINT-DUE'`,
        [orgId, shipped]
      );
      await runNudges(db, { orgId, now: NOON });
      const body = (await db.query(
        `SELECT rendered_body FROM messages WHERE client_id = $1`, [clientId]
      )).rows[0].rendered_body;

      assert.equal(
        body,
        "Hi Nudge, it's Fundhub. This is due today on your file: Link your business bank "
        + "account. You can take care of it in your portal. Reply here if you are stuck. "
        + "Reply STOP to opt out."
      );
      assert.equal(/\{\{|\}\}/.test(body), false, `an unresolved merge field shipped: ${body}`);
      assert.ok(body.endsWith("Reply STOP to opt out."), "the opt-out line has to survive");
      /* No claim about a credit outcome, and none of the words the owner has
         banned from client-facing copy. */
      for (const banned of [/credit repair/i, /score/i, /guarantee/i, /approved/i, /delete[ds]?\b/i]) {
        assert.equal(banned.test(body), false, `${banned} must not appear: ${body}`);
      }
    } finally {
      await db.query(
        `UPDATE message_templates SET body = $2
          WHERE org_id = $1 AND template_key = 'SMS-WAYPOINT-DUE'`,
        [orgId, fixture]
      );
    }
  });

/* ── BLOCKER: the chase must not be able to starve ────────────────────────── */

test("200 finished waypoints do NOT hold the budget against one live client",
  { skip: !HAS_DB }, async () => {
    /* THE FAILURE THIS PINS. planNudges took the 200 oldest overdue rows with no
       anti-join against waypoint_nudges, and the sweeper calls it with
       orgId=null so those 200 slots are one budget for the whole platform. A
       waypoint whose four rungs were spent stayed not_started and overdue for
       ever, and being oldest it sorted FIRST — so dead rows accumulated at the
       front of the queue until they held every slot and no live overdue row was
       ever reached again. Measured on a scratch database on 2026-09-06:
       "candidates: 200 includes the live one? false", 200 considered, 0 queued,
       0 messages to the live client.

       200 exactly, because that is DEFAULT_LIMIT. */
    const dead = [];
    for (let i = 0; i < 200; i += 1) {
      const c = await makeClient();
      const w = await makeWaypoint(c, { dueDaysAgo: 100 + i, title: `Finished ${i}` });
      for (const step of [1, 2, 3, 4]) {
        await db.query(
          `INSERT INTO waypoint_nudges (org_id, client_id, waypoint_id, step, kind, channel,
             template_key, outcome, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8)`,
          [orgId, c, w, step,
           step === 4 ? "staff_task" : "client_message",
           step === 4 ? null : (step === 2 ? "email" : "sms"),
           step === 4 ? "staff_task" : "no_contact",
           idempotencyKeyFor(w, step)]
        );
      }
      dead.push(w);
    }

    const live = await makeClient();
    const liveWp = await makeWaypoint(live, { dueDaysAgo: 0, title: "Link your business bank account" });

    const plan = await planNudges(db, { orgId: null, now: NOON });
    assert.ok(plan.some((c) => c.waypointId === liveWp),
      `the live waypoint must be a candidate; got ${plan.length} candidates`);
    assert.equal(plan.some((c) => dead.includes(c.waypointId)), false,
      "a waypoint with every rung spent may not occupy a slot");

    const tally = await runNudges(db, { orgId: null, now: NOON });
    assert.equal(await countMessages(live), 1, "the live client gets their message");
    assert.equal(tally.queued, 1);
  });

test("a pass that fills its budget says so, with a number",
  { skip: !HAS_DB }, async () => {
    /* Starvation was silent. The tally read "considered 200 / queued 0 /
       skipped 200" and nothing in it said the queue was full, so the worst pass
       the system can have looked like a quiet day. */
    for (let i = 0; i < 5; i += 1) {
      const c = await makeClient();
      await makeWaypoint(c, { dueDaysAgo: 1 });
    }
    const tally = await runNudges(db, { orgId, now: NOON, limit: 2 });
    assert.equal(tally.limit, 2);
    assert.equal(tally.budget_exhausted, true, "the budget was filled and must say so");
    assert.equal(tally.not_reached, 3, "three eligible rows were not reached");

    const roomy = await runNudges(db, { orgId, now: NOON, limit: 100 });
    assert.equal(roomy.budget_exhausted, false, "a pass with room to spare is not exhausted");
    assert.equal(roomy.not_reached, 0);
  });

/* ── HIGH: a legal threat may not expire ──────────────────────────────────── */

test("a lawyer message survives 210 later messages, and stays permanent",
  { skip: !HAS_DB }, async () => {
    /* THE FAILURE THIS PINS. The escalation check read the client's most recent
       200 inbound messages and regexed them in JavaScript. 200 is a horizon,
       and the portal chat writes one inbound row per client turn, so an
       ordinary talkative client pushed "my lawyer will be in touch" out of the
       window while the row sat untouched in the table. Measured on a scratch
       database on 2026-09-06: blockersFor returned [] and deliverNudge queued a
       text. "Messages the permanently stopped client just got: 1." */
    const clientId = await makeClient();
    await inboundMessage(clientId, "my lawyer will be in touch", new Date(NOON.getTime() - 60 * DAY));
    for (let i = 0; i < 210; i += 1) {
      await inboundMessage(clientId, `ordinary chatter ${i}`,
        new Date(NOON.getTime() - (59 - i * 0.2) * DAY));
    }

    const waypointId = await makeWaypoint(clientId, { dueDaysAgo: 0 });
    const blockers = await blockersFor(db, { waypointId, now: NOON });
    assert.ok(blockers.includes("escalation"), JSON.stringify(blockers));

    const tally = await runNudges(db, { orgId, now: NOON });
    assert.equal(await countMessages(clientId), 0,
      "a client who threatened us gets nothing, however much they have said since");
    assert.equal(tally.queued, 0);
  });

test("the escalation is recorded once and cannot be erased by deleting the message",
  { skip: !HAS_DB }, async () => {
    /* A scan is a detector, not a memory. The durable row in client_escalations
       (368) is the memory, and it has to outlive the evidence: no code path in
       src/nudge/ removes it. The database half of that — that fundhub_app is
       not merely un-granted DELETE but explicitly REVOKED it — is asserted in
       src/nudge/escalation-permanence.pg.test.mjs, which is the only file that
       connects as that role. This one asserts the behaviour. */
    const clientId = await makeClient();
    await inboundMessage(clientId, "this is a scam", new Date(NOON.getTime() - DAY));
    const waypointId = await makeWaypoint(clientId, { dueDaysAgo: 0 });

    assert.ok((await blockersFor(db, { waypointId, now: NOON })).includes("escalation"));

    const rows = (await db.query(
      `SELECT client_id, said_at, message_id, matched_pattern
         FROM client_escalations WHERE client_id = $1`, [clientId]
    )).rows;
    assert.equal(rows.length, 1, "exactly one durable row");
    assert.ok(rows[0].matched_pattern, "which of OUR rules fired is recorded");
    assert.equal(rows[0].matched_pattern.includes("this is a scam"), false,
      "the client's own words are NOT stored");
    assert.ok(rows[0].said_at, "when they said it, not just when we noticed");

    // A second pass writes no second row.
    await blockersFor(db, { waypointId, now: NOON });
    assert.equal(Number((await db.query(
      `SELECT count(*)::int AS n FROM client_escalations WHERE client_id = $1`, [clientId]
    )).rows[0].n), 1, "first sighting wins; nothing writes a second");

    // The evidence goes. The stop does not.
    await db.query(`DELETE FROM messages WHERE client_id = $1`, [clientId]);
    assert.ok((await blockersFor(db, { waypointId, now: NOON })).includes("escalation"),
      "the stop outlives the message it was found in");
    assert.equal(Number((await db.query(
      `SELECT count(*)::int AS n FROM client_escalations WHERE client_id = $1`, [clientId]
    )).rows[0].n), 1);
    assert.equal(await countMessages(clientId), 0);
  });

test("a permanent stop is no longer INVISIBLE — a person is given the task",
  { skip: !HAS_DB }, async () => {
    /* ROUND FOUR. A reviewer sent one inbound text:
         "that collection agency that keeps calling me is a scam"
       — a client complaining about SOMEBODY ELSE. It matched \\bscam\\b, wrote
       the permanent row, and ended every chase that client will ever have. The
       REVOKE from round three means no code path in the product can lift it,
       and nothing outside src/nudge/ reads client_escalations, so NO SCREEN
       ANYWHERE SHOWED THAT IT HAD HAPPENED.

       The permanence is correct and is not being weakened. What is fixed is the
       silence: a task now lands on a person's board the first time a client is
       stopped. Lifting a mis-fire from inside the application is still
       impossible and is recorded as an open gap, not as fixed. */
    const clientId = await makeClient();
    await inboundMessage(clientId, "that collection agency that keeps calling me is a scam");
    const waypointId = await makeWaypoint(clientId, { dueDaysAgo: 0 });

    assert.ok((await blockersFor(db, { waypointId, now: NOON })).includes("escalation"));

    const tasks = (await db.query(
      `SELECT title, body, assignee_role, source_workflow FROM tasks
        WHERE client_id = $1 AND source_workflow = 'waypoint-nudge-escalation'`,
      [clientId]
    )).rows;
    assert.equal(tasks.length, 1, "somebody is told, exactly once");
    assert.equal(tasks[0].assignee_role, "csm");
    assert.match(tasks[0].title, /Chases stopped/);
    assert.match(tasks[0].body, /scam/,
      "the task names OUR rule, so a human can see a mis-fire for what it is");
    assert.equal(tasks[0].body.includes("that collection agency"), false,
      "and it still does not repeat the client's own sentence");

    /* A second and third pass write no second task, the same way they write no
       second escalation row. */
    await blockersFor(db, { waypointId, now: NOON });
    await blockersFor(db, { waypointId, now: NOON });
    assert.equal(Number((await db.query(
      `SELECT count(*)::int AS n FROM tasks
        WHERE client_id = $1 AND source_workflow = 'waypoint-nudge-escalation'`, [clientId]
    )).rows[0].n), 1, "one client, one escalation, one task — ever");
    assert.equal(await countMessages(clientId), 0, "and still nothing is sent to them");
  });

test("an ordinary client who never threatened us is still chased",
  { skip: !HAS_DB }, async () => {
    /* The other half of the escalation change, and the one that matters for the
       feature existing at all: the scan must not become a blanket stop. A
       client doing exactly what our own product told them to do — file the CFPB
       form — is not a threat. */
    const clientId = await makeClient();
    for (const said of [
      "I filed the CFPB complaint like you said",
      "should I send the attorney general form too?",
      "there is a fraud alert on my file",
      "when is my next call"
    ]) {
      await inboundMessage(clientId, said, new Date(NOON.getTime() - 30 * DAY));
    }
    const waypointId = await makeWaypoint(clientId, { dueDaysAgo: 0 });
    const blockers = await blockersFor(db, { waypointId, now: NOON });
    assert.equal(blockers.includes("escalation"), false, JSON.stringify(blockers));
    assert.equal(Number((await db.query(
      `SELECT count(*)::int AS n FROM client_escalations WHERE client_id = $1`, [clientId]
    )).rows[0].n), 0, "no durable stop was written for a healthy conversation");
  });

/* ── MEDIUM: one person, one message a day ────────────────────────────────── */

test("two client rows on one phone number get ONE text a day, not two",
  { skip: !HAS_DB }, async () => {
    /* The daily cap in 365 counts RECORDS: UNIQUE (client_id, client_local_date).
       A person with two client rows on the same phone is two records, which is
       ordinary in any CRM and is the shape behind the incident where one phone
       received 51 messages. Measured on a scratch database on 2026-09-06 before
       the fix: two rows, one pass, two outbound messages.

       The two spellings differ on purpose — normalisation is the thing being
       proved, not just the constraint. */
    const twinA = await makeClient({ phone: "+15550004000" });
    const twinB = await makeClient({ phone: "+1 (555) 000-4000" });
    await makeWaypoint(twinA, { title: "Upload your ID" });
    await makeWaypoint(twinB, { title: "Upload your ID" });

    const tally = await runNudges(db, { orgId, now: NOON });
    const total = (await countMessages(twinA)) + (await countMessages(twinB));
    assert.equal(total, 1, "one person, one message");
    assert.ok(
      tally.results.some((r) => (r.reasons || []).includes("daily_cap_destination")),
      `the destination cap should be the named reason: ${JSON.stringify(tally.results.map((r) => r.reasons))}`
    );
  });

test("one client with a phone and an email still gets ONE message a day",
  { skip: !HAS_DB }, async () => {
    /* The destination cap is added to the client cap, never instead of it.
       Replacing it would newly allow one person a text AND an email in a day,
       which is more messages — the wrong direction. Step 1 is SMS and step 2 is
       email, so two waypoints at different overdue ages reach for both. */
    const clientId = await makeClient();
    await makeWaypoint(clientId, { key: "upload_id", title: "Upload your ID", dueDaysAgo: 0 });
    await makeWaypoint(clientId, { key: "sign_agreement", title: "Sign the agreement", dueDaysAgo: 3 });
    await runNudges(db, { orgId, now: NOON });
    assert.equal(await countMessages(clientId), 1,
      "one message, whichever two channels were reached for");
  });

/* ── MEDIUM: a crash mid-send must read as unresolved ─────────────────────── */

test("the row says 'claimed' until the send resolves, never 'queued'",
  { skip: !HAS_DB }, async () => {
    /* 365's header describes claim-then-queue with outcome='claimed' meaning
       the send has not resolved. The code INSERTed 'queued' before sendTemplated
       was called, so a pass that died between the two left a row reading exactly
       like a delivered nudge. Measured on a scratch database on 2026-09-06 by
       reading the row from inside the send callback: it read "queued". */
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);
    const [candidate] = await planNudges(db, { orgId, now: NOON });

    let seenMidSend = null;
    const res = await deliverNudge(db, candidate, {
      now: NOON,
      send: async () => {
        seenMidSend = (await db.query(
          `SELECT outcome, client_local_date, destination_key
             FROM waypoint_nudges WHERE waypoint_id = $1 AND step = 1`,
          [waypointId]
        )).rows[0];
        return { sent: true, messageId: null };
      }
    });

    assert.equal(seenMidSend.outcome, "claimed",
      "in flight, the row must not claim a message went out");
    assert.ok(seenMidSend.client_local_date,
      "it still holds the client's day — not knowing is not a reason to send a second one");
    assert.ok(seenMidSend.destination_key, "and the destination it was aimed at");
    assert.equal(res.action, "queued");
    assert.equal((await nudgeRows(waypointId))[0].outcome, "queued",
      "once the send returns, the claim resolves");
  });

test("a claim left in flight is never retried, and holds the day",
  { skip: !HAS_DB }, async () => {
    /* The honest cost of claim-before-queue, pinned rather than described. A
       process that dies mid-send leaves 'claimed'; the step is spent and the
       client does not get a second attempt. Simulated by claiming through a
       send that throws a non-Error and then re-running the whole pass. */
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);
    await db.query(
      `INSERT INTO waypoint_nudges (org_id, client_id, waypoint_id, step, kind, channel,
         template_key, outcome, idempotency_key, client_local_date, destination_key)
       VALUES ($1,$2,$3,1,'client_message','sms','SMS-WAYPOINT-DUE','claimed',$4,
               '2026-09-10'::date,'5555551000')`,
      [orgId, clientId, waypointId, idempotencyKeyFor(waypointId, 1)]
    );
    const tally = await runNudges(db, { orgId, now: NOON });
    assert.equal(await countMessages(clientId), 0, "the spent rung is not retried");
    assert.equal(tally.queued, 0);
    const rows = await nudgeRows(waypointId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, "claimed", "it stays unresolved rather than becoming 'queued'");
  });

/* ── LOW: a missing template must be loud, and must name itself ───────────── */

test("a missing template names the key it is missing, not just a count",
  { skip: !HAS_DB }, async () => {
    /* db/seed/025 writes the three nudge templates for every org that exists
       when it runs, so an org created afterwards has none and every rung
       resolves as template_pending. The COUNT was already in the tally; WHICH
       key was missing was not, so finding it was a hunt. */
    const clientId = await makeClient();
    await makeWaypoint(clientId);
    const saved = (await db.query(
      `SELECT body FROM message_templates WHERE org_id = $1 AND template_key = 'SMS-WAYPOINT-DUE'`,
      [orgId]
    )).rows[0].body;
    try {
      await db.query(
        `UPDATE message_templates SET compliance_passed = false
          WHERE org_id = $1 AND template_key = 'SMS-WAYPOINT-DUE'`,
        [orgId]
      );
      const tally = await runNudges(db, { orgId, now: NOON });
      assert.equal(tally.template_pending, 1);
      assert.deepEqual(tally.template_pending_keys, ["SMS-WAYPOINT-DUE"]);
      assert.equal(await countMessages(clientId), 0);
    } finally {
      await db.query(
        `UPDATE message_templates SET compliance_passed = true, body = $2
          WHERE org_id = $1 AND template_key = 'SMS-WAYPOINT-DUE'`,
        [orgId, saved]
      );
    }
  });

/* ── BLOCKER, ROUND THREE: A PERMANENTLY STOPPED CLIENT MAY NOT HOLD A SLOT ──

   The round-two fix anti-joined the currently-due rung against waypoint_nudges.
   That catches a waypoint that has ALREADY WRITTEN a row. It does not catch the
   failing case, which is a waypoint that never writes a row at all: blockersFor
   refuses it, deliverNudge returns "skipped" and writes nothing, so the row
   stays not_started, stays overdue, stays the oldest, sorts FIRST, and holds a
   slot on every pass for ever.

   Both reviewers reproduced it independently and both scenarios are pinned
   below, at the exact size they used — 200, which is DEFAULT_LIMIT. */

const starvationScenario = async (setup) => {
  const stopped = [];
  for (let i = 0; i < 200; i += 1) {
    const c = await makeClient();
    /* 100+ days overdue so every one of these sorts AHEAD of the live client. */
    const w = await makeWaypoint(c, { dueDaysAgo: 100 + i, title: `Stopped ${i}` });
    await setup(c, w, i);
    stopped.push(w);
  }
  const live = await makeClient();
  const liveWp = await makeWaypoint(live, { dueDaysAgo: 0, title: "Link your business bank account" });
  return { stopped, live, liveWp };
};

test("200 CANCELLED programs do NOT hold the budget against one live client",
  { skip: !HAS_DB }, async () => {
    /* Reviewer A's scenario, verbatim. Before the fix, on a scratch Postgres 16.14
       in this worktree on 2026-09-06:
         candidates: 200 includes the live one? false
         tally considered 200 queued 0 skipped 200
         messages to the live client: 0 / next day: same, total 0 */
    const { stopped, live, liveWp } = await starvationScenario(async (c) => {
      await db.query(
        `INSERT INTO repair_programs (org_id, client_id, program, rounds_cap, price_total, status)
         VALUES ($1,$2,'full',6,1200.00,'cancelled')`,
        [orgId, c]
      );
    });

    const plan = await planNudges(db, { orgId: null, now: NOON });
    assert.ok(plan.some((c) => c.waypointId === liveWp),
      `the live waypoint must be a candidate; got ${plan.length} candidates`);
    assert.equal(plan.some((c) => stopped.includes(c.waypointId)), false,
      "a cancelled program's waypoint may not occupy a slot");

    const tally = await runNudges(db, { orgId: null, now: NOON });
    assert.equal(tally.budget_exhausted, false, "the budget must no longer be full of dead rows");
    assert.equal(await countMessages(live), 1, "the live client gets their message");
    assert.equal(tally.queued, 1);
  });

test("200 clients who texted STOP do NOT hold the budget against one live client",
  { skip: !HAS_DB }, async () => {
    /* Reviewer B's scenario, verbatim. Opt-out is the most common permanent stop
       in any messaging product and it is the one that will actually happen.
       Before the fix, same worktree, same database:
         [nudge/run] budget full: 200 of 200 slots used, 1 eligible waypoint(s)
         not reached this pass
         pass 1: candidates 200, live included? false, queued 0,
         budget_exhausted true, messages to live client 0 */
    const { stopped, live, liveWp } = await starvationScenario(async (c) => {
      await recordOptOut(db, c, orgId, "sms", "inbound_keyword");
    });

    const plan = await planNudges(db, { orgId: null, now: NOON });
    assert.ok(plan.some((c) => c.waypointId === liveWp),
      `the live waypoint must be a candidate; got ${plan.length} candidates`);
    assert.equal(plan.some((c) => stopped.includes(c.waypointId)), false,
      "somebody who said STOP may not occupy a slot");

    const tally = await runNudges(db, { orgId: null, now: NOON });
    assert.equal(tally.budget_exhausted, false);
    assert.equal(await countMessages(live), 1, "the live client gets their message");
    assert.equal(tally.queued, 1);
  });

const checkoutStarvation = async (ageDays) => {
  /* The reviewers' scenario, at their sizes: 200 clients each with an
     awaiting_payment request minted `ageDays` ago against a waypoint the same
     number of days overdue, plus one freshly overdue live client. */
  const stopped = [];
  for (let i = 0; i < 200; i += 1) {
    const c = await makeClient();
    const w = await makeWaypoint(c, { dueDaysAgo: ageDays + i, title: `Unpaid ${i}` });
    await paidRequest(c, w, {
      status: "awaiting_payment",
      requestedDaysAgo: ageDays + i,
      expiresInDays: -(ageDays + i - 7)
    });
    stopped.push(w);
  }
  const live = await makeClient();
  const liveWp = await makeWaypoint(live, { dueDaysAgo: 0, title: "Link your business bank account" });
  return { stopped, live, liveWp };
};

for (const ageDays of [200, 400]) {
  test(`an abandoned checkout link at ${ageDays} days does not hold a slot for ever`,
    { skip: !HAS_DB }, async () => {
      /* BEFORE THE FIX, measured by a reviewer and reproduced in this worktree
         on a scratch Postgres 16.14 on 2026-09-06:
             today          -> candidates 200, live in plan FALSE,
                               messages to live client 0, budget_exhausted true
             one year later -> candidates 200, live in plan FALSE,
                               messages to live client 0, budget_exhausted true
             waypoint_nudges rows ever written for those 200: 0
         The last line is why round two's anti-join could not help: the rows
         never wrote anything to anti-join against.

         AFTER THE FIX the 200 are not a dead weight at all — their invitations
         are long dead, so they are REAL work again and each one runs to the end
         of its ladder in a single pass (200+ days overdue is rung 4, a person).
         That drains them permanently, and the live client is reached on the
         very next pass. One pass, versus never. */
      const { stopped, live, liveWp } = await checkoutStarvation(ageDays);

      const pass1 = await runNudges(db, { orgId: null, now: NOON });
      assert.equal(pass1.staff_tasks, 200,
        "every abandoned one is finished off rather than left to sit for ever");
      assert.equal(pass1.not_reached, 1, "and the pass says out loud who it could not reach");

      /* The whole point: they are gone from the queue afterwards, permanently. */
      const plan2 = await planNudges(db, { orgId: null, now: NOON });
      assert.equal(plan2.some((c) => stopped.includes(c.waypointId)), false,
        "an abandoned checkout may not hold a slot on the next pass");
      assert.ok(plan2.some((c) => c.waypointId === liveWp), "the live client is now in the plan");

      const pass2 = await runNudges(db, { orgId: null, now: new Date(NOON.getTime() + 60 * 60 * 1000) });
      assert.equal(pass2.budget_exhausted, false);
      assert.equal(pass2.queued, 1);
      assert.equal(await countMessages(live), 1, "the live client gets their message");
    });
}

/* ── ROUND FOUR: THE CHECKOUT LINK THAT HELD A SLOT FOR EVER ───────────────
   ═════════════════════════════════════════════════════════════════════════

   `payment_in_flight` was classified TEMPORARY on the stated ground that "a
   checkout link is out. It expires; then we chase again." NOTHING IN THIS
   CODEBASE EVER EXPIRED ONE — no expiry column, nothing set a deadline at mint,
   and no file under src/workflows/ even named paid_service_requests. So the
   hold was permanent while filed as temporary, and it held a slot in a
   platform-wide budget for ever.

   Both halves are pinned below: a LIVE link costs no slot and sends nothing,
   and an EXPIRED one is chased again exactly as the sentence always promised. */

test("a LIVE checkout link holds NO slot, and still sends nothing",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId, { dueDaysAgo: 1 });
    await paidRequest(clientId, waypointId, { status: "awaiting_payment", expiresInDays: 7 });

    const held = await planNudges(db, { orgId, now: NOON });
    assert.equal(held.some((c) => c.waypointId === waypointId), false,
      "a live hold costs no slot — the gate would refuse it a moment later anyway");

    /* The gate is still the authority, and it still says no. A stale plan that
       somehow carried this row must produce nothing. */
    const blockers = await blockersFor(db, { waypointId, now: NOON });
    assert.deepEqual(blockers, ["payment_in_flight"]);
    const out = await deliverNudge(db, {
      waypointId, orgId, clientId, key: "k", title: "t", detail: null,
      dueAt: overdueBy(1), step: 1, kind: "client_message", channel: "sms",
      templateKey: "SMS-WAYPOINT-DUE"
    }, { now: NOON });
    assert.equal(out.action, "skipped");
    assert.deepEqual(out.reasons, ["payment_in_flight"]);
    assert.equal(await countMessages(clientId), 0);
  });

test("an EXPIRED checkout link stops holding the waypoint, and the chase resumes",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId, { dueDaysAgo: 1 });
    /* Minted eight days before NOON, so its seven-day stamp has passed. */
    await paidRequest(clientId, waypointId, {
      status: "awaiting_payment", expiresInDays: -1, requestedDaysAgo: 8
    });

    assert.deepEqual(await blockersFor(db, { waypointId, now: NOON }), [],
      "an invitation nobody took is not a reason to stay quiet for ever");
    const plan = await planNudges(db, { orgId, now: NOON });
    assert.ok(plan.some((c) => c.waypointId === waypointId));

    const tally = await runNudges(db, { orgId, now: NOON });
    assert.equal(tally.queued, 1, "the chase resumes, exactly as the comment always promised");
    assert.equal(await countMessages(clientId), 1);
  });

test("the expiry is a fact in the data, not only in the nudge query",
  { skip: !HAS_DB }, async () => {
    /* THE COLUMN IS THE ENFORCEMENT. db/migrations/370 refuses a row that sits
       at awaiting_payment without a deadline, so a future writer cannot
       reintroduce an unbounded hold by forgetting to stamp one. */
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId, { dueDaysAgo: 1 });
    const accountId = await makeClientAccount(clientId);
    await assert.rejects(
      () => db.query(
        `INSERT INTO paid_service_requests
           (org_id, client_id, waypoint_id, service_kind, requested_by_kind,
            requested_by_account_id, status, price_components, price_total_cents)
         VALUES ($1,$2,$3,'dispute_round','client',$4,'awaiting_payment',
                 '[{"code":"round_base","label":"Dispute round","quantity":1,"unit_cents":10000,"amount_cents":10000}]'::jsonb,
                 10000)`,
        [orgId, clientId, waypointId, accountId]
      ),
      (err) => err.code === "23514"
        && /awaiting_needs_expiry/.test(String(err.constraint || err.message)),
      "an awaiting_payment row with no deadline must be refused by the database"
    );

    /* And the sweep moves the row off that status when the deadline passes, so
       'awaiting_payment for ever' stops being a state the table can hold. */
    await paidRequest(clientId, waypointId, {
      status: "awaiting_payment", expiresInDays: -1, requestedDaysAgo: 8
    });
    const swept = await expireStaleCheckouts(db, { now: NOON });
    assert.equal(swept.closed, 1);
    const row = (await db.query(
      `SELECT status, state_reason FROM paid_service_requests WHERE waypoint_id = $1`,
      [waypointId]
    )).rows[0];
    assert.equal(row.status, "cancelled");
    assert.equal(row.state_reason, "checkout_expired");
  });

test("a REFUNDED paid request means we did NOT do it, so the client is still chased",
  { skip: !HAS_DB }, async () => {
    /* 'refunded' used to sit in BOUGHT_STATUSES, so a client whose money had
       gone back was treated for ever as "they paid us to handle this one" and
       was never chased about a task that is theirs again. */
    const refunded = await makeClient();
    const refundedWp = await makeWaypoint(refunded, { dueDaysAgo: 1 });
    await paidRequest(refunded, refundedWp, { status: "refunded", paid: true, expiresInDays: null });

    const paid = await makeClient();
    const paidWp = await makeWaypoint(paid, { dueDaysAgo: 1 });
    await paidRequest(paid, paidWp, { status: "paid", paid: true, expiresInDays: null });

    assert.deepEqual(await blockersFor(db, { waypointId: refundedWp, now: NOON }), [],
      "money given back is not work delivered");
    assert.deepEqual(await blockersFor(db, { waypointId: paidWp, now: NOON }),
      ["paid_alternative_bought"], "a real purchase still stops the chase");

    const plan = await planNudges(db, { orgId, now: NOON });
    assert.ok(plan.some((c) => c.waypointId === refundedWp));
    assert.equal(plan.some((c) => c.waypointId === paidWp), false);

    await runNudges(db, { orgId, now: NOON });
    assert.equal(await countMessages(refunded), 1);
    assert.equal(await countMessages(paid), 0);
  });

test("every waypoint the SQL removes is one the gate would have refused",
  { skip: !HAS_DB }, async () => {
    /* THE INVARIANT THAT MAKES THE SQL EXCLUSIONS SAFE. planNudges is an
       optimisation of the queue and never a substitute for blockersFor. If the
       two ever disagree — if the SQL drops a row the gate would have permitted —
       that is a silently missed nudge, and this fails. */
    const permanentlyStopped = [];

    const stopped = async (label, setup) => {
      const c = await makeClient();
      const w = await makeWaypoint(c, { dueDaysAgo: 1, title: label });
      await setup(c, w);
      permanentlyStopped.push([label, w]);
    };

    await stopped("opted out", async (c) => recordOptOut(db, c, orgId, "sms"));
    await stopped("opted out by email", async (c) => recordOptOut(db, c, orgId, "email"));
    await stopped("program complete", async (c) => db.query(
      `INSERT INTO repair_programs (org_id, client_id, program, rounds_cap, price_total, status)
       VALUES ($1,$2,'full',6,1200.00,'complete')`, [orgId, c]));
    await stopped("program cancelled", async (c) => db.query(
      `INSERT INTO repair_programs (org_id, client_id, program, rounds_cap, price_total, status)
       VALUES ($1,$2,'full',6,1200.00,'cancelled')`, [orgId, c]));
    await stopped("escalated", async (c) => db.query(
      `INSERT INTO client_escalations (org_id, client_id, matched_pattern)
       VALUES ($1,$2,'\\blawyer\\b')`, [orgId, c]));
    await stopped("paid the alternative", async (c, w) => {
      const a = await makeClientAccount(c);
      await db.query(
        `INSERT INTO paid_service_requests
           (org_id, client_id, waypoint_id, service_kind, requested_by_kind,
            requested_by_account_id, status, price_components, price_total_cents,
            amount_paid_cents, paid_at)
         VALUES ($1,$2,$3,'dispute_round','client',$4,'paid',
                 '[{"code":"round_base","label":"Dispute round","quantity":1,"unit_cents":10000,"amount_cents":10000}]'::jsonb,
                 10000, 10000, now())`,
        [orgId, c, w, a]);
    });
    await stopped("already replied", async (c, w) => {
      /* The nudge is dated a day BEFORE the reply, on this test's own clock.
         It used to take the column default (the real now()), which put it
         before NOON (2026-09-10) only while the wall clock was earlier than
         that. From 2026-09-11 on, the nudge was dated after the reply, so the
         gate correctly saw no reply and this test failed (CI, 2026-10-05). */
      await db.query(
        `INSERT INTO waypoint_nudges (org_id, client_id, waypoint_id, step, kind, channel,
           template_key, outcome, idempotency_key, created_at)
         VALUES ($1,$2,$3,1,'client_message','sms',NULL,'queued',$4,$5::timestamptz)`,
        [orgId, c, w, idempotencyKeyFor(w, 1), new Date(NOON.getTime() - DAY).toISOString()]);
      await inboundMessage(c, "ok I did it", NOON);
    });
    await stopped("ladder exhausted", async (c, w) => {
      await db.query(
        `INSERT INTO waypoint_nudges (org_id, client_id, waypoint_id, step, kind, channel,
           template_key, outcome, idempotency_key)
         VALUES ($1,$2,$3,4,'staff_task',NULL,NULL,'staff_task',$4)`,
        [orgId, c, w, idempotencyKeyFor(w, 4)]);
    });
    await stopped("blocked", async (c, w) => db.query(
      `UPDATE client_waypoints SET state = 'blocked' WHERE id = $1`, [w]));
    await stopped("done", async (c, w) => db.query(
      `UPDATE client_waypoints SET state = 'done', completed_at = now() WHERE id = $1`, [w]));
    await stopped("ours, not theirs", async (c, w) => db.query(
      `UPDATE client_waypoints SET owner_kind = 'fundhub' WHERE id = $1`, [w]));

    const plan = await planNudges(db, { orgId, now: NOON });
    const planned = new Set(plan.map((c) => c.waypointId));

    for (const [label, waypointId] of permanentlyStopped) {
      assert.equal(planned.has(waypointId), false,
        `"${label}" is a permanent stop and must not hold a slot`);
      /* And the other direction: the gate agrees it is a stop, so removing it
         from the queue cannot have lost a sendable nudge. */
      const reasons = await blockersFor(db, { waypointId, now: NOON });
      assert.ok(reasons.length > 0,
        `"${label}" was removed by the SQL but the gate would have permitted it — ` +
        `that is a silently missed nudge`);
    }
  });

test("a matching message sitting exactly AT the old read mark is still found",
  { skip: !HAS_DB }, async () => {
    /* THE HIGH THIS PINS, and it is the reviewer's exact scenario. Round two
       replaced the 200-message window with a read watermark. The watermark
       advanced to max(created_at) over EVERY inbound row, and the next pass read
       with a strict "created_at > mark" — so a threat whose created_at landed on
       the mark was invisible for ever. Measured in this worktree on 2026-09-06,
       before the fix:
         scan 1 -> false; escalation row present in messages? 1
         scan 2 -> false; hasEscalation -> false
         blockersFor -> [] ; deliverNudge -> queued
         Messages the lawyer-threat client just got: 1
       The mark is gone entirely. This is what proves it. */
    const clientId = await makeClient();
    const markAt = new Date(NOON.getTime() - 5 * DAY);
    for (let i = 10; i > 0; i -= 1) {
      await inboundMessage(clientId, `ordinary message ${i}`, new Date(markAt.getTime() - i * 1000));
    }
    await inboundMessage(clientId, "thanks, will do", markAt);

    /* First look: nothing to find. Whatever bookkeeping this leaves behind must
       not be able to hide what comes next. */
    assert.equal(await scanForEscalation(db, { orgId, clientId }), false);

    /* The threat lands at the SAME INSTANT as the newest row already examined. */
    await inboundMessage(clientId, "my lawyer will be in touch", markAt);

    assert.equal(await scanForEscalation(db, { orgId, clientId }), true,
      "a threat at the boundary must still be found");
    assert.equal(await hasEscalation(db, clientId), true);

    const waypointId = await makeWaypoint(clientId, { dueDaysAgo: 1 });
    const reasons = await blockersFor(db, { waypointId, now: NOON });
    assert.ok(reasons.includes("escalation"), JSON.stringify(reasons));
    const tally = await runNudges(db, { orgId, now: NOON });
    assert.equal(tally.queued, 0);
    assert.equal(await countMessages(clientId), 0,
      "a message saying a lawyer is involved must never be missed because a mark moved past it");
  });

test("a pass over an empty org does nothing and does not throw",
  { skip: !HAS_DB }, async () => {
    const tally = await runNudges(db, { orgId, now: NOON });
    assert.equal(tally.considered, 0);
    assert.equal(tally.queued, 0);
    assert.equal(tally.failed, 0);
  });
