import { test, before, after } from "node:test";
import assert from "node:assert";
import {
  handle as runFollowUp, surveyCompleted, resumePlan, stopReason, TOUCHES, RESUME_TEMPLATE_KEYS,
  EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY, SEQUENCE_WINDOW_MS
} from "./s-02-incomplete-survey-nudge.mjs";
import { pgFake } from "./test-support.mjs";
import { withReplyRead } from "./stop-on-reply.test-support.mjs";
import { inngestSim } from "./inngest-sim.mjs";
import { DRIP_LAST_PLAN_MINUTE, inDripWindow, SEND_WINDOW_TZ } from "../messaging/send-window.mjs";

/* ── The database ───────────────────────────────────────────────────────────────────────────────
   pgFake answers the shared reads (clients, templates, messages, the cohort, bookings), and
   withReplyRead answers the reply read the way stop-on-reply.mjs's SQL does. Neither knows the
   one-sequence-at-a-time read, and pgFake does not stamp a time on a message, so this answers that
   one and remembers when each message was queued. The SQL itself is read against Postgres in
   s-02-incomplete-survey-nudge.pg.test.mjs and stop-on-reply.pg.test.mjs. */
function withReads(inner, sim) {
  const wrapped = Object.create(inner);
  wrapped.sentLog = [];
  wrapped.query = async (sql, params = []) => {
    const text = String(sql);
    if (/SELECT MAX\(m.created_at\) AS completed_at/.test(text)) {
      const [eventId, orgId, clientId, keys, allKeys] = params;
      const source = inner.events.find((e) => e.id === eventId && e.org_id === orgId);
      const sourceAt = Date.parse(source?.created_at);
      const pending = wrapped.sentLog.some((m) => m.client_id === clientId && allKeys.includes(m.template_key)
        && m.at < sourceAt && m.at > sourceAt - SEQUENCE_WINDOW_MS
        && (m.status == null || ["queued", "sending"].includes(m.status)
          || (["sent", "delivered"].includes(m.status) && m.lastAttemptAt >= sourceAt)));
      const prior = wrapped.sentLog
        .filter((m) => !pending && m.client_id === clientId && keys.includes(m.template_key)
          && ["sent", "delivered"].includes(m.status) && (m.lastAttemptAt ?? m.at) < sourceAt)
        .sort((a, b) => b.at - a.at)[0];
      return { rows: [{ completed_at: prior ? iso(prior.at) : null }] };
    }
    if (/template_key = ANY\(\$3\)/.test(text)) {
      // Any resume message sent in the window, by any run (sequenceInFlight, review of PR #346).
      const [, clientId, keys, since] = params;
      const hit = wrapped.sentLog.some((m) =>
        m.client_id === clientId && keys.includes(m.template_key) && m.at > Date.parse(since));
      return { rows: hit ? [{ x: 1 }] : [] };
    }
    if (/INSERT INTO messages/.test(text)) {
      const before = inner.messages.length;
      const out = await inner.query(sql, params);
      if (inner.messages.length > before) {
        wrapped.sentLog.push({ client_id: params[1], template_key: params[3], provider_ref: params[5], status: "queued", at: sim.now() });
      }
      return out;
    }
    return inner.query(sql, params);
  };
  return wrapped;
}

const ORG = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CLIENT = "c3b1a9d2-5f4e-4c1a-8b7d-2e6f9a0b1c3d";
const EMAIL = "pat@example.com";
const SECRET = "unit-test-resume-secret-0123456789abcdef0123456789";

// Wednesday 28 October 2026. Arizona is UTC-7 all year (no daylight saving).
const AT_10AM = "2026-10-28T17:00:00Z";
const AT_11PM = "2026-10-29T06:00:00Z";
const NINE_AM = (day) => `2026-10-${day}T16:00:00.000Z`;

const iso = (ms) => new Date(ms).toISOString();
const arizonaDay = (d) => new Intl.DateTimeFormat("en-CA", {
  timeZone: SEND_WINDOW_TZ, year: "numeric", month: "2-digit", day: "2-digit"
}).format(d);
// Arizona is UTC-7 all year, so its minute of the day is the UTC one shifted by 17 hours.
const arizonaMinute = (d) => (d.getUTCHours() * 60 + d.getUTCMinutes() + 17 * 60) % 1440;
const dayNumber = (d) => Date.parse(`${arizonaDay(d)}T00:00:00Z`) / 86_400_000;

let savedSecret;
before(() => { savedSecret = process.env.UNSUBSCRIBE_TOKEN_SECRET; process.env.UNSUBSCRIBE_TOKEN_SECRET = SECRET; });
after(() => { if (savedSecret === undefined) delete process.env.UNSUBSCRIBE_TOKEN_SECRET; else process.env.UNSUBSCRIBE_TOKEN_SECRET = savedSecret; });

