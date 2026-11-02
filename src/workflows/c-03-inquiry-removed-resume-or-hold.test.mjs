import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./c-03-inquiry-removed-resume-or-hold.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

function c03Db({ client, cases = [], inquiries = [], paid = false, fraudCase = false, advisorId = "advisor-1" }) {
  const base = pgFake({ clients: [client] });
  const query = base.query.bind(base);
  base.query = async (sql, params) => {
    if (/SELECT \*\s+FROM inquiry_removal_cases/.test(sql)) return { rows: cases };
    if (/SELECT 1 FROM inquiry_removal_cases/.test(sql)) return { rows: fraudCase ? [{ exists: 1 }] : [] };
    if (/SELECT bureau, status, created_at, is_open FROM inquiry_log/.test(sql)) return { rows: inquiries };
    if (/SELECT 1 FROM sales s/.test(sql)) return { rows: paid ? [{ exists: 1 }] : [] };
    if (sql.includes("LEFT JOIN staff s") && sql.includes("cf_funding_advisor_user_id")) {
      const id = client.custom_fields?.cf_funding_advisor_user_id || null;
      return { rows: [{ staff_id: id, active_staff_id: id }] };
    }
    if (sql.includes("FROM tasks t JOIN staff s")) return { rows: [] };
    if (sql.includes("FROM staff s") && sql.includes("ORDER BY")) return { rows: paid && advisorId ? [{ id: advisorId }] : [] };
    if (sql.includes("UPDATE clients c") && sql.includes("cf_funding_advisor_user_id")) {
      client.custom_fields.cf_funding_advisor_user_id = params[2];
      return { rows: [{ id: client.id }] };
    }
    if (sql.includes("UPDATE tasks SET assignee_staff_id")) return { rows: [] };
    return query(sql, params);
  };
  return base;
}

