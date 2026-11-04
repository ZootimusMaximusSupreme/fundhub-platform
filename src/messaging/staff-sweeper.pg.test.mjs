// The sweeper that releases held staff replies.
//
// TWO CLAIMS, and the second one is the one that could hurt somebody:
//
//   1. A text held overnight actually goes out when the window opens. Before
//      this existed it did not — the message was correctly held and then sat
//      queued forever, because nothing in this repository had ever called the
//      dispatcher on a clock. The screen told the sender "it will go out on its
//      own", which was untrue.
//
//   2. It releases only held staff replies and recent pre-gate staff alerts.
//      `messages` holds thousands of rows queued by workflows over months and
//      never dispatched. A sweeper that
//      drained the whole queue would put months of stale automated messages in
//      front of real people the first time it ran. That is not this feature's
//      decision to make, so the filter is asserted here rather than trusted to
//      a comment.
//
// THIS SUITE OWNS ITS OWN ORG. Channels route to `memory` on that org only —
// never by UPDATE-ing the default org's message_channel_routing. See
// src/messaging/pg-test-fixture.mjs. Sweep calls also pass orgId so a
// concurrent suite's queued rows cannot inflate claim counts.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, close } from "../db.mjs";
import { sweepStaffMessages, SWEEP_CRON, MAX_BATCHES_PER_PASS } from "../../netlify/functions/staff-message-sweeper.mjs";
import { recorded, reset as resetMemory } from "./providers/memory.mjs";
import { createMemoryRoutedOrg, destroyMemoryRoutedOrg } from "./pg-test-fixture.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "staff_sweeper_pg_test@example.com";
const ORG_SLUG = "staff-sweeper-pg-test";
const HERE = path.dirname(fileURLToPath(import.meta.url));

let orgId = null;
let staffId = null;
let clientId = null;