const template = (key) => ({
  org_id: ORG, template_key: key, channel: key.startsWith("SMS") ? "sms" : "email",
  subject: key.startsWith("EMAIL") ? `Subject for ${key}` : null,
  body: `${key}: Start your questions here: {{survey_resume_link}}`,
  compliance_passed: true
});
const lead = (over = {}) => ({
  id: CLIENT, org_id: ORG, email: EMAIL, phone: "+15551234567", first_name: "Pat", last_name: "Lee", custom_fields: {}, ...over
});

function world({ start = AT_10AM, templates = RESUME_TEMPLATE_KEYS.map(template), clients = [lead()] } = {}) {
  const sim = inngestSim(start);
  return { sim, db: withReads(withReplyRead(pgFake({ clients, templates })), sim) };
}

/** An opt-in: the entry.captured row (pgFake reads it for the send key) and the event the run gets. */
function optIn(w, { id = "evt-a", at = iso(w.sim.now()), email = EMAIL } = {}) {
  const payload = { email, funnel: "apply-survey" };
  w.db.events.push({ id, org_id: ORG, client_id: CLIENT, name: "entry.captured", payload, created_at: at });
  return { id, orgId: ORG, clientId: CLIENT, name: "entry.captured", payload, createdAt: at };
}
/** Drive one or more runs together, each starting at its own opt-in time. Results come back in order. */
const runAll = (w, ...events) => w.sim.runAll(events.map((event) => ({
  key: event.id, at: event.createdAt,
  fn: (step) => runFollowUp({ event, db: w.db, step, now: w.sim.now })
})));
const run = async (w, event) => (await runAll(w, event))[0];
const keys = (w) => w.db.messages.map((m) => m.template_key);
const queuedAt = (w) => w.db.sentLog.map((m) => iso(m.at));

const finishes = (w, atIso, name = "survey.completed") =>
  w.sim.at(atIso, () => w.db.events.push({ id: `evt-${name}`, org_id: ORG, client_id: CLIENT, name, payload: {}, created_at: atIso }));
/* A text from the person, saved the way the Twilio adapter saves it: no client on the event, the sender's number in the payload. */
const textEvent = (atIso, over = {}) =>
  ({ id: `evt-reply-${atIso}`, org_id: ORG, client_id: null, name: "message.inbound", payload: { from: "+15551234567", channel: "sms", body: "who is this?" }, created_at: atIso, ...over });
const replies = (w, atIso) => w.sim.at(atIso, () => w.db.events.push(textEvent(atIso)));
const books = (w, atIso) =>
  w.sim.at(atIso, () => w.db.events.push({ id: "evt-book", org_id: ORG, client_id: CLIENT, name: "booking.created", payload: {}, created_at: atIso }));

const TOUCH_KEYS = [
  "SMS-S02-RESUME-1", "EMAIL-S02-RESUME-1", "SMS-S02-RESUME-2", "EMAIL-S02-RESUME-2", "SMS-S02-RESUME-3", "EMAIL-S02-RESUME-3"
];

// ── the keys ─────────────────────────────────────────────────────────────────────────────────────

test("the six keys are the ones the migration writes, and the old one-email nudge is gone", () => {
  assert.deepEqual(TOUCHES.flatMap((t) => [t.sms, t.email]), TOUCH_KEYS);
  assert.deepEqual([...RESUME_TEMPLATE_KEYS], TOUCH_KEYS);
  assert.equal(SMS_TEMPLATE_KEY, "SMS-S02-RESUME-1");
  assert.equal(EMAIL_TEMPLATE_KEY, "EMAIL-S02-RESUME-1");
  assert.ok(!RESUME_TEMPLATE_KEYS.includes("EMAIL-S02-FINISH-APPLICATION"));
});

// ── when each touch goes out ─────────────────────────────────────────────────────────────────────

test("plan: a 10 a.m. opt-in gets touch 1 at 10:20, then 9 a.m. on each of the next two days", () => {
  const [t1, t2, t3] = resumePlan(Date.parse(AT_10AM)).map((d) => d.toISOString());
  assert.deepEqual([t1, t2, t3], ["2026-10-28T17:20:00.000Z", NINE_AM(29), NINE_AM(30)]);
});

test("plan: an 11 p.m. opt-in waits for 9 a.m., and the touches still come one a day", () => {
  const [t1, t2, t3] = resumePlan(Date.parse(AT_11PM)).map((d) => d.toISOString());
  assert.deepEqual([t1, t2, t3], [NINE_AM(29), NINE_AM(30), NINE_AM(31)]);
});

