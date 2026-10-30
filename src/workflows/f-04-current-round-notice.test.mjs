// F-04 notice safety: a stale/terminal Card Stacking round cannot notify a customer.
// Synthetic in-memory fixtures; external email/SMS providers are never invoked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./f-04-round-approvals.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const ORG = "org-1";
const CLIENT = "cl-1";
const OWNED = { org_id: ORG, client_id: CLIENT };
const templates = [
  { org_id: ORG, template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Approval verified", compliance_passed: true },
  { org_id: ORG, template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Approval verified", compliance_passed: true }
];

function fixture(rounds = []) {
  const db = pgFake({ clients: [{ id: CLIENT, org_id: ORG, email: "f04-test@example.invalid" }], templates });
  const query = db.query.bind(db);
  db.query = async (sql, params = []) => {
    if (/SELECT round_number, status FROM funding_rounds/.test(sql)) {
      assert.match(sql, /org_id = \$1 AND client_id = \$2/, "round lookup must enforce both tenant and client");
      const rows = rounds.filter(x => x.org_id === params[0] && x.client_id === params[1])
        .sort((a, b) => Number(b.round_number) - Number(a.round_number));
      return { rows: rows.slice(0, 1).map(x => ({ round_number: x.round_number, status: x.status })) };
    }
    return query(sql, params);
  };
  return db;
}
const approval = (roundNumber = 1, more = {}) => ev("round.approved", {
  rail: "card_stacking", roundNumber, approvedAmount: 12500, ...more
}, { clientId: CLIENT });

for (const status of ["funded", "closed", "completed", "cancelled", "canceled"]) {
  test(`F-04 refuses late approval notice after round became ${status}`, async () => {
    const db = fixture([{ ...OWNED, round_number: 1, status }]);
    const result = await handle({ event: approval(), db, step: fakeStep() });
    assert.deepEqual(result, { sent: false, reason: "round_terminal" });
    assert.equal(db.messages.length, 0);
    assert.equal(db.clients[0].custom_fields?.employee_next_action, undefined);
  });
}

test("F-04 refuses an old round one approval after round two starts", async () => {
  const db = fixture([
    { ...OWNED, round_number: 1, status: "approved" },
    { ...OWNED, round_number: 2, status: "started" }
  ]);
  const out = await handle({ event: approval(1), db, step: fakeStep() });
  assert.deepEqual(out, { sent: false, reason: "stale_round_approval" });
  assert.equal(db.messages.length, 0);
});

test("F-04 refuses missing or fictitious card stacking round references", async () => {
  const db = fixture([{ ...OWNED, round_number: 1, status: "approved" }]);
  assert.deepEqual(await handle({ event: approval(undefined, { roundNumber: undefined }), db, step: fakeStep() }),
    { sent: false, reason: "invalid_round_number" });
  assert.deepEqual(await handle({ event: approval(8), db, step: fakeStep() }),
    { sent: false, reason: "stale_round_approval" });
  const missing = fixture();
  assert.deepEqual(await handle({ event: approval(1), db: missing, step: fakeStep() }),
    { sent: false, reason: "funding_round_not_found" });
  assert.equal(db.messages.length + missing.messages.length, 0);
});

test("F-04 sends current approved Card Stacking notice once and persists action", async () => {
  const db = fixture([{ ...OWNED, round_number: 1, status: "approved" }]);
  const e = approval();
  const first = await handle({ event: e, db, step: fakeStep() });
  const second = await handle({ event: e, db, step: fakeStep() });
  assert.equal(first.sent, true);
  assert.equal(second.sent, true, "handler can complete but providers deduplicate event id");
  assert.equal(db.messages.length, 2, "one email and one SMS message, never four");
  assert.equal(db.clients[0].custom_fields?.employee_next_action, "Prepare Next Funding Round");
});

test("F-04 refuses a foreign company's client before round lookup or sending", async () => {
  const db = fixture([{ ...OWNED, round_number: 1, status: "approved" }]);
  const e = ev("round.approved", { rail: "card_stacking", roundNumber: 1, approvedAmount: 10000 },
    { orgId: "org-2", clientId: CLIENT });
  assert.deepEqual(await handle({ event: e, db, step: fakeStep() }), { sent: false, reason: "no_client" });
  assert.equal(db.messages.length, 0);
});

test("F-04 preserves legacy non-card-stacking rails without invented round ids", async () => {
  const db = fixture();
  const out = await handle({ event: ev("round.approved", { rail: "other_provider", approvedAmount: 5000 },
    { clientId: CLIENT }), db, step: fakeStep() });
  assert.equal(out.sent, true);
  assert.equal(db.messages.length, 2);
});
