// Client portal must never demand payment on an unissued draft invoice.
// Executes the EXACT read-only SQL used by GET /api/read/portal-summary.
// Disposable GitHub Actions PostgreSQL only; plus-tag fake buyers in one
// BEGIN/ROLLBACK. Never use production Supabase or merchant providers.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { createInvoice, markSent, markPaid } from "../invoices/index.mjs";
import { PORTAL_INVOICE_DUE_SQL } from "../../api/read/portal-summary.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(url.hostname)
      && url.pathname === "/fundhub_ci";
  } catch { return false; }
})();

describe("portal invoice due excludes drafts and terminal invoices (real PostgreSQL)", {
  skip: SCRATCH ? false : "CI loopback fundhub_ci only"
}, () => {
  let conn, orgA, orgB, buyerA, buyerB, draft, sent, settled, foreign, contradictory;

  before(async () => {
    conn = await pool().connect();
    await conn.query("BEGIN");
    const org = async (tag) => (await conn.query(
      "INSERT INTO orgs (slug, name) VALUES ($1,$2) RETURNING id",
      ["ci-ar-portal-" + tag + "-" + randomUUID(), "CI AR Portal " + tag]
    )).rows[0].id;
    orgA = await org("a");
    orgB = await org("b");
    const buyer = async (orgId, tag) => (await conn.query(
      "INSERT INTO clients (org_id,first_name,last_name,email) VALUES ($1,'AR','PortalBuyer',$2) RETURNING id",
      [orgId, "ar-portal-issued+" + tag + "-" + randomUUID() + "@example.invalid"]
    )).rows[0].id;
    buyerA = await buyer(orgA, "a");
    buyerB = await buyer(orgB, "b");

    const invoice = async (orgId, buyerId, amount) => {
      const row = await createInvoice(conn, {
        orgId, clientId: buyerId, source: "funding_success_fee", amount
      });
      assert.ok(row?.id);
      return row;
    };
    draft = await invoice(orgA, buyerA, 475);
    const sentRow = await invoice(orgA, buyerA, 125);
    sent = await markSent(conn, { invoiceId: sentRow.id });
    assert.equal(sent?.status, "sent");
    const settledRow = await invoice(orgA, buyerA, 210);
    await markSent(conn, { invoiceId: settledRow.id });
    settled = await markPaid(conn, { invoiceId: settledRow.id });
    assert.equal(settled?.status, "paid");
    const foreignRow = await invoice(orgB, buyerB, 830);
    foreign = await markSent(conn, { invoiceId: foreignRow.id });
    // Legacy invoice FK permits org A to reference a buyer owned by org B.
    // This must NEVER display as A's debt or expose its saved payment link.
    const badRow = await invoice(orgA, buyerB, 999);
    contradictory = await markSent(conn, { invoiceId: badRow.id });
    assert.equal(contradictory?.status, "sent");
  });

  after(async () => {
    if (conn) {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
    }
    await close();
  });

  test("only a customer's issued outstanding invoice appears; draft $475 does not", async () => {
    const rows = (await conn.query(PORTAL_INVOICE_DUE_SQL, [orgA, buyerA])).rows;
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].id), String(sent.id));
    assert.equal(Number(rows[0].open_balance), 125);
    assert.ok(!rows.some((r) => String(r.id) === String(draft.id)));
    assert.ok(!rows.some((r) => String(r.id) === String(settled.id)));
  });

  test("a different company never sees this customer's invoice", async () => {
    const wrongBuyer = (await conn.query(PORTAL_INVOICE_DUE_SQL, [orgA, buyerB])).rows;
    assert.deepEqual(wrongBuyer, []);
    const rightBuyer = (await conn.query(PORTAL_INVOICE_DUE_SQL, [orgB, buyerB])).rows;
    assert.deepEqual(rightBuyer.map((r) => String(r.id)), [String(foreign.id)]);
    assert.equal(Number(rightBuyer[0].open_balance), 830);
  });

  test("a contradictory A-invoice/B-buyer row is excluded even when it is issued and positive", async () => {
    // Prove the test actually exercises an inconsistent legacy row.
    const raw = (await conn.query(
      "SELECT invoice_id, org_id, client_id, open_balance FROM v_invoice_aging WHERE invoice_id=$1",
      [contradictory.id]
    )).rows[0];
    assert.equal(String(raw.org_id), String(orgA));
    assert.equal(String(raw.client_id), String(buyerB));
    assert.equal(Number(raw.open_balance), 999);
    assert.match(PORTAL_INVOICE_DUE_SQL, /JOIN clients c ON c\.id = i\.client_id AND c\.org_id = i\.org_id/);

    const wrongCompany = (await conn.query(PORTAL_INVOICE_DUE_SQL, [orgA, buyerB])).rows;
    assert.deepEqual(wrongCompany, [], "no cross-org bill or checkout link can be exposed");
    const legitimate = (await conn.query(PORTAL_INVOICE_DUE_SQL, [orgA, buyerA])).rows;
    assert.deepEqual(legitimate.map(r => String(r.id)), [String(sent.id)]);
  });

  test("an unissued draft alone does not generate a false portal balance", async () => {
    const query = PORTAL_INVOICE_DUE_SQL.replace(
      "AND v.open_balance > 0",
      "AND v.open_balance > 0 AND v.invoice_id = $3"
    );
    const rows = (await conn.query(query, [orgA, buyerA, draft.id])).rows;
    assert.deepEqual(rows, []);
  });
});
