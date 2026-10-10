// Messages truth — the SQL itself, on a real Postgres. Read only.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run it:  DATABASE_URL=postgres://... node --test src/pulse/coverage/gap-msg.pg.test.mjs
//
// WHY THIS FILE EXISTS. gap-msg.test.mjs hands the lane a fake database that returns canned rows. That proves the
// wording and the status rules. It cannot prove the SQL, and the SQL is where the logic lives: the blank-spot
// patterns, the staff-address match, the duplicate-text window, the HELP match. These scenarios run the real SQL on a
// real Postgres and make it answer for made-up messages.
//
// HOW IT STAYS HARMLESS. Each query runs inside BEGIN READ ONLY and is always rolled back. The real tables are
// shadowed by a CTE that holds ONLY the made-up rows of that scenario, so no real row is read and the test works the
// same on an empty scratch database as on production. Nothing is written (the database would refuse it). Nothing is
// sent.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { pool, close } from "../../db.mjs";
import {
  BLANKS_SQL,
  BLANKS_TOTAL_SQL,
  DAILY_SENDS_SQL,
  DEAD_QUEUED_SQL,
  DUPLICATE_TEXTS_SQL,
  HELP_SQL,
  HIRING_BLOCKED_SQL,
  OWNER_ALERTS_SQL,
  PAUSED_SENDS_SQL,
  RE_STAFF_COPY,
  STAFF_TEMPLATE_KEYS,
  STAFF_TO_CLIENT_SQL,
  TEMPLATE_PATH_SQL,
  buildEmailStepsSql
} from "./gap-msg.mjs";
import { TEST_ADDRESS_RE } from "./gap-sms.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SKIP = HAS_DB ? false : "no DATABASE_URL";
const ORG = crypto.randomUUID();
const OTHER_ORG = crypto.randomUUID();
const NOW = new Date("2026-10-10T13:00:00.000Z");
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60000).toISOString();
const H = 60;
const D = 24 * 60;
const uuid = () => crypto.randomUUID();

const SHADOWS = {
  messages: {
    cols: "id, org_id, client_id, direction, channel, template_key, rendered_body, subject, status, created_at, last_attempt_at, to_address, is_demo, provider_ref, blocked_reason, sender_staff_id",
    rec: "id uuid, org_id uuid, client_id uuid, direction text, channel text, template_key text, rendered_body text, subject text, status text, created_at timestamptz, last_attempt_at timestamptz, to_address text, is_demo boolean, provider_ref text, blocked_reason text, sender_staff_id uuid"
  },
  clients: {
    cols: "id, org_id, email, phone, custom_fields, is_demo",
    rec: "id uuid, org_id uuid, email text, phone text, custom_fields jsonb, is_demo boolean"
  },
  staff: {
    cols: "org_id, email, phone",
    rec: "org_id uuid, email text, phone text"
  },
  events: {
    cols: "id, org_id, name, client_id, payload, created_at, is_demo",
    rec: "id uuid, org_id uuid, name text, client_id uuid, payload jsonb, created_at timestamptz, is_demo boolean"
  },
  message_templates: {
    cols: "org_id, template_key, channel, compliance_passed, body, subject",
    rec: "org_id uuid, template_key text, channel text, compliance_passed boolean, body text, subject text"
  },
  owner_notifications: {
    cols: "org_id, status, created_at",
    rec: "org_id uuid, status text, created_at timestamptz"
  }
};

let conn = null;

