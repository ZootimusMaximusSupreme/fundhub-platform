import { test } from "node:test";
import assert from "node:assert";
import { handle, dpc02CallOutcomeEnforcement, noshowKeyFor } from "./dpc-02-call-outcome-enforcement.mjs";
import { s05aNoShowRecovery } from "./s-05a-no-show-recovery.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withStages = () => ({
  pipelineStages: [
    { pipeline_key: "sales", stage_key: "showed", pipeline_id: "pl-sales", stage_id: "st-showed" },
    { pipeline_key: "sales", stage_key: "lost", pipeline_id: "pl-sales", stage_id: "st-lost" }
  ]
});

// A booking ending 1 hour from now.
const futureEnd = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

test("sleepUntil is set to appointment end + 5 minutes, not a flat duration", async () => {
  const endTime = futureEnd();
  const expectedWake = new Date(new Date(endTime).getTime() + 5 * 60 * 1000);
  const sleepUntilCalls = [];
  const step = { ...fakeStep(), sleepUntil: async (id, target) => { sleepUntilCalls.push({ id, target }); } };
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
  await handle({ event: ev("booking.created", { endTime }, { clientId: "cl-1" }), db, step });
  assert.equal(sleepUntilCalls.length, 1);
  assert.equal(sleepUntilCalls[0].id, "wait-until-5-min-after-end");
  // Target must be at least endTime + 5m (within 1 second tolerance for test runtime).
  assert.ok(Math.abs(sleepUntilCalls[0].target.getTime() - expectedWake.getTime()) < 1000,
    `sleepUntil target should be ~endTime+5m, got ${sleepUntilCalls[0].target.toISOString()}`);
});

test("falls back to startTime when endTime absent", async () => {
  const startTime = futureEnd();
  const sleepUntilCalls = [];
  const step = { ...fakeStep(), sleepUntil: async (id, target) => { sleepUntilCalls.push({ id, target }); } };
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
  await handle({ event: ev("booking.created", { startTime }, { clientId: "cl-1" }), db, step });
  assert.equal(sleepUntilCalls.length, 1);
  const expected = new Date(new Date(startTime).getTime() + 5 * 60 * 1000);
  assert.ok(Math.abs(sleepUntilCalls[0].target.getTime() - expected.getTime()) < 1000);
});

test("no appointment time → early exit, no sleep", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_appointment_time");
});

test("happy path: call happened before the check — moves to showed", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    events: [{ client_id: "cl-1", name: "call.completed" }],
    ...withStages()
  });
  const res = await handle({ event: ev("booking.created", { endTime: futureEnd() }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.outcome, "showed");
  assert.equal(db.cards[0].stage_id, "st-showed");
  assert.equal(db.events.filter((e) => e.name === "booking.noshow").length, 0);
});

test("branch: no call — no-show, tagged, moved to lost", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
  const res = await handle({ event: ev("booking.created", { endTime: futureEnd() }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.outcome, "no_show");
  assert.deepEqual(db.clients[0].tags, ["call:no_show"]);
  assert.equal(db.cards[0].stage_id, "st-lost");
});

test("no-show emits booking.noshow and S-05A listens for that event", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
  const event = ev(
    "booking.created",
    { endTime: futureEnd(), bookingUid: "bk_1", email: "a@b.com", source: "clickfunnels" },
    { clientId: "cl-1" }
  );
  await handle({ event, db, step: fakeStep() });
  const noshows = db.events.filter((e) => e.name === "booking.noshow");
  assert.equal(noshows.length, 1);
  assert.equal(noshows[0].client_id, "cl-1");
  assert.equal(noshows[0].payload.bookingUid, "bk_1");
  const triggers = (s05aNoShowRecovery.opts.triggers || []).map((t) => t.event);
  assert.ok(triggers.includes("booking.noshow"), "S-05A must start on booking.noshow");
});

test("duplicate delivery: replaying does not double-move the card", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
  const event = ev("booking.created", { endTime: futureEnd() }, { id: "evt-dup-dpc02", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.cards.length, 1);
});

/* ── A cancelled or moved call is never a no-show (cf-calendar-switch-plan step b/c)
 *
 * This run sleeps from booking until 5 minutes after the end. A cancel or move
 * used to leave it asleep, so at the OLD end time it found no call, tagged the
 * customer call:no_show, moved the sales card to lost and emitted booking.noshow
 * (which starts the no-show texts). withBookings answers the bookingStateAt read
 * (src/bookings/store.mjs) from saved booking rows.
 */
