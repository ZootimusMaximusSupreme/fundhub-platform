import { test } from "node:test";
import assert from "node:assert/strict";
import { sendTemplated } from "./messaging.mjs";
import { pgFake } from "./test-support.mjs";
import { RESUME_BASE_URL, surveyResumeEmailUrl } from "../survey/resume-link.mjs";

const ORG = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CLIENT = "c3b1a9d2-5f4e-4c1a-8b7d-2e6f9a0b1c3d";
const EMAIL = "pat@example.com";
const SECRET = "runtime-survey-resume-secret-0123456789abcdef012345";
const COPIES = [
  ["EMAIL-S00-WELCOME", `This button starts the questions again from the first one. ${RESUME_BASE_URL}`],
  ["EMAIL-S02-RESUME-1", `The survey starts again at the first question. Use the button below to start the questions again. Start my questions ${RESUME_BASE_URL}`],
  ["EMAIL-S02-RESUME-2", `That starts with your questions. Open the survey and finish them. ${RESUME_BASE_URL}`],
  ["EMAIL-S02-RESUME-3", `If funding is still on your list, start the questions again and then pick a call time. ${RESUME_BASE_URL}`],
  ["EMAIL-S02-RESUME-2-B", "Finish my questions: {{survey_resume_link}}"]
];

function fixture(email = EMAIL) {
  return pgFake({
    clients: [{ id: CLIENT, org_id: ORG, email, phone: "+15551234567", first_name: "Pat", custom_fields: {} }],
    templates: [
      ...COPIES.map(([key, body]) => ({ org_id: ORG, template_key: key, channel: "email", subject: "Finish your questions", body, compliance_passed: true })),
      { org_id: ORG, template_key: "SMS-S00-WELCOME", channel: "sms", body: `Start here: ${RESUME_BASE_URL}`, compliance_passed: true }
    ]
  });
}

async function withSecret(fn) {
  const saved = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  process.env.UNSUBSCRIBE_TOKEN_SECRET = SECRET;
  try { return await fn(); }
  finally {
    if (saved === undefined) delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
    else process.env.UNSUBSCRIBE_TOKEN_SECRET = saved;
  }
}

test("all survey email keys, including B, queue the v3 link and truthful resume copy", async () => {
  await withSecret(async () => {
    const db = fixture();
    const url = surveyResumeEmailUrl({ clientId: CLIENT, email: EMAIL });
    for (const [key] of COPIES) {
      const result = await sendTemplated(db, { orgId: ORG, clientId: CLIENT, channel: "email", templateKey: key,
        eventId: `evt-${key}`, context: { survey_resume_link: url } });
      assert.equal(result.sent, true, key);
    }
    assert.equal(db.messages.length, COPIES.length);
    for (const message of db.messages) {
      assert.ok(message.rendered_body.includes(url), message.template_key);
      assert.doesNotMatch(message.rendered_body, /starts? (?:the questions )?again|first question/i, message.template_key);
    }
  });
});

test("SMS stays plain, even when a caller passes the signed email link", async () => {
  await withSecret(async () => {
    const db = fixture();
    const url = surveyResumeEmailUrl({ clientId: CLIENT, email: EMAIL });
    await sendTemplated(db, { orgId: ORG, clientId: CLIENT, channel: "sms", templateKey: "SMS-S00-WELCOME",
      eventId: "evt-sms", context: { survey_resume_link: url } });
    assert.equal(db.messages[0].rendered_body, `Start here: ${RESUME_BASE_URL}`);
  });
});

test("plain fallback and a link for an old email leave seeded copy unchanged", async () => {
  await withSecret(async () => {
    const db = fixture("new@example.com");
    const oldUrl = surveyResumeEmailUrl({ clientId: CLIENT, email: EMAIL });
    await sendTemplated(db, { orgId: ORG, clientId: CLIENT, channel: "email", templateKey: "EMAIL-S00-WELCOME",
      eventId: "evt-old-email", context: { survey_resume_link: oldUrl } });
    await sendTemplated(db, { orgId: ORG, clientId: CLIENT, channel: "email", templateKey: "EMAIL-S02-RESUME-1",
      eventId: "evt-plain", context: { survey_resume_link: RESUME_BASE_URL } });
    assert.equal(db.messages[0].rendered_body, COPIES[0][1]);
    assert.equal(db.messages[1].rendered_body, COPIES[1][1]);
  });
});
