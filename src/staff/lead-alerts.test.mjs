import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStaffLeadText, buildCloserSetText, buildCloserUpcomingText,
  queueNewLeadAlerts, queueCloserSetAlert, queueCloserUpcomingAlert
} from "./lead-alerts.mjs";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const STAFF = [
  { id: "owner-1", role: "owner", phone: "+16616180865" },
  { id: "setter-2", role: "setter", phone: "+14805550111" },
  { id: "closer-3", role: "closer", phone: "+14805550222" }
];

function fakeDb({ booked = false, assigned = false } = {}) {
  const refs = new Set();
  const messages = [];
  const client = { first_name: "Pat", last_name: "Lee", phone: "+14805550333",
    email: "pat@example.com", custom_fields: {
      cf_svy_planned_use_label: "Open a shop",
      setter_survey_edits: { cf_svy_planned_use: "Buy equipment" },
      setter_handoff: { closer_staff_id: "closer-3" }
    } };
  const db = { async query(sql, args = []) {
    if (/FROM clients/.test(sql)) return { rows: [client] };
    if (/FROM bookings/.test(sql)) return { rows: booked ? [{ starts_at: "2026-11-01T20:00:00Z" }] : [] };
    if (/FROM tasks/.test(sql)) return { rows: assigned ? [{ assignee_staff_id: "closer-3" }] : [] };
    if (/FROM staff/.test(sql) && /id = \$2/.test(sql)) return { rows: STAFF.filter(row => row.id === args[1]) };
    if (/FROM staff/.test(sql)) return { rows: STAFF.filter(row => args[1].includes(row.role)) };
    if (/INSERT INTO messages/.test(sql)) {
      if (refs.has(args[3])) return { rows: [] };
      refs.add(args[3]);
      messages.push({ body: args[2], ref: args[3], to: args[4] });
      return { rows: [{ id: `m-${messages.length}` }] };
    }
    throw new Error(`unexpected query: ${sql}`);
  } };
  return { db, client, messages };
}

test("new lead text has only first name, contact, booking state and current survey answers", () => {
  const { client } = fakeDb();
  const text = buildStaffLeadText({ client });
  assert.match(text, /^New lead: Pat\n/);
  assert.doesNotMatch(text, /Pat Lee|deposit|commission|RUN FIRST/);
  assert.match(text, /Phone: \+14805550333/);
  assert.match(text, /Email: pat@example.com/);
  assert.match(text, /Booked: No/);
  assert.match(text, /Planned Use: Buy equipment/);
  assert.doesNotMatch(text, /Open a shop/);
});

test("only setters and owner get the first SMS and push, once per client", async () => {
  const { db, messages } = fakeDb();
  const pushes = [];
  const drains = [];
  const opts = {
    orgId: "org-1", clientId: CLIENT,
    drainNowImpl: async (_db, id) => { drains.push(id); return { sent: 1 }; },
    pushImpl: async (_db, args) => { pushes.push(args); return { sent: 1 }; }
  };
  const first = await queueNewLeadAlerts(db, opts);
  const replay = await queueNewLeadAlerts(db, opts);
  assert.equal(first.queued, 2);
  assert.equal(replay.queued, 0);
  assert.deepEqual(messages.map(row => row.to), [STAFF[0].phone, STAFF[1].phone]);
  assert.deepEqual(drains, ["m-1", "m-2"]);
  assert.deepEqual(pushes.map(row => row.kind), ["lead", "lead", "lead", "lead"]);
  assert.ok(pushes.every(row => row.key === CLIENT));
});

test("set text includes saved setter corrections, including when the owner is setter and closer", async () => {
  const { db, client, messages } = fakeDb({ booked: true });
  const handoff = { goal: "New location", problem: "Cash gap", computer_ready: true };
  const body = buildCloserSetText({ client, handoff, startTime: "2026-11-01T20:00:00Z" });
  assert.match(body, /^Lead set: Pat\n/);
  assert.match(body, /Goal: New location/);
  assert.match(body, /Problem: Cash gap/);
  assert.match(body, /Planned Use: Buy equipment/);
  assert.doesNotMatch(body, /Open a shop|deposit|commission/);
  const same = await queueCloserSetAlert(db, { orgId: "org-1", clientId: CLIENT,
    setterStaffId: "owner-1", closerStaffId: "owner-1", client, handoff,
    drainNowImpl: async () => ({ sent: 1 }), pushImpl: async () => ({ sent: 1 }) });
  assert.equal(same.queued, 1);
  const opts = { orgId: "org-1", clientId: CLIENT, setterStaffId: "owner-1",
    closerStaffId: "closer-3", client, handoff, startTime: "2026-11-01T20:00:00Z",
    drainNowImpl: async () => ({ sent: 1 }), pushImpl: async () => ({ sent: 1 }) };
  assert.equal((await queueCloserSetAlert(db, opts)).queued, 1);
  assert.equal((await queueCloserSetAlert(db, opts)).queued, 0);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].to, STAFF[0].phone);
  assert.equal(messages[1].to, STAFF[2].phone);
});

test("upcoming alert goes only to assigned closer for this call time", async () => {
  const { db, messages } = fakeDb({ booked: true, assigned: true });
  const opts = { orgId: "org-1", clientId: CLIENT, startTime: "2026-11-01T20:00:00Z",
    drainNowImpl: async () => ({ sent: 1 }), pushImpl: async () => ({ sent: 1 }) };
  assert.match(buildCloserUpcomingText({ client: { first_name: "Pat" }, startTime: opts.startTime }), /Next call: Pat/);
  assert.equal((await queueCloserUpcomingAlert(db, opts)).queued, 1);
  assert.equal((await queueCloserUpcomingAlert(db, opts)).queued, 0);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, STAFF[2].phone);
});

test("an assigned closer gets a new-lead push without an immediate closer SMS", async () => {
  const { db, messages } = fakeDb({ assigned: true });
  const pushes = [];
  await queueNewLeadAlerts(db, { orgId: "org-1", clientId: CLIENT,
    drainNowImpl: async () => ({ sent: 1 }),
    pushImpl: async (_db, args) => { pushes.push(args); return { sent: 1 }; } });
  assert.deepEqual(messages.map(row => row.to), [STAFF[0].phone, STAFF[1].phone]);
  assert.deepEqual(pushes.map(row => row.staffId), ["owner-1", "setter-2", "closer-3"]);
});
