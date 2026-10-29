// Regression against disposable GitHub Actions Postgres, never live Supabase.
// The collection workflow refuses draft notices; the receipt allocator must
// independently refuse money credited to an invoice that was never issued.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createInvoice, getInvoice } from "./index.mjs";
import { allocatePayment } from "./allocate.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

describe("A/R receipt issuance guard — real disposable Postgres",
  { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
    let c, orgId, clientId;
    before(async () => {
      c = await pool().connect();
      await c.query("BEGIN");
      orgId = await resolveDefaultOrg(c);
      clientId = (await c.query(
        `INSERT INTO clients (org_id, first_name, last_name, email)
         VALUES ($1, 'AR', 'DraftTest', $2) RETURNING id`,
        [orgId, `ar-issuance+${process.pid}-${Date.now()}@example.com`]
      )).rows[0].id;
    });

    after(async () => {
      if (c) {
        await c.query("ROLLBACK").catch(() => {});
        c.release();
      }
      await close();
    });

    test("a provider receipt explicitly pointing at a draft cannot create a ledger payment", async () => {
      const invoice = await createInvoice(c, {
        orgId, clientId, source: "funding_success_fee", amount: 1250
      });
      assert.equal(invoice.status, "draft");
      const paymentId = `ar-draft-${process.pid}-${Date.now()}`;
      const result = await allocatePayment(c, {
        name: "payment.received",
        id: `ar-draft-event-${process.pid}-${Date.now()}`,
        orgId, clientId,
        payload: { invoiceId: invoice.id, product: "success_fee", amount: 1250, paymentId }
      });

      assert.equal(result.allocated, false);
      assert.equal(result.reason, "invoice_unavailable");
      assert.equal((await getInvoice(c, { invoiceId: invoice.id })).status, "draft");
      const receipt = await c.query(
        "SELECT id FROM invoice_payments WHERE invoice_id = $1",
        [invoice.id]
      );
      assert.equal(receipt.rows.length, 0, "no receipt can settle an unissued bill");
      const tasks = await c.query(
        `SELECT id FROM tasks
          WHERE org_id = $1 AND client_id = $2
            AND source_workflow = 'ar-allocate' AND body = $3`,
        [orgId, clientId, `invoice_unavailable:${paymentId}`]
      );
      assert.equal(tasks.rows.length, 1, "manual review must catch the real unmatched receipt");
    });
  });
