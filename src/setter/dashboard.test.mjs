import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeHandoffPatch, missingForCompletion, updateSetterHandoff, listSetterQueue, targetDialBy } from "./dashboard.mjs";

const STAFF = { id: "staff-1", org_id: "org-1", role: "owner", name: "Chris" };
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

function completeHandoff() {
  return { dialed_at: "2026-10-26T20:00:00Z", call_attempts: 1, disposition: "reached",
    time_confirmed: true, frame_warmed: true, problem: "Needs working capital",
    goal: "Open a second location", computer_ready: true, app_on_phone: false };
}

function fakeDb(booked = true) {
  const client = { client_id: CLIENT_ID, first_name: "Pat", last_name: "Lee", phone: "+15551234567",
    email: "pat@example.com", custom_fields: {}, booked_at: booked ? "2026-10-26T19:00:00Z" : null,
    booking_time: booked ? "2026-10-28T19:00:00Z" : null, closer_staff_id: STAFF.id };
  const queries = [];
  const db = { async query(sql, params) {
    queries.push(sql);
    if (sql.includes("FROM clients c")) return { rows: [client] };
    if (sql.includes("UPDATE clients")) {
      client.custom_fields.setter_handoff = { ...(client.custom_fields.setter_handoff || {}), ...JSON.parse(params[2]) };
      return { rows: [{ setter_handoff: client.custom_fields.setter_handoff }] };
    }
    if (sql.includes("UPDATE tasks")) return { rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  } };
  return { db, client, queries };
}

test("handoff input refuses unsupported claims and keeps only checklist fields", () => {
  assert.match(sanitizeHandoffPatch({ goal: "Pre-approved for $100,000" }).error, /unsupported/);
  assert.match(sanitizeHandoffPatch({ problem: "SSN 123-45-6789" }).error, /unsupported/);
  assert.deepEqual(sanitizeHandoffPatch({ goal: "Growth", forged_timestamp: "now" }).patch, { goal: "Growth" });
});

test("dial target waits until 6 a.m. Phoenix for an overnight lead", () => {
  assert.equal(targetDialBy("2026-10-27T06:00:00Z"), "2026-10-27T13:00:00.000Z");
  assert.equal(targetDialBy("2026-10-27T20:00:00Z"), "2026-10-27T20:01:00.000Z");
});

test("completion requires booked webhook, triage fields for opt-in, and handoff facts", () => {
  const h = { lead_type: "opt_in", ...completeHandoff() };
  assert.deepEqual(missingForCompletion(h, { booked_at: null, booking_time: null }),
    ["booking", "triage_problem", "triage_goal", "triage_personal_or_business"]);
  assert.deepEqual(missingForCompletion({ lead_type: "booked", ...completeHandoff() },
    { booked_at: "2026-10-26", booking_time: "2026-10-28" }), []);
});

test("saved checklist merges, completion is gated, and complete handoff is visible on client", async () => {
  const { db, client, queries } = fakeDb();
  const saved = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save",
    handoff: { dialed_at: "2026-10-26T20:00:00Z", call_attempts: 1 } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.item.setter_handoff.call_attempts, 1);
  const incomplete = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "complete",
    handoff: { goal: "Open a second location" } });
  assert.equal(incomplete.status, 400);
  assert.equal(incomplete.body.error, "handoff_incomplete");
  assert.equal(queries.some(q => q.includes("UPDATE tasks")), false);
  const completed = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "complete",
    handoff: completeHandoff() }, { buildText: () => "Saved handoff" });
  assert.equal(completed.status, 200);
  assert.equal(client.custom_fields.setter_handoff.handoff_text, "Saved handoff");
  assert.ok(client.custom_fields.setter_handoff.complete_at);
  assert.equal(completed.body.item.needs_work, false);
  assert.equal(queries.some(q => q.includes("UPDATE tasks")), true);
});

test("opt-in cannot complete until booking webhook adds a booking", async () => {
  const { db } = fakeDb(false);
  const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "complete",
    handoff: { ...completeHandoff(), triage_problem: "Cash flow", triage_goal: "Expand",
      triage_personal_or_business: "business" } });
  assert.equal(result.status, 400);
  assert.deepEqual(result.body.missing, ["booking"]);
});