async function wipe() {
  await db.query(`DELETE FROM messages WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  await db.query(`DELETE FROM conversations WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  // An opt-out survives its message; the re-check case below writes one, and a
  // run that failed part-way through leaves it behind.
  await db.query(`DELETE FROM opt_outs WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email = $1`, [EMAIL]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  await destroyMemoryRoutedOrg(db, { slug: ORG_SLUG });

  ({ orgId, staffId } = await createMemoryRoutedOrg(db, {
    slug: ORG_SLUG,
    name: "Staff Sweeper Pg Test",
    staffEmail: "staff_sweeper_pg_owner@example.com",
    staffName: "Sweeper Owner"
  }));

  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone)
     VALUES ($1,$2,'Held','Overnight','+15550009999') RETURNING id`, [orgId, EMAIL])).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await destroyMemoryRoutedOrg(db, { orgId, slug: ORG_SLUG });
  await close();
});

beforeEach(async () => { if (HAS_DB) { resetMemory(); await wipe2(); } });

/* Between cases: clear this file's messages only. The client row stays. */
async function wipe2() {
  await db.query(`DELETE FROM messages WHERE client_id = $1`, [clientId]);
}

/* The clock, fixed outside quiet hours, so this file's result does not depend
   on what time the suite happens to run — the same reason the gate takes a
   clock as an argument at all. 18:00 UTC is 11:00 in Arizona, which does not
   move for daylight saving. */
const OPEN = () => new Date("2026-03-10T18:00:00Z");

/* Scope every sweep to THIS org. Without it, claimDue races every other
   suite's queued staff rows and the asserted counts become noise. */
const sweep = (extra = {}) => sweepStaffMessages(db, { now: OPEN, orgId, ...extra });

/* A message whose hold has already expired: `scheduled_at` set an hour before
   OPEN. That is exactly the state dispatchOne leaves an overnight text in once
   11am has come and gone — queued, outbound, and due.

   THE TIMESTAMP IS FIXED, NOT `now() - interval`. The sweeper is driven with
   the fixed clock above, and a row stamped with the database's real clock would
   be scheduled months AFTER it and never come due. That is a test-fixture trap
   worth naming: it fails as "nothing was claimed", which reads exactly like the
   sweeper being broken. */
const held = (extra = {}) => db.query(
  `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body,
                         status, scheduled_at, sender_staff_id, to_address)
   VALUES ($1,$2,'outbound','sms',$3,'queued', '2026-03-10T17:00:00Z', $4, '+15550009999')
   RETURNING id`,
  [orgId, clientId, extra.body || "good morning — following up", extra.senderStaffId === null ? null : staffId]
).then((r) => r.rows[0].id);

test("sweeper: a text held overnight is sent once the window has opened",
  { skip: !HAS_DB }, async () => {
  const id = await held();

  const result = await sweep();

  assert.equal(result.ok, true);
  assert.equal(result.claimed, 1);
  const row = (await db.query(`SELECT status FROM messages WHERE id = $1`, [id])).rows[0];
  assert.equal(row.status, "sent", "the held message is still sitting in the queue");
  assert.equal(recorded().length, 1, "it never reached a provider");
});

/* *** THE ONE THAT MATTERS. *** */
test("sweeper: it does NOT release the legacy workflow queue", { skip: !HAS_DB }, async () => {
  const mine = await held();
  const workflowQueued = await held({ senderStaffId: null, body: "an old automated message" });

  const result = await sweep();

  assert.equal(result.claimed, 1, "the sweeper claimed a message nobody typed");
  const rows = (await db.query(
    `SELECT id, status FROM messages WHERE id = ANY($1) ORDER BY id`, [[mine, workflowQueued]])).rows;
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
  assert.equal(byId[mine], "sent");
  assert.equal(byId[workflowQueued], "queued",
    "a message queued by a workflow months ago was released. There are thousands of those " +
    "and sending them is an owner decision, not a side effect of fixing overnight texts.");
  assert.equal(recorded().length, 1);
  assert.equal(recorded()[0].body, "good morning — following up");
});

test("sweeper retries only a recent staff alert interrupted before the send gate",
  { skip: !HAS_DB }, async () => {
  await db.query(`UPDATE staff SET phone = '+15550009999' WHERE id = $1`, [staffId]);
  const makeAlert = async ({ minutesAgo, gatePassed = false }) => (await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body,
       provider, provider_ref, status, compliance_check_passed, to_address,
       attempts, created_at, last_attempt_at)
     VALUES ($1,$2,'outbound','sms','New lead needs review','internal',
       'staff-alert:lead:' || gen_random_uuid()::text || ':' || $3::text,
       'sending',$4,'+15550009999',1,
       now() - ($5::int * interval '1 minute'),
       now() - ($5::int * interval '1 minute'))
     RETURNING id`, [orgId, clientId, staffId, gatePassed, minutesAgo]
  )).rows[0].id;
  const recent = await makeAlert({ minutesAgo: 20 });
  const uncertain = await makeAlert({ minutesAgo: 20, gatePassed: true });
  const stale = await makeAlert({ minutesAgo: 120 });

  const result = await sweep();

  assert.equal(result.ok, true);
  assert.equal(result.recovered, 1);
  assert.equal(result.claimed, 1);
  const rows = (await db.query(
    `SELECT id, status, attempts FROM messages WHERE id = ANY($1)`,
    [[recent, uncertain, stale]]
  )).rows;
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId[recent].status, "sent");
  assert.equal(byId[recent].attempts, 1, "the interrupted pre-gate claim was refunded");
  assert.equal(byId[uncertain].status, "sending", "a possible provider send must not be replayed");
  assert.equal(byId[stale].status, "sending", "an old lead alert must not arrive late");
  assert.equal(recorded().length, 1);
});

test("sweeper: every message is re-checked on the way out, not trusted",
  { skip: !HAS_DB }, async () => {
  const { recordOptOut } = await import("../lib/opt-out.mjs");
  const id = await held();
  // The client opted out AFTER the message was written and held. This is the
  // whole reason the gate reads opt-out state at send time.
  await recordOptOut(db, clientId, orgId, "sms", "inbound_keyword");

  await sweep();

  const row = (await db.query(`SELECT status, blocked_reason FROM messages WHERE id = $1`, [id])).rows[0];
  assert.equal(row.status, "blocked", "a message was sent to somebody who had since asked us to stop");
  assert.match(String(row.blocked_reason), /opted_out/);
  assert.equal(recorded().length, 0);

  await db.query(`DELETE FROM opt_outs WHERE client_id = $1`, [clientId]);
});

