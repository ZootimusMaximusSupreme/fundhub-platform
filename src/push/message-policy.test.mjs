import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationForSentMessage } from "./message-policy.mjs";

const message = (over = {}) => ({
  id: "message-1", org_id: "org-1", client_id: "client-1",
  channel: "sms", template_key: "SMS-BS01-02-PRECALL", ...over
});

function fakeDb({ enabled = false, optedOut = false, upcomingBooking = true, lastDay = 0, lastWeek = 0 } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("FROM clients")) {
        return { rows: [{ custom_fields: { marketing_push_enabled: enabled } }] };
      }
      if (sql.includes("FROM opt_outs")) return { rows: optedOut ? [{ one: 1 }] : [] };
      if (sql.includes("FROM bookings")) return { rows: upcomingBooking ? [{ one: 1 }] : [] };
      if (sql.includes("FROM messages")) return { rows: [{ last_day: lastDay, last_week: lastWeek }] };
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

const CALL_START = "2026-10-17T16:15:00.000Z";
const HANDOFF_NOW = new Date("2026-10-17T16:05:00.000Z");
const handoffMessage = (over = {}) => message({
  template_key: "SMS-AISET04-HANDOFF",
  provider_ref: `workflow:SMS-AISET04-HANDOFF:booking-start:client-1:${CALL_START}`,
  ...over
});
function handoffDb(rows) {
  const queries = [];
  return { queries, async query(sql, params) {
    queries.push({ sql, params });
    assert.match(sql, /FROM bookings/);
    return { rows };
  } };
}
const callRow = (over = {}) => ({
  id: "booking-1", starts_at: CALL_START, ends_at: "2026-10-17T17:00:00.000Z",
  meeting_url: "https://meet.google.com/abc-defg-hij", ...over
});

test("a real sent handoff gets one short-lived native call invite", async () => {
  const db = handoffDb([callRow()]);
  assert.deepEqual(await notificationForSentMessage(db, handoffMessage(), { now: HANDOFF_NOW }), {
    kind: "call_invite", expiresAt: "2026-10-17T16:45:00.000Z"
  });
  assert.deepEqual(db.queries[0].params, ["org-1", "client-1", CALL_START]);
  assert.match(db.queries[0].sql, /status IN \('booked', 'rescheduled'\)/);
  assert.match(db.queries[0].sql, /LIMIT 2/);
});

test("a shorter booked end is the hard APNs expiry", async () => {
  const db = handoffDb([callRow({ ends_at: "2026-10-17T16:20:00.000Z" })]);
  assert.deepEqual(await notificationForSentMessage(db, handoffMessage(), { now: HANDOFF_NOW }), {
    kind: "call_invite", expiresAt: "2026-10-17T16:20:00.000Z"
  });
});

test("late, early, wrong-client, non-SMS, and unkeyed texts cannot invite", async () => {
  for (const [candidate, now] of [
    [handoffMessage(), new Date("2026-10-17T15:59:59.000Z")],
    [handoffMessage(), new Date(CALL_START)],
    [handoffMessage({ provider_ref: "workflow:SMS-AISET04-HANDOFF:booking-start:other:" + CALL_START }), HANDOFF_NOW],
    [handoffMessage({ channel: "email" }), HANDOFF_NOW],
    [handoffMessage({ provider_ref: "workflow:SMS-AISET04-HANDOFF:other" }), HANDOFF_NOW]
  ]) {
    const db = handoffDb([callRow()]);
    assert.equal(await notificationForSentMessage(db, candidate, { now }), null);
    assert.equal(db.queries.length, 0);
  }
});

test("moved, cancelled, duplicate, no-link and non-room bookings cannot invite", async () => {
  for (const rows of [
    [], [callRow({ starts_at: "2026-10-17T16:30:00.000Z" })],
    [callRow(), callRow({ id: "booking-2" })],
    [callRow({ meeting_url: null })],
    [callRow({ meeting_url: "https://fundhub.ai/portal-login.html" })],
    [callRow({ meeting_url: "https://calendly.com/advisor/book-a-call" })],
    [callRow({ meeting_url: "https://zoom.us/signin" })],
    [callRow({ ends_at: "2026-10-17T16:00:00.000Z" })]
  ]) {
    const db = handoffDb(rows);
    assert.equal(await notificationForSentMessage(db, handoffMessage(), { now: HANDOFF_NOW }), null);
    assert.equal(db.queries.length, 1);
  }
});

test("service email and SMS use a generic alert; booking confirmation keeps its approved alert", async () => {
  const db = fakeDb();
  assert.deepEqual(await notificationForSentMessage(db, message({ channel: "email", template_key: "EMAIL-S04-01-CONFIRM" })), { kind: "update" });
  assert.deepEqual(await notificationForSentMessage(db, message({ template_key: "SMS-S04-01-CONFIRM" })), { kind: "call_confirmation" });
  assert.equal(db.queries.length, 0);
});

test("non-client and non-email/SMS messages never create client push", async () => {
  const db = fakeDb();
  assert.equal(await notificationForSentMessage(db, message({ client_id: null })), null);
  assert.equal(await notificationForSentMessage(db, message({ channel: "voice" })), null);
  assert.equal(db.queries.length, 0);
});

test("BS drip and other promo families do not turn into a burst of alerts", async () => {
  const db = fakeDb({ enabled: true });
  for (const key of ["BS-FUND-D1-E1", "BS-REPAIR-D3-E6", "EMAIL-NOBOOK-01", "SMS-S05A-NOSHOW-RECOVERY", "EMAIL-SLO-197", "EMAIL-OFFER-REPAIR-DFY", "EMAIL-N01-COLD-NURTURE", "SMS-AISET03-MSG1", "EMAIL-S02-FINISH-APPLICATION"]) {
    assert.equal(await notificationForSentMessage(db, message({ template_key: key })), null, key);
  }
  assert.equal(db.queries.length, 0);
});

test("BS pre-call needs a strict client preference and stays off by default", async () => {
  for (const enabled of [false, "true", null]) {
    const db = fakeDb({ enabled });
    assert.equal(await notificationForSentMessage(db, message()), null);
    assert.equal(db.queries.length, 1);
  }
});

test("a marketing push never works around an SMS or email opt-out", async () => {
  const db = fakeDb({ enabled: true, optedOut: true });
  assert.equal(await notificationForSentMessage(db, message()), null);
  assert.equal(db.queries.length, 2);
});

test("a moved or cancelled call leaves no marketing alert without an upcoming booking", async () => {
  const db = fakeDb({ enabled: true, upcomingBooking: false });
  assert.equal(await notificationForSentMessage(db, message()), null);
  assert.equal(db.queries.length, 3);
});

test("BS pre-call allows one opted-in alert within the 24-hour and 7-day limits", async () => {
  const db = fakeDb({ enabled: true });
  const now = new Date("2026-10-17T16:00:00Z");
  assert.deepEqual(await notificationForSentMessage(db, message(), { now }), { kind: "check_in" });
  assert.equal(db.queries.length, 4);
  assert.match(db.queries[3].sql, /status = 'sent'/);
  assert.deepEqual(db.queries[3].params, ["org-1", "client-1", "SMS-BS01-02-PRECALL", now.toISOString(), "message-1"]);
});

test("BS pre-call skips when the cap is spent or its read is incomplete", async () => {
  for (const limits of [{ lastDay: 1 }, { lastWeek: 3 }, { lastDay: null }]) {
    const db = fakeDb({ enabled: true, ...limits });
    assert.equal(await notificationForSentMessage(db, message()), null);
  }
});