const sameInstant = (a, b) => a != null && b != null && Date.parse(a) === Date.parse(b);
function withBookings(base, bookings) {
  return {
    ...base,
    async query(sql, params = []) {
      if (/was_at_this_time/.test(sql)) {
        const [orgId, clientId, at, uid] = params;
        return {
          rows: bookings
            .filter((b) => b.org_id === orgId && ((clientId && b.client_id === clientId) || (uid && b.provider_uid === uid)))
            .map((b) => ({
              status: b.status,
              at_this_time: sameInstant(b.starts_at, at),
              was_at_this_time: (b.history || []).some((t) => sameInstant(t, at))
            }))
        };
      }
      return base.query(sql, params);
    }
  };
}
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const noshowDb = (bookings) => {
  const base = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
  return { base, db: withBookings(base, bookings) };
};
const assertNoNoShow = (base) => {
  assert.equal(base.events.filter((e) => e.name === "booking.noshow").length, 0, "booking.noshow was emitted");
  assert.ok(!(base.clients[0].tags || []).includes("call:no_show"), "the customer was tagged a no-show");
  assert.equal(base.cards.length, 0, "the sales card was moved");
  assert.notEqual(base.clients[0].custom_fields?.call_outcome, "no_show");
};

test("cancelled before its time: the check wakes and marks nothing", async () => {
  const start = inHours(1);
  const { base, db } = noshowDb([
    { org_id: "org-1", client_id: "cl-1", provider_uid: "72509", starts_at: start, status: "cancelled" }
  ]);
  const res = await handle({
    event: ev("booking.created", { startTime: start, endTime: inHours(1.5), bookingUid: "72509", email: "a@b.com" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "call_cancelled");
  assertNoNoShow(base);
});

test("moved before its time: the OLD-time check marks nothing", async () => {
  const oldStart = inHours(1), newStart = inHours(25);
  const { base, db } = noshowDb([
    { org_id: "org-1", client_id: "cl-1", provider_uid: "72509", starts_at: newStart, status: "rescheduled", history: [oldStart] }
  ]);
  const res = await handle({
    event: ev("booking.created", { startTime: oldStart, endTime: inHours(1.5), bookingUid: "72509" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.reason, "call_moved");
  assertNoNoShow(base);
});

test("moved: the NEW-time check still marks a real no-show", async () => {
  const oldStart = inHours(1), newStart = inHours(25);
  const { base, db } = noshowDb([
    { org_id: "org-1", client_id: "cl-1", provider_uid: "72509", starts_at: newStart, status: "rescheduled", history: [oldStart] }
  ]);
  const res = await handle({
    event: ev("booking.rescheduled", { startTime: newStart, endTime: inHours(25.5), bookingUid: "72509" }, { id: "evt-move", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.outcome, "no_show");
  const noshows = base.events.filter((e) => e.name === "booking.noshow");
  assert.equal(noshows.length, 1);
  assert.equal(noshows[0].idempotency_key, noshowKeyFor({ startTime: newStart, bookingUid: "72509" }, "evt-move"));
});

test("a booking still on at its time is decided as before (showed or no-show)", async () => {
  const start = inHours(1);
  const { base, db } = noshowDb([
    { org_id: "org-1", client_id: "cl-1", provider_uid: "72509", starts_at: start, status: "booked" }
  ]);
  const res = await handle({
    event: ev("booking.created", { startTime: start, endTime: inHours(1.5), bookingUid: "72509" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.outcome, "no_show");
  assert.equal(base.events.filter((e) => e.name === "booking.noshow").length, 1);
});

test("no-show key carries the call time: the same call missed at two times is two no-shows", () => {
  const a = noshowKeyFor({ bookingUid: "72509", startTime: "2026-10-06T18:00:00Z" }, "e1");
  const b = noshowKeyFor({ bookingUid: "72509", startTime: "2026-10-07T18:00:00.000Z" }, "e2");
  assert.notEqual(a, b);
  assert.equal(noshowKeyFor({ bookingUid: "72509", startTime: "2026-10-06T18:00:00Z" }, "e9"), a,
    "one call time must give one key, however the time is written");
  assert.equal(noshowKeyFor({}, "evt-1"), "dpc-02:evt-1:booking.noshow");
});

test("wiring: a cancel or a move to another time stops the check; a move starts one", () => {
  const triggers = (dpc02CallOutcomeEnforcement.opts.triggers || []).map((t) => t.event).sort();
  assert.deepEqual(triggers, ["booking.created", "booking.rescheduled"]);
  const rules = dpc02CallOutcomeEnforcement.opts.cancelOn || [];
  assert.equal(rules.filter((r) => r.event === "booking.cancelled").length, 2);
  const moves = rules.filter((r) => r.event === "booking.rescheduled");
  assert.equal(moves.length, 2);
  for (const r of moves) assert.match(r.if, /startTime != async\.data\.payload\.startTime/);
});