test("plan: the edges of the window", () => {
  const plan = (iso8601) => resumePlan(Date.parse(iso8601)).map((d) => d.toISOString());
  // A drip is planned no later than 4:50 p.m. (DRIP_LAST_PLAN_MINUTE in send-window.mjs): the sender sweeps
  // every 5 minutes, and one swept after 5:00 would be held to 9 a.m. with no new check.
  // 4:30 p.m. + 20 minutes = 4:50, still inside; 4:31 + 20 = 4:51, the next morning.
  assert.equal(plan("2026-10-28T23:30:00Z")[0], "2026-10-28T23:50:00.000Z");
  assert.equal(plan("2026-10-28T23:31:00Z")[0], NINE_AM(29));
  assert.equal(plan("2026-10-28T23:35:00Z")[0], NINE_AM(29), "4:55 p.m. is past the edge now");
  assert.equal(plan("2026-10-28T23:39:00Z")[0], NINE_AM(29), "4:59 p.m.");
  assert.equal(plan("2026-10-28T23:40:00Z")[0], NINE_AM(29), "5:00 p.m.");
  // 8:39 a.m. + 20 = 8:59, outside, so 9:00 today; 8:40 + 20 = 9:00:00, inside.
  assert.equal(plan("2026-10-28T15:39:00Z")[0], NINE_AM(28));
  assert.equal(plan("2026-10-28T15:40:00Z")[0], NINE_AM(28));
  // Touches 2 and 3 are the next two 9 a.m. after touch 1, even when touch 1 is late in the afternoon.
  assert.deepEqual(plan("2026-10-28T23:30:00Z").slice(1), [NINE_AM(29), NINE_AM(30)]);
});

test("plan: whatever hour they sign up, every touch is inside the drip window and the days are consecutive", () => {
  // Every half hour across two days, so the 9 a.m. and 5 p.m. edges and both sides of midnight are covered.
  const start = Date.parse("2026-10-28T07:00:00Z");
  for (let i = 0; i < 96; i++) {
    const startMs = start + i * 30 * 60 * 1000;
    const touches = resumePlan(startMs);
    const label = `opt-in ${iso(startMs)}`;
    touches.forEach((t, n) => {
      assert.ok(inDripWindow(t), `${label}: touch ${n + 1} at ${iso(t.getTime())} is outside 9-5`);
      assert.ok(arizonaMinute(t) <= DRIP_LAST_PLAN_MINUTE, `${label}: touch ${n + 1} is planned after 4:55 p.m.`);
    });
    assert.ok(touches[0].getTime() >= startMs + 20 * 60 * 1000, `${label}: touch 1 is never earlier than 20 minutes`);
    assert.equal(dayNumber(touches[1]) - dayNumber(touches[0]), 1, `${label}: touch 2 is the day after touch 1`);
    assert.equal(dayNumber(touches[2]) - dayNumber(touches[1]), 1, `${label}: touch 3 is the day after touch 2`);
    assert.equal(touches[1].toISOString().slice(11), "16:00:00.000Z", `${label}: touch 2 is 9:00 a.m. Arizona`);
    assert.equal(touches[2].toISOString().slice(11), "16:00:00.000Z", `${label}: touch 3 is 9:00 a.m. Arizona`);
  }
});

test("plan: the end of a month and of a year", () => {
  const [a, b, c] = resumePlan(Date.parse("2026-10-31T06:00:00Z")).map((d) => d.toISOString()); // 11 p.m. Oct 30
  assert.deepEqual([a, b, c], ["2026-10-31T16:00:00.000Z", "2026-11-01T16:00:00.000Z", "2026-11-02T16:00:00.000Z"]);
  const [x, y, z] = resumePlan(Date.parse("2027-01-01T06:00:00Z")).map((d) => d.toISOString()); // 11 p.m. Dec 31
  assert.deepEqual([x, y, z], ["2027-01-01T16:00:00.000Z", "2027-01-02T16:00:00.000Z", "2027-01-03T16:00:00.000Z"]);
});

// ── the run ──────────────────────────────────────────────────────────────────────────────────────

test("a lead who never finishes gets three touches, a text and an email each, at the planned times", async () => {
  const w = world({ start: AT_10AM });
  const res = await run(w, optIn(w));
  assert.equal(res.done, true);
  assert.equal(res.stoppedBecause, undefined);
  assert.deepEqual(keys(w), TOUCH_KEYS);
  assert.deepEqual(queuedAt(w), [
    "2026-10-28T17:20:00.000Z", "2026-10-28T17:20:00.000Z", NINE_AM(29), NINE_AM(29), NINE_AM(30), NINE_AM(30)
  ]);
  assert.deepEqual(w.sim.sleeps.map((s) => [s.id, s.until]), [
    ["wait-touch-1", "2026-10-28T17:20:00.000Z"], ["wait-touch-2", NINE_AM(29)], ["wait-touch-3", NINE_AM(30)]
  ]);
});

