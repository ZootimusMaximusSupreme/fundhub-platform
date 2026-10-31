/* S-02's three questions, and the whole follow-up, against a real Postgres.
 *
 * WHY A DATABASE TEST AND NOT ONLY THE FAKE. The unit tests in s-02-incomplete-survey-nudge.test.mjs
 * prove the decisions; they answer the three stop questions (finished? replied? already running?) with
 * a stand-in. The SQL is where the mistakes hide: a JSON field read, a company scope, a LIKE on the send
 * key, a timestamp comparison. A fake that answers the way its author expected proves the author.
 *
 * The second half walks the real workflow through the real sendTemplated with the real messages table,
 * on the shared simulated clock (inngest-sim.mjs): the sends are real rows, the stops are real reads.
 *
 * Every row is built by the test and removed after: two made-up companies, made-up people with a made-up
 * ghl_contact_id (so the contact sync is never reached), six made-up templates. No provider is called:
 * the rows are queued, never dispatched, and the keys that could reach one are cleared for the run.
 *
 * SKIPS unless DATABASE_URL is a loopback scratch or CI database (the lock in
 * src/verification/scratch-guard.mjs). A skip is not a pass.
 */
import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  handle, resumePlan, sequenceInFlight, stopReason, surveyCompleted, RESUME_TEMPLATE_KEYS
} from "./s-02-incomplete-survey-nudge.mjs";
import { inngestSim } from "./inngest-sim.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";

// Writes and deletes its own rows, so it runs only on a loopback scratch or CI database.
const HAS_DB = isLocalScratchDatabaseUrl(process.env.DATABASE_URL);
const SLUG = "s02-resume-test";
const OTHER_SLUG = "s02-resume-test-other";
const DOMAIN = "s02-resume.test";
const SECRET = "pg-test-resume-secret-0123456789abcdef0123456789";
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let orgId;
let otherOrgId;
const saved = {};
let seq = 0;

const iso = (ms) => new Date(ms).toISOString();

async function makeClient(org, { email = `lead${++seq}@${DOMAIN}`, phone = `+1555010${String(1000 + seq).slice(-4)}`, answers = {} } = {}) {
  return (await db.query(
    `INSERT INTO clients (org_id, email, phone, first_name, last_name, ghl_contact_id, custom_fields)
     VALUES ($1,$2,$3,'Pat','Lee',$4,$5) RETURNING id`,
    [org, email, phone, `test-ghl-${seq}`, JSON.stringify(answers)]
  )).rows[0].id;
}
async function addEvent(org, clientId, name, payload, at) {
  return (await db.query(
    `INSERT INTO events (org_id, name, version, client_id, payload, created_at)
     VALUES ($1,$2,1,$3,$4,$5) RETURNING id`,
    [org, name, clientId, JSON.stringify(payload), at]
  )).rows[0].id;
}
async function addMessage(org, clientId, { direction = "outbound", templateKey = null, providerRef = null, at, channel = "sms" }) {
  await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key, rendered_body, provider, provider_ref, status, compliance_check_passed, created_at)
     VALUES ($1,$2,$3,$4,$5,'x','internal',$6,$7,true,$8)`,
    [org, clientId, direction, channel, templateKey, providerRef, direction === "inbound" ? "received" : "queued", at]
  );
}
const messagesOf = async (clientId) => (await db.query(
  `SELECT template_key, channel, status, provider_ref, rendered_body, to_address, created_at
     FROM messages WHERE client_id = $1 AND direction = 'outbound' ORDER BY created_at, template_key`, [clientId])).rows;

async function purge() {
  if (!HAS_DB) return;
  const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = ANY($1)`, [[SLUG, OTHER_SLUG]])).rows.map((r) => r.id);
  if (orgs.length) {
    await db.query(`UPDATE messages SET conversation_id = NULL WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM messages WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM conversations WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM events WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM clients WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM message_templates WHERE org_id = ANY($1)`, [orgs]);
  }
  await db.query(`DELETE FROM orgs WHERE slug = ANY($1)`, [[SLUG, OTHER_SLUG]]);
}

