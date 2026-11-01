import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./s-00-welcome.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const templates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "welcome", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "welcome sms", compliance_passed: true }
];

test("s-00: entry.captured sends welcome email and sms", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates()
  });
  const res = await handle({
    event: ev("entry.captured", {}, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.deepEqual(db.messages.map((m) => m.template_key), [EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY]);
});

test("s-00: no client — no send", async () => {
  const db = pgFake({ templates: templates() });
  const res = await handle({ event: ev("entry.captured", {}), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(db.messages.length, 0);
});

test("s-00: second entry.captured does not send again", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates()
  });
  const first = await handle({
    event: ev("entry.captured", {}, { id: "evt-1", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  const second = await handle({
    event: ev("entry.captured", {}, { id: "evt-2", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(first.done, true);
  assert.equal(second.done, false);
  assert.equal(second.reason, "already_locked");
  assert.equal(db.messages.length, 2);
});

test("s-00: two pings at once still send welcome only once", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates()
  });
  const [a, b] = await Promise.all([
    handle({ event: ev("entry.captured", {}, { id: "evt-a", clientId: "cl-1" }), db, step: fakeStep() }),
    handle({ event: ev("entry.captured", {}, { id: "evt-b", clientId: "cl-1" }), db, step: fakeStep() })
  ]);
  const wins = [a, b].filter((r) => r.done).length;
  const skips = [a, b].filter((r) => r.reason === "already_locked").length;
  assert.equal(wins, 1);
  assert.equal(skips, 1);
  assert.equal(db.messages.length, 2);
});

// ── the resume link (owner-set 2026-10-31; containment 2026-10-31) ────────────────────────────────
// The welcome text and email carry {{survey_resume_link}}. It is the plain /apply page, never a
// signed ?r= code: /apply lets a new phone onto an existing lead's email, so this text can reach a
// stranger. Real uuids and a real key are used so a code COULD be minted, and is not.
const ORG = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CLIENT = "c3b1a9d2-5f4e-4c1a-8b7d-2e6f9a0b1c3d";
const SECRET = "unit-test-resume-secret-0123456789abcdef0123456789";

const linkTemplates = () => [
  { org_id: ORG, template_key: EMAIL_TEMPLATE_KEY, channel: "email", subject: "Welcome", body: "Welcome. Pick up here: {{survey_resume_link}}", compliance_passed: true },
  { org_id: ORG, template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Welcome. Pick up here: {{survey_resume_link}}", compliance_passed: true }
];
const pat = () => ({ id: CLIENT, org_id: ORG, email: "pat@example.com", phone: "+15551234567", first_name: "Pat", custom_fields: {} });

async function withSecret(secret, fn) {
  const saved = { u: process.env.UNSUBSCRIBE_TOKEN_SECRET, d: process.env.DOCUMENT_URL_SECRET };
  if (secret == null) { delete process.env.UNSUBSCRIBE_TOKEN_SECRET; delete process.env.DOCUMENT_URL_SECRET; }
  else process.env.UNSUBSCRIBE_TOKEN_SECRET = secret;
  const realWarn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(" "));
  try { return { value: await fn(), warnings }; } finally {
    console.warn = realWarn;
    if (saved.u === undefined) delete process.env.UNSUBSCRIBE_TOKEN_SECRET; else process.env.UNSUBSCRIBE_TOKEN_SECRET = saved.u;
    if (saved.d === undefined) delete process.env.DOCUMENT_URL_SECRET; else process.env.DOCUMENT_URL_SECRET = saved.d;
  }
}

test("s-00: the text and the email carry the plain /apply link and never a resume code, even with a signing key", async () => {
  const db = pgFake({ clients: [pat()], templates: linkTemplates() });
  const { value: res } = await withSecret(SECRET, () => handle({
    event: ev("entry.captured", {}, { orgId: ORG, clientId: CLIENT }), db, step: fakeStep()
  }));
  assert.equal(res.done, true);
  assert.deepEqual(db.messages.map((m) => m.template_key), [EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY]);
  for (const m of db.messages) {
    assert.equal(m.rendered_body, "Welcome. Pick up here: https://apply.fundhub.ai/apply", m.template_key);
    assert.ok(!m.rendered_body.includes("?r="), `${m.template_key} carries no resume code`);
  }
});

test("s-00: no signing key — the welcome still goes, with the same plain apply link", async () => {
  const db = pgFake({ clients: [pat()], templates: linkTemplates() });
  const { value: res } = await withSecret(null, () => handle({
    event: ev("entry.captured", {}, { orgId: ORG, clientId: CLIENT }), db, step: fakeStep()
  }));
  assert.equal(res.done, true, "a missing key must not cost a lead their welcome");
  assert.equal(db.messages.length, 2);
  for (const m of db.messages) assert.equal(m.rendered_body, "Welcome. Pick up here: https://apply.fundhub.ai/apply");
});

test("s-00: a second opt-in sends nothing more, so the person is not welcomed (or linked) twice", async () => {
  const db = pgFake({ clients: [pat()], templates: linkTemplates() });
  await withSecret(SECRET, async () => {
    await handle({ event: ev("entry.captured", {}, { id: "evt-1", orgId: ORG, clientId: CLIENT }), db, step: fakeStep() });
    const again = await handle({ event: ev("entry.captured", {}, { id: "evt-2", orgId: ORG, clientId: CLIENT }), db, step: fakeStep() });
    assert.equal(again.reason, "already_locked");
  });
  assert.equal(db.messages.length, 2);
});
