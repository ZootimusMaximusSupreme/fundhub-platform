// Unit 4's guarantee: every workflow that creates work names the role that owns
// it, and it is the role the routing spec assigns.
//
// Two layers, because neither alone is enough:
//
//  1. RUNTIME — drive four workflows (one per destination role) through their real
//     handle() against the pgFake and assert the row that lands. This is the only
//     proof that the value reaches the database rather than merely appearing in
//     the source.
//
//  2. COMPLETENESS — assert the remaining sites pass a role from the spec map and
//     that nothing still writes a raw INSERT. This is a source check and is honest
//     about being one; what makes it more than a grep is that createTask() THROWS
//     on a missing or non-employee role, so the existing workflow test files are
//     themselves runtime proof that whatever each site passes is present and valid.
//
// TWENTY sites, not nineteen: src/handlers/comms.mjs creates the Cal.com
// "Strategy session booked" task and is not a workflow, so the first routing pass
// missed it. It is routed to closer — a booked strategy session is a sales call.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { pgFake, fakeStep, ev } from "./test-support.mjs";
import { TASK_ROLES } from "../lib/create-task.mjs";

// Booking tasks now require a persisted, tenant-owned appointment FIRST.
// This narrow fake keeps the routing spec's role assertion meaningful while
// exercising the same booking/identity acceptance contract as real Postgres.
function bookingTaskFake(seed) {
  const fake = pgFake(seed);
  const query = fake.query.bind(fake);
  fake.query = async (sql, params = []) => {
    if (/SELECT id FROM clients WHERE org_id = \\$1 AND id = \\$2 LIMIT 1/.test(sql)) {
      const owner = fake.clients.find(c => c.org_id === params[0] && c.id === params[1]);
      return { rows: owner ? [{ id: owner.id }] : [] };
    }
    if (/FROM bookings\\s+WHERE org_id = \\$1 AND provider_uid = \\$2/.test(sql)) {
      const row = fake.bookings.find(b => b.org_id === params[0] && b.provider_uid === params[1]);
      return { rows: row ? [row] : [] };
    }
    if (/INSERT INTO bookings/.test(sql)) {
      const [org_id, client_id, source, provider_uid,,,, status] = params;
      const row = { org_id, client_id, source, provider_uid, status };
      fake.bookings.push(row);
      return { rows: [row] };
    }
    return query(sql, params);
  };
  return fake;
}

// The routing table from the unit spec, keyed by workflow id prefix.
const SPEC = {
  "f-01": "funding_advisor", "f-07": "funding_advisor", "f-08": "funding_advisor",
  "f-09": "funding_advisor", "f-10": "funding_advisor", "f-11": "funding_advisor",
  "c-05": "funding_advisor", "c-06": "funding_advisor", "dpc-03": "funding_advisor",
  "dpc-05": "funding_advisor", "n-06": "funding_advisor", "u-02": "funding_advisor",
  "u-05": "funding_advisor", "ai-set-04": "closer",
  "c-02": "inquiry_specialist", "c-03": "inquiry_specialist",
  // s-06 was "closer" and that was wrong: the task it raises is "Funding intake
  // — pull CRS", which is fulfilment work. Closers sell and close; funding
  // advisors deliver. Corrected 2026-08-30 with the code.
  "s-06": "funding_advisor", "s-08": "closer",
  "ds-02": "admin"
};

// Task writers outside src/workflows. Same requirement, different directory.
// comms.mjs creates three Cal.com tasks: booking → closer, reschedule → closer,
// cancel re-nurture → setter. All must be employee roles from TASK_ROLES.
const NON_WORKFLOW_SITES = [
  { file: "src/handlers/comms.mjs", roles: ["closer", "setter"] }
];

/* Templates are defined per-test-file in this suite rather than exported from
   test-support, so this is the local one. It is permissive on purpose: these
   tests assert the TASK row, and a missing template must not stop a workflow
   reaching its task branch. */