test("editing a completed checklist keeps the closer note in sync and preserves completion gates", async () => {
  const { db, client } = fakeDb();
  client.custom_fields.setter_handoff = { lead_type: "booked", ...completeHandoff(),
    complete_at: "2026-10-26T21:00:00Z", handoff_text: "Old note" };
  const edited = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save",
    handoff: { problem: "New stuck part" } }, { buildText: ({ handoff }) => handoff.problem });
  assert.equal(edited.status, 200);
  assert.equal(client.custom_fields.setter_handoff.handoff_text, "New stuck part");
  assert.equal(client.custom_fields.setter_handoff.complete_at, "2026-10-26T21:00:00Z");
  const invalid = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "save",
    handoff: { problem: "" } });
  assert.equal(invalid.status, 400);
  assert.equal(client.custom_fields.setter_handoff.problem, "New stuck part");
});

test("send action receives saved handoff and persists timestamp only after send", async () => {
  const { db, client } = fakeDb();
  client.custom_fields.setter_handoff = { lead_type: "booked", ...completeHandoff(), complete_at: "2026-10-26T21:00:00Z" };
  let seen = null;
  const result = await updateSetterHandoff(db, STAFF, { client_id: CLIENT_ID, action: "send_handoff", handoff: {} }, {
    sendAction: async args => {
      seen = args;
      return { same_staff: true, handoffPatch: { handoff_sent_at: "2026-10-26T21:01:00Z" } };
    }
  });
  assert.equal(result.status, 200);
  assert.equal(seen.action, "send_handoff");
  assert.equal(seen.setterStaffId, STAFF.id);
  assert.equal(seen.closerStaffId, STAFF.id);
  assert.equal(seen.handoff.goal, "Open a second location");
  assert.equal(client.custom_fields.setter_handoff.handoff_sent_at, "2026-10-26T21:01:00Z");
});

test("queue returns booked and opt-in leads with survey echo and saved handoff", async () => {
  const db = { async query(sql, params) {
    assert.match(sql, /assignee_role = 'setter'/);
    assert.equal(params[0], STAFF.org_id);
    return { rows: [{ client_id: CLIENT_ID, first_name: "Pat", last_name: "Lee",
      phone: "+15551234567", created_at: "2026-10-26T20:00:00Z",
      target_dial_by: "2026-10-26T20:01:00Z", booked_at: null, booking_time: null,
      custom_fields: { cf_svy_planned_use_label: "Open a shop", setter_handoff: { call_attempts: 2 } } }] };
  } };
  const result = await listSetterQueue(db, STAFF);
  assert.equal(result.items[0].lead_type, "opt_in");
  assert.equal(result.items[0].setter_handoff.call_attempts, 2);
  assert.ok(result.items[0].survey.some(x => x.answer === "Open a shop"));
});

test("booked lead dial target starts from booking time, not its earlier opt-in task", async () => {
  const db = { async query() { return { rows: [{ client_id: CLIENT_ID, first_name: "Pat",
    created_at: "2026-10-26T16:00:00Z", booked_at: "2026-10-26T20:00:00Z",
    booking_time: "2026-10-28T19:00:00Z", custom_fields: {} }] }; } };
  const result = await listSetterQueue(db, STAFF);
  assert.equal(result.items[0].target_dial_by, "2026-10-26T20:01:00.000Z");
});

test("setter can save only an assigned or unclaimed task and claims it", async () => {
  const { db, client } = fakeDb();
  const setter = { id: "staff-2", org_id: STAFF.org_id, role: "setter", name: "Alex" };
  let assignee = null;
  const original = db.query;
  db.query = async (sql, params) => {
    if (sql.trim().startsWith("SELECT assignee_staff_id FROM tasks")) return { rows: [{ assignee_staff_id: assignee }] };
    if (sql.includes("UPDATE tasks SET assignee_staff_id")) {
      if (assignee && assignee !== params[2]) return { rows: [] };
      assignee = params[2];
      return { rows: [{ id: "task-1" }] };
    }
    return original(sql, params);
  };
  const first = await updateSetterHandoff(db, setter, { client_id: CLIENT_ID, action: "save",
    handoff: { call_attempts: 1 } });
  assert.equal(first.status, 200);
  assert.equal(assignee, setter.id);
  assert.equal(client.custom_fields.setter_handoff.setter_staff_id, setter.id);
  const other = await updateSetterHandoff(db, { ...setter, id: "staff-3" }, { client_id: CLIENT_ID, action: "save",
    handoff: { call_attempts: 2 } });
  assert.equal(other.status, 403);
  assert.equal(client.custom_fields.setter_handoff.call_attempts, 1);
});