test("an 11 p.m. opt-in: touch 1 is queued at 9 a.m., not at 11:20 p.m., so the dispatcher never has to hold it", async () => {
  const w = world({ start: AT_11PM });
  await run(w, optIn(w));
  assert.deepEqual(w.sim.sleeps.map((s) => s.until), [NINE_AM(29), NINE_AM(30), NINE_AM(31)]);
  assert.deepEqual(queuedAt(w), [
    NINE_AM(29), NINE_AM(29), NINE_AM(30), NINE_AM(30), NINE_AM(31), NINE_AM(31)
  ]);
  for (const m of w.db.sentLog) assert.ok(inDripWindow(new Date(m.at)), `${m.template_key} was queued outside 9-5`);
});

test("THE FIX: opt in at 11 p.m., finish the survey at 8 a.m. — no come-back text at 9", async () => {
  const w = world({ start: AT_11PM });
  // 8:00 a.m. Arizona. The dispatcher would have held a message queued at 11:20 p.m. until 9 and sent it
  // without asking again. The question is asked at 9, and the answer is already yes.
  finishes(w, "2026-10-29T15:00:00Z");
  const res = await run(w, optIn(w));
  assert.equal(res.done, true);
  assert.equal(res.stoppedAt, "before-touch-1");
  assert.equal(res.stoppedBecause, "finished");
  assert.deepEqual(res.touches, []);
  assert.equal(w.db.messages.length, 0, "no touch-1 text, no touch-1 email, nothing");
  assert.equal(w.db.sentLog.length, 0);
  assert.equal(w.sim.sleeps[0].until, NINE_AM(29), "the run slept to 9 a.m. before it asked");
  assert.equal(w.sim.sleeps.length, 1, "and it did not sleep again");
  assert.deepEqual(w.db.clients[0].tags, ["survey:complete"], "the finished tag is kept");
});

test("the same night, nobody finishes: the touch goes at 9 a.m. exactly", async () => {
  const w = world({ start: AT_11PM });
  const res = await run(w, optIn(w));
  assert.equal(res.stoppedBecause, undefined);
  assert.deepEqual(queuedAt(w).slice(0, 2), [NINE_AM(29), NINE_AM(29)]);
});

test("finishing in the 20 minutes after opting in, in the daytime, stops touch 1", async () => {
  const w = world({ start: AT_10AM });
  finishes(w, "2026-10-28T17:12:00Z");
  const res = await run(w, optIn(w));
  assert.equal(res.stoppedAt, "before-touch-1");
  assert.equal(res.stoppedBecause, "finished");
  assert.equal(w.db.messages.length, 0);
});

test("finishing between touch 1 and touch 2 stops the rest, and the first touch stays sent", async () => {
  const w = world({ start: AT_10AM });
  finishes(w, "2026-10-29T15:00:00Z"); // 8:00 a.m. on day 2, an hour before touch 2
  const res = await run(w, optIn(w));
  assert.equal(res.stoppedAt, "before-touch-2");
  assert.equal(res.stoppedBecause, "finished");
  assert.deepEqual(keys(w), ["SMS-S02-RESUME-1", "EMAIL-S02-RESUME-1"]);
  assert.equal(res.touches.length, 1);
});

test("answering one question is not finishing: survey.submitted alone does not stop anything", async () => {
  const w = world({ start: AT_10AM });
  w.db.events.push({ id: "evt-s1", org_id: ORG, client_id: CLIENT, name: "survey.submitted", payload: {}, created_at: AT_10AM });
  w.db.events.push({ id: "evt-s2", org_id: ORG, client_id: CLIENT, name: "survey.submitted", payload: {}, created_at: AT_10AM });
  const res = await run(w, optIn(w));
  assert.equal(res.stoppedBecause, undefined);
  assert.deepEqual(keys(w), TOUCH_KEYS);
});

test("a reply stops the sequence, whenever it comes, as long as it came after the run started", async () => {
  // Before touch 1, overnight.
  let w = world({ start: AT_11PM });
  replies(w, "2026-10-29T08:00:00Z"); // 1:00 a.m. Arizona
  let res = await run(w, optIn(w));
  assert.equal(res.stoppedAt, "before-touch-1");
  assert.equal(res.stoppedBecause, "replied");
  assert.equal(w.db.messages.length, 0);

  // Between touch 1 and touch 2.
  w = world({ start: AT_10AM });
  replies(w, "2026-10-28T20:00:00Z");
  res = await run(w, optIn(w));
  assert.equal(res.stoppedAt, "before-touch-2");
  assert.equal(res.stoppedBecause, "replied");
  assert.deepEqual(keys(w), ["SMS-S02-RESUME-1", "EMAIL-S02-RESUME-1"]);

  // Between touch 2 and touch 3.
  w = world({ start: AT_10AM });
  replies(w, "2026-10-29T20:00:00Z");
  res = await run(w, optIn(w));
  assert.equal(res.stoppedAt, "before-touch-3");
  assert.deepEqual(keys(w), TOUCH_KEYS.slice(0, 4));
});

