// A/R payment.received identity gate against disposable GitHub Actions Postgres.
// All fixture writes are inside one transaction and ROLLBACK. Never run with
// live Supabase, any remote PostgreSQL, or real payment/messaging adapters.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createInvoice, markSent, getInvoice } from "../invoices/index.mjs";
import { handle } from "./ar-collections.mjs";
import { fakeStep } from "./test-support.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(url.hostname)
      && url.pathname === "/fundhub_ci";
  } catch {
    return false;
  }
})();

describe("payment receipt A/R cannot mutate or invent clients (disposable PostgreSQL)",
  { skip: SCRATCH ? false : "CI local fundhub_ci PostgreSQL only" }, () => {
    let conn, db, orgId, clientId, email;

    before(async () => {
      conn = await pool().connect();
      await conn.query("BEGIN");
      db = { query: (...args) => conn.query(...args) };
      orgId = await resolveDefaultOrg(conn);
      email = `ar-owned-receipt+${randomUUID()}@example.invalid`;
      const row = await conn.query(
        `INSERT INTO clients (org_id, email, first_name, last_name)
         VALUES ($1, $2, 'Original', 'Buyer') RETURNING id`, [orgId, email]
      );
      clientId = row.rows[0].id;
    });

    after(async () => {
      if (conn) {
        await conn.query("ROLLBACK").catch(() => {});
        conn.release();
      }
      await close();
    });

    async function invoice() {
      const created = await createInvoice(conn, {
        orgId, clientId, source: "funding_success_fee", amount: 100
      });
      assert.ok(created?.id);
      return markSent(conn, { invoiceId: created.id });
    }

    async function drive(invoiceId, { id = null, payerEmail = null, paymentId = randomUUID() } = {}) {
      return handle({
        db, step: fakeStep(),
        event: {
          id: randomUUID(), name: "payment.received", orgId, clientId: id,
          payload: {
            invoiceId, product: "success_fee", amount: 25, paymentId,
            ...(payerEmail ? { email: payerEmail, firstName: "Untrusted Name" } : {})
          }
        }
      });
    }

    test("foreign explicit customer ID is rejected before any invoice or CRM mutation", async () => {
      const inv = await invoice();
      const wrongClient = randomUUID();
      const first = await drive(inv.id, { id: wrongClient, payerEmail: email });
      assert.equal(first.allocated, false);
      assert.equal(first.reason, "client_not_owned");
      assert.equal(first.reviewTaskCreated, true);
      assert.equal((await conn.query(
        `SELECT count(*)::int AS n FROM tasks
         WHERE org_id = $1 AND client_id = $2 AND source_workflow = 'ar-allocate'
           AND title = 'Unallocated receipt — verify payment customer identity'`,
        [orgId, clientId]
      )).rows[0].n, 1, "review is assigned to the legitimate buyer, never the foreign locator");
      assert.equal((await getInvoice(conn, { invoiceId: inv.id })).status, "sent");
      const p = await conn.query("SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1", [inv.id]);
      assert.equal(p.rows[0].n, 0);
      const person = await conn.query("SELECT first_name FROM clients WHERE id = $1", [clientId]);
      assert.equal(person.rows[0].first_name, "Original");
    });

    test("unknown email cannot create a buyer and cannot settle existing invoice", async () => {
      const inv = await invoice();
      const unknownEmail = `unmatched-ar+${randomUUID()}@example.invalid`;
      const res = await drive(inv.id, { payerEmail: unknownEmail });
      assert.equal(res.reason, "client_not_owned");
      assert.equal(res.reviewTaskCreated, true, "unmatched merchant receipt must enter a real advisor queue");
      assert.equal((await conn.query(
        "SELECT count(*)::int AS n FROM clients WHERE org_id = $1 AND email = $2",
        [orgId, unknownEmail]
      )).rows[0].n, 0);
      assert.equal((await getInvoice(conn, { invoiceId: inv.id })).status, "sent");
    });

    test("existing client email allocates once with the original contact intact", async () => {
      const inv = await invoice();
      const first = await drive(inv.id, { payerEmail: email });
      assert.equal(first.allocated, true);
      assert.equal(first.appliedCents, 2500);
      assert.equal((await getInvoice(conn, { invoiceId: inv.id })).status, "partially_paid");
      assert.equal((await conn.query(
        "SELECT first_name FROM clients WHERE id = $1", [clientId]
      )).rows[0].first_name, "Original");
      assert.equal((await conn.query(
        "SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1", [inv.id]
      )).rows[0].n, 1);
    });

    test("valid invoice-only PSP reference still allocates without creating CRM contact", async () => {
      const inv = await invoice();
      const result = await drive(inv.id);
      assert.equal(result.allocated, true);
      assert.equal(result.appliedCents, 2500);
      assert.equal((await getInvoice(conn, { invoiceId: inv.id })).status, "partially_paid");
    });
  });
