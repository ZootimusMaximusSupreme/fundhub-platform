/* The message-tests report against a real Postgres: who is counted, who is left out, and what reached means.
 *
 * WHY A DATABASE TEST. experiment-report.test.mjs proves the maths and the words. The counting is the SQL,
 * and the SQL is where a demo person, a test address, another company's row or a message that never left
 * would be counted as a customer. A fake that answers the way its author expected proves the author.
 *
 * THE FIXTURE (nobook-proof, the test starts at S = 2026-11-10 16:00 UTC, the first version B message):
 *   early1   version A two days BEFORE S            -> earlier (not compared), though they booked
 *   a1       A text at S+1h, booked at S+1d         -> A, reached
 *   a2       A email at S+2h, never booked          -> A  (three wrong events beside it: another company's
 *                                                       booking, a booking.rescheduled, a demo booking)
 *   a3       A text + A email at S+3h, booked at S+6d23h -> A, reached (inside 7 days of S+3h)
 *   a4       A at S+4h, booked 7 days and a minute later -> A, not reached (a minute too late)
 *   a5       A at S+5h, booking event BEFORE the message -> A, not reached
 *   a6       A at S+6h, still queued                -> A, not reached (a queued message counts)
 *   b1       B text at S                            -> B, reached
 *   b2       B text + B email at S+1h               -> B, not reached
 *   b3       B email at S+2h, booked at S+3d        -> B, reached
 *   b4       A email at S+2h (B was not ready) then B email at S+3h, booked at S+4d -> B, reached
 *   LEFT OUT: a demo client, a +sim address, an example.com address, a client in another company, a
 *   message that failed / was blocked / bounced, an inbound message, a message under another key.
 *
 * Every row is made by the test, in companies of its own, and removed after. Nothing is sent.
 * SKIPS unless DATABASE_URL is a loopback scratch or CI database. A skip is not a pass.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { experimentReport } from "./experiment-report.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";

const HAS_DB = isLocalScratchDatabaseUrl(process.env.DATABASE_URL);
const SLUGS = ["ab-report-pg-main", "ab-report-pg-other", "ab-report-pg-big"];
const NONCE = `${process.pid}-${Date.now()}`;

const S = new Date("2026-11-10T16:00:00Z");
const at = (ms) => new Date(S.getTime() + ms);
const H = 3600 * 1000;
const D = 24 * H;
const MIN = 60 * 1000;

let orgId;
let otherOrgId;
let bigOrgId;
let seq = 0;
const who = {};

async function client(org, tag, { demo = false, email } = {}) {
  seq += 1;
  return (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, is_demo) VALUES ($1,$2,'Rae','Sample',$3) RETURNING id`,
    [org, email ?? `${tag}.${NONCE}.${seq}@sample-leads.com`, demo]
  )).rows[0].id;
}

async function message(org, clientId, key, when, { status = "sent", direction = "outbound", demo = false } = {}) {
  seq += 1;
  const channel = key.startsWith("SMS-") ? "sms" : "email";
  // A queued row gets a hold time a month out. The dispatcher (dispatchDue with no company, as other messaging
  // tests call it) claims queued rows from every company; one of ours must never be due while they run.
  await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key, rendered_body, provider, provider_ref, status, to_address, created_at, is_demo, scheduled_at)
     VALUES ($1,$2,$3,$4,$5,'words','internal',$6,$7,'x',$8,$9, CASE WHEN $7 = 'queued' THEN now() + interval '30 days' END)`,
    [org, clientId, direction, channel, key, `ref-${NONCE}-${seq}`, status, when, demo]
  );
}

async function event(org, clientId, name, when, { demo = false } = {}) {
  await db.query(
    `INSERT INTO events (org_id, name, client_id, payload, created_at, is_demo) VALUES ($1,$2,$3,'{}',$4,$5)`,
    [org, name, clientId, when, demo]
  );
}

async function purge() {
  if (!HAS_DB) return;
  const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = ANY($1)`, [SLUGS])).rows.map((r) => r.id);
  if (orgs.length) {
    await db.query(`DELETE FROM messages WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM events WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM clients WHERE org_id = ANY($1)`, [orgs]);
  }
  await db.query(`DELETE FROM orgs WHERE slug = ANY($1)`, [SLUGS]);
}

const NOW_AFTER_ALL = new Date(S.getTime() + 40 * D);
const report = async (org, now = NOW_AFTER_ALL) => {
  const tests = await experimentReport(db, { orgId: org, now });
  return Object.fromEntries(tests.map((t) => [t.name, t]));
};

before(async () => {
  if (!HAS_DB) return;
  await purge();
  [orgId, otherOrgId, bigOrgId] = [];
  for (const [i, slug] of SLUGS.entries()) {
    const id = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1,$2) RETURNING id`, [slug, `AB Report ${slug}`])).rows[0].id;
    if (i === 0) orgId = id; else if (i === 1) otherOrgId = id; else bigOrgId = id;
  }

  // ---- the nobook-proof fixture, in the main company ---------------------------------------------------
  who.early1 = await client(orgId, "early1");
  await message(orgId, who.early1, "SMS-NOBOOK-02", at(-2 * D));
  await event(orgId, who.early1, "booking.created", at(-2 * D + H));

  who.a1 = await client(orgId, "a1");
  await message(orgId, who.a1, "SMS-NOBOOK-02", at(1 * H));
  await event(orgId, who.a1, "booking.created", at(1 * D));

  who.a2 = await client(orgId, "a2");
  await message(orgId, who.a2, "EMAIL-NOBOOK-02", at(2 * H));
  await event(otherOrgId, who.a2, "booking.created", at(1 * D));             // another company's row
  await event(orgId, who.a2, "booking.rescheduled", at(1 * D));              // not the goal
  await event(orgId, who.a2, "booking.created", at(1 * D), { demo: true });  // a demo row

  who.a3 = await client(orgId, "a3");
  await message(orgId, who.a3, "SMS-NOBOOK-02", at(3 * H));
  await message(orgId, who.a3, "EMAIL-NOBOOK-02", at(3 * H + 1000));
  await event(orgId, who.a3, "booking.created", at(6 * D + 23 * H));

  who.a4 = await client(orgId, "a4");
  await message(orgId, who.a4, "SMS-NOBOOK-02", at(4 * H));
  await event(orgId, who.a4, "booking.created", at(4 * H + 7 * D + MIN));

  who.a5 = await client(orgId, "a5");
  await message(orgId, who.a5, "SMS-NOBOOK-02", at(5 * H));
  await event(orgId, who.a5, "booking.created", at(1 * H));

  who.a6 = await client(orgId, "a6");
  await message(orgId, who.a6, "EMAIL-NOBOOK-02", at(6 * H), { status: "queued" });

  who.b1 = await client(orgId, "b1");
  await message(orgId, who.b1, "SMS-NOBOOK-02-B", at(0));
  await event(orgId, who.b1, "booking.created", at(2 * D));

  who.b2 = await client(orgId, "b2");
  await message(orgId, who.b2, "SMS-NOBOOK-02-B", at(1 * H));
  await message(orgId, who.b2, "EMAIL-NOBOOK-02-B", at(1 * H + 1000));

  who.b3 = await client(orgId, "b3");
  await message(orgId, who.b3, "EMAIL-NOBOOK-02-B", at(2 * H));
  await event(orgId, who.b3, "booking.created", at(3 * D));

  who.b4 = await client(orgId, "b4");
  await message(orgId, who.b4, "EMAIL-NOBOOK-02", at(2 * H));
  await message(orgId, who.b4, "EMAIL-NOBOOK-02-B", at(3 * H));
  await event(orgId, who.b4, "booking.created", at(4 * D));

  // ---- people who must not be counted ------------------------------------------------------------------
  const demo = await client(orgId, "demo", { demo: true });
  await message(orgId, demo, "SMS-NOBOOK-02-B", at(1 * H));
  await event(orgId, demo, "booking.created", at(2 * H));
  const sim = await client(orgId, "sim", { email: `lead+sim-${NONCE}@sample-leads.com` });
  await message(orgId, sim, "SMS-NOBOOK-02", at(1 * H));
  const example = await client(orgId, "example", { email: `person.${NONCE}@example.com` });
  await message(orgId, example, "SMS-NOBOOK-02-B", at(1 * H));
  const company = await client(orgId, "company", { email: `someone.${NONCE}@fundhub.ai` });
  await message(orgId, company, "SMS-NOBOOK-02", at(1 * H));
  const demoMessage = await client(orgId, "demomsg");
  await message(orgId, demoMessage, "SMS-NOBOOK-02", at(1 * H), { demo: true });
  for (const status of ["failed", "blocked", "bounced"]) {
    const never = await client(orgId, status);
    await message(orgId, never, "EMAIL-NOBOOK-02", at(1 * H), { status });
    await message(orgId, never, "EMAIL-NOBOOK-02-B", at(1 * H), { status });
  }
  const inbound = await client(orgId, "inbound");
  await message(orgId, inbound, "SMS-NOBOOK-02", at(1 * H), { direction: "inbound", status: "received" });
  const otherKey = await client(orgId, "otherkey");
  await message(orgId, otherKey, "SMS-NOBOOK-03", at(1 * H));
  await message(orgId, otherKey, "SMS-NOBOOK-01", at(1 * H));
  // The other company has its own two people, one in each version.
  const elsewhere = await client(otherOrgId, "elsewhere");
  await message(otherOrgId, elsewhere, "SMS-NOBOOK-02-B", at(1 * H));
  await event(otherOrgId, elsewhere, "booking.created", at(3 * H));
  const elsewhere2 = await client(otherOrgId, "elsewhere2");
  await message(otherOrgId, elsewhere2, "SMS-NOBOOK-02", at(2 * H));

  // ---- resume-proof in the main company: version A only, so the test has not started --------------------
  who.r1 = await client(orgId, "r1");
  await message(orgId, who.r1, "SMS-S02-RESUME-2", at(1 * H));
  who.r2 = await client(orgId, "r2");
  await message(orgId, who.r2, "EMAIL-S02-RESUME-2", at(2 * H));
  await event(orgId, who.r2, "survey.completed", at(1 * D));
  // the wrong goal for this test: a booking is not a finished survey
  await event(orgId, who.r1, "booking.created", at(1 * D));
});

after(async () => {
  if (!HAS_DB) return;
  await purge();
  await close();
});

test("each version's people are counted once, and reached means the goal inside the window", { skip: !HAS_DB }, async () => {
  const t = (await report(orgId))["nobook-proof"];
  assert.deepEqual(t.arms.A, { people: 6, reached: 2, waiting: 0 }, "a1..a6; a1 and a3 booked in time");
  assert.deepEqual(t.arms.B, { people: 4, reached: 3, waiting: 0 }, "b1..b4; b4 had an A message first and still counts once, in B");
  assert.equal(t.earlier_people, 1, "early1 got A before the first B and is not compared");
  assert.equal(t.started_at, S.toISOString(), "the test starts at the first B message");
  assert.equal(t.goal, "booking.created");
  assert.equal(t.window_days, 7);
  assert.equal(t.name, "nobook-proof");
});

test("the verdict reads the same numbers", { skip: !HAS_DB }, async () => {
  const t = (await report(orgId))["nobook-proof"];
  assert.equal(t.verdict.winner, null);
  assert.equal(t.verdict.p, null, "under 30 a side, no test is made");
  assert.equal(t.verdict.text, "B is ahead: 3 of 4 booked (75%) vs 2 of 6 (33%). Not enough people yet to call it.");
});

test("a demo client, a test address, a message that never reached anyone, another company and another key are left out", { skip: !HAS_DB }, async () => {
  const t = (await report(orgId))["nobook-proof"];
  // If any of the left-out rows leaked in, one of these totals would be higher.
  assert.equal(t.arms.A.people + t.arms.B.people, 10);
  const other = (await report(otherOrgId))["nobook-proof"];
  assert.deepEqual(other.arms.A, { people: 1, reached: 0, waiting: 0 }, "the other company sees only its own two people");
  assert.deepEqual(other.arms.B, { people: 1, reached: 1, waiting: 0 });
  assert.equal(other.earlier_people, 0);
});

test("a test whose version B has not gone out is not started, and compares nothing", { skip: !HAS_DB }, async () => {
  const t = (await report(orgId))["resume-proof"];
  assert.deepEqual(t.arms, { A: { people: 0, reached: 0, waiting: 0 }, B: { people: 0, reached: 0, waiting: 0 } });
  assert.equal(t.earlier_people, 2, "the two who got A are held apart");
  assert.equal(t.started_at, null);
  assert.equal(t.verdict.winner, null);
  assert.equal(t.verdict.text,
    "Version B has not gone out yet, so there is nothing to compare. " +
    "The 2 people who got version A so far are not counted; the count starts when B goes out.");
});

test("a company with no messages in the test gets zeros and a plain sentence", { skip: !HAS_DB }, async () => {
  const empty = await report(bigOrgId);
  for (const name of ["resume-proof", "nobook-proof"]) {
    assert.deepEqual(empty[name].arms, { A: { people: 0, reached: 0, waiting: 0 }, B: { people: 0, reached: 0, waiting: 0 } });
    assert.equal(empty[name].earlier_people, 0);
    assert.equal(empty[name].verdict.text, "Version B has not gone out yet, so there is nothing to compare.");
  }
});

test("people whose days are not over are counted as waiting, by the clock handed in", { skip: !HAS_DB }, async () => {
  // At S+5d every first message (S .. S+6h, early1 aside) is inside its 7 days.
  const soon = (await report(orgId, at(5 * D)))["nobook-proof"];
  assert.deepEqual([soon.arms.A.waiting, soon.arms.B.waiting], [6, 4]);
  assert.match(soon.verdict.text, /10 of these 10 people still have days left in their 7 days/);
  // At S+7d+2.5h the people first messaged by S+2.5h have run out of days:
  // a1 (S+1h), a2 (S+2h), b1 (S), b2 (S+1h), b3 (S+2h), b4 (first at S+2h). Left waiting: a3, a4, a5, a6.
  const later = (await report(orgId, at(7 * D + 2.5 * H)))["nobook-proof"];
  assert.deepEqual([later.arms.A.waiting, later.arms.B.waiting], [4, 0]);
  // The counts of people and of reached do not move with the clock.
  assert.deepEqual([later.arms.A.people, later.arms.A.reached, later.arms.B.people, later.arms.B.reached], [6, 2, 4, 3]);
});

test("the report reads, it does not write", { skip: !HAS_DB }, async () => {
  const count = async () => (await db.query(
    `SELECT (SELECT count(*) FROM messages WHERE org_id = $1) AS m, (SELECT count(*) FROM events WHERE org_id = $1) AS e,
            (SELECT count(*) FROM clients WHERE org_id = $1) AS c, (SELECT count(*) FROM message_templates WHERE org_id = $1) AS t`,
    [orgId])).rows[0];
  const before = await count();
  await report(orgId);
  assert.deepEqual(await count(), before);

  // And the database itself refuses a write from the connection the script uses.
  const conn = await (await import("../db.mjs")).pool().connect();
  try {
    await conn.query("BEGIN READ ONLY");
    await experimentReport(conn, { orgId, now: NOW_AFTER_ALL });
    await assert.rejects(conn.query(`INSERT INTO events (org_id, name, payload) VALUES ($1,'x','{}')`, [orgId]), /read-only/);
  } finally {
    await conn.query("ROLLBACK");
    conn.release();
  }
});

test("with 30 or more a side a clear gap names a winner, and a small one does not", { skip: !HAS_DB }, async () => {
  // nobook-proof: 35 in A (10 booked) against 36 in B (22 booked). The test starts at S.
  const make = async (n, reachedN, key, offsetMs, goal) => {
    for (let i = 0; i < n; i += 1) {
      const id = await client(bigOrgId, `big${key}${i}`);
      await message(bigOrgId, id, key, at(offsetMs + i * MIN));
      if (i < reachedN) await event(bigOrgId, id, goal, at(offsetMs + i * MIN + 1 * D));
    }
  };
  await make(36, 22, "SMS-NOBOOK-02-B", 0, "booking.created");
  await make(35, 10, "SMS-NOBOOK-02", 1 * H, "booking.created");
  // resume-proof: 31 in A (12 finished) against 30 in B (13 finished): enough people, no gap worth the name.
  await make(30, 13, "EMAIL-S02-RESUME-2-B", 0, "survey.completed");
  await make(31, 12, "EMAIL-S02-RESUME-2", 1 * H, "survey.completed");

  const r = await report(bigOrgId);
  const win = r["nobook-proof"];
  assert.deepEqual(win.arms.A, { people: 35, reached: 10, waiting: 0 });
  assert.deepEqual(win.arms.B, { people: 36, reached: 22, waiting: 0 });
  assert.equal(win.verdict.winner, "B");
  assert.ok(win.verdict.p < 0.05);
  assert.equal(win.verdict.text, "B wins: 22 of 36 booked (61%) vs 10 of 35 (29%). That gap is big enough to trust.");

  const flat = r["resume-proof"];
  assert.deepEqual(flat.arms.A, { people: 31, reached: 12, waiting: 0 });
  assert.deepEqual(flat.arms.B, { people: 30, reached: 13, waiting: 0 });
  assert.equal(flat.verdict.winner, null);
  assert.ok(flat.verdict.p > 0.05);
  assert.equal(flat.verdict.text, "B is ahead: 13 of 30 finished the survey (43%) vs 12 of 31 (39%). Not enough people yet to call it.");
});
