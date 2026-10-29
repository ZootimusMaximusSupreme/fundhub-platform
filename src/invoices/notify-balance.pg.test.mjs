// A/R customer billing: original invoice face amount is not the unpaid balance.
// Real GitHub Actions disposable PostgreSQL ONLY; all fixture writes ROLLBACK.
// Outbound drain is a test fake — no email, SMS, processor or production writes.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { createInvoice, markSent, getInvoice } from "./index.mjs";
import { emailInvoice, INVOICE_TEMPLATE_KEY } from "./notify.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(u.hostname) && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

describe("A/R invoice email remaining-balance reconciliation (disposable PG)", {
  skip: SCRATCH ? false : "CI localhost fundhub_ci only"
}, () => {
  let conn, orgId, buyerId, invoiceId;
  let fakeDrains = 0;
  const noSend = async () => {
    fakeDrains++;
    return { mocked: true, sent: 0 };
  };

  before(async () => {
    conn = await pool().connect();
    await conn.query("BEGIN");
    orgId = (await conn.query(
      "INSERT INTO orgs (slug, name) VALUES ($1, 'CI A/R Billing') RETURNING id",
      [`ar-balance-${randomUUID()}`]
    )).rows[0].id;
    buyerId = (await conn.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Invoice','NetBalance',$2) RETURNING id`,
      [orgId, `ar-balance+${randomUUID()}@example.invalid`]
    )).rows[0].id;
    await conn.query(
      `INSERT INTO message_templates
         (org_id, template_key, channel, subject, body, compliance_passed)
       VALUES ($1, $2, 'email', 'Invoice balance {{invoice.amount}}',
               'Amount due {{invoice.amount}}', true)`,
      [orgId, INVOICE_TEMPLATE_KEY]
    );
    const draft = await createInvoice(conn, {
      orgId, clientId: buyerId, source: "funding_success_fee", amount: 1000
    });
    const issued = await markSent(conn, { invoiceId: draft.id });
    invoiceId = issued.id;
  });

  after(async () => {
    if (conn) {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
    }
    await close();
  });

  test("partial receipt reduces BOTH rendered subject/body without changing invoice face amount", async () => {
    await conn.query(
      `INSERT INTO invoice_payments (org_id, invoice_id, kind, amount, method, external_ref)
       VALUES ($1,$2,'payment',400,'ci-fake', $3)`,
      [orgId, invoiceId, `ci-partial-${randomUUID()}`]
    );
    await conn.query("UPDATE invoices SET status = 'partially_paid' WHERE id = $1", [invoiceId]);
    const sent = await emailInvoice(conn, {
      orgId, invoiceId, purpose: "partial-balance-ci", drainOutbox: noSend
    });
    assert.equal(sent.ok, true, sent.error || sent.reason);
    assert.equal(sent.delivery.mocked, true);
    assert.equal(fakeDrains, 1);

    const rows = await conn.query(
      `SELECT rendered_body, subject, status, to_address
         FROM messages WHERE org_id = $1 AND provider_ref = $2`,
      [orgId, `invoice:${invoiceId}:partial-balance-ci`]
    );
    assert.equal(rows.rows.length, 1);
    assert.match(rows.rows[0].rendered_body, /Amount due \$600\.00/);
    assert.match(rows.rows[0].subject, /balance \$600\.00/);
    assert.doesNotMatch(rows.rows[0].rendered_body, /1,000\.00/);
    assert.equal(rows.rows[0].status, "queued", "no real provider drain");
    assert.match(rows.rows[0].to_address, /@example\.invalid$/);
    assert.equal(Number((await getInvoice(conn, { invoiceId })).amount_due), 1000);

    const replay = await emailInvoice(conn, {
      orgId, invoiceId, purpose: "partial-balance-ci", drainOutbox: noSend
    });
    assert.equal(replay.ok, false);
    assert.equal(replay.reason, "already_emailed");
    assert.equal(fakeDrains, 1, "same purpose must never trigger a second drain");
  });

  test("settled by receipt rows but stale invoice status cannot queue any new demand", async () => {
    await conn.query(
      `INSERT INTO invoice_payments (org_id, invoice_id, kind, amount, method, external_ref)
       VALUES ($1,$2,'payment',600,'ci-fake',$3)`,
      [orgId, invoiceId, `ci-final-${randomUUID()}`]
    );
    // The invoice is deliberately still sent; a delayed markPaid() cannot
    // override what the canonical immutable receipt rows already establish.
    assert.equal((await getInvoice(conn, { invoiceId })).status, "partially_paid");
    const blocked = await emailInvoice(conn, {
      orgId, invoiceId, purpose: "stale-resend-ci", drainOutbox: noSend
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "no_balance");
    assert.equal(fakeDrains, 1);
    const rows = await conn.query(
      "SELECT count(*)::int AS n FROM messages WHERE org_id = $1 AND provider_ref = $2",
      [orgId, `invoice:${invoiceId}:stale-resend-ci`]
    );
    assert.equal(rows.rows[0].n, 0);
  });
});