before(async () => {
  if (!HAS_DB) return;
  // Nothing in this file may reach a provider or the CRM, whatever the shell it runs in holds.
  for (const k of ["INNGEST_EVENT_KEY", "GHL_API_KEY", "DOCUMENT_URL_SECRET", "UNSUBSCRIBE_TOKEN_SECRET"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.UNSUBSCRIBE_TOKEN_SECRET = SECRET;
  await purge();
  orgId = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1,'S02 Resume Test') RETURNING id`, [SLUG])).rows[0].id;
  otherOrgId = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1,'S02 Resume Test Other') RETURNING id`, [OTHER_SLUG])).rows[0].id;
  for (const key of RESUME_TEMPLATE_KEYS) {
    await db.query(
      `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
       VALUES ($1,$2,$3,$4,$5,true)`,
      [orgId, key, key.startsWith("SMS") ? "sms" : "email", key.startsWith("EMAIL") ? `Subject ${key}` : null,
        `${key}: Hi {{contact.first_name}}, you stopped at {{survey_stopped_at}}, {{survey_taps_left}} to go: {{survey_resume_link}}`]
    );
  }
});

after(async () => {
  if (!HAS_DB) return;
  await purge();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await close();
});

// ── finished? ────────────────────────────────────────────────────────────────────────────────────

test("finished: a survey.completed row for the client, or an unstamped one with their email, and nothing else",
  { skip: !HAS_DB }, async () => {
    const at = iso(Date.now());
    const stamped = await makeClient(orgId);
    assert.equal(await surveyCompleted(db, stamped, null, orgId), false, "nothing yet");
    await addEvent(orgId, stamped, "survey.completed", {}, at);
    assert.equal(await surveyCompleted(db, stamped, null, orgId), true, "stamped with the client");

    const email = `Unstamped.Case@${DOMAIN}`;
    const unstamped = await makeClient(orgId, { email });
    await addEvent(orgId, null, "survey.completed", { email: email.toLowerCase() }, at);
    assert.equal(await surveyCompleted(db, unstamped, email, orgId), true, "no client on the row: found by email, any case");
    assert.equal(await surveyCompleted(db, unstamped, null, orgId), false, "no email to look for");
  });

test("finished: answering questions is not finishing, and survey.submitted never counts",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId);
    for (let i = 0; i < 4; i++) await addEvent(orgId, id, "survey.submitted", { email: "x" }, iso(Date.now()));
    assert.equal(await surveyCompleted(db, id, null, orgId), false);
  });

test("finished: a row stamped with somebody else's id is theirs, and another company's row is not ours",
  { skip: !HAS_DB }, async () => {
    const at = iso(Date.now());
    const email = `shared@${DOMAIN}`;
    const me = await makeClient(orgId, { email });
    const someoneElse = await makeClient(orgId);
    await addEvent(orgId, someoneElse, "survey.completed", { email }, at);
    assert.equal(await surveyCompleted(db, me, email, orgId), false, "stamped with another client: not mine, though the email matches");

    const otherOrgLead = await makeClient(otherOrgId, { email: `elsewhere@${DOMAIN}` });
    await addEvent(otherOrgId, null, "survey.completed", { email: `elsewhere@${DOMAIN}` }, at);
    const sameEmailHere = await makeClient(orgId, { email: `elsewhere2@${DOMAIN}` });
    assert.equal(await surveyCompleted(db, sameEmailHere, `elsewhere@${DOMAIN}`, orgId), false, "another company's unstamped row does not finish this company's lead");
    assert.equal(await surveyCompleted(db, otherOrgLead, `elsewhere@${DOMAIN}`, otherOrgId), true, "but it does finish its own");
  });

// ── replied? ─────────────────────────────────────────────────────────────────────────────────────
// The reply read itself is stop-on-reply.mjs, proved on its own in stop-on-reply.pg.test.mjs. This pins
// that S-02 asks it, with the opt-in that started the run, for both shapes that are in the table.

