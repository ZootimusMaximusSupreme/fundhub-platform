// A/R receipt replay and invalid-amount regressions against disposable PG.
// Fixture customers are synthetic; the enclosing transaction always rolls back.
// No provider calls, live Supabase writes, SMS, or charges.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createInvoice, markSent, getInvoice } from "./index.mjs";
import { allocatePayment } from "./allocate.mjs";

const HAVE_DB = Boolean(process.env.DATABASE_URL);

describe("A/R replay must retain the original payer and invoice (real Postgres)",
  { skip: !HAVE_DB ? "no disposable DATABASE_URL" : false }, () => {
    let conn, transactionalDb, orgId, firstClient, secondClient;

    before(async () => {
      conn = await pool().connect();
      await conn.query("BEGIN");
      // Allocate inside the same rollback-only PG transaction. Passing pg.Client
      // directly would call .connect() again in withTransaction and throw.
      transactionalDb = { query: (...args) => conn.query(...args) };
      orgId = await resolveDefaultOrg(conn);
      const clients = [];
      for (const suffix of ["original", "different"]) {
        const inserted = await conn.query(
          `INSERT INTO clients (org_id, first_name, last_name, email)
           VALUES ($1, 'AR', 'ReplayFixture', $2) RETURNING id`,
          [orgId, `ar-replay+${suffix}-${randomUUID()}@example.com`]
        );
        clients.push(inserted.rows[0].id);
      }
      [firstClient, secondClient] = clients;
    });

    after(async () => {
      if (conn) {
        await conn.query("ROLLBACK").catch(() => {});
        conn.release();
      }
      await close();
    });

    const makeInvoice = async (clientId) => {
      const draft = await createInvoice(conn, {
        orgId, clientId, source: "funding_success_fee", amount: 100
      });
      return markSent(conn, { invoiceId: draft.id });
    };

    const receipt = (clientId, invoiceId, paymentId, amount = 40) => ({
      name: "payment.received",
      id: randomUUID(), orgId, clientId,
      payload: { invoiceId, product: "success_fee", amount, paymentId }
    });

    test("same provider ID is a replay only for its original client and invoice", async () => {
      const original = await makeInvoice(firstClient);
      const anotherClient = await makeInvoice(secondClient);
      const anotherInvoice = await makeInvoice(firstClient);
      const ref = `ar-replay-${randomUUID()}`;

      const first = await allocatePayment(transactionalDb, receipt(firstClient, original.id, ref));
      assert.equal(first.allocated, true, "real first receipt must allocate");
      assert.equal(first.appliedCents, 4000);
      assert.equal((await getInvoice(conn, { invoiceId: original.id })).status, "partially_paid");

      const replay = await allocatePayment(transactionalDb, receipt(firstClient, original.id, ref));
      assert.equal(replay.replay, true, "identical receipt may be safely reannounced");

      const wrongCustomer = await allocatePayment(transactionalDb, receipt(secondClient, anotherClient.id, ref));
      assert.equal(wrongCustomer.allocated, false);
      assert.equal(wrongCustomer.replay, false);
      assert.equal(wrongCustomer.reason, "receipt_reference_mismatch");

      const wrongInvoice = await allocatePayment(transactionalDb, receipt(firstClient, anotherInvoice.id, ref));
      assert.equal(wrongInvoice.allocated, false);
      assert.equal(wrongInvoice.reason, "receipt_reference_mismatch");

      for (const target of [anotherClient, anotherInvoice]) {
        assert.equal((await getInvoice(conn, { invoiceId: target.id })).status, "sent");
        const row = await conn.query(
          "SELECT COUNT(*)::int n FROM invoice_payments WHERE invoice_id = $1",
          [target.id]
        );
        assert.equal(row.rows[0].n, 0, "replayed PSP reference cannot credit another bill");
      }
      const originalReceipts = await conn.query(
        "SELECT COUNT(*)::int n FROM invoice_payments WHERE invoice_id = $1",
        [original.id]
      );
      assert.equal(originalReceipts.rows[0].n, 1);
      // The original settled receipt is authoritative. Two conflicting
      // envelopes with the SAME provider ID create just one review task on
      // the original customer's queue, never on the forged callback buyer.
      const tasks = await conn.query(
        `SELECT client_id FROM tasks
         WHERE org_id = $1 AND source_workflow = 'ar-allocate'
           AND body = $2`,
        [orgId, `receipt-conflict:${ref}`]
      );
      assert.equal(tasks.rows.length, 1, "multiple conflicting envelopes are one PSP-reference review");
      assert.equal(String(tasks.rows[0].client_id), String(firstClient),
        "receipt conflict must be reviewed on the original invoice owner");
      assert.notEqual(String(tasks.rows[0].client_id), String(secondClient));
    });

    test("zero and negative payment.received amounts are not silently acknowledged", async () => {
      const invoice = await makeInvoice(secondClient);
      for (const amount of [0, -15]) {
        const providerRef = `invalid-amount-${randomUUID()}`;
        const answer = await allocatePayment(
          transactionalDb, receipt(secondClient, invoice.id, providerRef, amount)
        );
        assert.equal(answer.allocated, false);
        assert.equal(answer.reason, "non_positive_amount");
        const task = await conn.query(
          `SELECT COUNT(*)::int n FROM tasks
           WHERE org_id = $1 AND client_id = $2 AND source_workflow = 'ar-allocate'
             AND body = $3`,
          [orgId, secondClient, `non_positive_amount:${providerRef}`]
        );
        assert.equal(task.rows[0].n, 1);
      }
      assert.equal((await getInvoice(conn, { invoiceId: invoice.id })).status, "sent");
      const rows = await conn.query(
        "SELECT COUNT(*)::int n FROM invoice_payments WHERE invoice_id = $1",
        [invoice.id]
      );
      assert.equal(rows.rows[0].n, 0);
    });
  });
