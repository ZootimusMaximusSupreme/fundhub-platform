import { test } from "node:test";
import assert from "node:assert";
import { handle, JOSH_CODE, JOSH_CALL_KIND, VENDOR_SETTER_TASK } from "./ai-set-01-josh-setter.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const CLIENT_PHONE = "+15555550100";

function stubPlaceCall(sink) {
  return async (args) => {
    sink.push(args);
    return { status: "blocked", blocked: true, reason: "dry_run", callId: null };
  };
}

function withAgents(db, agents) {
  const orig = db.query.bind(db);
  db.query = async (sql, params = []) => {
    if (/FROM agents/.test(sql)) {
      const row = agents.find((a) => a.org_id === params[0] && a.code === params[1]);
      return { rows: row ? [row] : [] };
    }
    return orig(sql, params);
  };
  return db;
}

test("booking.created would call placeCall with the setter prompt + client phone", async () => {
  // Dry-run: no real person called.
  const placed = [];
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: CLIENT_PHONE }]
  });
  const res = await handle({
    event: ev("booking.created", {}, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    placeCallImpl: stubPlaceCall(placed)
  });
  assert.equal(res.done, true);
  assert.equal(res.agentSource, "vendor_prompt");
  assert.equal(placed.length, 1);
  assert.equal(placed[0].phone, CLIENT_PHONE);
  assert.equal(placed[0].agent.prompt, VENDOR_SETTER_TASK);
  assert.match(placed[0].agent.prompt, /You are Chris/);
  assert.equal(placed[0].clientId, "cl-1");
});

test("AG-04 row wins over the vendor file when it is ready", async () => {
  // Dry-run: no real person called.
  const placed = [];
  const dbPrompt = "You are Chris. Confirm the Strategy Session from the Agent Editor.";
  const db = withAgents(pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: CLIENT_PHONE }]
  }), [{
    org_id: "org-1",
    code: JOSH_CODE,
    name: "Setter Chris",
    status: "live",
    channel: "voice",
    agent_class: "client_facing",
    runtime: "bland",
    prompt: dbPrompt
  }]);
  const res = await handle({
    event: ev("booking.created", {}, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    placeCallImpl: stubPlaceCall(placed)
  });
  assert.equal(res.done, true);
  assert.equal(res.agentSource, "ag-04");
  assert.equal(placed[0].phone, CLIENT_PHONE);
  assert.equal(placed[0].agent.prompt, dbPrompt);
});

test("retired AG-04 does not placeCall and does not fall back to vendor", async () => {
  const placed = [];
  const db = withAgents(pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: CLIENT_PHONE }]
  }), [{
    org_id: "org-1",
    code: JOSH_CODE,
    name: "Setter Chris",
    status: "retired",
    channel: "voice",
    agent_class: "client_facing",
    runtime: "bland",
    prompt: "You are Chris. Still has a script, but retired must not dial."
  }]);
  const res = await handle({
    event: ev("booking.created", {}, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    placeCallImpl: stubPlaceCall(placed)
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "agent_not_ready");
  assert.equal(res.agentSource, "ag-04");
  assert.equal(placed.length, 0);
});

test("quiet-hours-blocks-or-delays-setter: 8pm Arizona waits until 8am, then dials once", async () => {
  const placed = [];
  const sleeps = [];
  const night = new Date("2026-08-02T03:00:00Z"); // 8pm Arizona
  const step = {
    ...fakeStep(),
    sleepUntil: async (id, date) => { sleeps.push({ id, date }); }
  };
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: CLIENT_PHONE }]
  });
  const res = await handle({
    event: ev("booking.created", { bookingUid: "bk-night" }, { clientId: "cl-1" }),
    db,
    step,
    placeCallImpl: stubPlaceCall(placed),
    now: () => night
  });
  assert.equal(res.done, true);
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0].id, "wait-quiet-hours");
  assert.equal(sleeps[0].date.toISOString(), "2026-08-02T15:00:00.000Z");
  assert.equal(placed.length, 1, "one call after the wait, not two");
});

test("quiet-hours-blocks-or-delays-setter: daytime Arizona dials once with no wait", async () => {
  const placed = [];
  const sleeps = [];
  const afternoon = new Date("2026-08-02T18:00:00Z"); // 11am Arizona
  const step = {
    ...fakeStep(),
    sleepUntil: async (id, date) => { sleeps.push({ id, date }); }
  };
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: CLIENT_PHONE }]
  });
  const res = await handle({
    event: ev("booking.created", { bookingUid: "bk-day" }, { clientId: "cl-1" }),
    db,
    step,
    placeCallImpl: stubPlaceCall(placed),
    now: () => afternoon
  });
  assert.equal(res.done, true);
  assert.equal(sleeps.length, 0);
  assert.equal(placed.length, 1);
});

test("successful placeCall writes outbound_calls as ai-set-01-josh-setter", async () => {
  const inserts = [];
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: CLIENT_PHONE }]
  });
  const orig = db.query.bind(db);
  db.query = async (sql, params = []) => {
    if (/INSERT INTO outbound_calls/.test(sql)) {
      inserts.push(params);
      return { rows: [] };
    }
    return orig(sql, params);
  };
  const res = await handle({
    event: ev("booking.created", {}, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    placeCallImpl: async () => ({ status: "sent", callId: "bland-setter-1", reason: "placed" })
  });
  assert.equal(res.done, true);
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0], ["bland-setter-1", "cl-1", "org-1", JOSH_CALL_KIND]);
});

test("prove sim skips quiet hours and dials once at night", async () => {
  const placed = [];
  const sleeps = [];
  const night = new Date("2026-08-02T03:00:00Z");
  const step = {
    ...fakeStep(),
    sleepUntil: async (id, date) => { sleeps.push({ id, date }); }
  };
  const db = pgFake({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "stanbridgejchris+sim-fund@gmail.com",
      phone: CLIENT_PHONE
    }]
  });
  const res = await handle({
    event: ev("booking.created", { bookingUid: "bk-sim-night" }, { clientId: "cl-1" }),
    db,
    step,
    placeCallImpl: stubPlaceCall(placed),
    now: () => night
  });
  assert.equal(res.done, true);
  assert.equal(sleeps.length, 0);
  assert.equal(placed.length, 1);
});

test("no phone — placeCall is not invoked", async () => {
  const placed = [];
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }]
  });
  const res = await handle({
    event: ev("booking.created", {}, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    placeCallImpl: stubPlaceCall(placed)
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_phone");
  assert.equal(placed.length, 0);
});
