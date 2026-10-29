// Never queue an invoice payment demand for an unissued/paid/void/written-off
// bill. Real disposable GitHub Actions PostgreSQL only, ROLLBACK everything;
// no SMS, email, merchant calls, or production accounts.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createInvoice, markSent, markPaid, voidInvoice } from "./index.mjs";
import { emailInvoice } from "./notify.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(url.hostname)
      && url.pathname === "/fundhub_ci";
  } catch { return false; }
})();

describe("invoice mail terminal-state guard on rollback-only PostgreSQL",
  { skip: SCRATCH ? false : "only disposable local fundhub_ci PostgreSQL" }, () => {
    let conn, orgId, clientId;
    before(async () => {
      conn = await pool().connect();
      await conn.query("BEGIN");
      orgId = await resolveDefaultOrg(conn);
      clientId = (await conn.query(
        `INSERT INTO clients (org_id, email, first_name, last_name)
         VALUES ($1, $2, 'AR', 'MailTest') RETURNING id`,
        [orgId, `invoice-terminal+${randomUUID()}@example.invalid`]
      )).rows[0].id;
    });
    after(async () => {
      if (conn) {
        await conn.query("ROLLBACK").catch(() => {});
        conn.release();
      }
      await close();
    });
    async function newInvoice() {
      const invoice = await createInvoice(conn, {
        orgId, clientId, source: "funding_success_fee", amount: 100
      });
      assert.ok(invoice?.id);
      return invoice;
    }

    for (const [status, reason] of [
      ["draft", "not_issued"],
      ["paid", "already_paid"],
      ["void", "voided"],
      ["written_off", "written_off"]
    ]) {
      test(`state ${status} does not queue an invoice message (real SQL)`, async () => {
        const invoice = await newInvoice();
        if (status !== "draft") await markSent(conn, { invoiceId: invoice.id });
        if (status === "paid") await markPaid(conn, { invoiceId: invoice.id });
        if (status === "void") await voidInvoice(conn, { invoiceId: invoice.id, notes: "CI correction" });
        if (status === "written_off") {
          await conn.query(
            `UPDATE invoices SET status = 'written_off', write_off_reason = 'CI-only write-off'
             WHERE id = $1`, [invoice.id]
          );
        }
        const result = await emailInvoice(conn, {
          orgId, invoiceId: invoice.id, purpose: "late-manual-resend"
        });
        assert.equal(result.ok, false);
        assert.equal(result.reason, reason);
        const queued = await conn.query(
          `SELECT count(*)::int AS n FROM messages
           WHERE org_id = $1 AND client_id = $2
             AND provider_ref = $3`,
          [orgId, clientId, `invoice:${invoice.id}:late-manual-resend`]
        );
        assert.equal(queued.rows[0].n, 0);
      });
    }
  });
