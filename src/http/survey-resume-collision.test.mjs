// Regression (containment 2026-10-31): an email/phone collision on /apply cannot reveal
// a lead's saved survey answers.
//
// The hole: /apply takes an existing lead's email with a NEW phone. resolveClient
// (src/handlers/client-lifecycle.mjs) writes that phone over the lead's own, because a
// ClickFunnels apply-survey submit is "the client's latest contact instruction". S-00 and
// S-02 then texted a signed resume code to that phone, and GET /api/public/survey-resume
// turned the code into the lead's saved contact and answers.
//
// This replays the whole path on a fake database: the stranger's submit, the welcome,
// the three come-back touches, and the door. It holds two things:
//   1. no message on the record carries a resume code or any saved answer;
//   2. even a valid code minted for the lead (the link the old senders put in the text)
//      opens nothing at the door, and the door never asks the database.
import { test } from "node:test";
import assert from "node:assert/strict";
import doorHandler from "../../api/public/survey-resume.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { surveyResumeToken } from "../survey/resume-link.mjs";
import { handle as welcome } from "../workflows/s-00-welcome.mjs";
import { handle as comeBack, RESUME_TEMPLATE_KEYS } from "../workflows/s-02-incomplete-survey-nudge.mjs";
import { pgFake, fakeStep } from "../workflows/test-support.mjs";
import { withReplyRead } from "../workflows/stop-on-reply.test-support.mjs";
import { inngestSim } from "../workflows/inngest-sim.mjs";

const ORG = "0f8fad5b-d9cb-469f-a165-70867728950e";
const LEAD = "c3b1a9d2-5f4e-4c1a-8b7d-2e6f9a0b1c3d";
const LEAD_EMAIL = "dana.lead@realmail.test";
const LEAD_PHONE = "+15550001111";
const STRANGER_PHONE_TYPED = "(555) 999-0000";
const STRANGER_PHONE = "+15559990000";
const SECRET = "collision-test-resume-secret-0123456789abcdef0123";
const START = "2026-10-28T17:00:00Z"; // 10 a.m. Arizona, inside the drip window

/* Five of eight questions answered. Every one of these words is private to the lead. */
const SAVED = Object.freeze({
  cf_svy_funding_target_amount: "$100k - $200k",
  cf_svy_planned_use: "Payroll or rent",
  cf_svy_money_change_now: ["Stability (cover bills / buffer slow weeks)"],
  cf_svy_self_reported_fico: "580-649",
  cf_svy_has_business: "Yes, 1-2 years"
});
const PRIVATE_WORDS = ["$100k - $200k", "Payroll or rent", "Stability", "580-649", "Yes, 1-2 years", LEAD_EMAIL, "5550001111", "Dana"];

const WELCOME_KEYS = ["EMAIL-S00-WELCOME", "SMS-S00-WELCOME"];
const template = (key) => ({
  org_id: ORG, template_key: key, channel: key.startsWith("SMS") ? "sms" : "email",
  subject: key.startsWith("EMAIL") ? `Subject for ${key}` : null,
  body: `${key}: Start the questions here: {{survey_resume_link}}`,
  compliance_passed: true
});

/* pgFake plus the three reads and the one write resolveClient makes that pgFake does not
   model. The UPDATE is the real overwrite rule for a ClickFunnels apply-survey submit:
   COALESCE(new, old) on phone, first and last name. The lead already has a CRM link, so
   the backfill returns early and nothing leaves the test. */
function worldDb() {
  const inner = withReplyRead(pgFake({
    clients: [{
      id: LEAD, org_id: ORG, email: LEAD_EMAIL, phone: LEAD_PHONE, first_name: "Dana", last_name: "Lead",
      ghl_contact_id: "crm-lead-1", custom_fields: { ...SAVED }
    }],
    templates: [...WELCOME_KEYS, ...RESUME_TEMPLATE_KEYS].map(template)
  }));
  const db = Object.create(inner);
  const row = () => inner.clients.find((c) => c.id === LEAD);
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (/SELECT id, ghl_contact_id FROM clients WHERE org_id = \$1 AND lower\(email\) = \$2/.test(text)) {
      const c = inner.clients.find((x) => x.org_id === params[0] && x.email.toLowerCase() === params[1]);
      return { rows: c ? [{ id: c.id, ghl_contact_id: c.ghl_contact_id }] : [] };
    }
    if (/SELECT id, ghl_contact_id, email, phone, first_name, last_name\s+FROM clients WHERE id = \$1 AND org_id = \$2/.test(text)) {
      const c = inner.clients.find((x) => x.id === params[0] && x.org_id === params[1]);
      return { rows: c ? [c] : [] };
    }
    if (/UPDATE clients SET\s+phone = COALESCE\(\$2, NULLIF\(phone, ''\)\)/.test(text)) {
      const c = row();
      if (c && params[0] === c.id) {
        c.phone = params[1] ?? c.phone;
        c.first_name = params[2] ?? c.first_name;
        c.last_name = params[3] ?? c.last_name;
      }
      return { rows: [] };
    }
    return inner.query(sql, params);
  };
  return { db, row, messages: inner.messages, events: inner.events };
}