test("replied: a text (no person on the event, the number in the payload) or an email (the person on it), after the opt-in",
  { skip: !HAS_DB }, async () => {
    const now = Date.now();
    const mk = async (phone) => {
      const email = `reply${++seq}@${DOMAIN}`;
      const id = await makeClient(orgId, { email, phone });
      return { id, email, trigger: await addEvent(orgId, id, "entry.captured", { email }, iso(now - HOUR)) };
    };
    const ask = (c) => stopReason(db, { orgId, clientId: c.id, email: c.email, eventId: c.trigger });

    const quiet = await mk("+15550100001");
    assert.equal(await ask(quiet), null);

    const texter = await mk("+15550100002");
    await addEvent(orgId, null, "message.inbound", { from: "+15550100002", channel: "sms", body: "who is this" }, iso(now - 10 * MIN));
    assert.equal(await ask(texter), "replied", "Twilio saves no client on the event; the number finds the person");

    const mailer = await mk("+15550100003");
    await addEvent(orgId, mailer.id, "message.inbound", { channel: "email" }, iso(now - 5 * MIN));
    assert.equal(await ask(mailer), "replied", "an email reply is saved with the person on it");

    const early = await mk("+15550100004");
    await addEvent(orgId, null, "message.inbound", { from: "+15550100004", channel: "sms" }, iso(now - 2 * HOUR));
    assert.equal(await ask(early), null, "a reply from before the opt-in is not an answer to our messages");

    const stranger = await mk("+15550100005");
    await addEvent(orgId, null, "message.inbound", { from: "+15550199999", channel: "sms" }, iso(now - 10 * MIN));
    assert.equal(await ask(stranger), null, "a text from another number");

    const otherCompany = await mk("+15550100006");
    await addEvent(otherOrgId, null, "message.inbound", { from: "+15550100006", channel: "sms" }, iso(now - 10 * MIN));
    assert.equal(await ask(otherCompany), null, "the same number texting another company");
  });

// ── already running? ─────────────────────────────────────────────────────────────────────────────

test("already running: resume messages from a different opt-in in the last four days, and no others",
  { skip: !HAS_DB }, async () => {
    const now = Date.now();
    const since = iso(now - 4 * DAY);
    const ask = (clientId, cohortId, org = orgId) => sequenceInFlight(db, { orgId: org, clientId, cohortId, since });

    const fresh = await makeClient(orgId);
    assert.equal(await ask(fresh, "evt-mine"), false, "nothing sent yet");

    const sent = await makeClient(orgId);
    await addMessage(orgId, sent, { templateKey: "EMAIL-S02-RESUME-1", providerRef: "workflow:EMAIL-S02-RESUME-1:evt-theirs", at: iso(now - DAY) });
    assert.equal(await ask(sent, "evt-mine"), true, "sent from another opt-in a day ago");
    assert.equal(await ask(sent, "evt-theirs"), false, "that opt-in is this one: its own messages do not count");

    const old = await makeClient(orgId);
    await addMessage(orgId, old, { templateKey: "SMS-S02-RESUME-3", providerRef: "workflow:SMS-S02-RESUME-3:evt-old", at: iso(now - 5 * DAY) });
    assert.equal(await ask(old, "evt-mine"), false, "five days ago: that sequence is over");

    const otherMessage = await makeClient(orgId);
    await addMessage(orgId, otherMessage, { templateKey: "EMAIL-S00-WELCOME", providerRef: "workflow:EMAIL-S00-WELCOME:evt-1", at: iso(now - HOUR) });
    await addMessage(orgId, otherMessage, { templateKey: "EMAIL-NOBOOK-01", providerRef: "workflow:EMAIL-NOBOOK-01:evt-1", at: iso(now - HOUR) });
    assert.equal(await ask(otherMessage, "evt-mine"), false, "the welcome and the never-booked chase are other things");

    const inboundOnly = await makeClient(orgId);
    await addMessage(orgId, inboundOnly, { direction: "inbound", templateKey: "SMS-S02-RESUME-1", providerRef: "twilio:SM1", at: iso(now - HOUR) });
    assert.equal(await ask(inboundOnly, "evt-mine"), false, "only what we sent");

    assert.equal(await ask(sent, "evt-mine", otherOrgId), false, "another company's id");
    const noRef = await makeClient(orgId);
    await addMessage(orgId, noRef, { templateKey: "EMAIL-S02-RESUME-2", providerRef: null, at: iso(now - HOUR) });
    assert.equal(await ask(noRef, "evt-mine"), true, "a resume message with no send key still counts as sent");
  });

