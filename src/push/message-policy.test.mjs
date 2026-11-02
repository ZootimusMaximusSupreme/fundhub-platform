import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationForSentMessage, claimMarketingPush, recordMarketingPush } from "./message-policy.mjs";

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
  assert.match(db.queries[2].sql, /held\.created_at >= COALESCE\(booked\.created_at, b\.created_at\)/);
  assert.match(db.queries[2].sql, /outcome.*<> 'no_show'/);
  assert.match(db.queries[3].sql, /channel = 'push' AND status IN \('sending', 'sent'\)/);
  assert.deepEqual(db.queries[3].params, ["org-1", "client-1", now.toISOString()]);
});

test("BS pre-call skips when the cap is spent or its read is incomplete", async () => {
  for (const limits of [{ lastDay: 1 }, { lastWeek: 3 }, { lastDay: null }]) {
    const db = fakeDb({ enabled: true, ...limits });
    assert.equal(await notificationForSentMessage(db, message()), null);
  }
});

test("three selected sent lessons open their exact slide under the shared marketing checks", async () => {
  const now = new Date("2026-11-02T17:00:00Z");
  for (const slug of ["the-call", "who-we-are", "the-money-talk"]) {
    for (const [key, channel] of [["EMAIL-BS-DECK-LESSON", "email"], ["SMS-BS-DECK", "sms"]]) {
      const source = message({ channel, template_key: key,
        provider_ref: `workflow:${key}:bs-deck:client-1:${slug}` });
      const db = fakeDb({ enabled: true });
      assert.deepEqual(await notificationForSentMessage(db, source, { now }),
        { kind: "check_in", url: `/slideshows/${slug}.html` });
      assert.equal(db.queries.length, 4);
      assert.equal(db.queries[2].params[3], true, "lesson timing can start more than 72 hours before the call");
      for (const options of [{ enabled: false }, { enabled: true, optedOut: true },
        { enabled: true, upcomingBooking: false }, { enabled: true, lastDay: 1 },
        { enabled: true, lastWeek: 3 }]) {
        assert.equal(await notificationForSentMessage(fakeDb(options), source, { now }), null);
      }
    }
  }
});

test("marketing push claims share a day key and delivery receipts reflect actual devices", async () => {
  const queries = [];
  const db = { async query(sql, params) {
    queries.push({ sql, params });
    return { rows: sql.includes("INSERT INTO messages") ? [{ id: "push-1" }] : [] };
  } };
  const now = new Date("2026-11-02T17:00:00Z");
  const id = await claimMarketingPush(db, message(), { kind: "check_in" }, { now });
  assert.equal(id, "push-1");
  assert.equal(queries[0].params[3], "marketing-push:client-1:2026-11-02");
  assert.equal(await claimMarketingPush(db, message(), { kind: "check_in" },
    { now: new Date("2026-11-03T06:59:59Z") }), null);
  assert.equal(await claimMarketingPush(db, message(), { kind: "check_in" },
    { now: new Date("2026-11-03T07:00:00Z") }), null);
  assert.equal(queries.length, 1, "neither side of Arizona midnight can claim a push");
  assert.match(queries[0].sql, /ON CONFLICT \(org_id, provider_ref\)/);
  assert.match(queries[0].sql, /WHERE messages\.status = 'failed'/);
  await recordMarketingPush(db, id, [{ status: "fulfilled", value: { sent: 0 } }, { status: "rejected" }]);
  assert.equal(queries[1].params[1], "sending", "rejected transport promise has an unknown delivery outcome");
  await recordMarketingPush(db, id, [{ status: "fulfilled", value: { sent: 1 } }]);
  assert.equal(queries[2].params[1], "sent");
});

test("a malformed, wrong-client, unselected or night-time lesson never becomes push", async () => {
  const source = message({ channel: "email", template_key: "EMAIL-BS-DECK-LESSON",
    provider_ref: "workflow:EMAIL-BS-DECK-LESSON:bs-deck:client-1:the-call" });
  for (const change of [
    { provider_ref: "workflow:EMAIL-BS-DECK-LESSON:bs-deck:other-client:the-call" },
    { provider_ref: "workflow:EMAIL-BS-DECK-LESSON:bs-deck:client-1:apply-yourself" },
    { provider_ref: source.provider_ref + "?next=https://example.com" },
    { provider_ref: source.provider_ref + "/../app/client-portal.html" },
    { channel: "sms" }
  ]) {
    const db = fakeDb({ enabled: true });
    assert.equal(await notificationForSentMessage(db, { ...source, ...change },
      { now: new Date("2026-11-02T17:00:00Z") }), null);
    assert.equal(db.queries.length, 0);
  }
  const db = fakeDb({ enabled: true });
  assert.equal(await notificationForSentMessage(db, source,
    { now: new Date("2026-11-03T03:00:00Z") }), null);
  assert.equal(db.queries.length, 0);
});

test("marketing receipt holds every unknown result, frees definite failures, and preserves confirmed delivery",async()=>{
 let params;const db={async query(_sql,args){params=args;return{rows:[]};}};
 for(const results of [[{status:'rejected',reason:new Error('timeout')}],[{status:'fulfilled',value:undefined}],[{status:'fulfilled',value:{sent:0,unknown:1}}]]){
 await recordMarketingPush(db,'claim',results);assert.equal(params[1],'sending');assert.match(params[2],/review before resending/);
 }
 for(const result of [{sent:0,attempted:0,reason:'no_device'},{sent:0,failed:1,unknown:0}]){
 await recordMarketingPush(db,'claim',[{status:'fulfilled',value:result}]);assert.equal(params[1],'failed');
 }
 await recordMarketingPush(db,'claim',[{status:'fulfilled',value:{sent:1}},{status:'rejected'}]);assert.equal(params[1],'sent');
});