before(async () => {
  if (!HAS_DB) return;
  conn = await pool().connect();
  await conn.query("BEGIN READ ONLY");
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
  return `WITH ${ctes}\n${sql}`;
}

async function rows(sql, params, fakes = {}) {
  const text = withShadows(sql, params.length);
  const extra = Object.keys(SHADOWS).map((t) => JSON.stringify(fakes[t] || []));
  const res = await conn.query(text, [...params, ...extra]);
  return res.rows;
}

const one = async (sql, params, fakes) => (await rows(sql, params, fakes))[0];

// ── made-up rows ─────────────────────────────────────────────────────────────

function client(over = {}) {
  const id = over.id || uuid();
  return {
    id, org_id: ORG, email: over.email ?? `maria.${id.slice(0, 6)}@gmail.com`, phone: over.phone ?? "+16025550142",
    custom_fields: over.custom_fields || {}, is_demo: over.is_demo ?? false
  };
}

function msg(over = {}) {
  return {
    id: uuid(), org_id: ORG, client_id: null, direction: "outbound", channel: "email", template_key: "EMAIL-TEST-1",
    rendered_body: "Hello Maria, your file is ready.", subject: null, status: "delivered", created_at: ago(2 * H),
    last_attempt_at: ago(2 * H), to_address: "maria@gmail.com", is_demo: false, provider_ref: null, blocked_reason: null,
    sender_staff_id: null, ...over
  };
}

function ev(name, minutesAgo, payload = {}, over = {}) {
  return { id: uuid(), org_id: ORG, name, client_id: over.client_id ?? null, payload, created_at: ago(minutesAgo), is_demo: over.is_demo ?? false };
}

const templ = (key, over = {}) => ({ org_id: ORG, template_key: key, channel: "email", compliance_passed: true, body: "Hi", subject: "Hello", ...over });

const BY_KEY = (list) => Object.fromEntries(list.map((r) => [r.template_key, r]));

// ── 1. blank spots ───────────────────────────────────────────────────────────

test("blanks: each kind of blank is counted on its own template, and clean copy is not", { skip: SKIP }, async () => {
  const messages = [
    msg({ template_key: "T-DOLLAR", rendered_body: "Total funding secured: $" }),
    msg({ template_key: "T-DOLLAR-LINE", rendered_body: "Your approval: $\nNext step is a call." }),
    msg({ template_key: "T-GREETING", channel: "sms", rendered_body: "Hi , we got your file." }),
    msg({ template_key: "T-SPACES", rendered_body: "We had you down for  and did not connect." }),
    msg({ template_key: "T-BRACES", rendered_body: "Hi {{contact.first_name}}, welcome." }),
    msg({ template_key: "T-WORDS", rendered_body: "This is a placeholder for the real note." }),
    msg({ template_key: "T-DRAFT", rendered_body: "[DRAFT] Welcome aboard." }),
    msg({ template_key: "T-SUBJECT", subject: "Your  approval", rendered_body: "Hello." }),
    // clean: a real amount, "$.50", a sentence end followed by two spaces, an HTML page with source spacing
    msg({ template_key: "T-CLEAN-1", rendered_body: "You got $3,000 today. See https://fundhub.ai/x.  Reply STOP to opt out." }),
    msg({ template_key: "T-CLEAN-2", rendered_body: "It is $.50 and $ 3,000 and $0." }),
    msg({ template_key: "T-CLEAN-HTML", rendered_body: "<p>Hello</p>\n<td>  Maria </td> we had you down for  Thursday" })
  ];
  const got = BY_KEY(await rows(BLANKS_SQL, [ORG, ago(D), TEST_ADDRESS_RE], { messages }));
  assert.deepEqual(Object.keys(got).sort(), ["T-BRACES", "T-DOLLAR", "T-DOLLAR-LINE", "T-DRAFT", "T-GREETING", "T-SPACES", "T-SUBJECT", "T-WORDS"]);
  assert.equal(got["T-DOLLAR"].dollar_n, 1);
  assert.equal(got["T-DOLLAR-LINE"].dollar_n, 1);
  assert.equal(got["T-GREETING"].greeting_n, 1);
  assert.equal(got["T-SPACES"].spaces_n, 1);
  assert.equal(got["T-SUBJECT"].spaces_n, 1);
  assert.equal(got["T-BRACES"].braces_n, 1);
  assert.equal(got["T-WORDS"].words_n, 1);
  assert.equal(got["T-DRAFT"].words_n, 1);
  assert.equal(got["T-DOLLAR"].spaces_n, 0, "one kind does not leak into another");
});

test("blanks: only mail that left or is about to, in the window, real, with a template, in this company", { skip: SKIP }, async () => {
  const blank = "Total funding secured: $";
  const messages = [
    msg({ template_key: "IN-DELIVERED", rendered_body: blank, status: "delivered" }),
    msg({ template_key: "IN-QUEUED", rendered_body: blank, status: "queued" }),
    msg({ template_key: "IN-SENT", rendered_body: blank, status: "sent" }),
    msg({ template_key: "OUT-FAILED", rendered_body: blank, status: "failed" }),
    msg({ template_key: "OUT-BLOCKED", rendered_body: blank, status: "blocked" }),
    msg({ template_key: "OUT-OLD", rendered_body: blank, created_at: ago(3 * D) }),
    msg({ template_key: "OUT-DEMO", rendered_body: blank, is_demo: true }),
    msg({ template_key: "OUT-TESTADDR", rendered_body: blank, to_address: "walk-1@example.com" }),
    msg({ template_key: "OUT-PLUS", rendered_body: blank, to_address: "e2e+abc@fundhub.ai" }),
    msg({ template_key: null, rendered_body: blank }),
    msg({ template_key: "OUT-INBOUND", rendered_body: blank, direction: "inbound" }),
    msg({ template_key: "OUT-OTHER-ORG", rendered_body: blank, org_id: OTHER_ORG })
  ];
  const synthetic = client({ custom_fields: { synthetic: "true" } });
  const demo = client({ is_demo: true });
  messages.push(msg({ template_key: "OUT-SYNTHETIC", rendered_body: blank, client_id: synthetic.id }));
  messages.push(msg({ template_key: "OUT-DEMO-CLIENT", rendered_body: blank, client_id: demo.id }));
  const got = await rows(BLANKS_SQL, [ORG, ago(D), TEST_ADDRESS_RE], { messages, clients: [synthetic, demo] });
  assert.deepEqual(got.map((r) => r.template_key).sort(), ["IN-DELIVERED", "IN-QUEUED", "IN-SENT"]);
  const total = await one(BLANKS_TOTAL_SQL, [ORG, ago(D), TEST_ADDRESS_RE], { messages, clients: [synthetic, demo] });
  assert.equal(total.n, 3, "the total counts the same population the blanks are drawn from");
});

// ── 2. staff templates to a non-staff address ────────────────────────────────

test("staff template: a staff key or staff copy that went to anyone but staff is counted; one that went to staff is not", { skip: SKIP }, async () => {
  const staff = [{ org_id: ORG, email: "Closer@Fundhub.ai", phone: "+1 (602) 555-0100" }];
  const maria = client({ email: "maria@gmail.com", phone: "+16025550142" });
  const closerAsClient = client({ email: "closer@fundhub.ai", phone: "+16025550100" });
  const messages = [
    msg({ template_key: "EMAIL-DPC05-NO-PROGRESS-72H", channel: "email", to_address: "maria@gmail.com", client_id: maria.id }),
    msg({ template_key: "EMAIL-DPC05-NO-PROGRESS-72H", channel: "email", to_address: "closer@fundhub.ai", client_id: maria.id }),
    msg({ template_key: "SMS-DEAL-CLOSE-WIN", channel: "sms", to_address: "+16025550100", client_id: maria.id }),
    msg({ template_key: "SMS-DEAL-CLOSE-WIN", channel: "sms", to_address: "+16025550142", client_id: maria.id }),
    msg({ template_key: "EMAIL-SOMETHING-NEW", channel: "email", to_address: "maria@gmail.com", client_id: maria.id, rendered_body: "Internal alert — this record has had no progress for 72+ hours." }),
    msg({ template_key: "EMAIL-S00-WELCOME", channel: "email", to_address: "maria@gmail.com", client_id: maria.id, rendered_body: "Welcome, Maria." }),
    msg({ template_key: "EMAIL-DPC05-NO-PROGRESS-72H", channel: "email", to_address: null, client_id: closerAsClient.id }),
    msg({ template_key: "EMAIL-DPC05-NO-PROGRESS-72H", channel: "email", to_address: "ops@fundhub.ai", client_id: maria.id }),
    msg({ template_key: "EMAIL-DPC05-NO-PROGRESS-72H", channel: "email", to_address: "maria@gmail.com", client_id: maria.id, status: "failed" })
  ];
  const params = [ORG, ago(7 * D), [...STAFF_TEMPLATE_KEYS], RE_STAFF_COPY, TEST_ADDRESS_RE, "ops@fundhub.ai"];
  const got = await rows(STAFF_TO_CLIENT_SQL, params, { messages, clients: [maria, closerAsClient], staff });
  const by = BY_KEY(got);
  assert.equal(by["EMAIL-DPC05-NO-PROGRESS-72H"].n, 1, "only the one to Maria; staff, the client-with-staff-email, the alert address and the failed one are not counted");
  assert.equal(by["SMS-DEAL-CLOSE-WIN"].n, 1, "the text to the closer's number is fine, the text to Maria's number is not");
  assert.equal(by["EMAIL-SOMETHING-NEW"].n, 1, "staff copy is caught by its words even when the key is not on the list");
  assert.equal(by["EMAIL-S00-WELCOME"], undefined);
});

// ── 4. per-template path ─────────────────────────────────────────────────────

test("per-template path: each stage is counted per template, and a row younger than the grace is not 'aged'", { skip: SKIP }, async () => {
  const messages = [
    msg({ template_key: "T-DEAD", status: "sent", created_at: ago(30 * H) }),
    msg({ template_key: "T-DEAD", status: "sent", created_at: ago(40 * H) }),
    msg({ template_key: "T-DEAD", status: "bounced", created_at: ago(50 * H) }),
    msg({ template_key: "T-DEAD", status: "queued", created_at: ago(1 * H) }),
    msg({ template_key: "T-ALIVE", status: "delivered", created_at: ago(30 * H) }),
    msg({ template_key: "T-ALIVE", status: "sent", created_at: ago(40 * H) }),
    msg({ template_key: "T-HELD", status: "blocked", created_at: ago(40 * H) })
  ];
  const got = BY_KEY(await rows(TEMPLATE_PATH_SQL, [ORG, ago(7 * D), ago(24 * H), TEST_ADDRESS_RE], { messages }));
  assert.deepEqual(
    { aged: got["T-DEAD"].aged_n, delivered: got["T-DEAD"].delivered_n, sent: got["T-DEAD"].sent_n, failed: got["T-DEAD"].failed_n, waiting: got["T-DEAD"].waiting_n },
    { aged: 3, delivered: 0, sent: 2, failed: 1, waiting: 1 }
  );
  assert.equal(got["T-ALIVE"].delivered_n, 1);
  assert.equal(got["T-HELD"], undefined, "a message our gate held is not part of the path");
});

test("per-template path: an event with no email is counted, an event with one is not, and each guard of the step holds", { skip: SKIP }, async () => {
  const maria = client({ email: "maria@gmail.com" });
  const welcomed = client({ email: "welcomed@gmail.com" });
  const demo = client({ is_demo: true });
  const e = {
    missing: ev("entry.captured", 90, { email: "maria@gmail.com" }, { client_id: maria.id }),
    made: ev("entry.captured", 95, { email: "x@gmail.com" }),
    repeat: ev("entry.captured", 80, { email: "welcomed@gmail.com" }, { client_id: welcomed.id }),
    demoEvt: ev("entry.captured", 70, { email: "d@gmail.com" }, { is_demo: true }),
    demoClient: ev("entry.captured", 70, { email: "dc@gmail.com" }, { client_id: demo.id }),
    fresh: ev("entry.captured", 5, { email: "fresh@gmail.com" }),
    old: ev("entry.captured", 9 * D, { email: "old@gmail.com" }),
    bookMissing: ev("booking.created", 120, { email: "b@gmail.com" }),
    bookMade: ev("booking.created", 120, { email: "b2@gmail.com" }),
    zeroAmount: ev("round.approved", 60, { email: "z@gmail.com", approvedAmount: "0" }),
    amount: ev("round.approved", 60, { email: "a@gmail.com", approvedAmount: "25000" }),
    noRound: ev("round.submitted", 60, { email: "r@gmail.com" }),
    withRound: ev("round.submitted", 60, { email: "r2@gmail.com", roundNumber: 2 })
  };
  const messages = [
    msg({ provider_ref: `workflow:EMAIL-S00-WELCOME:${e.made.id}`, template_key: "EMAIL-S00-WELCOME" }),
    msg({ provider_ref: `workflow:EMAIL-S04-01-CONFIRM:${e.bookMade.id}:confirm-email`, template_key: "EMAIL-S04-01-CONFIRM" }),
    msg({ client_id: welcomed.id, template_key: "EMAIL-S00-WELCOME", provider_ref: "workflow:EMAIL-S00-WELCOME:an-earlier-event" })
  ];
  const templates = [
    templ("EMAIL-S00-WELCOME"),
    templ("EMAIL-S04-01-CONFIRM"),
    templ("EMAIL-F04-ROUND-APPROVALS"),
    templ("EMAIL-F03-ROUND-SUBMITTED", { compliance_passed: false })
  ];
  const got = await one(buildEmailStepsSql(), [ORG, ago(15), ago(7 * D)], {
    events: Object.values(e), messages, message_templates: templates, clients: [maria, welcomed, demo]
  });
  // missing welcome (maria), missing confirm (bookMissing), the approval with an amount. Not: the one with a message,
  // the repeat for a person already welcomed, demo, too fresh, too old, a zero amount, no round, an unapproved template.
  assert.equal(got.n, 3);
  assert.deepEqual([...got.names].sort(), ["EMAIL-F04-ROUND-APPROVALS", "EMAIL-S00-WELCOME", "EMAIL-S04-01-CONFIRM"]);
});

// ── 5. brakes ────────────────────────────────────────────────────────────────

test("brakes: only a message that left after the pause began is counted, test traffic and other states are not", { skip: SKIP }, async () => {
  const since = ago(10 * H);
  const messages = [
    msg({ status: "sent", last_attempt_at: ago(5 * H) }),
    msg({ status: "delivered", last_attempt_at: ago(2 * H) }),
    msg({ status: "sent", last_attempt_at: ago(20 * H), created_at: ago(20 * H) }),
    msg({ status: "queued", last_attempt_at: null, created_at: ago(1 * H) }),
    msg({ status: "failed", last_attempt_at: ago(1 * H) }),
    msg({ status: "sent", last_attempt_at: ago(1 * H), is_demo: true }),
    msg({ status: "sent", last_attempt_at: null, created_at: ago(3 * H) })
  ];
  const got = await one(PAUSED_SENDS_SQL, [ORG, since, TEST_ADDRESS_RE], { messages });
  assert.equal(got.n, 3, "two stamped after the pause, plus one with no attempt time whose creation time is after it");
});

test("brakes: sends are counted per day on the day the app's own cap counts (created_at), left states only", { skip: SKIP }, async () => {
  const messages = [
    ...Array.from({ length: 3 }, () => msg({ status: "sent", created_at: "2026-10-08T10:00:00Z" })),
    ...Array.from({ length: 2 }, () => msg({ status: "delivered", created_at: "2026-10-09T10:00:00Z" })),
    msg({ status: "failed", created_at: "2026-10-09T11:00:00Z" }),
    msg({ status: "queued", created_at: "2026-10-09T11:00:00Z" }),
    msg({ status: "sent", created_at: "2026-10-01T11:00:00Z" })
  ];
  const got = await rows(DAILY_SENDS_SQL, [ORG, "2026-10-07T18:00:00Z"], { messages });
  assert.deepEqual(got.map((r) => r.n), [3, 2]);
});

test("brakes: the same text to the same phone twice inside the window is counted, and each exemption holds", { skip: SKIP }, async () => {
  const p1 = "+16025550142";
  const base = { channel: "sms", template_key: "SMS-S00-WELCOME", status: "delivered" };
  const messages = [
    // twice, 3 hours apart -> a repeat
    msg({ ...base, to_address: p1, created_at: ago(10 * H) }),
    msg({ ...base, to_address: p1, created_at: ago(7 * H) }),
    // the same number typed two ways -> a repeat
    msg({ ...base, template_key: "SMS-SLO-197", to_address: "(602) 555-0143", created_at: ago(9 * H) }),
    msg({ ...base, template_key: "SMS-SLO-197", to_address: "+16025550143", created_at: ago(8 * H) }),
    // no template, same words -> a repeat
    msg({ ...base, template_key: null, rendered_body: "Your call is at 3.", to_address: "+16025550144", created_at: ago(6 * H) }),
    msg({ ...base, template_key: null, rendered_body: "Your call is at 3.", to_address: "+16025550144", created_at: ago(5 * H) }),
    // 30 hours apart -> fine
    msg({ ...base, template_key: "SMS-A", to_address: "+16025550145", created_at: ago(40 * H) }),
    msg({ ...base, template_key: "SMS-A", to_address: "+16025550145", created_at: ago(10 * H) }),
    // two different templates, same phone -> fine
    msg({ ...base, template_key: "SMS-B", to_address: "+16025550146", created_at: ago(4 * H) }),
    msg({ ...base, template_key: "SMS-C", to_address: "+16025550146", created_at: ago(3 * H) }),
    // a person typed both -> fine
    msg({ ...base, template_key: "SMS-D", to_address: "+16025550147", created_at: ago(4 * H), sender_staff_id: uuid() }),
    msg({ ...base, template_key: "SMS-D", to_address: "+16025550147", created_at: ago(3 * H), sender_staff_id: uuid() }),
    // the second one failed -> only one text reached the phone
    msg({ ...base, template_key: "SMS-E", to_address: "+16025550148", created_at: ago(4 * H) }),
    msg({ ...base, template_key: "SMS-E", to_address: "+16025550148", created_at: ago(3 * H), status: "failed" })
  ];
  const got = BY_KEY(await rows(DUPLICATE_TEXTS_SQL, [ORG, ago(3 * D), 24, TEST_ADDRESS_RE], { messages }));
  assert.deepEqual(Object.keys(got).sort(), ["(no template)", "SMS-S00-WELCOME", "SMS-SLO-197"]);
  assert.equal(got["SMS-S00-WELCOME"].n, 1);
  assert.equal(got["SMS-SLO-197"].n, 1);
  assert.equal(got["(no template)"].n, 1);
});

// ── 6. dead senders and the two held queues ──────────────────────────────────

test("dead senders: only a queued message from a listed key, in the window, real, in this company", { skip: SKIP }, async () => {
  const keys = ["EMAIL-N01-COLD-NURTURE", "SMS-C06-DECLINE"];
  const messages = [
    msg({ template_key: "EMAIL-N01-COLD-NURTURE", status: "queued" }),
    msg({ template_key: "EMAIL-N01-COLD-NURTURE", status: "queued" }),
    msg({ template_key: "SMS-C06-DECLINE", channel: "sms", status: "blocked" }),
    msg({ template_key: "EMAIL-S00-WELCOME" }),
    msg({ template_key: "EMAIL-N01-COLD-NURTURE", created_at: ago(30 * D) }),
    msg({ template_key: "EMAIL-N01-COLD-NURTURE", is_demo: true }),
    msg({ template_key: "EMAIL-N01-COLD-NURTURE", org_id: OTHER_ORG })
  ];
  const got = BY_KEY(await rows(DEAD_QUEUED_SQL, [ORG, ago(7 * D), keys, TEST_ADDRESS_RE], { messages }));
  assert.equal(got["EMAIL-N01-COLD-NURTURE"].n, 2);
  assert.equal(got["SMS-C06-DECLINE"].n, 1);
  assert.equal(got["EMAIL-S00-WELCOME"], undefined);
});

test("owner alerts: queued past the grace, or failed, is counted; fresh and sent are not", { skip: SKIP }, async () => {
  const owner_notifications = [
    { org_id: ORG, status: "queued", created_at: ago(3 * H) },
    { org_id: ORG, status: "queued", created_at: ago(10) },
    { org_id: ORG, status: "failed", created_at: ago(10) },
    { org_id: ORG, status: "sent", created_at: ago(5 * D) },
    { org_id: OTHER_ORG, status: "queued", created_at: ago(5 * D) }
  ];
  const got = await rows(OWNER_ALERTS_SQL, [ORG, ago(1 * H)], { owner_notifications });
  const by = Object.fromEntries(got.map((r) => [r.status, r.n]));
  assert.deepEqual(by, { failed: 1, queued: 1 });
});

test("hiring outreach: blocked as recipient unknown, or stuck queued, is counted; a delivered one and other keys are not", { skip: SKIP }, async () => {
  const messages = [
    msg({ template_key: "EMAIL-CANDIDATE-OUTREACH-1", status: "blocked", blocked_reason: "recipient_unknown" }),
    msg({ template_key: "SMS-CANDIDATE-OUTREACH-2", channel: "sms", status: "queued", created_at: ago(5 * H) }),
    msg({ template_key: "SMS-CANDIDATE-OUTREACH-3", channel: "sms", status: "queued", created_at: ago(5) }),
    msg({ template_key: "EMAIL-CANDIDATE-OUTREACH-4", status: "delivered" }),
    msg({ template_key: "EMAIL-CANDIDATE-OUTREACH-1", status: "blocked", blocked_reason: "opted_out" }),
    msg({ template_key: "AF1", status: "blocked", blocked_reason: "recipient_unknown" })
  ];
  const got = await rows(HIRING_BLOCKED_SQL, [ORG, ago(1 * H)], { messages });
  assert.deepEqual(got.map((r) => `${r.template_key}:${r.status}`).sort(), [
    "EMAIL-CANDIDATE-OUTREACH-1:blocked", "SMS-CANDIDATE-OUTREACH-2:queued"
  ]);
});

// ── 7. HELP ──────────────────────────────────────────────────────────────────

test("help reply: an unanswered HELP is counted; an answered one, a failed answer, our own line and a sentence are each judged right", { skip: SKIP }, async () => {
  const OUR = "+18005550100";
  const inbound = (from, body, minutesAgo, over = {}) => ev("message.inbound", minutesAgo, { from, to: OUR, body, channel: "sms" }, over);
  const events = [
    inbound("+16025550111", "HELP", 5 * H),           // answered
    inbound("+16025550112", "help!", 5 * H),          // unanswered (punctuation and case do not matter)
    inbound("+16025550113", "Help", 5 * H),           // answer failed -> unanswered
    inbound("+16025550114", "I need help with my file", 5 * H), // a sentence, not the keyword
    inbound("+16025550115", "HELP", 10),              // inside the grace -> not judged yet
    inbound("+16025550116", "HELP", 5 * H, { is_demo: true }), // demo
    inbound("+16025550117", "HELP", 9 * D),           // outside the window
    { ...inbound("+18005550100", "HELP", 5 * H) }     // our own line texting our line
  ];
  // Our own line is a number that has been the "to" of an inbound event: make it one by a customer texting it.
  const messages = [
    msg({ channel: "sms", to_address: "+16025550111", status: "delivered", created_at: ago(5 * H - 2), template_key: "SMS-HELP-REPLY" }),
    msg({ channel: "sms", to_address: "+16025550113", status: "failed", created_at: ago(5 * H - 2), template_key: "SMS-HELP-REPLY" })
  ];
  const got = await one(HELP_SQL, [ORG, ago(7 * D), ago(30), 24], { events, messages });
  assert.equal(got.asked, 3);
  assert.equal(got.answered, 1);
  assert.equal(got.unanswered, 2);
});
