// A/R receipt ownership guard: real disposable PostgreSQL, no provider calls.
// CI=true + loopback /fundhub_ci only. Two synthetic organizations, plus-tag
// buyers and contradictory invoice fixtures are enclosed in BEGIN/ROLLBACK.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { createInvoice, markSent, getInvoice } from "./index.mjs";
import { allocatePayment } from "./allocate.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(u.hostname)
      && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

describe("A/R receipts require an invoice buyer owned by the invoice tenant (real PG)", {
  skip: SCRATCH ? false : "CI disposable loopback fundhub_ci only"
}, () => {
  let conn, tx, orgA, orgB, buyerA, buyerB, validInvoice, foreignBuyerInvoice;

  before(async () => {
    conn = await pool().connect();
    await conn.query("BEGIN");
    tx = { query: (...args) => conn.query(...args) };

    async function org(tag) {
      return (await conn.query(
        "INSERT INTO orgs (slug, name) VALUES ($1, $2) RETURNING id",
        [`ci-ar-allocate-${tag}-${randomUUID()}`, `CI AR Allocate ${tag}`]
      )).rows[0].id;
    }
    orgA = await org("a");
    orgB = await org("b");

    async function buyer(orgId, tag) {
      return (await conn.query(
        `INSERT INTO clients (org_id, first_name, last_name, email)
         VALUES ($1, 'AR', 'OwnedFixture', $2) RETURNING id`,
        [orgId, `ar-allocate-owned+${tag}-${randomUUID()}@example.invalid`]
      )).rows[0].id;
    }
    buyerA = await buyer(orgA, "a");
    buyerB = await buyer(orgB, "b");

    async function issued(orgId, clientId) {
      const draft = await createInvoice(conn, {
        orgId, clientId, source: "funding_success_fee", amount: 100
      });
      assert.ok(draft?.id);
      const sent = await markSent(conn, { invoiceId: draft.id });
      assert.ok(sent?.id);
      return sent;
    }
    validInvoice = await issued(orgA, buyerA);
    // The legacy invoice client FK allows this contradictory tenant pairing.
    foreignBuyerInvoice = await issued(orgA, buyerB);
  });

  after(async () => {
    if (conn) {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
    }
    await close();
  });

  const event = (invoiceId, paymentId = randomUUID()) => ({
    name: "payment.received", id: randomUUID(), orgId: orgA, clientId: null,
    payload: { product: "success_fee", invoiceId, amount: 25, paymentId }
  });

  const count = async (invoiceId) => (await conn.query(
    "SELECT COUNT(*)::int AS n FROM invoice_payments WHERE invoice_id = $1",
    [invoiceId]
  )).rows[0].n;

  test("invoice-only callback cannot credit a foreign-org buyer or silently acknowledge it", async () => {
    const receipt = event(foreignBuyerInvoice.id);
    await assert.rejects(allocatePayment(tx, receipt), /ar_invoice_buyer_not_owned_by_org/);
    assert.equal(await count(foreignBuyerInvoice.id), 0);
    assert.equal((await getInvoice(conn, { invoiceId: foreignBuyerInvoice.id })).status, "sent");
    const tasks = await conn.query(
      "SELECT COUNT(*)::int AS n FROM tasks WHERE org_id = $1 AND client_id = $2",
      [orgA, buyerB]
    );
    assert.equal(tasks.rows[0].n, 0, "must not attach a task to foreign buyer");
  });

  test("a valid same-org buyer can still pay part of the issued invoice", async () => {
    const paid = await allocatePayment(tx, event(validInvoice.id));
    assert.equal(paid.allocated, true);
    assert.equal(paid.appliedCents, 2500);
    assert.equal(paid.remainingCents, 7500);
    assert.equal(await count(validInvoice.id), 1);
    assert.equal((await getInvoice(conn, { invoiceId: validInvoice.id })).status, "partially_paid");
  });

  test("an existing processor receipt on a contradictory invoice cannot be replay-acknowledged", async () => {
    const paymentId = `ci-ar-foreign-buyer-replay-${randomUUID()}`;
    await conn.query(
      `INSERT INTO invoice_payments
       (org_id, invoice_id, kind, amount, method, external_ref, source_event_id)
       VALUES ($1, $2, 'payment', 15, 'commas', $3, $4)`,
      [orgA, foreignBuyerInvoice.id, paymentId, randomUUID()]
    );
    assert.equal(await count(foreignBuyerInvoice.id), 1);
    await assert.rejects(
      allocatePayment(tx, event(foreignBuyerInvoice.id, paymentId)),
      /ar_invoice_buyer_not_owned_by_org/
    );
    assert.equal(await count(foreignBuyerInvoice.id), 1, "no second receipt");
    assert.equal((await getInvoice(conn, { invoiceId: foreignBuyerInvoice.id })).status, "sent");
  });

  test("a checkout link cannot override the invoice's foreign-buyer mismatch", async () => {
    const linked = (await conn.query(
      `INSERT INTO payment_links
       (org_id, client_id, purpose, amount_cents, link_ref, checkout_url, invoice_id)
       VALUES ($1,$2,'custom',10000,$3,'https://example.invalid/ci',$4)
       RETURNING id`,
      [orgA, buyerA, `ci-ar-cross-owner-${randomUUID()}`, foreignBuyerInvoice.id]
    )).rows[0].id;
    const receipt = event(foreignBuyerInvoice.id);
    receipt.payload.paymentLinkId = linked;
    await assert.rejects(allocatePayment(tx, receipt), /ar_invoice_buyer_not_owned_by_org/);
    assert.equal(await count(foreignBuyerInvoice.id), 1, "only the deliberate historical fixture remains");
  });
});