test("a reply from before the run started does not count", async () => {
  const w = world({ start: AT_10AM });
  w.db.events.push(textEvent("2026-10-28T16:59:00Z")); // a minute before the opt-in
  const res = await run(w, optIn(w));
  assert.equal(res.stoppedBecause, undefined);
  assert.deepEqual(keys(w), TOUCH_KEYS);
});

test("an email reply, saved with the person on it, stops the sequence too; somebody else's text does not", async () => {
  let w = world({ start: AT_10AM });
  w.sim.at("2026-10-28T20:00:00Z", () => w.db.events.push(
    { id: "evt-mail-reply", org_id: ORG, client_id: CLIENT, name: "message.inbound", payload: { channel: "email", from: EMAIL }, created_at: "2026-10-28T20:00:00Z" }));
  let res = await run(w, optIn(w));
  assert.equal(res.stoppedAt, "before-touch-2");
  assert.equal(res.stoppedBecause, "replied");

  w = world({ start: AT_10AM });
  w.sim.at("2026-10-28T20:00:00Z", () => w.db.events.push(textEvent("2026-10-28T20:00:00Z", { payload: { from: "+15559998888", channel: "sms" } })));
  res = await run(w, optIn(w));
  assert.equal(res.stoppedBecause, undefined, "a text from another number is not this person writing back");
  assert.deepEqual(keys(w), TOUCH_KEYS);
});

test("booking a call stops the sequence", async () => {
  let w = world({ start: AT_11PM });
  books(w, "2026-10-29T14:00:00Z"); // 7:00 a.m., before touch 1
  let res = await run(w, optIn(w));
  assert.equal(res.stoppedAt, "before-touch-1");
  assert.equal(res.stoppedBecause, "booked");
  assert.equal(w.db.messages.length, 0);

  w = world({ start: AT_10AM });
  books(w, "2026-10-30T12:00:00Z"); // between touch 2 and touch 3
  res = await run(w, optIn(w));
  assert.equal(res.stoppedAt, "before-touch-3");
  assert.equal(res.stoppedBecause, "booked");
  assert.deepEqual(keys(w), TOUCH_KEYS.slice(0, 4));
});

test("finished is checked first, then a reply, then a booking", async () => {
  const w = world({ start: AT_10AM });
  finishes(w, "2026-10-28T17:10:00Z");
  replies(w, "2026-10-28T17:11:00Z");
  books(w, "2026-10-28T17:12:00Z");
  assert.equal((await run(w, optIn(w))).stoppedBecause, "finished");
  const w2 = world({ start: AT_10AM });
  replies(w2, "2026-10-28T17:11:00Z");
  books(w2, "2026-10-28T17:12:00Z");
  assert.equal((await run(w2, optIn(w2))).stoppedBecause, "replied");
});

// ── the words the message carries ────────────────────────────────────────────────────────────────

test("every text and email carries the plain /apply link and never a resume code, even with a signing key", async () => {
  // Containment (2026-10-31): /apply lets a new phone onto an existing lead's email, so a come-back
  // text can reach a stranger. The signing key is set (before()), so a code COULD be minted, and is not.
  const w = world({ start: AT_10AM });
  await run(w, optIn(w));
  assert.equal(w.db.messages.length, 6);
  for (const m of w.db.messages) {
    assert.ok(m.rendered_body.endsWith("here: https://apply.fundhub.ai/apply"), `${m.template_key}: ${m.rendered_body}`);
    assert.ok(!m.rendered_body.includes("?r="), `${m.template_key} carries no resume code`);
    assert.ok(!m.rendered_body.includes("{{"), "no merge tag is left over");
    assert.ok(!m.rendered_body.includes("Pat"), "the neutral copy carries no saved name");
  }
});

test("with no signing key the touches still go, with the same plain apply link", async () => {
  const saved = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  const savedDoc = process.env.DOCUMENT_URL_SECRET;
  delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
  delete process.env.DOCUMENT_URL_SECRET;
  try {
    const w = world({ start: AT_10AM });
    await run(w, optIn(w));
    assert.equal(w.db.messages.length, 6, "a missing key does not stop the follow-up");
    for (const m of w.db.messages) {
      assert.ok(m.rendered_body.includes("https://apply.fundhub.ai/apply"), m.rendered_body);
      assert.ok(!m.rendered_body.includes("?r="), "and it is the plain link");
    }
  } finally {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = saved;
    if (savedDoc !== undefined) process.env.DOCUMENT_URL_SECRET = savedDoc;
  }
});

test("a key with no approved template row is a no-op for that message, and the rest of the sequence goes on", async () => {
  const w = world({ start: AT_10AM, templates: RESUME_TEMPLATE_KEYS.filter((k) => k !== "EMAIL-S02-RESUME-2").map(template) });
  const res = await run(w, optIn(w));
  assert.deepEqual(res.touches[1].email, { sent: false, reason: "template_pending" });
  assert.deepEqual(keys(w), TOUCH_KEYS.filter((k) => k !== "EMAIL-S02-RESUME-2"));
});

