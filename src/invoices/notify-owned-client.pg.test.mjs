// An invoice's org_id and client_id must identify the SAME tenant before
// any email or backlog disclosure. CI disposable localhost/fundhub_ci only.
// All synthetic customers, invoices, and messages remain in a ROLLBACK-only
// transaction; the drain is a fake and cannot send mail or charge a customer.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { createInvoice, markSent, getInvoice } from "./index.mjs";
import { emailInvoice, unemailedInvoices, INVOICE_TEMPLATE_KEY } from "./notify.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(u.hostname)
      && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

describe("A/R invoice emails cannot address another company's client (real PG)", {
  skip: SCRATCH ? false : "CI localhost fundhub_ci only"
}, () => {
  let conn, orgA, orgB, buyerA, buyerB, validInvoice, foreignBuyerInvoice;
  let drainCalls = 0;
  const noSend = async () => {
    drainCalls++;
    return { mocked: true, sent: 0 };
  };

  before(async () => {
    conn = await pool().connect();
    await conn.query("BEGIN");
    async function org(label) {
      return (await conn.query(
        "INSERT INTO orgs (slug, name) VALUES ($1, $2) RETURNING id",
        [`ci-invoice-owner-${label}-${randomUUID()}`, `CI Invoice Owner ${label}`]
      )).rows[0].id;
    }
    orgA = await org("a");
    orgB = await org("b");
    async function buyer(orgId, label) {
      return (await conn.query(
        `INSERT INTO clients (org_id, first_name, last_name, email)
         VALUES ($1, 'AR', 'OwnedBuyer', $2) RETURNING id`,
        [orgId, `ar-invoice-owned+${label}-${randomUUID()}@example.invalid`]
      )).rows[0].id;
    }
    buyerA = await buyer(orgA, "a");
    buyerB = await buyer(orgB, "b");
    await conn.query(
      `INSERT INTO message_templates
         (org_id, template_key, channel, subject, body, compliance_passed)
       VALUES ($1, $2, 'email', 'Balance {{invoice.amount}}',
               'Due {{invoice.amount}}', true)`,
      [orgA, INVOICE_TEMPLATE_KEY]
    );

    async function issued(orgId, clientId) {
      const draft = await createInvoice(conn, {
        orgId, clientId, source: "funding_success_fee", amount: 100
      });
      assert.ok(draft?.id, "fixture invoice inserted");
      const sent = await markSent(conn, { invoiceId: draft.id });
      assert.ok(sent?.id, "fixture invoice issued");
      return sent;
    }
    validInvoice = await issued(orgA, buyerA);
    // The legacy invoices FK references clients(id) only. This intentionally
    // constructs a contradictory pair without bypassing or changing schema.
    foreignBuyerInvoice = await issued(orgA, buyerB);
  });

  after(async () => {
    if (conn) {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
    }
    await close();
  });

  test("bad org/client pair cannot enqueue a payable invoice email or stamp delivery", async () => {
    const refused = await emailInvoice(conn, {
      orgId: orgA, invoiceId: foreignBuyerInvoice.id,
      purpose: "cross-org-owned-buyer", drainOutbox: noSend
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "not_found");
    assert.equal(drainCalls, 0);
    const messages = await conn.query(
      "SELECT COUNT(*)::int AS n FROM messages WHERE org_id = $1 AND provider_ref = $2",
      [orgA, `invoice:${foreignBuyerInvoice.id}:cross-org-owned-buyer`]
    );
    assert.equal(messages.rows[0].n, 0);
    const stale = await getInvoice(conn, { invoiceId: foreignBuyerInvoice.id });
    assert.equal(stale.emailed_at, null);
    assert.equal(stale.email_message_id, null);
  });

  test("unemailed A/R backlog hides the other tenant's buyer", async () => {
    const rows = await unemailedInvoices(conn, { orgId: orgA });
    assert.ok(rows.some((r) => String(r.id) === String(validInvoice.id)));
    assert.ok(!rows.some((r) => String(r.id) === String(foreignBuyerInvoice.id)));
    assert.ok(rows.every((r) => String(r.client_email).endsWith("@example.invalid")));
    assert.ok(rows.every((r) => String(r.client_email).includes("owned+a-")));
  });

  test("valid same-org invoice still queues once without real provider delivery", async () => {
    const accepted = await emailInvoice(conn, {
      orgId: orgA, invoiceId: validInvoice.id,
      purpose: "owned-client-valid", drainOutbox: noSend
    });
    assert.equal(accepted.ok, true, accepted.error || accepted.reason);
    assert.equal(accepted.delivery.mocked, true);
    assert.equal(drainCalls, 1);
    const row = (await conn.query(
      "SELECT client_id, to_address, status FROM messages WHERE org_id = $1 AND provider_ref = $2",
      [orgA, `invoice:${validInvoice.id}:owned-client-valid`]
    )).rows[0];
    assert.equal(String(row.client_id), String(buyerA));
    assert.match(row.to_address, /@example\\.invalid$/);
    assert.equal(row.status, "queued");
  });
});
