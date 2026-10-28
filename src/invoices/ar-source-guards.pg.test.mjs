// Real-Postgres regression for success-fee A/R source isolation.
// All writes are rolled back. No payment provider, outbound message or live DB.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createInvoice, markSent, getInvoice } from "./index.mjs";
import { allocatePayment } from "./allocate.mjs";
import { isFundingSuccessFeeInvoice } from "./success-fee-source.mjs";

const HAVE_DB = Boolean(process.env.DATABASE_URL);

describe("AR invoice-source isolation against real Postgres", { skip: !HAVE_DB && "no DATABASE_URL" }, () => {
  let conn;
  let orgId;
  let clientId;

  before(async () => {
    conn = await pool().connect();
    await conn.query("BEGIN");
    orgId = await resolveDefaultOrg(conn);
    clientId = (await conn.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
         VALUES ($1, 'AR', 'Guard', $2) RETURNING id`,
      [orgId, `ar-source-guard+${process.pid}-${Date.now()}@example.com`]
    )).rows[0].id;
  });

  after(async () => {
    if (conn) {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
    }
    await close();
  });

  const invoice = async (source) => {
    const created = await createInvoice(conn, {
      orgId, clientId, source, amount: 100
    });
    return markSent(conn, { invoiceId: created.id });
  };

  const event = (invoiceId, product, ref) => ({
    id: `test-event-${ref}`, orgId, clientId,
    payload: { invoiceId, product, amount: 100, paymentId: ref }
  });

  test("stored source is authoritative across the legacy invoice_type mapping", async () => {
    const diy = await invoice("diy_letters");
    const funding = await invoice("funding_success_fee");
    assert.equal(isFundingSuccessFeeInvoice(diy), false);
    assert.equal(isFundingSuccessFeeInvoice(funding), true);
  });

  test("non-success-fee invoice ID cannot write a success-fee receipt", async () => {
    const diy = await invoice("diy_letters");
    const result = await allocatePayment(conn, event(diy.id, "diy_letters", "not-a-fee-1"));
    assert.equal(result.reason, "not_success_fee_invoice");
    assert.equal(result.allocated, false);
    const fresh = await getInvoice(conn, { invoiceId: diy.id });
    assert.equal(fresh.status, "sent");
    const count = (await conn.query("SELECT COUNT(*)::int n FROM invoice_payments WHERE invoice_id = $1", [diy.id])).rows[0].n;
    assert.equal(count, 0);
  });

  test("a deposit event cannot pay a real funding success-fee invoice", async () => {
    const funding = await invoice("funding_success_fee");
    const result = await allocatePayment(conn, event(funding.id, "deposit", "not-a-fee-2"));
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "not_invoice_payment");
    const fresh = await getInvoice(conn, { invoiceId: funding.id });
    assert.equal(fresh.status, "sent");
    const count = (await conn.query("SELECT COUNT(*)::int n FROM invoice_payments WHERE invoice_id = $1", [funding.id])).rows[0].n;
    assert.equal(count, 0);
  });
});