// ── saved progress controls stopping, never outbound detail ──────────────────────────────────────

const ANSWERED_THREE = {
  cf_svy_funding_target_amount: "$50k - $100k",
  cf_svy_planned_use: "Not sure yet",
  cf_svy_money_change_now: ["Stability (cover bills / buffer slow weeks)"]
};
const ALL_EIGHT = {
  ...ANSWERED_THREE,
  cf_svy_self_reported_fico: "700-759", cf_svy_has_business: "Yes, 1-2 years",
  cf_svy_business_revenue: "$1M+", cf_svy_revenue_verifiable: "Yes, both", cf_svy_available_capital: "$100k+"
};
const bodyOf = (w, key) => w.db.messages.find((m) => m.template_key === key).rendered_body;

test("even a stale template cannot render saved survey progress into a message", async () => {
  const staleTemplate = (key) => ({ ...template(key),
    body: `${key}: {{survey_stopped_at}} {{survey_taps_left}} {{survey_resume_link}}` });
  const w = world({ start: AT_10AM, clients: [lead({ custom_fields: { ...ANSWERED_THREE } })],
    templates: RESUME_TEMPLATE_KEYS.map(staleTemplate) });
  await run(w, optIn(w));
  assert.equal(w.db.messages.length, 6);
  for (const m of w.db.messages) {
    assert.ok(!m.rendered_body.includes("credit score question"), m.rendered_body);
    assert.ok(!m.rendered_body.includes("5 more taps"), m.rendered_body);
    assert.match(m.rendered_body, /https:\/\/apply\.fundhub\.ai\/apply$/, "the plain link (containment 2026-10-31)");
    assert.ok(!m.rendered_body.includes("{{"), "no merge tag is left over");
  }
});

test("someone who answered nothing gets the neutral link without saved progress", async () => {
  const w = world({ start: AT_10AM });
  await run(w, optIn(w));
  assert.equal(w.db.messages.length, 6);
  assert.ok(bodyOf(w, "SMS-S02-RESUME-1").includes("Start your questions here: https://apply.fundhub.ai/apply"));
  assert.ok(!bodyOf(w, "SMS-S02-RESUME-1").includes("first question"));
});

test("one question left still gets a neutral message", async () => {
  const sevenAnswered = { ...ALL_EIGHT };
  delete sevenAnswered.cf_svy_available_capital;
  const w = world({ start: AT_10AM, clients: [lead({ custom_fields: sevenAnswered })] });
  await run(w, optIn(w));
  assert.equal(w.db.messages.length, 6);
  assert.ok(bodyOf(w, "EMAIL-S02-RESUME-1").includes("Start your questions here: https://apply.fundhub.ai/apply"));
  assert.ok(!bodyOf(w, "EMAIL-S02-RESUME-1").includes("last question"));
});

test("new answers before a later touch still stop a completed survey", async () => {
  const w = world({ start: AT_10AM });
  // 1:00 a.m. on day 2: three more answered. 1:00 a.m. on day 3: all remaining answers.
  w.sim.at("2026-10-29T08:00:00Z", () => Object.assign(w.db.clients[0].custom_fields, ANSWERED_THREE));
  w.sim.at("2026-10-30T08:00:00Z", () => Object.assign(w.db.clients[0].custom_fields, ALL_EIGHT));
  const res = await run(w, optIn(w));
  assert.equal(res.stoppedAt, "before-touch-3");
  assert.equal(res.stoppedBecause, "all_answered");
  assert.equal(w.db.messages.length, 4);
  assert.ok(w.db.messages.every((m) => !m.rendered_body.includes("credit score question")));
});

test("every question answered and no finish on record: nothing is sent, the sequence stops, the person is tagged", async () => {
  const w = world({ start: AT_10AM, clients: [lead({ custom_fields: { ...ALL_EIGHT } })] });
  const res = await run(w, optIn(w));
  assert.equal(res.stoppedAt, "before-touch-1");
  assert.equal(res.stoppedBecause, "all_answered");
  assert.equal(w.db.messages.length, 0);
  assert.deepEqual(w.db.clients[0].tags, ["survey:complete"]);
});

test("every question answered after touch 1: touch 1 stays sent, touch 2 does not go", async () => {
  const w = world({ start: AT_10AM });
  w.sim.at("2026-10-29T08:00:00Z", () => Object.assign(w.db.clients[0].custom_fields, ALL_EIGHT));
  const res = await run(w, optIn(w));
  assert.equal(res.stoppedAt, "before-touch-2");
  assert.equal(res.stoppedBecause, "all_answered");
  assert.deepEqual(keys(w), ["SMS-S02-RESUME-1", "EMAIL-S02-RESUME-1"]);
});