test("stopReason reads all three from the real tables", { skip: !HAS_DB }, async () => {
  const now = Date.now();
  const mk = async () => {
    const email = `stop${++seq}@${DOMAIN}`;
    const phone = `+1555020${String(1000 + seq).slice(-4)}`;
    const id = await makeClient(orgId, { email, phone });
    return { id, email, phone, trigger: await addEvent(orgId, id, "entry.captured", { email }, iso(now - HOUR)) };
  };
  const ask = (c) => stopReason(db, { orgId, clientId: c.id, email: c.email, eventId: c.trigger });
  const none = await mk();
  assert.equal(await ask(none), null);

  const finished = await mk();
  await addEvent(orgId, finished.id, "survey.completed", {}, iso(now));
  assert.equal(await ask(finished), "finished");

  const replied = await mk();
  await addEvent(orgId, null, "message.inbound", { from: replied.phone, channel: "sms" }, iso(now));
  assert.equal(await ask(replied), "replied");

  const booked = await mk();
  await addEvent(orgId, booked.id, "booking.created", { email: booked.email }, iso(now));
  assert.equal(await ask(booked), "booked");
});

// ── the whole follow-up, on real rows ────────────────────────────────────────────────────────────

/** Start an opt-in at `startMs` for a client: the entry.captured row (real, so the send key is read from Postgres) and its event. */
async function optIn(clientId, startMs, email) {
  const payload = { email, funnel: "apply-survey" };
  const id = await addEvent(orgId, clientId, "entry.captured", payload, iso(startMs));
  return { id, orgId, clientId, name: "entry.captured", payload, createdAt: iso(startMs) };
}
const spec = (sim, event) => ({
  key: event.id, at: event.createdAt,
  fn: (step) => handle({ event, db, step, now: sim.now })
});
const ANSWERED_THREE = {
  cf_svy_funding_target_amount: "$50k - $100k",
  cf_svy_planned_use: "Not sure yet",
  cf_svy_money_change_now: ["Stability (cover bills / buffer slow weeks)"]
};
const ALL_EIGHT = {
  ...ANSWERED_THREE,
  cf_svy_self_reported_fico: "700-759", cf_svy_has_business: "No, personal funding only",
  cf_svy_annual_income_range: "$50k-$99k", cf_svy_income_verifiable: "Yes, both", cf_svy_available_capital: "$100k+"
};
const KEYS6 = ["EMAIL-S02-RESUME-1", "EMAIL-S02-RESUME-2", "EMAIL-S02-RESUME-3", "SMS-S02-RESUME-1", "SMS-S02-RESUME-2", "SMS-S02-RESUME-3"];

test("a lead who never finishes: six queued messages on real rows, each with the plain /apply link and no resume code",
  { skip: !HAS_DB }, async () => {
    const email = `quits${++seq}@${DOMAIN}`;
    const clientId = await makeClient(orgId, { email, phone: "(555) 010-2001", answers: ANSWERED_THREE });
    const start = Date.now();
    const sim = inngestSim(iso(start));
    const event = await optIn(clientId, start, email);
    const [res] = await sim.runAll([spec(sim, event)]);
    assert.equal(res.done, true);
    assert.equal(res.stoppedBecause, undefined);

    const rows = await messagesOf(clientId);
    assert.deepEqual(rows.map((r) => r.template_key).sort(), KEYS6);
    for (const r of rows) {
      assert.equal(r.status, "queued", "queued for the dispatcher; this test sends nothing");
      assert.equal(r.provider_ref, `workflow:${r.template_key}:${event.id}`, "one send key per touch, per channel, per opt-in");
      assert.ok(r.rendered_body.endsWith("to go: https://apply.fundhub.ai/apply"), r.rendered_body);
      assert.ok(!r.rendered_body.includes("?r="), "containment 2026-10-31: no resume code in a follow-up");
      assert.ok(r.rendered_body.includes("Hi Pat"));
      assert.ok(r.rendered_body.includes("you stopped at the credit score question, 5 more taps to go:"), r.rendered_body);
    }
    assert.ok(rows.filter((r) => r.channel === "sms").every((r) => /^\+1555/.test(r.to_address)), "texts are addressed in E.164");
    assert.deepEqual(sim.sleeps.map((s) => s.until), resumePlan(start).map((d) => d.toISOString()));
  });