test("happy path: funding client — resumes, tags completed, ready for next round", async () => {
  const db = c03Db({ client: { id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["inquiry:pending"], custom_fields: { product_path: "Funding", round_hold_reason: "New Inquiries" } }, paid: true });
  const res = await handle({ event: ev("inquiry.removed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "resume");
  assert.equal(db.clients[0].tags.includes("inquiry:pending"), false);
  assert.ok(db.clients[0].tags.includes("inquiry:completed"));
  assert.equal(db.clients[0].custom_fields.ready_for_next_round, true);
  assert.equal(db.clients[0].custom_fields.employee_next_action, "Apply for Funding");
  assert.equal(db.clients[0].custom_fields.round_hold_reason, null);
  assert.equal(db.clients[0].custom_fields.cf_funding_advisor_user_id, "advisor-1");
  assert.equal(db.tasks[0].assignee_role, "funding_advisor");
  assert.equal(db.tasks[0].assignee_staff_id, "advisor-1");
});

test("inquiry-only file does not say Apply for Funding", async () => {
  const db = c03Db({ client: { id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["inquiry:pending"], custom_fields: {} } });
  const res = await handle({ event: ev("inquiry.removed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "inquiry_done");
  assert.ok(db.clients[0].tags.includes("inquiry:completed"));
  assert.equal(db.clients[0].custom_fields.ready_for_next_round, false);
  assert.notEqual(db.clients[0].custom_fields.employee_next_action, "Apply for Funding");
  assert.equal(db.tasks.length, 0);
});

test("branch: fraud alert holds the file instead", async () => {
  const db = c03Db({ client: { id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} } });
  const res = await handle({ event: ev("inquiry.removed", { fraudAlert: true }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "fraud_hold");
  assert.equal(db.clients[0].custom_fields.round_hold_reason, "Fraud Alert");
  assert.deepEqual(db.clients[0].tags, ["fraud:alert-present"]);
});

test("duplicate delivery: replaying does not double-create the task", async () => {
  const db = c03Db({ client: { id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { product_path: "Funding" } }, paid: true });
  const event = ev("inquiry.removed", {}, { id: "evt-dup-c03", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
});

test("one cleared bureau leaves other inquiry work pending", async () => {
  const client = { id: "cl-1", org_id: "org-1", tags: ["inquiry:pending"], custom_fields: { product_path: "Funding", round_hold_reason: "New Inquiries" } };
  const db = c03Db({ client, paid: true, cases: [{ case_status: "In Progress", selected_bureaus_raw: "TU" }] });
  const res = await handle({ event: ev("inquiry.removed", {}, { clientId: client.id }), db, step: fakeStep() });
  assert.equal(res.branch, "inquiries_pending");
  assert.equal(client.custom_fields.ready_for_next_round, false);
  assert.equal(client.custom_fields.round_hold_reason, "New Inquiries");
  assert.ok(client.tags.includes("inquiry:pending"));
  assert.equal(db.tasks.length, 0);
});

test("open inquiry log keeps work pending after a case closes", async () => {
  const client = { id: "cl-1", org_id: "org-1", tags: ["inquiry:pending"], custom_fields: { round_hold_reason: "New Inquiries" } };
  const db = c03Db({ client, inquiries: [{ bureau: "EX", status: "open", is_open: true }] });
  const res = await handle({ event: ev("inquiry.removed", {}, { clientId: client.id }), db, step: fakeStep() });
  assert.equal(res.branch, "inquiries_pending");
  assert.equal(client.custom_fields.round_hold_reason, "New Inquiries");
});

test("recent cleared inquiry hands clean bureaus back to the funding advisor", async () => {
  const client = { id: "cl-1", org_id: "org-1", tags: ["inquiry:pending"], custom_fields: { round_hold_reason: "New Inquiries" } };
  const db = c03Db({ client, paid: true, inquiries: [{ bureau: "EX", status: "Removed", is_open: false, created_at: new Date().toISOString() }] });
  const res = await handle({ event: ev("inquiry.removed", {}, { clientId: client.id }), db, step: fakeStep() });
  assert.equal(res.branch, "resume");
  assert.equal(client.custom_fields.round_hold_reason, null);
  assert.equal(client.custom_fields.ready_for_next_round, true);
  assert.ok(!client.tags.includes("inquiry:pending"));
  assert.deepEqual(res.protectedBureaus, ["EX"]);
  assert.equal(db.tasks[0].assignee_role, "funding_advisor");
  assert.equal(db.tasks[0].assignee_staff_id, "advisor-1");
});

test("cleared inquiry does not invite Apply when no funding advisor is available", async () => {
  const client = { id: "cl-1", org_id: "org-1", tags: ["inquiry:pending"], custom_fields: { round_hold_reason: "New Inquiries" } };
  const db = c03Db({ client, paid: true, advisorId: null });
  const res = await handle({ event: ev("inquiry.removed", {}, { clientId: client.id }), db, step: fakeStep() });
  assert.equal(res.branch, "advisor_unassigned");
  assert.equal(client.custom_fields.ready_for_next_round, false);
  assert.equal(client.custom_fields.employee_next_action, "Assign Funding Advisor");
  assert.equal(db.tasks.length, 0);
});

test("document hold and unpaid funding do not become Apply", async () => {
  const client = { id: "cl-1", org_id: "org-1", tags: ["inquiry:pending"], custom_fields: { round_hold_reason: "Documents Pending Approval", product_path: "Funding" } };
  const db = c03Db({ client, paid: true });
  const res = await handle({ event: ev("inquiry.removed", {}, { clientId: client.id }), db, step: fakeStep() });
  assert.equal(res.branch, "other_hold");
  assert.equal(client.custom_fields.round_hold_reason, "Documents Pending Approval");
  assert.equal(client.custom_fields.ready_for_next_round, false);

  const unpaid = { id: "cl-2", org_id: "org-1", tags: [], custom_fields: { product_path: "Funding" } };
  const unpaidDb = c03Db({ client: unpaid });
  const unpaidRes = await handle({ event: ev("inquiry.removed", {}, { clientId: unpaid.id }), db: unpaidDb, step: fakeStep() });
  assert.equal(unpaidRes.branch, "inquiry_done");
  assert.notEqual(unpaid.custom_fields.ready_for_next_round, true);
});

test("persisted fraud alert remains held after a later removal event", async () => {
  const client = { id: "cl-1", org_id: "org-1", tags: [], custom_fields: {} };
  const db = c03Db({ client, paid: true, fraudCase: true });
  const res = await handle({ event: ev("inquiry.removed", {}, { clientId: client.id }), db, step: fakeStep() });
  assert.equal(res.branch, "fraud_hold");
  assert.equal(client.custom_fields.ready_for_next_round, false);
});
