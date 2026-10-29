// A/R: an explicit provider checkout ID must not fall back to a second local ref.
// Disposable GitHub Actions PostgreSQL only; every synthetic row rolls back.
// No Supabase writes, real Commas calls, live messages or customer records.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
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

describe("A/R explicit checkout ID cannot be rescued by conflicting reference (real PG)",
  { skip: SCRATCH ? false : "CI loopback fundhub_ci only" }, () => {
    let conn, tx, orgId, foreignOrgId, buyerId, foreignBuyerId;

    before(async () => {
      conn = await pool().connect();
      await conn.query("BEGIN");
      tx = { query: (...args) => conn.query(...args) };
      orgId = await resolveDefaultOrg(conn);
      foreignOrgId = (await conn.query(
        "INSERT INTO orgs (slug, name) VALUES ($1, 'AR Checkout Foreign Tenant') RETURNING id",
        [`ar-checkout-foreign-${randomUUID()}`]
      )).rows[0].id;
      const buyer = async (org, tag) => (await conn.query(
        `INSERT INTO clients (org_id, first_name, last_name, email)
         VALUES ($1,'AR','CheckoutTest',$2) RETURNING id`,
        [org, `ar-checkout+${tag}-${randomUUID()}@example.invalid`]
      )).rows[0].id;
      buyerId = await buyer(orgId, "same");
      foreignBuyerId = await buyer(foreignOrgId, "foreign");
    });

    after(async () => {
      if (conn) {
        await conn.query("ROLLBACK").catch(() => {});
        conn.release();
      }
      await close();
    });

    const issue = async (org, client) => {
      const draft = await createInvoice(conn, {
        orgId: org, clientId: client, source: "funding_success_fee", amount: 100
      });
      assert.ok(draft?.id);
      return markSent(conn, { invoiceId: draft.id });
    };

    const makeLink = async (org, client, invoice) => {
      const ref = `ar-checkout-link-${randomUUID()}`;
      const row = await conn.query(
        `INSERT INTO payment_links
           (org_id, client_id, purpose, amount_cents, link_ref, checkout_url, invoice_id)
         VALUES ($1,$2,'custom',10000,$3,'https://example.invalid/ci-checkout',$4)
         RETURNING id, link_ref`,
        [org, client, ref, invoice.id]
      );
      return row.rows[0];
    };

    const receipt = (invoiceId, id, ref, paymentId = randomUUID()) => ({
      name: "payment.received", id: randomUUID(), orgId, clientId: buyerId,
      payload: {
        product: "success_fee", amount: 25, paymentId,
        invoiceId, paymentLinkId: id, ref
      }
    });

    const count = async (invoice) => (await conn.query(
      "SELECT COUNT(*)::int AS n FROM invoice_payments WHERE invoice_id = $1",
      [invoice.id]
    )).rows[0].n;

    test("first-time receipt with foreign checkout ID and valid local ref cannot credit either buyer", async () => {
      const localInvoice = await issue(orgId, buyerId);
      const foreignInvoice = await issue(foreignOrgId, foreignBuyerId);
      const good = await makeLink(orgId, buyerId, localInvoice);
      const foreign = await makeLink(foreignOrgId, foreignBuyerId, foreignInvoice);

      const got = await allocatePayment(tx, receipt(localInvoice.id, foreign.id, good.link_ref));
      assert.equal(got.allocated, false);
      assert.equal(got.reason, "invoice_mismatch");
      assert.equal("invoiceId" in got, false, "do not disclose invoice identity in conflict response");
      assert.equal(await count(localInvoice), 0);
      assert.equal(await count(foreignInvoice), 0);
      assert.equal((await getInvoice(conn, { invoiceId: localInvoice.id })).status, "sent");
      assert.equal((await getInvoice(conn, { invoiceId: foreignInvoice.id })).status, "sent");
    });

    test("replayed PSP reference with foreign checkout ID and valid local ref must be reviewed", async () => {
      const localInvoice = await issue(orgId, buyerId);
      const foreignInvoice = await issue(foreignOrgId, foreignBuyerId);
      const good = await makeLink(orgId, buyerId, localInvoice);
      const foreign = await makeLink(foreignOrgId, foreignBuyerId, foreignInvoice);
      const paymentId = `ar-explicit-checkout-${randomUUID()}`;
      const first = await allocatePayment(tx, receipt(localInvoice.id, good.id, good.link_ref, paymentId));
      assert.equal(first.allocated, true);
      assert.equal(await count(localInvoice), 1);

      const conflicting = await allocatePayment(
        tx, receipt(localInvoice.id, foreign.id, good.link_ref, paymentId)
      );
      assert.equal(conflicting.allocated, false);
      assert.equal(conflicting.replay, false);
      assert.equal(conflicting.reason, "receipt_reference_mismatch");
      assert.equal(await count(localInvoice), 1);
      assert.equal(await count(foreignInvoice), 0);
      const tasks = await conn.query(
        `SELECT client_id FROM tasks
         WHERE org_id = $1 AND source_workflow = 'ar-allocate' AND body = $2`,
        [orgId, `receipt-conflict:${paymentId}`]
      );
      assert.equal(tasks.rows.length, 1);
      assert.equal(String(tasks.rows[0].client_id), String(buyerId));
    });

    test("real matching checkout ID + local ref still allocates once, replay stays safe", async () => {
      const invoice = await issue(orgId, buyerId);
      const good = await makeLink(orgId, buyerId, invoice);
      const paymentId = `ar-valid-checkout-${randomUUID()}`;
      const first = await allocatePayment(tx, receipt(invoice.id, good.id, good.link_ref, paymentId));
      assert.equal(first.allocated, true);
      assert.equal(first.appliedCents, 2500);
      const replay = await allocatePayment(tx, receipt(invoice.id, good.id, good.link_ref, paymentId));
      assert.equal(replay.replay, true);
      assert.equal(await count(invoice), 1);
    });
  });