test("finished mid-way: touch 1 goes, touch 2 and 3 do not, the person is tagged",
  { skip: !HAS_DB }, async () => {
    const email = `finishes${++seq}@${DOMAIN}`;
    const clientId = await makeClient(orgId, { email });
    const start = Date.now();
    const sim = inngestSim(iso(start));
    const plan = resumePlan(start);
    sim.at(iso(plan[1].getTime() - HOUR), () => addEvent(orgId, clientId, "survey.completed", { email }, iso(plan[1].getTime() - HOUR)));
    const [res] = await sim.runAll([spec(sim, await optIn(clientId, start, email))]);
    assert.equal(res.stoppedAt, "before-touch-2");
    assert.equal(res.stoppedBecause, "finished");
    assert.deepEqual((await messagesOf(clientId)).map((r) => r.template_key).sort(), ["EMAIL-S02-RESUME-1", "SMS-S02-RESUME-1"]);
    assert.deepEqual((await db.query(`SELECT tags FROM clients WHERE id = $1`, [clientId])).rows[0].tags, ["survey:complete"]);
  });

test("finished overnight: nothing is queued at all, and the run asked at the moment the message would have gone",
  { skip: !HAS_DB }, async () => {
    const email = `overnight${++seq}@${DOMAIN}`;
    const clientId = await makeClient(orgId, { email });
    // 11 p.m. Arizona, whatever day it is now.
    const dayStart = Math.floor((Date.now() - 7 * HOUR) / DAY) * DAY + 7 * HOUR; // today's 00:00 Arizona, in ms
    const start = dayStart + 23 * HOUR;
    const sim = inngestSim(iso(start));
    const touch1 = resumePlan(start)[0];
    assert.equal(touch1.getTime(), dayStart + DAY + 9 * HOUR, "touch 1 waits for 9 a.m.");
    const eightAm = dayStart + DAY + 8 * HOUR;
    sim.at(iso(eightAm), () => addEvent(orgId, clientId, "survey.completed", { email }, iso(eightAm)));
    const [res] = await sim.runAll([spec(sim, await optIn(clientId, start, email))]);
    assert.equal(res.stoppedAt, "before-touch-1");
    assert.equal(res.stoppedBecause, "finished");
    assert.deepEqual(await messagesOf(clientId), []);
    assert.deepEqual(sim.sleeps.map((s) => s.until), [iso(touch1.getTime())], "it slept to 9 a.m. before asking");
  });

test("a reply and a booking each stop the run", { skip: !HAS_DB }, async () => {
  const start = Date.now();
  const plan = resumePlan(start);

  const replyEmail = `replies${++seq}@${DOMAIN}`;
  const replyPhone = "+15550209001";
  const replier = await makeClient(orgId, { email: replyEmail, phone: replyPhone });
  let sim = inngestSim(iso(start));
  sim.at(iso(plan[0].getTime() - MIN), () => addEvent(orgId, null, "message.inbound", { from: replyPhone, channel: "sms" }, iso(plan[0].getTime() - MIN)));
  let [res] = await sim.runAll([spec(sim, await optIn(replier, start, replyEmail))]);
  assert.equal(res.stoppedBecause, "replied");
  assert.deepEqual(await messagesOf(replier), []);

  const bookEmail = `books${++seq}@${DOMAIN}`;
  const booker = await makeClient(orgId, { email: bookEmail });
  sim = inngestSim(iso(start));
  sim.at(iso(plan[1].getTime() - HOUR), () => addEvent(orgId, booker, "booking.created", { email: bookEmail }, iso(plan[1].getTime() - HOUR)));
  [res] = await sim.runAll([spec(sim, await optIn(booker, start, bookEmail))]);
  assert.equal(res.stoppedAt, "before-touch-2");
  assert.equal(res.stoppedBecause, "booked");
  assert.equal((await messagesOf(booker)).length, 2, "touch 1 went, nothing after");
});

