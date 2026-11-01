import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./f-03-round-submitted.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Round submitted email", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Round submitted sms", compliance_passed: true }
];

test("happy path: round.submitted with a round number sends email + sms", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({ event: ev("round.submitted", { roundNumber: 3 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 2);
  assert.equal(db.clients[0].custom_fields.employee_next_action, "Remove Inquiries");
});

test("branch: missing round number exits without sending", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({ event: ev("round.submitted", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "no_round_number");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const event = ev("round.submitted", { roundNumber: 1 }, { id: "evt-dup-f03", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 2);
});


// Card Stacking-specific acceptance: the payload is NOT sufficient evidence that
// the submitted round is still current. All providers are mocked; no sends.
function submissionFixture(rounds, stage = "round_submitted") {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: withTemplates()
  });
  const query = db.query.bind(db);
  db.query = async (sql, params = []) => {
    if (/SELECT round_number, status FROM funding_rounds/.test(sql)) {
      assert.match(sql, /org_id = \$1 AND client_id = \$2/);
      const own = rounds.filter(r => r.org_id === params[0] && r.client_id === params[1])
        .sort((a, b) => Number(b.round_number) - Number(a.round_number));
      return { rows: own.slice(0, 1) };
    }
    if (/SELECT ps\.key AS stage_key FROM cards c/.test(sql)) {
      assert.match(sql, /c\.org_id = \$2/);
      assert.match(sql, /p\.org_id = \$2/);
      assert.match(sql, /ps\.org_id = \$2/);
      assert.match(sql, /p\.key = 'funding_card_stacking'/);
      assert.deepEqual(params, ["cl-1", "org-1"]);
      return { rows: stage == null ? [] : [{ stage_key: stage }] };
    }
    return query(sql, params);
  };
  return db;
}
const round = (roundNumber, status = "started", org_id = "org-1", client_id = "cl-1") =>
  ({ org_id, client_id, round_number: roundNumber, status });
const submitted = (roundNumber = 1, options = {}) =>
  ev("round.submitted",
    { rail: "card_stacking", source: "card_stacking", roundNumber },
    { clientId: "cl-1", ...options });

test("F-03 current owned Card Stacking submission sends exactly one email and SMS on replay", async () => {
  const db = submissionFixture([round(1)]);
  const event = submitted(1, { id: "f03-current-replay" });
  const first = await handle({ event, db, step: fakeStep() });
  const second = await handle({ event, db, step: fakeStep() });
  assert.equal(first.sent, true);
  assert.equal(second.sent, true);
  assert.equal(db.messages.length, 2, "the provider queue deduplicates by event ID");
  assert.equal(db.clients[0].custom_fields.employee_next_action, "Remove Inquiries");
});

test("F-03 refuses stale round 1 after round 2 starts", async () => {
  const db = submissionFixture([round(1), round(2)]);
  const out = await handle({ event: submitted(1), db, step: fakeStep() });
  assert.deepEqual(out, { sent: false, reason: "stale_round_submission" });
  assert.equal(db.messages.length, 0);
  assert.equal(db.clients[0].custom_fields?.employee_next_action, undefined);
});

for (const status of ["funded", "closed", "completed", "cancelled", "canceled"]) {
  test("F-03 refuses delayed submission for terminal " + status + " round", async () => {
    const db = submissionFixture([round(1, status)]);
    const out = await handle({ event: submitted(1), db, step: fakeStep() });
    assert.deepEqual(out, { sent: false, reason: "round_terminal" });
    assert.equal(db.messages.length, 0);
    assert.equal(db.clients[0].custom_fields?.employee_next_action, undefined);
  });
}

for (const stage of ["approved", "funded", "closed", "apply_now", null]) {
  test("F-03 refuses card that has moved away from submitted (" + stage + ")", async () => {
    const db = submissionFixture([round(1)], stage);
    const out = await handle({ event: submitted(1), db, step: fakeStep() });
    assert.deepEqual(out, { sent: false, reason: "card_not_submitted" });
    assert.equal(db.messages.length, 0);
    assert.equal(db.clients[0].custom_fields?.employee_next_action, undefined);
  });
}

test("F-03 refuses nonexistent rounds and rounds belonging to another company", async () => {
  for (const rounds of [[], [round(1, "started", "org-2")]]) {
    const db = submissionFixture(rounds);
    const out = await handle({ event: submitted(1), db, step: fakeStep() });
    assert.deepEqual(out, { sent: false, reason: "funding_round_not_found" });
    assert.equal(db.messages.length, 0);
  }
});

test("F-03 refuses wrong-company client before querying or notifying", async () => {
  const db = submissionFixture([round(1)]);
  const out = await handle({
    event: submitted(1, { orgId: "org-2" }), db, step: fakeStep()
  });
  assert.deepEqual(out, { sent: false, reason: "no_client" });
  assert.equal(db.messages.length, 0);
});

for (const roundNumber of [0, -1, 1.5, "abc", ""]) {
  test("F-03 refuses invalid round number " + JSON.stringify(roundNumber), async () => {
    const db = submissionFixture([round(1)]);
    const out = await handle({ event: submitted(roundNumber), db, step: fakeStep() });
    assert.equal(out.sent, false);
    assert.equal(out.reason, roundNumber === "" ? "no_round_number" : "invalid_round_number");
    assert.equal(db.messages.length, 0);
  });
}

test("F-03 preserves legacy provider path without inventing unverified database round identity", async () => {
  const db = submissionFixture([], null);
  const out = await handle({
    event: ev("round.submitted", { rail: "legacy_provider", roundNumber: 3 }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(out.sent, true);
  assert.equal(db.messages.length, 2);
});

test("F-03 refuses unrelated event type", async () => {
  const db = submissionFixture([round(1)]);
  const out = await handle({
    event: { ...submitted(1), name: "round.approved" }, db, step: fakeStep()
  });
  assert.deepEqual(out, { sent: false, reason: "not_round_submitted" });
  assert.equal(db.messages.length, 0);
});