test("sweeper: an empty queue is one cheap pass, not ten", { skip: !HAS_DB }, async () => {
  const result = await sweep();
  assert.equal(result.claimed, 0);
  assert.equal(result.batches, 1,
    "an empty queue did not stop after the first look — that is nine wasted queries on each of " +
    "the 288 passes a day when there is nothing to send");
});

test("sweeper: it works through more than one batch, but stops at the cap",
  { skip: !HAS_DB }, async () => {
  for (let i = 0; i < 5; i += 1) await held({ body: `held ${i}` });

  // limit 2 with the real cap: five messages needs three batches.
  const result = await sweep({ limit: 2 });
  assert.equal(result.claimed, 5, "the sweeper stopped after one batch — a night's backlog would take hours");

  // And with a cap of one batch it does exactly one, leaving the rest queued
  // for the next pass rather than running until it is killed mid-send.
  for (let i = 0; i < 4; i += 1) await held({ body: `second round ${i}` });
  const bounded = await sweep({ limit: 2, maxBatches: 1 });
  assert.equal(bounded.claimed, 2);
  assert.equal(bounded.batches, 1);
});

test("sweeper: a broken pass reports rather than throwing", { skip: !HAS_DB }, async () => {
  // The schedule must survive a bad pass: the next one five minutes later is
  // the recovery, and a throw would take the function down instead.
  const broken = { query: () => Promise.reject(new Error("connection terminated")) };
  const result = await sweepStaffMessages(broken);
  assert.equal(result.ok, false);
  assert.match(result.error, /connection terminated/);
});

/* ─────────────────── the schedule itself, no database ───────────────────── */

test("sweeper: netlify.toml schedules it, and on the same cron the module declares", () => {
  const toml = fs.readFileSync(path.resolve(HERE, "../../netlify.toml"), "utf8");
  assert.match(toml, /\[functions\."staff-message-sweeper"\]/,
    "the sweeper is not scheduled in netlify.toml — it exists and nothing runs it, which is " +
    "the state this whole file was written to end");
  const m = /\[functions\."staff-message-sweeper"\][\s\S]{0,200}?schedule\s*=\s*"([^"]+)"/.exec(toml);
  assert.ok(m, "the schedule line is missing from the function's block");
  assert.equal(m[1], SWEEP_CRON,
    "netlify.toml and SWEEP_CRON disagree about how often this runs. The toml is what actually " +
    "fires; the constant is what the comments and this test claim.");
  assert.ok(MAX_BATCHES_PER_PASS > 1, "one batch per pass cannot clear a night's backlog");
});

test("sweeper: releasing held texts did not depend on the workflow engine", async () => {
  // CLAUDE.md §11 reserves INNGEST_EVENT_KEY for the owner because it makes 47
  // workflow functions live. Releasing held texts must not require that, so the
  // standalone Netlify-scheduled sweeper (this file) stays Inngest-free — it
  // runs on its own cron regardless of whether the key is ever set.
  const src = fs.readFileSync(
    path.resolve(HERE, "../../netlify/functions/staff-message-sweeper.mjs"), "utf8");
  assert.ok(!/inngest/i.test(src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "")),
    "the standalone sweeper imports Inngest — it was written precisely so it would not have to");

  // message-dispatch-sweeper (a SEPARATE Inngest-registered function, added by
  // the outbound-mail build on this same day) IS now in the registry — see its
  // own header for why that changed from "deliberately unregistered" to
  // registered: the switch that used to be "not registered at all" moved to a
  // per-company DB row (messaging_settings.outbound_enabled) plus a daily cap,
  // both enforced independently of whether INNGEST_EVENT_KEY is ever set.
  // Registering the function does not itself send anything: Inngest invokes
  // nothing until that key exists, which remains the owner's decision alone.
  const index = await import("../workflows/index.mjs");
  const registered = JSON.stringify(index.functions ? index.functions.map((f) => f?.id?.() ?? "") : []);
  assert.ok(registered.includes("message-dispatch-sweeper"),
    "message-dispatch-sweeper is expected to be registered now — see its own header for why");
});