test("two posts of one application share the first post's send key and queue six messages, not twelve",
  { skip: !HAS_DB }, async () => {
    const email = `twice${++seq}@${DOMAIN}`;
    const clientId = await makeClient(orgId, { email });
    const start = Date.now();
    const sim = inngestSim(iso(start));
    const first = await optIn(clientId, start, email);
    const second = await optIn(clientId, start + 66, email);
    const [a, b] = await sim.runAll([spec(sim, first), spec(sim, second)]);
    assert.equal(a.stoppedBecause, undefined);
    assert.equal(b.stoppedBecause, undefined);
    const rows = await messagesOf(clientId);
    assert.equal(rows.length, 6);
    assert.ok(rows.every((r) => r.provider_ref.endsWith(`:${first.id}`)), "both runs keyed on the first post");
  });

test("a lead who comes back through touch 2's link and stops again is not started a second sequence",
  { skip: !HAS_DB }, async () => {
    const email = `returns${++seq}@${DOMAIN}`;
    const clientId = await makeClient(orgId, { email });
    const start = Date.now();
    const sim = inngestSim(iso(start));
    const first = await optIn(clientId, start, email);
    const returned = await optIn(clientId, resumePlan(start)[1].getTime() + 2 * HOUR, email); // two hours after touch 2
    const [a, b] = await sim.runAll([spec(sim, first), spec(sim, returned)]);
    assert.deepEqual(b, { done: false, reason: "sequence_in_flight" });
    assert.equal(a.stoppedBecause, undefined);
    assert.deepEqual((await messagesOf(clientId)).map((r) => r.template_key).sort(), KEYS6, "one sequence, three touches");
  });

test("the words are worked out when each touch goes out, from the answers saved in the real record by then",
  { skip: !HAS_DB }, async () => {
    const email = `progress${++seq}@${DOMAIN}`;
    const clientId = await makeClient(orgId, { email });
    const start = Date.now();
    const sim = inngestSim(iso(start));
    const plan = resumePlan(start);
    sim.at(iso(plan[1].getTime() - HOUR), async () => {
      await db.query(`UPDATE clients SET custom_fields = custom_fields || $2::jsonb WHERE id = $1`, [clientId, JSON.stringify(ANSWERED_THREE)]);
    });
    sim.at(iso(plan[2].getTime() - HOUR), async () => {
      await db.query(`UPDATE clients SET custom_fields = custom_fields || $2::jsonb WHERE id = $1`, [clientId, JSON.stringify({
        cf_svy_self_reported_fico: "Not sure", cf_svy_has_business: "Yes, 5+ years", cf_svy_business_revenue: "$500k - $999k"
      })]);
    });
    await sim.runAll([spec(sim, await optIn(clientId, start, email))]);
    const body = async (key) => (await messagesOf(clientId)).find((r) => r.template_key === key).rendered_body;
    assert.ok((await body("SMS-S02-RESUME-1")).includes("you stopped at the first question, 8 more taps to go:"));
    assert.ok((await body("EMAIL-S02-RESUME-2")).includes("you stopped at the credit score question, 5 more taps to go:"));
    assert.ok((await body("SMS-S02-RESUME-3")).includes("you stopped at the question about showing your revenue, 2 more taps to go:"));
  });

test("every question answered and no finish on record: nothing is queued, and the person is tagged",
  { skip: !HAS_DB }, async () => {
    const email = `answered${++seq}@${DOMAIN}`;
    const clientId = await makeClient(orgId, { email, answers: ALL_EIGHT });
    const start = Date.now();
    const sim = inngestSim(iso(start));
    const [res] = await sim.runAll([spec(sim, await optIn(clientId, start, email))]);
    assert.equal(res.stoppedAt, "before-touch-1");
    assert.equal(res.stoppedBecause, "all_answered");
    assert.deepEqual(await messagesOf(clientId), []);
    assert.deepEqual((await db.query(`SELECT tags FROM clients WHERE id = $1`, [clientId])).rows[0].tags, ["survey:complete"]);
  });
