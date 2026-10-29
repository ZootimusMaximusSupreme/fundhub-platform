// Isolated AR-04 handoff races. All fixtures are fake and never send messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, AR_04_SOURCE_WORKFLOW } from "./ar-collections.mjs";
import { pgFake, ev } from "./test-support.mjs";

const INVOICE = {
  id: "inv-ar04", org_id: "org-1", client_id: "cl-1",
  source: "funding_success_fee", invoice_type: "success_fee",
  amount_due: 1200, status: "sent"
};

function fixture(invoice = {}, payments = []) {
  return pgFake({
    invoices: [{ ...INVOICE, ...invoice }],
    invoicePayments: payments,
    clients: [{
      id: "cl-1", org_id: "org-1",
      email: "ar-handoff+synthetic@example.com", custom_fields: {}, tags: []
    }]
  });
}

// The first three notices are already complete in this test. Execute only the
// final handoff step; do not generate a checkout link or any real notification.
const step = {
  run: async (id, fn) => id.startsWith("send-ar-") ? { noticeAlreadySent: true } : fn(),
  sleep: async () => {}
};
async function handoff(db) {
  return handle({
    db, step,
    event: ev("invoice.sent", { invoiceId: INVOICE.id }, {
      id: "ar04-synthetic-event", clientId: "cl-1", orgId: "org-1"
    })
  });
}

test("AR-04: payment that commits before acquiring invoice row lock prevents a stale collection task", async () => {
  const db = fixture();
  const query = db.query.bind(db);
  let paidBeforeLock = false;
  db.query = async (sql, params) => {
    if (/SELECT \* FROM invoices WHERE id = \$1 FOR UPDATE/.test(sql)) {
      db.invoices[0].status = "paid"; // other receipt committed first
      paidBeforeLock = true;
    }
    return query(sql, params);
  };
  const result = await handoff(db);
  assert.equal(paidBeforeLock, true, "handoff must lock the invoice before changing it");
  assert.equal(result.handoff.skipped, true);
  assert.equal(result.handoff.reason, "paid");
  assert.equal(db.invoices[0].status, "paid");
  assert.equal(db.tasks.length, 0, "do not call a customer whose invoice was just paid");
  assert.deepEqual(db.clients[0].tags, [], "never leave a stale collections tag");
});

test("AR-04: invoice voided just before the lock cannot be escalated or assigned", async () => {
  const db = fixture();
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/SELECT \* FROM invoices WHERE id = \$1 FOR UPDATE/.test(sql)) db.invoices[0].status = "void";
    return query(sql, params);
  };
  const result = await handoff(db);
  assert.equal(result.handoff.reason, "void");
  assert.equal(db.tasks.length, 0);
  assert.deepEqual(db.clients[0].tags, []);
});

test("AR-04: fully receipted invoice with stale sent status has no balance to collect", async () => {
  const db = fixture({}, [{
    invoice_id: INVOICE.id, org_id: "org-1", kind: "payment",
    method: "commas", amount: 1200, external_ref: "synthetic-paid"
  }]);
  const result = await handoff(db);
  assert.equal(result.handoff.skipped, true);
  assert.equal(result.handoff.reason, "no_balance");
  assert.equal(db.invoices[0].status, "sent", "do not mutate status without a receipt workflow");
  assert.equal(db.tasks.length, 0);
  assert.deepEqual(db.clients[0].tags, []);
});

test("AR-04: replay of escalated unpaid invoice recovers one CSM task", async () => {
  const db = fixture({ status: "escalated" });
  const first = await handoff(db);
  const second = await handoff(db);
  assert.equal(first.handoff.skipped, false);
  assert.equal(first.handoff.escalated, true);
  assert.equal(first.handoff.taskCreated, true);
  assert.equal(second.handoff.skipped, false);
  assert.equal(second.handoff.taskCreated, false);
  const tasks = db.tasks.filter((t) => t.source_workflow === AR_04_SOURCE_WORKFLOW);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].assignee_role, "csm");
  assert.deepEqual(db.clients[0].tags, ["ar:collections-handoff"]);
});

test("AR-04: a task insertion error rolls back its transaction rather than committing escalation", async () => {
  const db = fixture();
  const query = db.query.bind(db);
  const statements = [];
  db.connect = async () => ({
    query: async (sql, params) => {
      if (sql === "BEGIN" || sql === "ROLLBACK" || sql === "COMMIT") {
        statements.push(sql);
        return { rows: [] };
      }
      if (/INSERT INTO tasks/.test(sql)) throw new Error("synthetic task storage failure");
      return query(sql, params);
    },
    release() {}
  });
  await assert.rejects(handoff(db), /synthetic task storage failure/);
  assert.deepEqual(statements, ["BEGIN", "ROLLBACK"], "a failed task must not commit the invoice escalation");
});