const anyTemplates = () => {
  const keys = [];
  for (const f of fs.readdirSync(path.join(process.cwd(), "src/workflows"))) {
    if (!f.endsWith(".mjs") || f.includes(".test.")) continue;
    const src = fs.readFileSync(path.join(process.cwd(), "src/workflows", f), "utf8");
    for (const m of src.matchAll(/["'`]((?:EMAIL|SMS)-[A-Z0-9-]+)["'`]/g)) keys.push(m[1]);
  }
  return [...new Set(keys)].flatMap((k) => ["sms", "email"].map((channel) => ({
    org_id: "org-1", template_key: k, channel, body: k, compliance_passed: true
  })));
};

const DIR = path.join(process.cwd(), "src/workflows");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs") && !f.includes(".test."));
const fileFor = (key) => files.find((f) => f.startsWith(key + "-"));

describe("task role routing", () => {

  // ── layer 1: the row that actually lands ──

  test("f-01 routes its pod task to funding_advisor", async () => {
    const { handle } = await import("./f-01-funding-intake.mjs");
    // Fixture copied from f-01-funding-intake.test.mjs's happy path — a funding
    // tier with no pod assigned is what reaches the task branch.
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com",
                  outcome_tier: "FULL_FUNDING", custom_fields: {} }]
    });
    await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(db.tasks.length, 1, "f-01 created no task");
    assert.equal(db.tasks[0].assignee_role, "funding_advisor");
    assert.equal(db.tasks[0].assignee_staff_id, null, "a new task must be unclaimed");
  });

  test("c-02 routes inquiry work to inquiry_specialist", async () => {
    const { handle } = await import("./c-02-inquiry-created.mjs");
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
      templates: anyTemplates()
    });
    await handle({
      event: ev("inquiry.created", { newInquiries: [{ bureau: "EX", name: "X" }] }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(db.tasks.length, 1, "c-02 created no task");
    assert.equal(db.tasks[0].assignee_role, "inquiry_specialist");
  });

  test("s-08 routes post-call follow-up to closer", async () => {
    const { handle } = await import("./s-08-post-call-funding-declined.mjs");
    // Fixture from s-08-post-call-funding-declined.test.mjs: the gate is
    // payload.outcome === "declined".
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
    await handle({
      event: ev("call.completed", { outcome: "declined" }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(db.tasks.length, 1, "s-08 created no task");
    assert.equal(db.tasks[0].assignee_role, "closer");
  });

  test("ds-02 routes the invoice task to admin", async () => {
    const { handle } = await import("./ds-02-diy-letters.mjs");
    // Fixture from ds-02-diy-letters.test.mjs: the downsell path is
    // REPAIR_ONLY + the DIY product name. HARD RULE 1 keeps it off the funding
    // route, so the tier here is load-bearing.
    const { EMAIL_TEMPLATE_KEY } = await import("./ds-02-diy-letters.mjs");
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com",
                  outcome_tier: "REPAIR_ONLY", custom_fields: {} }],
      templates: [{ org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email",
                    body: "letters ready", compliance_passed: true }]
    });
    await handle({
      event: ev("payment.received", { productName: "Consulting Services Package", amount: 1000 },
                { clientId: "cl-1" }),
      db, step: fakeStep(), fetchImpl: async () => ({ ok: true, status: 200 })
    });
    assert.equal(db.tasks.length, 1, "ds-02 created no task");
    assert.equal(db.tasks[0].assignee_role, "admin");
  });

  test("comms.mjs routes the booking task to closer, and labels it honestly", async () => {
    const { onBookingCreated } = await import("../handlers/comms.mjs");
    // Fixture from comms.test.mjs's booking case: resolveClient matches on email.
    const db = bookingTaskFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
    await onBookingCreated({
      id: "evt-booking-1", orgId: "org-1", clientId: "cl-1", name: "booking.created",
      // *** NO `source` KEY, ON PURPOSE. DO NOT ADD ONE. ***
      // This payload names no origin, which is the case the assertion below
      // exists to pin down. Adding `source: "calcom"` to the fixture makes that
      // assertion prove only that the payload round-trips — it stops proving
      // anything about what the code decides. It was added once, in T7 round 1,
      // and that edit is what this comment is here to prevent repeating.
      payload: { email: "a@b.com", bookingUid: "bk-1", startTime: "2026-09-01T15:00:00Z" }
    }, db);
    assert.equal(db.tasks.length, 1, "comms.mjs created no task");
    assert.equal(db.tasks[0].assignee_role, "closer");
    // The old hardcoded default was "calcom" — a vendor that has never sent this
    // system a booking (T7-05). An unnamed source is recorded as "we were not
    // told", never guessed.
    assert.equal(db.tasks[0].source_workflow, "unknown",
      "an unnamed booking source was filled in with a guess");
    assert.notEqual(db.tasks[0].source_workflow, "calcom");
    assert.equal(db.tasks[0].assignee_staff_id, null);
  });

  test("comms.mjs booking task still dedupes on the booking uid", async () => {
    const { onBookingCreated } = await import("../handlers/comms.mjs");
    const db = bookingTaskFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
    const evt = {
      id: "evt-booking-2", orgId: "org-1", clientId: "cl-1", name: "booking.created",
      payload: { email: "a@b.com", bookingUid: "bk-2", startTime: null }
    };
    await onBookingCreated(evt, db);
    await onBookingCreated(evt, db);
    assert.equal(db.tasks.length, 1, "replay double-created the booking task");
  });

  // ── layer 2: completeness across all twenty ──

  test("all twenty routed sites exist and pass a role from the spec", () => {
    const missing = [];
    const wrong = [];
    for (const [key, role] of Object.entries(SPEC)) {
      const f = fileFor(key);
      if (!f) { missing.push(key); continue; }
      const src = fs.readFileSync(path.join(DIR, f), "utf8");
      const found = [...src.matchAll(/assigneeRole:\s*"([a-z_]+)"/g)].map((m) => m[1]);
      if (!found.length) missing.push(`${key} (no assigneeRole)`);
      else if (!found.every((r) => r === role)) wrong.push(`${key}: ${found} ≠ ${role}`);
    }
    for (const { file, roles } of NON_WORKFLOW_SITES) {
      const src = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      const found = [...src.matchAll(/assigneeRole:\s*"([a-z_]+)"/g)].map((m) => m[1]);
      if (!found.length) missing.push(`${file} (no assigneeRole)`);
      else if (!found.every((r) => roles.includes(r))) {
        wrong.push(`${file}: ${found} not in ${roles}`);
      }
    }
    assert.deepEqual(missing, [], `sites with no role: ${missing}`);
    assert.deepEqual(wrong, [], `sites routed to the wrong role: ${wrong}`);
    assert.equal(Object.keys(SPEC).length + NON_WORKFLOW_SITES.length, 20);
  });

  test("every role in the spec is one createTask accepts", () => {
    for (const role of new Set(Object.values(SPEC))) {
      assert.ok(TASK_ROLES.has(role), `${role} is not an employee role`);
    }
  });

  test("nothing writes a raw INSERT INTO tasks any more", () => {
    // Whole tree, not just src/workflows — comms.mjs is exactly the case a
    // workflows-only sweep missed the first time.
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!e.name.endsWith(".mjs")) continue;
        const rel = path.relative(process.cwd(), full);
        // The helper itself is the one legitimate writer; the pgFake and the
        // tests only pattern-match on the SQL.
        if (rel.endsWith("src/lib/create-task.mjs")) continue;
        // A stand-in database used only by tests: it pattern-matches the SQL string to answer it. It writes to memory.
        if (rel.endsWith("src/testing/s3-mem-tasks-db.mjs")) continue;
        if (e.name.includes(".test.") || e.name === "test-support.mjs") continue;
        if (/INSERT INTO tasks/.test(fs.readFileSync(full, "utf8"))) offenders.push(rel);
      }
    };
    walk(path.join(process.cwd(), "src"));
    assert.deepEqual(offenders, [],
      `these bypass createTask and so can create work with no owner: ${offenders}`);
  });

  test("f-06 is named in the spec but creates no task — recorded, not silently dropped", () => {
    const f = fileFor("f-06");
    assert.ok(f, "f-06 should exist");
    const src = fs.readFileSync(path.join(DIR, f), "utf8");
    assert.equal(/INSERT INTO tasks|createTask\(/.test(src), false,
      "f-06 now creates a task — add it to the SPEC map above and route it");
  });
});
