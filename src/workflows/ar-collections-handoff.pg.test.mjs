// Disposable Postgres proof: AR-04 handoff must use the real invoice schema,
// row lock, status transition and CSM task. Never run writes on live Supabase.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createInvoice, markSent } from "../invoices/index.mjs";
import { handle, AR_04_SOURCE_WORKFLOW } from "./ar-collections.mjs";
import { ev } from "./test-support.mjs";

const ENABLED = Boolean(process.env.CI && process.env.DATABASE_URL);
const step = {
  run: (name, fn) => name.startsWith("send-ar-")
    ? Promise.resolve({ noticeAlreadySent: true }) : fn(),
  sleep: async () => {}
};
describe("AR-04 handoff SQL on CI disposable Postgres",
  { skip: ENABLED ? false : "CI disposable PostgreSQL only" }, () => {
  let c, org, clientId;
  before(async () => {
    c = await pool().connect();
    await c.query("BEGIN");
    org = await resolveDefaultOrg(c);
    const email = `ar04-pg+synthetic-${process.pid}-${Date.now()}@example.com`;
    clientId = (await c.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'AR04','Fixture',$2) RETURNING id`, [org, email]
    )).rows[0].id;
  });
  after(async () => {
    if (c) {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
    await close();
  });
  async function invoice() {
    const created = await createInvoice(c, {
      orgId: org, clientId, source: "funding_success_fee", amount: 1250
    });
    assert.ok(created?.id);
    const sent = await markSent(c, { invoiceId: created.id });
    assert.equal(sent?.status, "sent");
    return created.id;
  }
  async function drive(invoiceId, dbHandle) {
    return handle({
      db: dbHandle, step,
      event: ev("invoice.sent", { invoiceId }, {
        orgId: org, clientId, id: "00000000-0000-4000-8000-00000000a404"
      })
    });
  }
  // All fixture writes live inside the surrounding ROLLBACK transaction. This
  // query-only adapter reuses that connection, so row locking executes against
  // real Postgres and not an in-memory SQL interpreter.
  const using = () => ({ query: (...args) => c.query(...args) });

  test("unpaid invoice records one atomic escalation/tag/CSM task on replay", async () => {
    const id = await invoice();
    const first = await drive(id, using());
    const second = await drive(id, using());
    assert.equal(first.handoff.skipped, false);
    assert.equal(first.handoff.escalated, true);
    assert.equal(first.handoff.taskCreated, true);
    assert.equal(second.handoff.taskCreated, false);
    const state = (await c.query(
      `SELECT status FROM invoices WHERE id = $1`, [id]
    )).rows[0];
    assert.equal(state.status, "escalated");
    const tasks = (await c.query(
      `SELECT assignee_role, body FROM tasks
        WHERE client_id = $1 AND source_workflow = $2`,
      [clientId, AR_04_SOURCE_WORKFLOW]
    )).rows.filter((t) => t.body === `ar-success-fee:${org}:${id}:04`);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].assignee_role, "csm");
  });

  test("payment becomes visible at FOR UPDATE: never create a collections task", async () => {
    const id = await invoice();
    let paidAtLock = false;
    const dbHandle = {
      query: async (sql, params) => {
        if (!paidAtLock && /SELECT \* FROM invoices WHERE id = \$1 FOR UPDATE/.test(sql)
            && params?.[0] === id) {
          paidAtLock = true;
          await c.query(`UPDATE invoices SET status = 'paid' WHERE id = $1`, [id]);
        }
        return c.query(sql, params);
      }
    };
    const result = await drive(id, dbHandle);
    assert.equal(paidAtLock, true);
    assert.equal(result.handoff.skipped, true);
    assert.equal(result.handoff.reason, "paid");
    const tasks = (await c.query(
      `SELECT id FROM tasks WHERE client_id = $1 AND source_workflow = $2
        AND body = $3`,
      [clientId, AR_04_SOURCE_WORKFLOW, `ar-success-fee:${org}:${id}:04`]
    )).rows;
    assert.equal(tasks.length, 0);
  });
});
