import { test } from "node:test";
import assert from "node:assert";
import {
  onPaymentDisputed,
  onPaymentRefunded,
  parseDueBy,
  DISPUTE_ROLE
} from "./commas-disputes.mjs";

/* Fake db. The client already exists, so resolveClient takes its lookup branch
   and never touches the CRM — these tests are about the task, not about client
   creation, which client-lifecycle.test.mjs already covers. */
function fakeDb({ existingTasks = [] } = {}) {
  const tasks = [...existingTasks];
  let n = 0;
  return {
    tasks,
    async query(sql, params) {
      if (/FROM transactions t/.test(sql)) {
        const [org, providerRef] = params;
        const known = org === "org-1" && ["pay_disputed_1", "pay_ref_1"].includes(providerRef);
        return { rows: known ? [{ client_id: "client-1" }] : [] };
      }
      if (/FROM clients WHERE org_id/.test(sql)) {
        return { rows: [{ id: "client-1", ghl_contact_id: "crm-1" }] };
      }
      if (/SELECT id FROM tasks/.test(sql)) {
        const [clientId, workflow, body] = params;
        const hit = tasks.find(
          (t) => t.client_id === clientId && t.source_workflow === workflow && t.body === body
        );
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (/INSERT INTO tasks/.test(sql)) {
        const [org_id, client_id, title, body, due_at, source_workflow, assignee_role] = params;
        const row = {
          id: `task-${++n}`, org_id, client_id, title, body, due_at, source_workflow, assignee_role
        };
        tasks.push(row);
        return { rows: [{ id: row.id }] };
      }
      return { rows: [] };
    }
  };
}

const disputeEvent = (payload = {}) => ({
  id: "evt-dispute-1",
  name: "payment.disputed",
  orgId: "org-1",
  payload: {
    email: "angry@example.com",
    amount: 3000,
    productName: "Consulting Services Deposit",
    paymentId: "pay_disputed_1",
    dueBy: "2026-08-20T00:00:00Z",
    source: "commas",
    ...payload
  }
});

// --- the deadline ----------------------------------------------------------

test("parseDueBy reads a real date and refuses to invent one", () => {
  assert.equal(parseDueBy("2026-08-20T00:00:00Z").toISOString(), "2026-08-20T00:00:00.000Z");
  assert.equal(parseDueBy(null), null);
  assert.equal(parseDueBy(""), null);
  assert.equal(parseDueBy("not a date"), null, "an unreadable deadline must not become a guessed one");
});

test("a dispute becomes an URGENT task carrying the provider's deadline", async () => {
  const db = fakeDb();
  const res = await onPaymentDisputed(disputeEvent(), db);

  assert.equal(res.created, true);
  const task = db.tasks[0];
  assert.match(task.title, /^URGENT/, "a chargeback must read as urgent in a task list");
  assert.match(task.title, /\$3,000\.00/);
  assert.equal(task.assignee_role, DISPUTE_ROLE);
  assert.equal(task.source_workflow, "commas-dispute");
  assert.equal(task.client_id, "client-1");
  assert.equal(
    task.due_at.toISOString(),
    "2026-08-20T00:00:00.000Z",
    "the response deadline did not reach the task — this is how a dispute is lost by default"
  );
  assert.match(task.body, /pay_disputed_1/);
});

test("no deadline from the processor => no due date, and the task SAYS so", async () => {
  const db = fakeDb();
  await onPaymentDisputed(disputeEvent({ dueBy: null }), db);
  const task = db.tasks[0];
  assert.equal(task.due_at, null, "an invented deadline reads as 'there is time' until the money is gone");
  assert.match(task.body, /NO DEADLINE WAS SUPPLIED/);
});

test("an unreadable amount does not produce a task claiming $0", async () => {
  const db = fakeDb();
  await onPaymentDisputed(disputeEvent({ amount: null }), db);
  assert.match(db.tasks[0].title, /an unknown amount/);
  assert.ok(!db.tasks[0].title.includes("$0.00"), "a missing amount was reported as zero");
});

// --- idempotency -----------------------------------------------------------

test("the same dispute event twice creates ONE task", async () => {
  const db = fakeDb();
  const first = await onPaymentDisputed(disputeEvent(), db);
  const second = await onPaymentDisputed(disputeEvent(), db);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(db.tasks.length, 1);
});

// --- refunds ---------------------------------------------------------------

test("a refund creates its own task and never touches commission", async () => {
  const db = fakeDb();
  const res = await onPaymentRefunded({
    id: "evt-refund-1",
    name: "payment.refunded",
    orgId: "org-1",
    payload: {
      email: "refunded@example.com",
      amount: 1000,
      productName: "Consulting Services Package",
      paymentId: "pay_ref_1",
      source: "commas"
    }
  }, db);

  assert.equal(res.created, true);
  const task = db.tasks[0];
  assert.equal(task.source_workflow, "commas-refund");
  assert.match(task.title, /^Refund issued/);
  assert.ok(!/URGENT/.test(task.title), "a refund is not a deadline-bearing emergency");
  /* The money rule, asserted in the task text because that is where a human
     reads it: clawback policy is undecided, so nothing was reversed. */
  assert.match(task.body, /NOT adjusted/);
});

test("a dispute and a refund on the SAME payment are two separate tasks", async () => {
  const db = fakeDb();
  await onPaymentDisputed(disputeEvent(), db);
  await onPaymentRefunded({
    id: "evt-refund-2", name: "payment.refunded", orgId: "org-1",
    payload: { email: "angry@example.com", amount: 3000, paymentId: "pay_disputed_1" }
  }, db);
  assert.equal(db.tasks.length, 2);
  assert.deepEqual(
    db.tasks.map((t) => t.source_workflow).sort(),
    ["commas-dispute", "commas-refund"]
  );
});


/* Strict fake: unlike lead capture, a refund or chargeback must be READ-ONLY
 * on clients and must find an existing same-org buyer before creating work. */
function reversalDb({ clients = [], transactions = [] } = {}) {
  const tasks = [];
  let nextId = 0;
  return {
    tasks, clients,
    async query(sql, params = []) {
      if (/UPDATE clients|INSERT INTO clients|INSERT INTO transactions/.test(sql)) {
        throw new Error("reversal handler attempted a customer/ledger mutation");
      }
      if (/FROM transactions t/.test(sql)) {
        const [orgId, ref] = params;
        const txn = transactions.find((r) =>
          r.org_id === orgId && r.provider_ref === ref && r.provider === "commas"
          && r.status === "succeeded"
          && clients.some((c) => c.id === r.client_id && c.org_id === orgId)
        );
        return { rows: txn ? [{ client_id: txn.client_id }] : [] };
      }
      if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(sql)) {
        const [clientId, orgId] = params;
        const c = clients.find((x) => x.id === clientId && x.org_id === orgId);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/FROM clients WHERE org_id = \$1 AND lower\(email\) = \$2/.test(sql)) {
        const [orgId, email] = params;
        const c = clients.find((x) => x.org_id === orgId && x.email === email);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/SELECT id FROM tasks/.test(sql)) {
        const [clientId, workflow, body] = params;
        const t = tasks.find((x) => x.client_id === clientId && x.source_workflow === workflow && x.body === body);
        return { rows: t ? [{ id: t.id }] : [] };
      }
      if (/INSERT INTO tasks/.test(sql)) {
        const [org_id, client_id, title, body, due_at, source_workflow, assignee_role] = params;
        const row = { id: "reversal-task-" + (++nextId), org_id, client_id, title, body, due_at, source_workflow, assignee_role };
        tasks.push(row);
        return { rows: [{ id: row.id }] };
      }
      throw new Error("Unexpected reversal SQL: " + sql.slice(0, 90));
    }
  };
}