// ── no double sends ──────────────────────────────────────────────────────────────────────────────

test("a replayed run keeps its times and sends nothing twice", async () => {
  const w = world({ start: AT_11PM });
  const event = optIn(w);
  const first = await run(w, event);
  const planned = w.sim.sleeps.map((s) => s.until);
  assert.equal(w.db.messages.length, 6);

  // The server was down for a day, then Inngest runs the whole function again from the top.
  w.sim.jump(24 * 60 * 60 * 1000);
  const again = await w.sim.replay(event.id);
  assert.equal(w.db.messages.length, 6, "nothing was sent a second time");
  assert.deepEqual(again, first, "and the answer is the recorded one");
  assert.deepEqual(w.sim.sleeps.map((s) => s.until), planned, "no touch moved");
});

test("every wake runs the function again from the top, and the plan made at the opt-in still holds", async () => {
  // The run is invoked four times (the opt-in and the three wakes). The planned times are the ones worked out
  // at 11 p.m.; a plan worked out in the open would have been worked out again at each wake, against a later clock.
  const w = world({ start: AT_11PM });
  await run(w, optIn(w));
  assert.deepEqual(w.sim.sleeps.map((s) => s.until), [NINE_AM(29), NINE_AM(30), NINE_AM(31)]);
  assert.ok(w.sim.now() >= Date.parse(NINE_AM(31)));
  assert.deepEqual(queuedAt(w), [NINE_AM(29), NINE_AM(29), NINE_AM(30), NINE_AM(30), NINE_AM(31), NINE_AM(31)]);
});

test("two runs for one opt-in share one message per touch", async () => {
  const w = world({ start: AT_10AM });
  const first = optIn(w, { id: "evt-a", at: "2026-10-28T17:00:00.000Z" });
  const second = optIn(w, { id: "evt-b", at: "2026-10-28T17:00:00.066Z" }); // another post of the same application
  const [a, b] = await runAll(w, first, second);
  assert.equal(a.stoppedBecause, undefined);
  assert.equal(b.stoppedBecause, undefined);
  assert.equal(w.db.messages.length, 6, "six messages, not twelve");
  assert.deepEqual(
    [...new Set(w.db.messages.map((m) => m.provider_ref.split(":").pop()))],
    ["evt-a"],
    "both runs keyed their sends on the first post of the application"
  );
});

test("a lead who comes back through touch 2's link and stops again does not start a second sequence", async () => {
  const w = world({ start: AT_10AM });
  const first = optIn(w, { id: "evt-a", at: "2026-10-28T17:00:00.000Z" });
  // 11:00 a.m. on day 2: touch 2 went at 9, they answered another question and left. The adapter's six-hour
  // repeat guard has run out, so that post starts a new run, with a different send key.
  const again = optIn(w, { id: "evt-later", at: "2026-10-29T18:00:00.000Z" });
  const [a, b] = await runAll(w, first, again);
  assert.deepEqual(b, { done: false, reason: "sequence_in_flight" });
  assert.equal(a.stoppedBecause, undefined);
  assert.deepEqual(keys(w), TOUCH_KEYS, "the first run finishes its three touches; nobody gets a second touch 1");
  assert.deepEqual(queuedAt(w), [
    "2026-10-28T17:20:00.000Z", "2026-10-28T17:20:00.000Z", NINE_AM(29), NINE_AM(29), NINE_AM(30), NINE_AM(30)
  ]);
});

test("a lead who comes back long after the last sequence is followed up again", async () => {
  const w = world({ start: AT_10AM });
  const first = optIn(w, { id: "evt-a", at: "2026-10-28T17:00:00.000Z" });
  const back = optIn(w, { id: "evt-months-later", at: iso(Date.parse("2026-10-28T17:00:00Z") + SEQUENCE_WINDOW_MS + 2 * 24 * 60 * 60 * 1000) });
  const [a, b] = await runAll(w, first, back);
  assert.equal(a.stoppedBecause, undefined);
  assert.equal(b.done, true);
  assert.equal(b.stoppedBecause, undefined);
  assert.equal(w.db.messages.length, 12, "a fresh sequence of three touches, text and email");
});

test("a fresh opt-in after touch 3 starts a new sequence even inside the four-day duplicate window", async () => {
  const w = world({ start: AT_10AM });
  const first = optIn(w, { id: "evt-a", at: AT_10AM });
  const fresh = optIn(w, { id: "evt-fresh", at: "2026-10-31T17:00:00.000Z" });
  const a = await run(w, first);
  w.db.sentLog.forEach((m) => { m.status = "sent"; });
  const b = await run(w, fresh);
  assert.equal(a.stoppedBecause, undefined);
  assert.equal(b.stoppedBecause, undefined);
  assert.equal(w.db.messages.length, 12, "the completed old sequence cannot suppress the new opt-in");
  assert.deepEqual([...new Set(w.db.messages.map((m) => m.provider_ref.split(":").pop()))], ["evt-a", "evt-fresh"]);
});

