// Staff Open A/R must not present unissued draft invoices as collectible debt.
// Execute the EXACT production read SQL on disposable CI PostgreSQL only.
// Synthetic plus-tag buyers; everything is inside BEGIN/ROLLBACK.
// Never run against production Supabase, charge providers, or send messages.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { createInvoice, markSent, markPaid } from "../invoices/index.mjs";
import { AR_INVOICE_LIST_SQL } from "../../api/read/invoices.mjs";

const SAFE_SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const uri = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(uri.hostname)
      && uri.pathname === "/fundhub_ci";
  } catch { return false; }
})();

describe("staff AR open is issued-only while drafts remain reviewable (real PostgreSQL)", {
  skip: SAFE_SCRATCH ? false : "GitHub Actions loopback fundhub_ci only"
}, () => {
  let conn, orgA, orgB, buyerA, buyerB, draft, sent, stalePaid, otherSent;

  before(async () => {
    conn = await pool().connect();
    await conn.query("BEGIN");
    const org = async (tag) => (await conn.query(
      "INSERT INTO orgs (slug, name) VALUES ($1, $2) RETURNING id",
      ["ci-ar-open-issued-" + tag + "-" + randomUUID(), "CI AR Open " + tag]
    )).rows[0].id;
    orgA = await org("a");
    orgB = await org("b");
    const buyer = async (orgId, tag) => (await conn.query(
      "INSERT INTO clients (org_id, first_name, last_name, email) VALUES ($1, 'AR', 'OpenFixture', $2) RETURNING id",
      [orgId, "ar-open-issued+" + tag + "-" + randomUUID() + "@example.invalid"]
    )).rows[0].id;
    buyerA = await buyer(orgA, "a");
    buyerB = await buyer(orgB, "b");

    const invoice = async (orgId, buyerId, amount) => {
      const result = await createInvoice(conn, {
        orgId, clientId: buyerId, source: "funding_success_fee", amount
      });
      assert.ok(result?.id);
      return result;
    };
    // Fixture amounts only, NOT production offer prices.
    draft = await invoice(orgA, buyerA, 475);
    const toSend = await invoice(orgA, buyerA, 125);
    sent = await markSent(conn, { invoiceId: toSend.id });
    assert.equal(sent?.status, "sent");
    const terminal = await invoice(orgA, buyerA, 210);
    await markSent(conn, { invoiceId: terminal.id });
    stalePaid = await markPaid(conn, { invoiceId: terminal.id });
    assert.equal(stalePaid?.status, "paid");
    // No payment row on stalePaid intentionally: this simulates an inconsistent
    // status+receipt ledger without putting a debt back in the Open queue.
    otherSent = await invoice(orgB, buyerB, 830);
    otherSent = await markSent(conn, { invoiceId: otherSent.id });
    assert.equal(otherSent?.status, "sent");
  });

  after(async () => {
    if (conn) {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
    }
    await close();
  });

  const list = async (orgId, { open = false, status = null } = {}) => (await conn.query(
    AR_INVOICE_LIST_SQL, [51, 0, null, status, orgId, open]
  )).rows;

  test("open A/R contains only the $125 issued receivable, never $475 draft or $210 paid", async () => {
    const rows = await list(orgA, { open: true });
    assert.deepEqual(rows.map((r) => String(r.id)), [String(sent.id)]);
    assert.equal(Number(rows[0].open_balance), 125);
    assert.equal(Number(rows[0].balance_due), 125);
    assert.ok(!rows.some((r) => String(r.id) === String(draft.id)));
    assert.ok(!rows.some((r) => String(r.id) === String(stalePaid.id)));
    assert.ok(!rows.some((r) => String(r.id) === String(otherSent.id)));
  });

  test("the entire finance history retains draft and paid rows for authorized review", async () => {
    const rows = await list(orgA);
    assert.deepEqual(new Set(rows.map((r) => String(r.id))), new Set([
      String(draft.id), String(sent.id), String(stalePaid.id)
    ]));
  });

  test("?status=draft remains usable without treating drafts as Open", async () => {
    const rows = await list(orgA, { status: "draft" });
    assert.deepEqual(rows.map((r) => String(r.id)), [String(draft.id)]);
    assert.equal(Number(rows[0].open_balance), 475);
  });

  test("company B's $830 legitimate issued invoice remains visible to B only", async () => {
    const rows = await list(orgB, { open: true });
    assert.deepEqual(rows.map((r) => String(r.id)), [String(otherSent.id)]);
    assert.equal(Number(rows[0].open_balance), 830);
  });
});