test("dispute uses original settled payment owner, even when callback names a different buyer", async () => {
  const db = reversalDb({
    clients: [
      { id: "real-buyer", org_id: "org-1", email: "original@example.com" },
      { id: "wrong-buyer", org_id: "org-1", email: "wrong@example.com" }
    ],
    transactions: [
      { org_id: "org-1", provider_ref: "pay_disputed_1", provider: "commas", client_id: "real-buyer", status: "succeeded" }
    ]
  });
  const evt = { ...disputeEvent({ email: "wrong@example.com" }), clientId: "wrong-buyer" };
  const first = await onPaymentDisputed(evt, db);
  const replay = await onPaymentDisputed(evt, db);
  assert.equal(first.created, true);
  assert.equal(replay.created, false, "duplicate dispute event created another owner task");
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].client_id, "real-buyer");
  assert.equal(db.tasks[0].org_id, "org-1");
  assert.equal(db.tasks[0].assignee_role, "owner");
});

test("foreign customer ID without an original settled receipt cannot acquire a dispute task", async () => {
  const db = reversalDb({ clients: [
    { id: "foreign-buyer", org_id: "org-OTHER", email: "foreign@example.com" }
  ] });
  await assert.rejects(
    onPaymentDisputed({ ...disputeEvent({ email: "foreign@example.com", paymentId: "not-in-this-org" }), clientId: "foreign-buyer" }, db),
    /unowned payment.disputed/
  );
  assert.equal(db.tasks.length, 0);
  assert.equal(db.clients.length, 1, "no phantom customer was created");
});

test("unmatched refund and missing-org dispute fail for reconciliation instead of inventing buyer", async () => {
  const db = reversalDb();
  await assert.rejects(
    onPaymentRefunded({ id: "unmatched-refund", name: "payment.refunded", orgId: "org-1", payload: { email: "unknown@example.invalid", paymentId: "unknown" } }, db),
    /unowned payment.refunded/
  );
  await assert.rejects(
    onPaymentDisputed({ ...disputeEvent(), orgId: null }, db),
    /unowned payment.disputed/
  );
  assert.equal(db.tasks.length, 0);
  assert.equal(db.clients.length, 0);
});


test("known same-org email cannot hijack an unrecognized provider payment dispute", async () => {
  const db = reversalDb({ clients: [
    { id: "innocent-buyer", org_id: "org-1", email: "innocent@example.com" }
  ] });
  await assert.rejects(
    onPaymentDisputed({
      ...disputeEvent({ email: "innocent@example.com", paymentId: "not-original-payment" }),
      clientId: "innocent-buyer"
    }, db),
    /unowned payment.disputed/
  );
  assert.equal(db.tasks.length, 0, "a bogus payment cannot assign a task to a valid but unrelated buyer");
});
