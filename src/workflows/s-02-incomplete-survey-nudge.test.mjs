import { test } from "node:test";
import assert from "node:assert";
import { handle as runNudge, surveyCompleted, EMAIL_TEMPLATE_KEY } from "./s-02-incomplete-survey-nudge.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

async function handle({ event, db, step }) {
  if (!db.events.some((e) => e.id === event.id)) db.events.push({
    id: event.id, org_id: event.orgId, client_id: event.clientId,
    name: event.name, payload: event.payload, created_at: event.createdAt || "2026-10-30T12:00:00Z"
  });
  return runNudge({ event, db, step });
}

test("happy path: survey still incomplete after the wait sends the nudge", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "finish it", compliance_passed: true }]
  });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.nudged, true);
  assert.equal(db.messages.length, 1);
});

test("branch: survey completed during the wait — tag instead of nudge", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "survey.submitted" }]
  });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.nudged, false);
  assert.deepEqual(db.clients[0].tags, ["survey:complete"]);
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying does not double-send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "finish it", compliance_passed: true }]
  });
  const event = ev("entry.captured", {}, { id: "evt-dup-s02", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 1);
});

test("distinct entry events in one application send one nudge; a later application sends another", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "finish it", compliance_passed: true }],
    events: [
      { id: "evt-a", org_id: "org-1", client_id: "cl-1", name: "entry.captured", payload: { email: "a@b.com", funnel: "Fundhub Funnel" }, created_at: "2026-10-30T04:00:00Z" },
      { id: "evt-b", org_id: "org-1", client_id: "cl-1", name: "entry.captured", payload: { email: "a@b.com", funnel: "Fundhub Funnel" }, created_at: "2026-10-30T04:00:00.066Z" },
      { id: "evt-c", org_id: "org-1", client_id: "cl-1", name: "entry.captured", payload: { email: "a@b.com", funnel: "Fundhub Funnel" }, created_at: "2026-10-30T12:00:00Z" }
    ]
  });
  for (const id of ["evt-a", "evt-b", "evt-c"]) {
    await handle({ event: ev("entry.captured", { email: "a@b.com" }, { id, clientId: "cl-1" }), db, step: fakeStep() });
  }
  assert.equal(db.messages.length, 2);
  assert.deepEqual(db.messages.map((m) => m.provider_ref), [
    `workflow:${EMAIL_TEMPLATE_KEY}:evt-a`, `workflow:${EMAIL_TEMPLATE_KEY}:evt-c`
  ]);
});

// T14-11 regression: capture sources that predate the client_id fix wrote
// survey.submitted with client_id NULL. Before this, the completion check could
// never see those rows, so people who HAD finished the survey were still nudged.
function eventsDb(rows) {
  return {
    query: async (sql, params) => {
      assert.match(sql, /SELECT DISTINCT name FROM events/);
      const [clientId, names, addr] = params;
      const hits = rows
        .filter((e) => names.includes(e.name))
        .filter((e) => e.client_id === clientId || (addr !== "" && e.email === addr));
      return { rows: hits.map((e) => ({ name: e.name })) };
    },
  };
}

test("surveyCompleted matches a survey.submitted row that has no client_id, by email", async () => {
  const db = eventsDb([{ client_id: null, name: "survey.submitted", email: "a@b.com" }]);
  assert.equal(await surveyCompleted(db, "cl-1", "a@b.com"), true);
  assert.equal(await surveyCompleted(db, "cl-1", "A@B.com"), true, "email compare is case-insensitive");
  assert.equal(await surveyCompleted(db, "cl-1", null), false, "no email and no client_id link → not completed");
});

test("surveyCompleted still matches on client_id alone", async () => {
  const db = eventsDb([{ client_id: "cl-1", name: "survey.submitted", email: null }]);
  assert.equal(await surveyCompleted(db, "cl-1", null), true);
  assert.equal(await surveyCompleted(db, "cl-2", null), false);
});