test("a queued old touch 3 still blocks a fresh sequence until the old outbox clears", async () => {
  const w = world({ start: AT_10AM });
  const first = optIn(w, { id: "evt-a", at: AT_10AM });
  const fresh = optIn(w, { id: "evt-fresh", at: "2026-10-31T17:00:00.000Z" });
  await run(w, first);
  const b = await run(w, fresh);
  assert.deepEqual(b, { done: false, reason: "sequence_in_flight" });
  assert.equal(w.db.messages.length, 6, "the old queued touches are the only sequence");
});

test("an old touch 3 dispatched after the fresh opt-in cannot unlock a second sequence", async () => {
  const w = world({ start: AT_10AM });
  const first = optIn(w, { id: "evt-a", at: AT_10AM });
  const fresh = optIn(w, { id: "evt-fresh", at: "2026-10-31T17:00:00.000Z" });
  await run(w, first);
  w.db.sentLog.forEach((m) => { m.status = "sent"; });
  const oldTouch3 = w.db.sentLog.find((m) => m.template_key === TOUCHES[2].sms);
  oldTouch3.lastAttemptAt = Date.parse("2026-10-31T17:01:00.000Z");
  const b = await run(w, fresh);
  assert.deepEqual(b, { done: false, reason: "sequence_in_flight" });
  assert.equal(w.db.messages.length, 6);
});

test("no client means no follow-up", async () => {
  const sim = inngestSim(AT_10AM);
  const db = withReads(withReplyRead(pgFake({ templates: RESUME_TEMPLATE_KEYS.map(template) })), sim);
  const event = { id: "evt-x", orgId: ORG, name: "entry.captured", payload: {} };
  const [res] = await sim.runAll([{ key: "x", at: AT_10AM, fn: (step) => runFollowUp({ event, db, step, now: sim.now }) }]);
  assert.deepEqual(res, { done: false, reason: "no_client" });
  assert.equal(db.messages.length, 0);
});

// ── the three questions, asked of the database ───────────────────────────────────────────────────

// T14-11 regression: capture sources that predate the client_id fix wrote survey events with
// client_id NULL. A check that reads only client_id could never see them, so people who HAD
// finished were still nudged. The email arm sees them, and only them.
function eventsDb(rows) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      assert.match(sql, /SELECT DISTINCT name FROM events/);
      const [clientId, names, addr, orgId] = params;
      const hits = rows
        .filter((e) => names.includes(e.name))
        .filter((e) => orgId == null || e.org_id === orgId)
        .filter((e) => e.client_id === clientId || (e.client_id == null && addr !== "" && e.email === addr));
      return { rows: hits.map((e) => ({ name: e.name })) };
    }
  };
}

test("surveyCompleted asks for survey.completed, never survey.submitted", async () => {
  const db = eventsDb([{ client_id: "cl-1", name: "survey.submitted", org_id: "org-1" }]);
  assert.equal(await surveyCompleted(db, "cl-1", null, "org-1"), false);
  assert.deepEqual(db.seen[0].params[1], ["survey.completed"]);
});

test("surveyCompleted matches a survey.completed row that has no client_id, by email", async () => {
  const db = eventsDb([{ client_id: null, name: "survey.completed", email: "a@b.com", org_id: "org-1" }]);
  assert.equal(await surveyCompleted(db, "cl-1", "a@b.com", "org-1"), true);
  assert.equal(await surveyCompleted(db, "cl-1", "A@B.com", "org-1"), true, "email compare is case-insensitive");
  assert.equal(await surveyCompleted(db, "cl-1", null, "org-1"), false, "no email and no client_id link → not completed");
});

test("surveyCompleted still matches on client_id alone, and never across companies", async () => {
  const db = eventsDb([{ client_id: "cl-1", name: "survey.completed", email: null, org_id: "org-1" }]);
  assert.equal(await surveyCompleted(db, "cl-1", null, "org-1"), true);
  assert.equal(await surveyCompleted(db, "cl-2", null, "org-1"), false);
  assert.equal(await surveyCompleted(db, "cl-1", null, "org-2"), false, "another company's row is not this person's");
});

test("surveyCompleted: a row stamped with somebody else's id is theirs, even when the email matches", async () => {
  const db = eventsDb([{ client_id: "cl-other", name: "survey.completed", email: "a@b.com", org_id: "org-1" }]);
  assert.equal(await surveyCompleted(db, "cl-1", "a@b.com", "org-1"), false);
});

test("stopReason is null for a lead with no finish, reply or booking", async () => {
  const w = world();
  const event = optIn(w);
  assert.equal(await stopReason(w.db, { orgId: ORG, clientId: CLIENT, email: EMAIL, eventId: event.id }), null);
});