/* The stranger's /apply submit: the lead's email (any case), the stranger's phone and name. */
const strangerOptIn = () => ({
  id: "evt-stranger", orgId: ORG, name: "entry.captured", createdAt: START,
  payload: {
    email: LEAD_EMAIL.toUpperCase(), phone: STRANGER_PHONE_TYPED, name: "Mallory Stranger",
    source: "clickfunnels", funnel: "apply-survey"
  }
});

function makeRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(obj) { this.body = obj; return this; }
  };
}
async function openAtDoor(code) {
  const calls = [];
  const spy = { async query(sql, params) { calls.push(String(sql)); throw new Error("the closed door must not read"); } };
  const res = makeRes();
  await doorHandler({ method: "GET", headers: { origin: "https://apply.fundhub.ai" }, query: { r: code } }, res,
    { db: spy, secret: SECRET, now: () => Date.parse(START) });
  return { res, calls };
}

async function withSigningKey(fn) {
  const saved = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  process.env.UNSUBSCRIBE_TOKEN_SECRET = SECRET;
  try { return await fn(); } finally {
    if (saved === undefined) delete process.env.UNSUBSCRIBE_TOKEN_SECRET; else process.env.UNSUBSCRIBE_TOKEN_SECRET = saved;
  }
}

test("collision: a stranger's /apply with the lead's email puts the stranger's phone on the lead's record", async () => {
  // The precondition of the hole, held here so this test fails loudly if it ever changes shape.
  const { db, row } = worldDb();
  const id = await resolveClient(db, strangerOptIn());
  assert.equal(id, LEAD, "the email matched the existing lead");
  assert.equal(row().phone, STRANGER_PHONE, "the lead's texts now go to the stranger's phone");
  assert.deepEqual(row().custom_fields, SAVED, "the lead's saved answers are still on the record");
});

test("collision: S-00 and S-02 send the stranger's phone no resume code and none of the lead's saved answers", async () => {
  const { db, row, messages, events } = worldDb();
  await withSigningKey(async () => {
    const event = strangerOptIn();
    // The opt-in's own events row, as the capture door saves it (S-02 keys its sends on it).
    events.push({ id: event.id, org_id: ORG, client_id: LEAD, name: "entry.captured", payload: event.payload, created_at: START });
    const w = await welcome({ event, db, step: fakeStep() });
    assert.equal(w.done, true);
    const sim = inngestSim(START);
    const [run] = await sim.runAll([{ key: event.id, at: START, fn: (step) => comeBack({ event, db, step, now: sim.now }) }]);
    assert.equal(run.done, true);
    assert.equal(run.touches.length, 3, "all three come-back touches still go out");
  });
  assert.equal(row().phone, STRANGER_PHONE);

  const sent = messages.filter((m) => m.client_id === LEAD);
  assert.deepEqual(sent.map((m) => m.template_key).sort(), [...WELCOME_KEYS, ...RESUME_TEMPLATE_KEYS].sort(),
    "the welcome and every come-back message still go, text and email");
  for (const m of sent) {
    assert.ok(!m.rendered_body.includes("?r="), `${m.template_key} carries no resume code: ${m.rendered_body}`);
    assert.ok(m.rendered_body.endsWith("here: https://apply.fundhub.ai/apply"), `${m.template_key}: ${m.rendered_body}`);
    assert.ok(!/stopped at|taps left|more taps|where you were/i.test(m.rendered_body),
      `${m.template_key} must not reveal saved progress or promise a saved position`);
    for (const word of PRIVATE_WORDS) {
      assert.ok(!m.rendered_body.includes(word), `${m.template_key} must not carry the lead's "${word}"`);
    }
  }
});

test("collision: the code the old senders texted to that phone opens nothing at the door", async () => {
  // The exact link S-00/S-02 put in the stranger's text before the containment.
  const code = surveyResumeToken({ clientId: LEAD, now: () => Date.parse(START), secret: SECRET });
  const { res, calls } = await openAtDoor(code);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { ok: false });
  assert.equal(calls.length, 0, "the door never reads the lead's record");
  const body = JSON.stringify(res.body);
  for (const word of [...PRIVATE_WORDS, STRANGER_PHONE, "cf_svy"]) {
    assert.ok(!body.includes(word), `"${word}" must not leave the door`);
  }
});
